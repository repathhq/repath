//! Database access layer for the controller.
//!
//! The controller only needs to read rollouts and write decisions/state updates.
//! All reads are straightforward SELECTs; writes use optimistic concurrency
//! (state guard in the WHERE clause) to prevent double-application.
//!
//! Uses `sqlx::query` (non-macro) throughout to avoid requiring DATABASE_URL
//! at compile time.

use chrono::Utc;
use repath_common::{Error, Result};
use sqlx::PgPool;
use uuid::Uuid;

/// Minimal rollout data the controller needs for decision-making.
#[derive(Debug, Clone)]
pub struct ActiveRolloutRow {
    pub id: Uuid,
    pub name: String,
    pub state: String,
    pub current_weight: f64,
    /// JSON-serialised RolloutPolicy
    pub policy_json: serde_json::Value,
    /// JSON-serialised RolloutStrategy
    pub strategy_json: serde_json::Value,
}

/// Aggregated quality metrics for one version within a rollout.
#[derive(Debug, Clone)]
pub struct VersionMetrics {
    pub version_id: Uuid,
    pub avg_quality: f64,
    pub p95_latency_ms: i64,
    pub error_rate: f64,
    pub sample_count: i64,
}

/// Fetch all rollouts currently in `shadow` or `canary` state.
pub async fn fetch_active_rollouts(pool: &PgPool) -> Result<Vec<ActiveRolloutRow>> {
    let rows = sqlx::query(
        r#"
        SELECT id, name, state, current_weight, policy, strategy
        FROM rollouts
        WHERE state IN ('created', 'shadow', 'canary')
        ORDER BY created_at ASC
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "fetch active rollouts".to_string(),
        source: e.into(),
    })?;

    rows.iter()
        .map(|r| {
            use sqlx::Row;
            Ok(ActiveRolloutRow {
                id: r.get("id"),
                name: r.get("name"),
                state: r.get("state"),
                current_weight: r.get("current_weight"),
                policy_json: r.get("policy"),
                strategy_json: r.get("strategy"),
            })
        })
        .collect()
}

/// Aggregate evaluation scores for both versions of a rollout.
///
/// Uses a rolling 10-minute window so stale scores from earlier in the
/// rollout don't mask recent degradation.
///
/// Returns metrics for baseline and candidate separately so the policy
/// evaluator can compare them.
pub async fn aggregate_version_metrics(
    pool: &PgPool,
    rollout_id: Uuid,
    window_minutes: i32,
) -> Result<Vec<VersionMetrics>> {
    let rows = sqlx::query(
        r#"
        SELECT
            r.version_id,
            COALESCE(AVG(e.overall_score), 0.0)                       AS avg_quality,
            COALESCE(
                PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY r.latency_ms),
                0
            )::BIGINT                                                  AS p95_latency_ms,
            COALESCE(
                SUM(CASE WHEN r.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT
                    / NULLIF(COUNT(*), 0),
                0.0
            )                                                          AS error_rate,
            COUNT(*)                                                   AS sample_count
        FROM requests r
        LEFT JOIN evaluations e ON e.request_id = r.id
        WHERE r.rollout_id = $1
          AND r.created_at > NOW() - ($2 || ' minutes')::INTERVAL
        GROUP BY r.version_id
        "#,
    )
    .bind(rollout_id)
    .bind(window_minutes)
    .fetch_all(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "aggregate version metrics".to_string(),
        source: e.into(),
    })?;

    rows.iter()
        .map(|r| {
            use sqlx::Row;
            Ok(VersionMetrics {
                version_id: r.get("version_id"),
                avg_quality: r.get("avg_quality"),
                p95_latency_ms: r.get("p95_latency_ms"),
                error_rate: r.get("error_rate"),
                sample_count: r.get("sample_count"),
            })
        })
        .collect()
}

/// Advance rollout weight to the next step.
///
/// The `WHERE state = 'canary'` guard means this is a no-op if another
/// writer already changed the state — idempotent and race-free.
///
/// Returns `true` if the UPDATE modified a row (decision applied),
/// `false` if the state guard prevented it (someone else already acted).
pub async fn apply_advance(
    pool: &PgPool,
    rollout_id: Uuid,
    new_weight: f64,
    new_state: &str, // 'canary' (intermediate) or 'promoted' (final step)
    reason: &str,
    old_weight: f64,
    metrics_snapshot: serde_json::Value,
) -> Result<bool> {
    let updated = sqlx::query(
        r#"
        UPDATE rollouts
        SET
            current_weight = $1,
            state          = $2,
            updated_at     = NOW(),
            completed_at   = CASE WHEN $2 = 'promoted' THEN NOW() ELSE NULL END
        WHERE id    = $3
          AND state IN ('canary', 'shadow')
        "#,
    )
    .bind(new_weight)
    .bind(new_state)
    .bind(rollout_id)
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "advance rollout".to_string(),
        source: e.into(),
    })?
    .rows_affected();

    if updated == 0 {
        return Ok(false);
    }

    // Advance the active step's status
    sqlx::query(
        r#"
        UPDATE rollout_steps
        SET status       = 'passed',
            completed_at = NOW()
        WHERE rollout_id = $1
          AND status     = 'active'
        "#,
    )
    .bind(rollout_id)
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "mark step passed".to_string(),
        source: e.into(),
    })?;

    insert_decision(
        pool,
        rollout_id,
        if new_state == "promoted" { "promote" } else { "advance" },
        reason,
        Some(old_weight),
        Some(new_weight),
        "controller",
        Some(metrics_snapshot),
    )
    .await?;

    Ok(true)
}

/// Roll back a rollout to 100% baseline immediately.
///
/// Uses the same `WHERE state IN ('canary','shadow')` guard as advance —
/// safe to call concurrently without risk of double-rollback.
pub async fn apply_rollback(
    pool: &PgPool,
    rollout_id: Uuid,
    reason: &str,
    old_weight: f64,
    metrics_snapshot: serde_json::Value,
) -> Result<bool> {
    let updated = sqlx::query(
        r#"
        UPDATE rollouts
        SET
            current_weight = 0.0,
            state          = 'rolled_back',
            updated_at     = NOW(),
            completed_at   = NOW()
        WHERE id    = $1
          AND state IN ('canary', 'shadow')
        "#,
    )
    .bind(rollout_id)
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "rollback rollout".to_string(),
        source: e.into(),
    })?
    .rows_affected();

    if updated == 0 {
        return Ok(false);
    }

    // Mark all pending/active steps as failed
    sqlx::query(
        r#"
        UPDATE rollout_steps
        SET status       = 'failed',
            completed_at = NOW()
        WHERE rollout_id = $1
          AND status     IN ('pending', 'active')
        "#,
    )
    .bind(rollout_id)
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "mark steps failed on rollback".to_string(),
        source: e.into(),
    })?;

    insert_decision(
        pool,
        rollout_id,
        "rollback",
        reason,
        Some(old_weight),
        Some(0.0),
        "controller",
        Some(metrics_snapshot),
    )
    .await?;

    Ok(true)
}

/// Activate the next pending step for a rollout.
pub async fn activate_next_step(pool: &PgPool, rollout_id: Uuid) -> Result<Option<i32>> {
    let row = sqlx::query(
        r#"
        UPDATE rollout_steps
        SET status     = 'active',
            started_at = NOW()
        WHERE rollout_id = $1
          AND status     = 'pending'
          AND step_number = (
              SELECT MIN(step_number)
              FROM rollout_steps
              WHERE rollout_id = $1
                AND status = 'pending'
          )
        RETURNING step_number
        "#,
    )
    .bind(rollout_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "activate next step".to_string(),
        source: e.into(),
    })?;

    Ok(row.map(|r| {
        use sqlx::Row;
        r.get::<i32, _>("step_number")
    }))
}

/// Get the currently active step for a rollout.
pub async fn get_active_step(
    pool: &PgPool,
    rollout_id: Uuid,
) -> Result<Option<ActiveStepRow>> {
    let row = sqlx::query(
        r#"
        SELECT step_number, target_weight, gate_expression,
               pause_duration_seconds, started_at
        FROM rollout_steps
        WHERE rollout_id = $1
          AND status = 'active'
        LIMIT 1
        "#,
    )
    .bind(rollout_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "get active step".to_string(),
        source: e.into(),
    })?;

    Ok(row.map(|r| {
        use sqlx::Row;
        ActiveStepRow {
            step_number: r.get("step_number"),
            target_weight: r.get("target_weight"),
            gate_expression: r.get("gate_expression"),
            pause_duration_seconds: r.get("pause_duration_seconds"),
            started_at: r.get("started_at"),
        }
    }))
}

/// The active step for a rollout.
#[derive(Debug, Clone)]
pub struct ActiveStepRow {
    pub step_number: i32,
    pub target_weight: f64,
    pub gate_expression: String,
    pub pause_duration_seconds: Option<i32>,
    pub started_at: Option<chrono::DateTime<Utc>>,
}

/// Insert a decision record (audit log entry).
///
/// Called internally after every state transition. Never fails silently —
/// if we can't write the audit record, the caller surfaces the error.
#[allow(clippy::too_many_arguments)]
async fn insert_decision(
    pool: &PgPool,
    rollout_id: Uuid,
    action: &str,
    reason: &str,
    previous_weight: Option<f64>,
    new_weight: Option<f64>,
    triggered_by: &str,
    metrics_snapshot: Option<serde_json::Value>,
) -> Result<()> {
    sqlx::query(
        r#"
        INSERT INTO decisions (
            id, rollout_id, action, reason,
            previous_weight, new_weight, triggered_by,
            metrics_snapshot, created_at
        ) VALUES (
            $1, $2, $3, $4,
            $5, $6, $7,
            $8, NOW()
        )
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(rollout_id)
    .bind(action)
    .bind(reason)
    .bind(previous_weight)
    .bind(new_weight)
    .bind(triggered_by)
    .bind(metrics_snapshot)
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "insert decision".to_string(),
        source: e.into(),
    })?;

    Ok(())
}

/// Start a canary rollout: transition from 'created' → 'canary', activate step 1,
/// and set current_weight to the first step's target_weight.
pub async fn start_rollout(pool: &PgPool, rollout_id: Uuid) -> Result<bool> {
    // Get the first step's target weight
    let first_step_weight: f64 = sqlx::query(
        "SELECT target_weight FROM rollout_steps WHERE rollout_id = $1 ORDER BY step_number ASC LIMIT 1",
    )
    .bind(rollout_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "get first step weight".to_string(),
        source: e.into(),
    })?
    .map(|r| { use sqlx::Row; r.get::<f64, _>("target_weight") })
    .unwrap_or(0.1);

    let updated = sqlx::query(
        r#"
        UPDATE rollouts
        SET state          = 'canary',
            current_weight = $2,
            updated_at     = NOW()
        WHERE id    = $1
          AND state = 'created'
        "#,
    )
    .bind(rollout_id)
    .bind(first_step_weight)
    .bind(rollout_id)
    .execute(pool)
    .await
    .map_err(|e| Error::Database {
        operation: "start rollout".to_string(),
        source: e.into(),
    })?
    .rows_affected();

    if updated == 0 {
        return Ok(false);
    }

    activate_next_step(pool, rollout_id).await?;

    insert_decision(
        pool,
        rollout_id,
        "advance",
        "Rollout started",
        Some(0.0),
        None,
        "controller",
        None,
    )
    .await?;

    Ok(true)
}
