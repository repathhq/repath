//! `repath rollout history <id-or-name>` — full decision audit log.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use colored::Colorize;
use comfy_table::Cell;
use sqlx::PgPool;
use uuid::Uuid;

use crate::display::{decision_action, make_table, relative_time, weight_pct};

pub async fn history(pool: &PgPool, id_or_name: &str) -> Result<()> {
    let rollout_id = resolve_id(pool, id_or_name).await?;
    let decisions = fetch_decisions(pool, rollout_id).await?;

    if decisions.is_empty() {
        println!("{}", "No decisions recorded yet.".dimmed());
        return Ok(());
    }

    println!(
        "\n  Decision history for {}  ({} entries)\n",
        id_or_name.bold(),
        decisions.len()
    );

    let mut table = make_table(vec!["WHEN", "ACTION", "WEIGHT", "REASON", "BY"]);

    for d in &decisions {
        let weight_change = match (d.previous_weight, d.new_weight) {
            (Some(prev), Some(next)) => {
                format!("{} → {}", weight_pct(prev), weight_pct(next))
            }
            (Some(prev), None) => weight_pct(prev),
            _ => "—".to_string(),
        };

        // Truncate long reasons to keep the table readable
        let reason = if d.reason.len() > 70 {
            format!("{}…", &d.reason[..70])
        } else {
            d.reason.clone()
        };

        table.add_row(vec![
            Cell::new(relative_time(&d.created_at)),
            Cell::new(decision_action(&d.action)),
            Cell::new(weight_change),
            Cell::new(reason),
            Cell::new(&d.triggered_by),
        ]);
    }

    println!("{table}");
    Ok(())
}

struct DecisionRow {
    action: String,
    reason: String,
    previous_weight: Option<f64>,
    new_weight: Option<f64>,
    triggered_by: String,
    created_at: DateTime<Utc>,
}

async fn resolve_id(pool: &PgPool, id_or_name: &str) -> Result<Uuid> {
    use sqlx::Row;

    if let Ok(id) = id_or_name.parse::<Uuid>() {
        return Ok(id);
    }

    let row = sqlx::query(
        "SELECT id FROM rollouts WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(id_or_name)
    .fetch_optional(pool)
    .await
    .context("Failed to resolve rollout name")?;

    row.map(|r| r.get("id"))
        .ok_or_else(|| anyhow::anyhow!("Rollout not found: '{id_or_name}'"))
}

async fn fetch_decisions(pool: &PgPool, rollout_id: Uuid) -> Result<Vec<DecisionRow>> {
    use sqlx::Row;

    let rows = sqlx::query(
        r#"
        SELECT action, reason, previous_weight, new_weight, triggered_by, created_at
        FROM decisions
        WHERE rollout_id = $1
        ORDER BY created_at DESC
        LIMIT 100
        "#,
    )
    .bind(rollout_id)
    .fetch_all(pool)
    .await
    .context("Failed to fetch decisions")?;

    Ok(rows
        .iter()
        .map(|r| DecisionRow {
            action: r.get("action"),
            reason: r.get("reason"),
            previous_weight: r.get("previous_weight"),
            new_weight: r.get("new_weight"),
            triggered_by: r.get("triggered_by"),
            created_at: r.get("created_at"),
        })
        .collect())
}
