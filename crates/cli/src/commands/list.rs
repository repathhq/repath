//! `repath rollout list` — show all rollouts in a formatted table.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use colored::Colorize;
use comfy_table::Cell;
use sqlx::PgPool;

use crate::display::{make_table, quality_score, relative_time, state_badge, weight_pct};

pub async fn list(pool: &PgPool) -> Result<()> {
    let rows = fetch_rollout_list(pool).await?;

    if rows.is_empty() {
        println!("{}", "No rollouts found.".dimmed());
        println!(
            "{}",
            "Create one with: repath rollout create -f rollout.yaml".dimmed()
        );
        return Ok(());
    }

    let mut table = make_table(vec![
        "NAME",
        "STATE",
        "TRAFFIC",
        "QUALITY",
        "BASELINE",
        "CANDIDATE",
        "CREATED",
    ]);

    for r in &rows {
        table.add_row(vec![
            Cell::new(&r.name),
            Cell::new(state_badge(&r.state)),
            Cell::new(weight_pct(r.current_weight)),
            Cell::new(
                r.avg_quality
                    .map(quality_score)
                    .unwrap_or_else(|| "—".dimmed().to_string()),
            ),
            Cell::new(&r.baseline_model),
            Cell::new(&r.candidate_model),
            Cell::new(relative_time(&r.created_at)),
        ]);
    }

    println!("{table}");
    println!(
        "  {} rollout(s). Use `repath rollout status <name>` for details.",
        rows.len()
    );

    Ok(())
}

struct RolloutListRow {
    name: String,
    state: String,
    current_weight: f64,
    avg_quality: Option<f64>,
    baseline_model: String,
    candidate_model: String,
    created_at: DateTime<Utc>,
}

async fn fetch_rollout_list(pool: &PgPool) -> Result<Vec<RolloutListRow>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT
            r.name,
            r.state,
            r.current_weight,
            r.created_at,
            bv.model AS baseline_model,
            cv.model AS candidate_model,
            (
                SELECT AVG(e.overall_score)
                FROM evaluations e
                JOIN requests req ON e.request_id = req.id
                WHERE req.rollout_id = r.id
                  AND req.created_at > NOW() - INTERVAL '10 minutes'
            ) AS avg_quality
        FROM rollouts r
        JOIN versions bv ON r.baseline_version_id = bv.id
        JOIN versions cv ON r.candidate_version_id = cv.id
        ORDER BY
            CASE r.state
                WHEN 'canary'  THEN 1
                WHEN 'shadow'  THEN 2
                WHEN 'created' THEN 3
                WHEN 'paused'  THEN 4
                WHEN 'promoted' THEN 5
                ELSE 6
            END,
            r.created_at DESC
        LIMIT 50
        "#,
    )
    .fetch_all(pool)
    .await
    .context("Failed to fetch rollouts")?;

    Ok(rows
        .iter()
        .map(|r| RolloutListRow {
            name: r.get("name"),
            state: r.get("state"),
            current_weight: r.get("current_weight"),
            avg_quality: r.get("avg_quality"),
            baseline_model: r.get("baseline_model"),
            candidate_model: r.get("candidate_model"),
            created_at: r.get("created_at"),
        })
        .collect())
}
