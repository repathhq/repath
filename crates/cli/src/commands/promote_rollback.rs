//! `repath rollout promote` and `repath rollout rollback` — manual overrides.
//!
//! Both commands require confirmation unless `--force` is passed.
//! This prevents accidental production changes from muscle memory.

use anyhow::{Context, Result};
use colored::Colorize;
use repath_controller::store;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn promote(pool: &PgPool, id_or_name: &str) -> Result<()> {
    let (rollout_id, rollout_name, state, weight) =
        fetch_rollout_basics(pool, id_or_name).await?;

    // Guard: can only promote active rollouts
    if state == "promoted" {
        println!("{} Rollout '{}' is already promoted.", "✓".green(), rollout_name.bold());
        return Ok(());
    }
    if state == "rolled_back" {
        anyhow::bail!(
            "Rollout '{}' was rolled back and cannot be promoted. Create a new rollout.",
            rollout_name
        );
    }

    // Confirm
    println!(
        "{} Force-promote '{}' to 100% candidate? This bypasses quality gates.",
        "!".yellow().bold(),
        rollout_name.bold()
    );
    println!("  Current traffic: {}% candidate", (weight * 100.0) as u32);
    print!("  Type 'yes' to confirm: ");
    std::io::Write::flush(&mut std::io::stdout())?;

    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    if input.trim() != "yes" {
        println!("{}", "Aborted.".dimmed());
        return Ok(());
    }

    let applied = store::apply_advance(
        pool,
        rollout_id,
        1.0,
        "promoted",
        "Manual promotion via CLI",
        weight,
        serde_json::json!({"triggered_by": "manual_cli"}),
    )
    .await
    .context("Failed to apply promotion")?;

    if applied {
        println!(
            "{} Rollout '{}' promoted. 100% of traffic now goes to the candidate.",
            "✓".green().bold(),
            rollout_name.bold()
        );
    } else {
        println!(
            "{} State changed before the promotion could be applied. Check current status.",
            "!".yellow()
        );
    }

    Ok(())
}

pub async fn rollback(pool: &PgPool, id_or_name: &str) -> Result<()> {
    let (rollout_id, rollout_name, state, weight) =
        fetch_rollout_basics(pool, id_or_name).await?;

    if state == "rolled_back" {
        println!(
            "{} Rollout '{}' is already rolled back.",
            "✓".green(),
            rollout_name.bold()
        );
        return Ok(());
    }
    if state == "promoted" {
        anyhow::bail!(
            "Rollout '{}' has been promoted. Rollback is not available on completed rollouts.",
            rollout_name
        );
    }

    println!(
        "{} Force-rollback '{}' to 100% baseline? Candidate traffic will stop immediately.",
        "!".red().bold(),
        rollout_name.bold()
    );
    println!("  Current candidate traffic: {}%", (weight * 100.0) as u32);
    print!("  Type 'yes' to confirm: ");
    std::io::Write::flush(&mut std::io::stdout())?;

    let mut input = String::new();
    std::io::stdin().read_line(&mut input)?;
    if input.trim() != "yes" {
        println!("{}", "Aborted.".dimmed());
        return Ok(());
    }

    let applied = store::apply_rollback(
        pool,
        rollout_id,
        "Manual rollback via CLI",
        weight,
        serde_json::json!({"triggered_by": "manual_cli"}),
    )
    .await
    .context("Failed to apply rollback")?;

    if applied {
        println!(
            "{} Rollout '{}' rolled back. 100% of traffic now goes to the baseline.",
            "✓".green().bold(),
            rollout_name.bold()
        );
    } else {
        println!(
            "{} State changed before the rollback could be applied. Check current status.",
            "!".yellow()
        );
    }

    Ok(())
}

async fn fetch_rollout_basics(
    pool: &PgPool,
    id_or_name: &str,
) -> Result<(Uuid, String, String, f64)> {
    use sqlx::Row;

    let row = if let Ok(id) = id_or_name.parse::<Uuid>() {
        sqlx::query("SELECT id, name, state, current_weight FROM rollouts WHERE id = $1")
            .bind(id)
            .fetch_optional(pool)
            .await
    } else {
        sqlx::query(
            "SELECT id, name, state, current_weight FROM rollouts WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(id_or_name)
        .fetch_optional(pool)
        .await
    }
    .context("Failed to query rollout")?;

    let row = row.ok_or_else(|| anyhow::anyhow!("Rollout not found: '{id_or_name}'"))?;

    Ok((
        row.get("id"),
        row.get("name"),
        row.get("state"),
        row.get("current_weight"),
    ))
}
