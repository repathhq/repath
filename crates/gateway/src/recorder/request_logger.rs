//! PostgreSQL request logging.
//!
//! Uses `sqlx::query` (not `sqlx::query!`) so compile-time SQL verification
//! is skipped. This avoids needing DATABASE_URL at build time in CI/CD pipelines
//! that don't have a live database. Query correctness is verified by integration
//! tests that run against a real database.

use super::RecordRequest;
use repath_common::{Error, Result};
use sqlx::PgPool;
use uuid::Uuid;

/// Insert a completed request record into the `requests` table.
///
/// Called exclusively from the background recorder task — never the hot path.
/// Skips requests with no version_id (pass-through calls with no active rollout).
pub async fn insert_request(pool: &PgPool, record: &RecordRequest) -> Result<()> {
    // version_id is Uuid::nil() when no rollout is active — skip those,
    // since the FK constraint requires a real row in the versions table.
    if record.version_id == Uuid::nil() {
        return Ok(());
    }

    sqlx::query(
        r#"
        INSERT INTO requests (
            id, rollout_id, version_id, model,
            input_tokens, output_tokens, latency_ms,
            status_code, error, session_id
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, $9, $10
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
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "insert request".to_string(),
        source: e.into(),
    })?;

    Ok(())
}
