//! Request log — the evidence behind every score and every decision.
//!
//! # What this is for
//!
//! Observability tools show you traces. The useful question here is narrower
//! and harder: *why did the controller do that?* A rollback says "quality
//! 0.68 < 0.70" and, until now, that was the end of the trail — no way to see
//! which answers were bad or what the judge objected to.
//!
//! The judge's per-criterion reasoning has always been written to
//! `evaluations.metadata` and never surfaced anywhere. Pairing it with the
//! prompt and response (see migration 011) turns a score into an
//! explanation, and `requests_for_decision` walks back from a decision to the
//! exact requests that produced it.
//!
//! # Tenant scoping
//!
//! Every query here filters by tenant, and detail lookups return 404 rather
//! than 403 on a mismatch so ids cannot be probed. This is request *content* —
//! prompts and completions belonging to someone's end users — so a scoping
//! mistake here leaks more than a rollout name would.

use crate::{tenant::AuthContext, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Json},
    Extension,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

/// Page size. Capped so a client cannot ask for the whole table.
const DEFAULT_LIMIT: i64 = 50;
const MAX_LIMIT: i64 = 200;

#[derive(Deserialize)]
pub struct LogQuery {
    pub rollout_id: Option<Uuid>,
    pub version_id: Option<Uuid>,
    pub model: Option<String>,
    pub provider: Option<String>,
    /// "success" | "error" — coarse on purpose; an exact status code filter
    /// is rarely what someone scanning a log actually wants.
    pub status: Option<String>,
    /// Only requests scored at or below this. The main way in when hunting a
    /// regression: "show me the worst answers".
    pub max_score: Option<f64>,
    pub min_score: Option<f64>,
    /// "llm_judge" | "programmatic". Distinguishes a real quality measurement
    /// from the flat 1.0 the programmatic evaluator gives any healthy
    /// response — a distinction the dashboard used to hide.
    pub evaluator: Option<String>,
    pub limit: Option<i64>,
    /// Keyset pagination: pass the `created_at` of the last row seen.
    /// Offsets drift when new requests arrive mid-scroll, which on a live
    /// log is constantly.
    pub before: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct LogRow {
    id: Uuid,
    created_at: DateTime<Utc>,
    model: String,
    provider: Option<String>,
    latency_ms: i32,
    status_code: i32,
    input_tokens: Option<i32>,
    output_tokens: Option<i32>,
    /// Millionths of a dollar; `None` when the model is unpriced. The UI
    /// shows "—" rather than "$0.00", which would read as free.
    cost_micro_usd: Option<i64>,
    score: Option<f64>,
    evaluator_type: Option<String>,
    rollout_id: Option<Uuid>,
    version_id: Option<Uuid>,
    /// Which side of the rollout served this, when it was part of one.
    role: Option<String>,
    session_id: Option<String>,
    /// Whether prompt/response text is available for this request. False
    /// when the tenant has capture off, or the retention window has passed.
    has_payload: bool,
}

/// GET /api/v1/requests
pub async fn list_requests(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Query(q): Query<LogQuery>,
) -> impl IntoResponse {
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);

    // An admin caller (the dashboard proxying for a signed-in customer)
    // always arrives with an act-as tenant, so `tenant_filter` is Some in
    // practice; a bare operator token sees everything, which is what an
    // operator debugging a support ticket needs.
    let tenant = auth.tenant_filter();

    let rows = sqlx::query(
        r#"
        SELECT
            r.id, r.created_at, r.model, r.provider, r.latency_ms, r.status_code,
            r.input_tokens, r.output_tokens, r.cost_micro_usd,
            r.rollout_id, r.version_id, r.session_id,
            e.overall_score AS score,
            e.evaluator_type,
            CASE
                WHEN r.version_id IS NULL THEN NULL
                WHEN r.version_id = ro.candidate_version_id THEN 'candidate'
                WHEN r.version_id = ro.baseline_version_id  THEN 'baseline'
                ELSE NULL
            END AS role,
            (p.request_id IS NOT NULL) AS has_payload
        FROM requests r
        LEFT JOIN LATERAL (
            -- One request can in principle carry several evaluations. Take
            -- the judged one when there is one, since that is the score the
            -- controller acts on, and the newest otherwise.
            SELECT overall_score, evaluator_type
              FROM evaluations
             WHERE request_id = r.id
             ORDER BY (evaluator_type = 'llm_judge') DESC, created_at DESC
             LIMIT 1
        ) e ON TRUE
        LEFT JOIN rollouts ro ON ro.id = r.rollout_id
        LEFT JOIN request_payloads p ON p.request_id = r.id
        WHERE ($1::text IS NULL OR r.tenant_id = $1)
          AND ($2::uuid IS NULL OR r.rollout_id = $2)
          AND ($3::uuid IS NULL OR r.version_id = $3)
          AND ($4::text IS NULL OR r.model = $4)
          AND ($5::text IS NULL OR r.provider = $5)
          AND ($6::text IS NULL
               OR ($6 = 'error'   AND r.status_code >= 400)
               OR ($6 = 'success' AND r.status_code <  400))
          AND ($7::float8 IS NULL OR e.overall_score <= $7)
          AND ($8::float8 IS NULL OR e.overall_score >= $8)
          AND ($9::text IS NULL OR e.evaluator_type = $9)
          AND ($10::timestamptz IS NULL OR r.created_at < $10)
        ORDER BY r.created_at DESC
        LIMIT $11
        "#,
    )
    .bind(tenant)
    .bind(q.rollout_id)
    .bind(q.version_id)
    .bind(&q.model)
    .bind(&q.provider)
    .bind(&q.status)
    .bind(q.max_score)
    .bind(q.min_score)
    .bind(&q.evaluator)
    .bind(q.before)
    .bind(limit)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let items: Vec<LogRow> = rows.iter().map(to_log_row).collect();
            // The cursor for the next page is the oldest row on this one.
            let next_before = items.last().map(|r| r.created_at);
            Json(json!({
                "requests": items,
                "next_before": next_before,
                "has_more": items.len() as i64 == limit,
            }))
            .into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

fn to_log_row(r: &sqlx::postgres::PgRow) -> LogRow {
    LogRow {
        id: r.get("id"),
        created_at: r.get("created_at"),
        model: r.get("model"),
        provider: r.get("provider"),
        latency_ms: r.get("latency_ms"),
        status_code: r.get("status_code"),
        input_tokens: r.get("input_tokens"),
        output_tokens: r.get("output_tokens"),
        cost_micro_usd: r.get("cost_micro_usd"),
        score: r.get("score"),
        evaluator_type: r.get("evaluator_type"),
        rollout_id: r.get("rollout_id"),
        version_id: r.get("version_id"),
        role: r.get("role"),
        session_id: r.get("session_id"),
        has_payload: r.get("has_payload"),
    }
}

/// GET /api/v1/requests/:id
///
/// The full trace: metrics, the prompt and response, and every evaluation
/// with the judge's per-criterion reasoning.
pub async fn get_request(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let tenant = auth.tenant_filter();

    let row = sqlx::query(
        r#"
        SELECT
            r.id, r.created_at, r.model, r.provider, r.latency_ms, r.status_code,
            r.input_tokens, r.output_tokens, r.cost_micro_usd, r.error,
            r.rollout_id, r.version_id, r.session_id,
            ro.name AS rollout_name,
            CASE
                WHEN r.version_id IS NULL THEN NULL
                WHEN r.version_id = ro.candidate_version_id THEN 'candidate'
                WHEN r.version_id = ro.baseline_version_id  THEN 'baseline'
                ELSE NULL
            END AS role,
            v.prompt_template,
            p.request_body, p.response_text, p.truncated, p.expires_at
        FROM requests r
        LEFT JOIN rollouts ro ON ro.id = r.rollout_id
        LEFT JOIN versions v  ON v.id  = r.version_id
        LEFT JOIN request_payloads p ON p.request_id = r.id
        WHERE r.id = $1 AND ($2::text IS NULL OR r.tenant_id = $2)
        "#,
    )
    .bind(id)
    .bind(tenant)
    .fetch_optional(&state.db_pool)
    .await;

    let row = match row {
        // 404 rather than 403: a different status would confirm the id exists
        // and belongs to someone else.
        Ok(None) => return err(StatusCode::NOT_FOUND, format!("Request not found: {id}")),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        Ok(Some(r)) => r,
    };

    let evaluations = sqlx::query(
        "SELECT evaluator_type, overall_score, scores, metadata, created_at \
           FROM evaluations WHERE request_id = $1 ORDER BY created_at",
    )
    .bind(id)
    .fetch_all(&state.db_pool)
    .await
    .unwrap_or_default();

    let evals: Vec<Value> = evaluations
        .iter()
        .map(|e| {
            json!({
                "evaluator_type": e.get::<String, _>("evaluator_type"),
                "overall_score":  e.get::<f64, _>("overall_score"),
                "scores":         e.get::<Value, _>("scores"),
                // Carries the judge's per-criterion reasoning — the single
                // most useful field in the system, stored since day one and
                // never shown to anyone until now.
                "metadata":       e.get::<Option<Value>, _>("metadata"),
                "created_at":     e.get::<DateTime<Utc>, _>("created_at"),
            })
        })
        .collect();

    Json(json!({
        "id":             row.get::<Uuid, _>("id"),
        "created_at":     row.get::<DateTime<Utc>, _>("created_at"),
        "model":          row.get::<String, _>("model"),
        "provider":       row.get::<Option<String>, _>("provider"),
        "latency_ms":     row.get::<i32, _>("latency_ms"),
        "status_code":    row.get::<i32, _>("status_code"),
        "input_tokens":   row.get::<Option<i32>, _>("input_tokens"),
        "output_tokens":  row.get::<Option<i32>, _>("output_tokens"),
        "cost_micro_usd": row.get::<Option<i64>, _>("cost_micro_usd"),
        "error":          row.get::<Option<String>, _>("error"),
        "rollout_id":     row.get::<Option<Uuid>, _>("rollout_id"),
        "rollout_name":   row.get::<Option<String>, _>("rollout_name"),
        "version_id":     row.get::<Option<Uuid>, _>("version_id"),
        "role":           row.get::<Option<String>, _>("role"),
        "session_id":     row.get::<Option<String>, _>("session_id"),
        "system_prompt":  row.get::<Option<String>, _>("prompt_template"),
        "request_body":   row.get::<Option<String>, _>("request_body"),
        "response_text":  row.get::<Option<String>, _>("response_text"),
        "truncated":      row.get::<Option<bool>, _>("truncated").unwrap_or(false),
        "payload_expires_at": row.get::<Option<DateTime<Utc>>, _>("expires_at"),
        "evaluations":    evals,
    }))
    .into_response()
}

/// GET /api/v1/decisions/:id/requests
///
/// The requests that produced a decision.
///
/// This is the part no trace viewer offers, because no trace viewer makes the
/// decision. A rollback records the window it judged and the version it
/// judged; this replays that exact selection, worst-scoring first, so
/// "quality 0.68 < 0.70" becomes a list of the answers that caused it.
pub async fn requests_for_decision(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> impl IntoResponse {
    let tenant = auth.tenant_filter();

    // Resolve the decision, scoped to the tenant through its rollout.
    let decision = sqlx::query(
        "SELECT d.id, d.rollout_id, d.action, d.created_at, d.metrics_snapshot, \
                ro.candidate_version_id, ro.baseline_version_id \
           FROM decisions d \
           JOIN rollouts ro ON ro.id = d.rollout_id \
          WHERE d.id = $1 AND ($2::text IS NULL OR ro.tenant_id = $2)",
    )
    .bind(id)
    .bind(tenant)
    .fetch_optional(&state.db_pool)
    .await;

    let d = match decision {
        Ok(None) => return err(StatusCode::NOT_FOUND, format!("Decision not found: {id}")),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
        Ok(Some(d)) => d,
    };

    let action: String = d.get("action");
    let decided_at: DateTime<Utc> = d.get("created_at");
    let rollout_id: Uuid = d.get("rollout_id");
    let candidate_version: Uuid = d.get("candidate_version_id");
    let baseline_version: Uuid = d.get("baseline_version_id");

    // A rollback or an advance is a judgement about the candidate, so that is
    // the side worth showing. Anything else shows both.
    let focus_candidate = matches!(action.as_str(), "rollback" | "advance" | "promote");

    // The controller's metric window is 10 minutes by default. Looking back
    // that far from the decision reconstructs roughly what it saw — the
    // decision row does not store request ids, so this is a reconstruction
    // rather than an exact replay, and the response says so.
    let rows = sqlx::query(
        r#"
        SELECT
            r.id, r.created_at, r.model, r.provider, r.latency_ms, r.status_code,
            r.input_tokens, r.output_tokens, r.cost_micro_usd,
            r.rollout_id, r.version_id, r.session_id,
            e.overall_score AS score, e.evaluator_type,
            CASE WHEN r.version_id = $2 THEN 'candidate' ELSE 'baseline' END AS role,
            (p.request_id IS NOT NULL) AS has_payload
        FROM requests r
        LEFT JOIN LATERAL (
            SELECT overall_score, evaluator_type FROM evaluations
             WHERE request_id = r.id
             ORDER BY (evaluator_type = 'llm_judge') DESC, created_at DESC LIMIT 1
        ) e ON TRUE
        LEFT JOIN request_payloads p ON p.request_id = r.id
        WHERE r.rollout_id = $1
          AND r.created_at BETWEEN $3 - INTERVAL '10 minutes' AND $3
          AND ($4 = FALSE OR r.version_id = $2)
          AND r.version_id IN ($2, $5)
        -- Worst first: the point is to see what dragged the score down, and
        -- newest-first would bury it under whatever happened to be last.
        ORDER BY e.overall_score ASC NULLS LAST, r.created_at DESC
        LIMIT 100
        "#,
    )
    .bind(rollout_id)
    .bind(candidate_version)
    .bind(decided_at)
    .bind(focus_candidate)
    .bind(baseline_version)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let items: Vec<LogRow> = rows.iter().map(to_log_row).collect();
            Json(json!({
                "decision": {
                    "id": id,
                    "action": action,
                    "created_at": decided_at,
                    "metrics_snapshot": d.get::<Option<Value>, _>("metrics_snapshot"),
                },
                "requests": items,
                "window_minutes": 10,
                "note": "Requests from the controller's 10-minute metric window before this decision, worst-scoring first. Reconstructed from timestamps — decisions do not store individual request ids.",
            }))
            .into_response()
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

fn err(status: StatusCode, message: String) -> axum::response::Response {
    (
        status,
        Json(json!({ "error": { "message": message, "type": "log_error" } })),
    )
        .into_response()
}
