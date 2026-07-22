//! `repath rollout pause` and `repath rollout resume`.

use anyhow::{Context, Result};
use colored::Colorize;
use sqlx::PgPool;
use uuid::Uuid;

pub async fn pause(pool: &PgPool, id_or_name: &str) -> Result<()> {
    let (rollout_id, name, state) = fetch_basics(pool, id_or_name).await?;

    if state == "paused" {
        println!(
            "{} Rollout '{}' is already paused.",
            "✓".green(),
            name.bold()
        );
        return Ok(());
    }
    if matches!(state.as_str(), "promoted" | "rolled_back") {
        anyhow::bail!(
            "Rollout '{}' is {}. Only active rollouts can be paused.",
            name,
            state
        );
    }

    sqlx::query(
        "UPDATE rollouts SET state='paused', updated_at=NOW() \
         WHERE id=$1 AND state IN ('canary','shadow','created')",
    )
    .bind(rollout_id)
    .execute(pool)
    .await
    .context("Failed to pause rollout")?;

    sqlx::query(
        "INSERT INTO decisions (id,rollout_id,action,reason,triggered_by,created_at) \
         VALUES ($1,$2,'pause','Paused via CLI','manual',NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(rollout_id)
    .execute(pool)
    .await
    .context("Failed to record pause decision")?;

    println!(
        "{} Rollout '{}' paused. Controller will not make decisions until resumed.",
        "✓".green().bold(),
        name.bold()
    );
    Ok(())
}

pub async fn resume(pool: &PgPool, id_or_name: &str) -> Result<()> {
    let (rollout_id, name, state) = fetch_basics(pool, id_or_name).await?;

    if state != "paused" {
        anyhow::bail!(
            "Rollout '{}' is not paused (current state: {}).",
            name,
            state
        );
    }

    sqlx::query(
        "UPDATE rollouts SET state='canary', updated_at=NOW() WHERE id=$1 AND state='paused'",
    )
    .bind(rollout_id)
    .execute(pool)
    .await
    .context("Failed to resume rollout")?;

    sqlx::query(
        "INSERT INTO decisions (id,rollout_id,action,reason,triggered_by,created_at) \
         VALUES ($1,$2,'resume','Resumed via CLI','manual',NOW())",
    )
    .bind(Uuid::new_v4())
    .bind(rollout_id)
    .execute(pool)
    .await
    .context("Failed to record resume decision")?;

    println!(
        "{} Rollout '{}' resumed. Controller will resume making decisions on the next tick.",
        "✓".green().bold(),
        name.bold()
    );
    Ok(())
}

async fn fetch_basics(pool: &PgPool, id_or_name: &str) -> Result<(Uuid, String, String)> {
    use sqlx::Row;

    let row = if let Ok(id) = id_or_name.parse::<Uuid>() {
        sqlx::query("SELECT id, name, state FROM rollouts WHERE id=$1")
            .bind(id)
            .fetch_optional(pool)
            .await
    } else {
        sqlx::query(
            "SELECT id, name, state FROM rollouts WHERE name=$1 ORDER BY created_at DESC LIMIT 1",
        )
        .bind(id_or_name)
        .fetch_optional(pool)
        .await
    }
    .context("Failed to query rollout")?;

    let row = row.ok_or_else(|| anyhow::anyhow!("Rollout not found: '{id_or_name}'"))?;
    Ok((row.get("id"), row.get("name"), row.get("state")))
}
