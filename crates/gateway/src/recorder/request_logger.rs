//! PostgreSQL request logging.
//!
//! Uses `sqlx::query` (not `sqlx::query!`) so compile-time SQL verification
//! is skipped. This avoids needing DATABASE_URL at build time in CI/CD pipelines
//! that don't have a live database. Query correctness is verified by integration
//! tests that run against a real database.

use super::RecordRequest;
use repath_common::{Error, Result};
use sqlx::PgPool;

/// Insert a completed request record into the `requests` table.
///
/// Called exclusively from the background recorder task — never the hot path.
///
/// Every proxied request is recorded, including pass-through calls with no
/// active rollout: those carry `version_id = NULL`. This function used to skip
/// them and return `Ok(())`, because the column was NOT NULL and a nil-UUID
/// sentinel violated its foreign key — which meant the bulk of traffic was
/// never metered and no error was ever surfaced. See migration 006.
pub async fn insert_request(pool: &PgPool, record: &RecordRequest) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO requests (
            id, rollout_id, version_id, model,
            input_tokens, output_tokens, latency_ms,
            status_code, error, session_id, tenant_id,
            provider, cost_micro_usd
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10, $11,
            $12, $13
        )
        "#,
    )
    .bind(record.request_id)
    .bind(record.rollout_id)
    .bind(record.version_id)
    .bind(&record.model)
    .bind(record.input_tokens.map(|t| t as i32))
    .bind(record.output_tokens.map(|t| t as i32))
    .bind(record.latency_ms as i32)
    .bind(record.status_code as i32)
    .bind(&record.error)
    .bind(&record.session_id)
    .bind(&record.tenant_id)
    .bind(&record.provider)
    .bind(super::cost::estimate_micro_usd(
        &record.model,
        record.input_tokens,
        record.output_tokens,
    ))
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "insert request".to_string(),
        source: e.into(),
    })?;

    insert_payload(pool, record).await;

    Ok(())
}

/// Longest prompt or response stored per request.
///
/// Generous enough to hold a real conversation, bounded so one pathological
/// request cannot write megabytes. Anything longer is stored truncated and
/// flagged, so the UI says "truncated" rather than presenting a clipped
/// prompt as though it were the whole thing.
const MAX_PAYLOAD_CHARS: usize = 32_768;

fn clip(s: &str) -> (String, bool) {
    if s.chars().count() <= MAX_PAYLOAD_CHARS {
        return (s.to_string(), false);
    }
    // Truncate on a character boundary — slicing bytes would panic on any
    // multi-byte character that straddles the cap.
    (s.chars().take(MAX_PAYLOAD_CHARS).collect(), true)
}

/// Store the prompt and response, if this tenant has capture enabled.
///
/// Deliberately best-effort and never propagates an error: the request has
/// already been served and its metrics already recorded. Losing the payload
/// costs a log entry; failing the insert above would cost the metrics that
/// rollout decisions depend on.
///
/// `expires_at` is written here from the tenant's plan rather than derived at
/// deletion time, so a later plan change cannot retroactively extend the
/// retention promise made about text already captured.
async fn insert_payload(pool: &PgPool, record: &RecordRequest) {
    let (request_body, req_truncated) = clip(&record.request_body_json);
    let (response_text, resp_truncated) = clip(&record.response_text);

    let result = sqlx::query(
        r#"
        INSERT INTO request_payloads
            (request_id, tenant_id, request_body, response_text, truncated, expires_at)
        SELECT $1, t.id, $2, $3, $4,
               NOW() + (retention_days(t.plan) || ' days')::INTERVAL
          FROM tenants t
         WHERE t.id = $5 AND t.capture_payloads = TRUE
        ON CONFLICT (request_id) DO NOTHING
        "#,
    )
    .bind(record.request_id)
    .bind(&request_body)
    .bind(&response_text)
    .bind(req_truncated || resp_truncated)
    .bind(&record.tenant_id)
    .execute(pool)
    .await;

    if let Err(e) = result {
        tracing::warn!(
            request_id = %record.request_id,
            error = %e,
            "Could not store request payload — metrics were still recorded"
        );
    }
}
