//! `repath rollout status <id-or-name>` — detailed rollout view.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use colored::Colorize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::display::{
    kv, quality_score, relative_time, section, state_badge, traffic_bar,
};

pub async fn status(pool: &PgPool, id_or_name: &str) -> Result<()> {
    let rollout = fetch_rollout(pool, id_or_name).await?;

    // ── Header ────────────────────────────────────────────────────────────────
    println!();
    println!(
        "  {} {}   {}",
        rollout.name.bold().white(),
        state_badge(&rollout.state),
        format!("({})", rollout.id).dimmed(),
    );

    // ── Overview ──────────────────────────────────────────────────────────────
    section("Overview");
    kv("Baseline", &format!("{} ({})", rollout.baseline_model, rollout.baseline_version_id));
    kv("Candidate", &format!("{} ({})", rollout.candidate_model, rollout.candidate_version_id));
    kv("Created", &relative_time(&rollout.created_at));
    if let Some(completed) = rollout.completed_at {
        kv("Completed", &relative_time(&completed));
    }

    // ── Traffic split ─────────────────────────────────────────────────────────
    section("Traffic");
    let candidate_weight = rollout.current_weight;
    let baseline_weight = 1.0 - candidate_weight;
    traffic_bar("Baseline", baseline_weight, 30);
    traffic_bar("Candidate", candidate_weight, 30);

    // ── Quality metrics (last 10 minutes) ─────────────────────────────────────
    let metrics = fetch_version_metrics(pool, rollout.id).await?;
    if !metrics.is_empty() {
        section("Quality (last 10 min)");
        let mut table = crate::display::make_table(vec![
            "VERSION", "ROLE", "QUALITY", "P95 LATENCY", "ERROR RATE", "SAMPLES",
        ]);
        for m in &metrics {
            use comfy_table::Cell;
            let role = if m.version_id == rollout.baseline_version_id {
                "baseline".dimmed().to_string()
            } else {
                "candidate".yellow().to_string()
            };
            table.add_row(vec![
                Cell::new(&m.model),
                Cell::new(role),
                Cell::new(quality_score(m.avg_quality)),
                Cell::new(format!("{}ms", m.p95_latency_ms)),
                Cell::new(format!("{:.1}%", m.error_rate * 100.0)),
                Cell::new(m.sample_count.to_string()),
            ]);
        }
        println!("{table}");
    } else {
        section("Quality");
        println!("  {}", "No evaluation data yet — traffic may be too low.".dimmed());
    }

    // ── Steps ─────────────────────────────────────────────────────────────────
    let steps = fetch_steps(pool, rollout.id).await?;
    if !steps.is_empty() {
        section("Steps");
        for step in &steps {
            let icon = match step.status.as_str() {
                "passed" => "✓".green().to_string(),
                "failed" => "✗".red().to_string(),
                "active" => "→".yellow().bold().to_string(),
                _ => "○".dimmed().to_string(),
            };
            let weight = format!("{}%", (step.target_weight * 100.0) as u32);
            let duration = step
                .started_at
                .map(|t| format!("  ({})", relative_time(&t)))
                .unwrap_or_default();
            println!(
                "  {} Step {}  {:>4}  {}{}",
                icon,
                step.step_number,
                weight.bold(),
                step.gate_expression.dimmed(),
                duration.dimmed(),
            );
        }
    }

    // ── Recent decisions ──────────────────────────────────────────────────────
    let decisions = fetch_recent_decisions(pool, rollout.id, 3).await?;
    if !decisions.is_empty() {
        section("Recent Decisions");
        for d in &decisions {
            println!(
                "  {}  {}  {}",
                relative_time(&d.created_at).dimmed(),
                crate::display::decision_action(&d.action),
                d.reason.dimmed(),
            );
        }
        println!(
            "  {}",
            format!("Run `repath rollout history {}` to see full history.", id_or_name).dimmed()
        );
    }

    println!();
    Ok(())
}

// ── Data structs + queries ─────────────────────────────────────────────────────

struct RolloutDetail {
    id: Uuid,
    name: String,
    state: String,
    current_weight: f64,
    baseline_version_id: Uuid,
    candidate_version_id: Uuid,
    baseline_model: String,
    candidate_model: String,
    created_at: DateTime<Utc>,
    completed_at: Option<DateTime<Utc>>,
}

struct VersionMetricsRow {
    version_id: Uuid,
    model: String,
    avg_quality: f64,
    p95_latency_ms: i64,
    error_rate: f64,
    sample_count: i64,
}

struct StepRow {
    step_number: i32,
    target_weight: f64,
    gate_expression: String,
    status: String,
    started_at: Option<DateTime<Utc>>,
}

struct DecisionRow {
    action: String,
    reason: String,
    created_at: DateTime<Utc>,
}

async fn fetch_rollout(pool: &PgPool, id_or_name: &str) -> Result<RolloutDetail> {
    use sqlx::Row;

    // Try as UUID first, fall back to name lookup
    let row = if let Ok(id) = id_or_name.parse::<Uuid>() {
        sqlx::query(
            r#"
            SELECT r.id, r.name, r.state, r.current_weight,
                   r.baseline_version_id, r.candidate_version_id,
                   r.created_at, r.completed_at,
                   bv.model AS baseline_model, cv.model AS candidate_model
            FROM rollouts r
            JOIN versions bv ON r.baseline_version_id = bv.id
            JOIN versions cv ON r.candidate_version_id = cv.id
            WHERE r.id = $1
            "#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    } else {
        sqlx::query(
            r#"
            SELECT r.id, r.name, r.state, r.current_weight,
                   r.baseline_version_id, r.candidate_version_id,
                   r.created_at, r.completed_at,
                   bv.model AS baseline_model, cv.model AS candidate_model
            FROM rollouts r
            JOIN versions bv ON r.baseline_version_id = bv.id
            JOIN versions cv ON r.candidate_version_id = cv.id
            WHERE r.name = $1
            ORDER BY r.created_at DESC
            LIMIT 1
            "#,
        )
        .bind(id_or_name)
        .fetch_optional(pool)
        .await
    }
    .context("Failed to query rollout")?;

    let row = row.ok_or_else(|| anyhow::anyhow!("Rollout not found: '{id_or_name}'"))?;

    Ok(RolloutDetail {
        id: row.get("id"),
        name: row.get("name"),
        state: row.get("state"),
        current_weight: row.get("current_weight"),
        baseline_version_id: row.get("baseline_version_id"),
        candidate_version_id: row.get("candidate_version_id"),
        baseline_model: row.get("baseline_model"),
        candidate_model: row.get("candidate_model"),
        created_at: row.get("created_at"),
        completed_at: row.get("completed_at"),
    })
}

async fn fetch_version_metrics(pool: &PgPool, rollout_id: Uuid) -> Result<Vec<VersionMetricsRow>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT
            req.version_id,
            v.model,
            COALESCE(AVG(e.overall_score), 0.0) AS avg_quality,
            COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY req.latency_ms), 0)::BIGINT AS p95_latency_ms,
            COALESCE(
                SUM(CASE WHEN req.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / NULLIF(COUNT(*), 0),
                0.0
            ) AS error_rate,
            COUNT(*) AS sample_count
        FROM requests req
        JOIN versions v ON req.version_id = v.id
        LEFT JOIN evaluations e ON e.request_id = req.id
        WHERE req.rollout_id = $1
          AND req.created_at > NOW() - INTERVAL '10 minutes'
        GROUP BY req.version_id, v.model
        "#,
    )
    .bind(rollout_id)
    .fetch_all(pool)
    .await
    .context("Failed to fetch version metrics")?;

    Ok(rows
        .iter()
        .map(|r| VersionMetricsRow {
            version_id: r.get("version_id"),
            model: r.get("model"),
            avg_quality: r.get("avg_quality"),
            p95_latency_ms: r.get("p95_latency_ms"),
            error_rate: r.get("error_rate"),
            sample_count: r.get("sample_count"),
        })
        .collect())
}

async fn fetch_steps(pool: &PgPool, rollout_id: Uuid) -> Result<Vec<StepRow>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT step_number, target_weight, gate_expression, status, started_at
        FROM rollout_steps
        WHERE rollout_id = $1
        ORDER BY step_number ASC
        "#,
    )
    .bind(rollout_id)
    .fetch_all(pool)
    .await
    .context("Failed to fetch steps")?;

    Ok(rows
        .iter()
        .map(|r| StepRow {
            step_number: r.get("step_number"),
            target_weight: r.get("target_weight"),
            gate_expression: r.get("gate_expression"),
            status: r.get("status"),
            started_at: r.get("started_at"),
        })
        .collect())
}

async fn fetch_recent_decisions(
    pool: &PgPool,
    rollout_id: Uuid,
    limit: i64,
) -> Result<Vec<DecisionRow>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT action, reason, created_at
        FROM decisions
        WHERE rollout_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        "#,
    )
    .bind(rollout_id)
    .bind(limit)
    .fetch_all(pool)
    .await
    .context("Failed to fetch decisions")?;

    Ok(rows
        .iter()
        .map(|r| DecisionRow {
            action: r.get("action"),
            reason: r.get("reason"),
            created_at: r.get("created_at"),
        })
        .collect())
}
