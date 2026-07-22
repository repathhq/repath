//! Management API handlers.
//!
//! Each handler queries PostgreSQL directly via the shared pool in AppState.
//! Response types are inline structs with serde — we don't re-use the domain
//! types from `repath-common` here because the API shape is deliberately
//! different (richer, flatter, API-consumer-friendly).

use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
};
use chrono::{DateTime, Utc};
use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

// ── Response types ─────────────────────────────────────────────────────────

#[derive(Serialize)]
struct RolloutSummary {
    id: Uuid,
    name: String,
    state: String,
    current_weight: f64,
    baseline_model: String,
    candidate_model: String,
    avg_quality_candidate: Option<f64>,
    avg_quality_baseline: Option<f64>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct RolloutDetail {
    id: Uuid,
    name: String,
    state: String,
    current_weight: f64,
    baseline_version_id: Uuid,
    candidate_version_id: Uuid,
    baseline_model: String,
    candidate_model: String,
    baseline_prompt: Option<String>,
    candidate_prompt: Option<String>,
    policy: Value,
    strategy: Value,
    avg_quality_baseline: Option<f64>,
    avg_quality_candidate: Option<f64>,
    p95_latency_baseline: Option<i64>,
    p95_latency_candidate: Option<i64>,
    error_rate_baseline: Option<f64>,
    error_rate_candidate: Option<f64>,
    sample_count_baseline: Option<i64>,
    sample_count_candidate: Option<i64>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct MetricPoint {
    ts: DateTime<Utc>,
    version_id: Uuid,
    role: String, // "baseline" | "candidate"
    avg_quality: f64,
    p95_latency_ms: i64,
    error_rate: f64,
    request_count: i64,
}

#[derive(Serialize)]
struct StepInfo {
    step_number: i32,
    target_weight: f64,
    gate_expression: String,
    status: String,
    pause_duration_seconds: Option<i32>,
    started_at: Option<DateTime<Utc>>,
    completed_at: Option<DateTime<Utc>>,
}

#[derive(Serialize)]
struct DecisionInfo {
    id: Uuid,
    action: String,
    reason: String,
    previous_weight: Option<f64>,
    new_weight: Option<f64>,
    triggered_by: String,
    metrics_snapshot: Option<Value>,
    created_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct SystemHealth {
    status: String,
    database: String,
    redis: String,
    gateway_version: String,
    active_rollouts: i64,
}

// ── Handlers ───────────────────────────────────────────────────────────────

pub async fn list_rollouts(State(state): State<AppState>) -> impl IntoResponse {
    let rows = sqlx::query(
        r#"
        SELECT
            r.id, r.name, r.state, r.current_weight,
            r.created_at, r.updated_at, r.completed_at,
            bv.model AS baseline_model,
            cv.model AS candidate_model,
            COALESCE(
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id)
            ) AS avg_quality_candidate,
            COALESCE(
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id)
            ) AS avg_quality_baseline
        FROM rollouts r
        JOIN versions bv ON r.baseline_version_id = bv.id
        JOIN versions cv ON r.candidate_version_id = cv.id
        ORDER BY
            CASE r.state
                WHEN 'canary'  THEN 1
                WHEN 'shadow'  THEN 2
                WHEN 'created' THEN 3
                WHEN 'paused'  THEN 4
                ELSE 5
            END,
            r.created_at DESC
        LIMIT 50
        "#,
    )
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let summaries: Vec<RolloutSummary> = rows
                .iter()
                .map(|r| RolloutSummary {
                    id: r.get("id"),
                    name: r.get("name"),
                    state: r.get("state"),
                    current_weight: r.get("current_weight"),
                    baseline_model: r.get("baseline_model"),
                    candidate_model: r.get("candidate_model"),
                    avg_quality_candidate: r.get("avg_quality_candidate"),
                    avg_quality_baseline: r.get("avg_quality_baseline"),
                    created_at: r.get("created_at"),
                    updated_at: r.get("updated_at"),
                    completed_at: r.get("completed_at"),
                })
                .collect();
            Json(json!({ "rollouts": summaries, "total": summaries.len() })).into_response()
        }
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

pub async fn get_rollout(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let row = sqlx::query(
        r#"
        SELECT
            r.id, r.name, r.state, r.current_weight, r.policy, r.strategy,
            r.baseline_version_id, r.candidate_version_id,
            r.created_at, r.updated_at, r.completed_at,
            bv.model AS baseline_model, bv.prompt_template AS baseline_prompt,
            cv.model AS candidate_model, cv.prompt_template AS candidate_prompt,
            COALESCE(
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id)
            ) AS avg_quality_baseline,
            COALESCE(
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id)
            ) AS avg_quality_candidate,
            COALESCE(
                (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY req.latency_ms)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY req.latency_ms)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.baseline_version_id)
            )::BIGINT AS p95_latency_baseline,
            COALESCE(
                (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY req.latency_ms)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY req.latency_ms)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.candidate_version_id)
            )::BIGINT AS p95_latency_candidate,
            COALESCE(
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id)
            ) AS sample_count_baseline,
            COALESCE(
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id)
            ) AS sample_count_candidate,
            COALESCE(
                (SELECT SUM(CASE WHEN req.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT SUM(CASE WHEN req.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.baseline_version_id)
            ) AS error_rate_baseline,
            COALESCE(
                (SELECT SUM(CASE WHEN req.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes'),
                (SELECT SUM(CASE WHEN req.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0)
                 FROM requests req WHERE req.rollout_id = r.id
                   AND req.version_id = r.candidate_version_id)
            ) AS error_rate_candidate
        FROM rollouts r
        JOIN versions bv ON r.baseline_version_id = bv.id
        JOIN versions cv ON r.candidate_version_id = cv.id
        WHERE r.id::text = $1 OR r.name = $1
        LIMIT 1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match row {
        Ok(Some(r)) => {
            let detail = RolloutDetail {
                id: r.get("id"),
                name: r.get("name"),
                state: r.get("state"),
                current_weight: r.get("current_weight"),
                baseline_version_id: r.get("baseline_version_id"),
                candidate_version_id: r.get("candidate_version_id"),
                baseline_model: r.get("baseline_model"),
                candidate_model: r.get("candidate_model"),
                baseline_prompt: r.get("baseline_prompt"),
                candidate_prompt: r.get("candidate_prompt"),
                policy: r.get("policy"),
                strategy: r.get("strategy"),
                avg_quality_baseline: r.get("avg_quality_baseline"),
                avg_quality_candidate: r.get("avg_quality_candidate"),
                p95_latency_baseline: r.get("p95_latency_baseline"),
                p95_latency_candidate: r.get("p95_latency_candidate"),
                error_rate_baseline: r.get("error_rate_baseline"),
                error_rate_candidate: r.get("error_rate_candidate"),
                sample_count_baseline: r.get("sample_count_baseline"),
                sample_count_candidate: r.get("sample_count_candidate"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
                completed_at: r.get("completed_at"),
            };
            Json(json!(detail)).into_response()
        }
        Ok(None) => api_error(StatusCode::NOT_FOUND, format!("Rollout not found: '{id}'")),
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

pub async fn get_rollout_metrics(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    // Get the rollout ID first
    let rollout_id_row = sqlx::query(
        "SELECT id, baseline_version_id, candidate_version_id FROM rollouts WHERE id::text = $1 OR name = $1 LIMIT 1",
    )
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    let rollout_row = match rollout_id_row {
        Ok(Some(r)) => r,
        Ok(None) => return api_error(StatusCode::NOT_FOUND, format!("Rollout not found: '{id}'")),
        Err(e) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    let rollout_id: Uuid = rollout_row.get("id");
    let baseline_id: Uuid = rollout_row.get("baseline_version_id");
    let _candidate_id: Uuid = rollout_row.get("candidate_version_id");

    // Time-series: bucket by 1-minute intervals over the last 60 minutes
    let rows = sqlx::query(
        r#"
        SELECT
            DATE_TRUNC('minute', req.created_at)   AS ts,
            req.version_id,
            COALESCE(AVG(e.overall_score), 0.0)    AS avg_quality,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY req.latency_ms), 0)::BIGINT AS p95_latency_ms,
            COALESCE(
                SUM(CASE WHEN req.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0),
                0.0
            )                                      AS error_rate,
            COUNT(*)                               AS request_count
        FROM requests req
        LEFT JOIN evaluations e ON e.request_id = req.id
        WHERE req.rollout_id = $1
          AND req.created_at > NOW() - INTERVAL '60 minutes'
        GROUP BY DATE_TRUNC('minute', req.created_at), req.version_id
        ORDER BY ts ASC, req.version_id
        "#,
    )
    .bind(rollout_id)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let points: Vec<MetricPoint> = rows
                .iter()
                .map(|r| {
                    let version_id: Uuid = r.get("version_id");
                    let role = if version_id == baseline_id {
                        "baseline"
                    } else {
                        "candidate"
                    };
                    MetricPoint {
                        ts: r.get("ts"),
                        version_id,
                        role: role.to_string(),
                        avg_quality: r.get("avg_quality"),
                        p95_latency_ms: r.get("p95_latency_ms"),
                        error_rate: r.get("error_rate"),
                        request_count: r.get("request_count"),
                    }
                })
                .collect();
            Json(json!({ "metrics": points })).into_response()
        }
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

pub async fn get_rollout_steps(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let rollout_id_row =
        sqlx::query("SELECT id FROM rollouts WHERE id::text = $1 OR name = $1 LIMIT 1")
            .bind(&id)
            .fetch_optional(&state.db_pool)
            .await;

    let rollout_id: Uuid = match rollout_id_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return api_error(StatusCode::NOT_FOUND, format!("Rollout not found: '{id}'")),
        Err(e) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    let rows = sqlx::query(
        r#"
        SELECT step_number, target_weight, gate_expression, status,
               pause_duration_seconds, started_at, completed_at
        FROM rollout_steps
        WHERE rollout_id = $1
        ORDER BY step_number
        "#,
    )
    .bind(rollout_id)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let steps: Vec<StepInfo> = rows
                .iter()
                .map(|r| StepInfo {
                    step_number: r.get("step_number"),
                    target_weight: r.get("target_weight"),
                    gate_expression: r.get("gate_expression"),
                    status: r.get("status"),
                    pause_duration_seconds: r.get("pause_duration_seconds"),
                    started_at: r.get("started_at"),
                    completed_at: r.get("completed_at"),
                })
                .collect();
            Json(json!({ "steps": steps })).into_response()
        }
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

pub async fn get_rollout_decisions(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let rollout_id_row =
        sqlx::query("SELECT id FROM rollouts WHERE id::text = $1 OR name = $1 LIMIT 1")
            .bind(&id)
            .fetch_optional(&state.db_pool)
            .await;

    let rollout_id: Uuid = match rollout_id_row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return api_error(StatusCode::NOT_FOUND, format!("Rollout not found: '{id}'")),
        Err(e) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    let rows = sqlx::query(
        r#"
        SELECT id, action, reason, previous_weight, new_weight,
               triggered_by, metrics_snapshot, created_at
        FROM decisions
        WHERE rollout_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(rollout_id)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let decisions: Vec<DecisionInfo> = rows
                .iter()
                .map(|r| DecisionInfo {
                    id: r.get("id"),
                    action: r.get("action"),
                    reason: r.get("reason"),
                    previous_weight: r.get("previous_weight"),
                    new_weight: r.get("new_weight"),
                    triggered_by: r.get("triggered_by"),
                    metrics_snapshot: r.get("metrics_snapshot"),
                    created_at: r.get("created_at"),
                })
                .collect();
            Json(json!({ "decisions": decisions })).into_response()
        }
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// GET /api/v1/system/providers
/// Returns health status for every provider URL seen in the last 60 seconds.
/// Used by the dashboard to show provider reliability and incident history.
pub async fn provider_health(State(state): State<AppState>) -> impl IntoResponse {
    let snapshot = state.provider_health.snapshot();
    Json(json!({
        "providers": snapshot,
        "window_seconds": 60,
    }))
}

pub async fn system_health(State(state): State<AppState>) -> impl IntoResponse {
    let db_ok = sqlx::query("SELECT 1")
        .execute(&state.db_pool)
        .await
        .is_ok();

    let redis_ok = {
        let mut conn = state.redis.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok()
    };

    let active_rollouts: i64 = if db_ok {
        sqlx::query("SELECT COUNT(*) AS n FROM rollouts WHERE state IN ('canary','shadow')")
            .fetch_one(&state.db_pool)
            .await
            .map(|r| r.get::<i64, _>("n"))
            .unwrap_or(0)
    } else {
        0
    };

    let overall = if db_ok && redis_ok { "ok" } else { "degraded" };

    let health = SystemHealth {
        status: overall.to_string(),
        database: if db_ok { "ok".into() } else { "error".into() },
        redis: if redis_ok {
            "ok".into()
        } else {
            "error".into()
        },
        gateway_version: env!("CARGO_PKG_VERSION").to_string(),
        active_rollouts,
    };

    let status = if db_ok && redis_ok {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };

    (status, Json(json!(health))).into_response()
}

pub async fn promote_rollout(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match apply_manual_action(&state.db_pool, &id, "promote").await {
        Ok(msg) => Json(json!({ "message": msg })).into_response(),
        Err(e) => api_error(e.0, e.1),
    }
}

pub async fn rollback_rollout(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    match apply_manual_action(&state.db_pool, &id, "rollback").await {
        Ok(msg) => Json(json!({ "message": msg })).into_response(),
        Err(e) => api_error(e.0, e.1),
    }
}

async fn apply_manual_action(
    pool: &sqlx::PgPool,
    id: &str,
    action: &str,
) -> Result<String, (StatusCode, String)> {
    use sqlx::Row;

    // Resolve rollout
    let row = sqlx::query(
        "SELECT id, state, current_weight FROM rollouts WHERE id::text = $1 OR name = $1 LIMIT 1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .ok_or_else(|| (StatusCode::NOT_FOUND, format!("Rollout not found: '{id}'")))?;

    let rollout_id: Uuid = row.get("id");
    let state: String = row.get("state");
    let current_weight: f64 = row.get("current_weight");

    match action {
        "promote" => {
            if state == "promoted" {
                return Ok("Already promoted".into());
            }
            sqlx::query(
                "UPDATE rollouts SET state='promoted', current_weight=1.0, updated_at=NOW(), completed_at=NOW() WHERE id=$1 AND state IN ('canary','shadow','created')",
            )
            .bind(rollout_id)
            .execute(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            sqlx::query(
                "INSERT INTO decisions (id,rollout_id,action,reason,previous_weight,new_weight,triggered_by,created_at) VALUES ($1,$2,'promote','Manual promotion via dashboard',$3,1.0,'manual',NOW())",
            )
            .bind(Uuid::new_v4()).bind(rollout_id).bind(current_weight)
            .execute(pool).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            Ok("Promoted to 100%".into())
        }
        "rollback" => {
            if state == "rolled_back" {
                return Ok("Already rolled back".into());
            }
            sqlx::query(
                "UPDATE rollouts SET state='rolled_back', current_weight=0.0, updated_at=NOW(), completed_at=NOW() WHERE id=$1 AND state IN ('canary','shadow','created','paused')",
            )
            .bind(rollout_id)
            .execute(pool)
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            sqlx::query(
                "INSERT INTO decisions (id,rollout_id,action,reason,previous_weight,new_weight,triggered_by,created_at) VALUES ($1,$2,'rollback','Manual rollback via dashboard',$3,0.0,'manual',NOW())",
            )
            .bind(Uuid::new_v4()).bind(rollout_id).bind(current_weight)
            .execute(pool).await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

            Ok("Rolled back to baseline".into())
        }
        _ => Err((StatusCode::BAD_REQUEST, "Unknown action".into())),
    }
}

/// DELETE /api/v1/rollouts/:id
/// Hard-deletes the rollout and all associated requests/decisions/steps.
/// Versions are left intact (they may be shared).
pub async fn delete_rollout(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    use sqlx::Row;

    let row = sqlx::query("SELECT id FROM rollouts WHERE id::text = $1 OR name = $1 LIMIT 1")
        .bind(&id)
        .fetch_optional(&state.db_pool)
        .await;

    let rollout_id: Uuid = match row {
        Ok(Some(r)) => r.get("id"),
        Ok(None) => return api_error(StatusCode::NOT_FOUND, format!("Rollout not found: '{id}'")),
        Err(e) => return api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    // Delete requests referencing this rollout's versions, then the rollout.
    // Cascade deletes rollout_steps and decisions automatically.
    let result = sqlx::query("DELETE FROM requests WHERE rollout_id = $1")
        .bind(rollout_id)
        .execute(&state.db_pool)
        .await;

    if let Err(e) = result {
        return api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string());
    }

    match sqlx::query("DELETE FROM rollouts WHERE id = $1 RETURNING id")
        .bind(rollout_id)
        .fetch_optional(&state.db_pool)
        .await
    {
        Ok(Some(_)) => Json(json!({ "deleted": true, "id": rollout_id })).into_response(),
        Ok(None) => api_error(StatusCode::NOT_FOUND, "Rollout not found".into()),
        Err(e) => api_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

// ── Error helpers ───────────────────────────────────────────────────────────

fn api_error(status: StatusCode, message: String) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": {
                "message": message,
                "type": status_to_type(status),
            }
        })),
    )
        .into_response()
}

fn status_to_type(status: StatusCode) -> &'static str {
    match status.as_u16() {
        404 => "not_found",
        400 => "bad_request",
        409 => "conflict",
        _ => "internal_error",
    }
}
