//! `repath rollout create` — parse a rollout YAML and write it to the database.
//!
//! This command:
//! 1. Reads and validates the YAML file
//! 2. Upserts provider records
//! 3. Creates baseline + candidate version records
//! 4. Creates the rollout record
//! 5. Creates rollout_steps from the strategy
//!
//! Everything runs in a single transaction — either the whole rollout is
//! created or nothing is. Partial creates that leave orphaned records are
//! not acceptable in a system that drives production traffic.

use anyhow::{Context, Result};
use colored::Colorize;
use repath_common::types::{RolloutConfig, RolloutPolicy, RolloutStrategy, StrategyType};
use sqlx::PgPool;
use std::path::PathBuf;
use uuid::Uuid;

pub async fn create(pool: &PgPool, file: PathBuf) -> Result<()> {
    // Read and parse YAML
    let yaml_content = std::fs::read_to_string(&file)
        .with_context(|| format!("Failed to read file: {}", file.display()))?;

    let config: RolloutConfig = serde_yaml::from_str(&yaml_content)
        .with_context(|| "Failed to parse rollout YAML — check the format")?;

    // Validate
    validate_config(&config)?;

    let rollout_name = &config.metadata.name;
    println!(
        "{} Creating rollout {}...",
        "→".cyan().bold(),
        rollout_name.bold()
    );

    // Generate rollout ID upfront so version names can include it
    let rollout_id = Uuid::new_v4();

    // All DB writes in a single transaction
    let mut tx = pool.begin().await.context("Failed to begin transaction")?;

    // ── Upsert providers ─────────────────────────────────────────────────────
    let baseline_provider_id = upsert_provider(&mut tx, &config.spec.baseline.provider).await?;
    let candidate_provider_id = upsert_provider(&mut tx, &config.spec.candidate.provider).await?;

    // ── Create versions ───────────────────────────────────────────────────────
    // Use the rollout UUID in version names so re-creating a same-named rollout
    // (after deleting the old one) never hits the unique constraint.
    let baseline_version_id = insert_version(
        &mut tx,
        &format!("{}-baseline-{}", rollout_name, &rollout_id.to_string()[..8]),
        baseline_provider_id,
        &config.spec.baseline.model,
        config.spec.baseline.prompt.system.as_deref(),
        &serde_json::to_value(&config.spec.baseline.parameters)?,
    )
    .await?;

    let candidate_version_id = insert_version(
        &mut tx,
        &format!(
            "{}-candidate-{}",
            rollout_name,
            &rollout_id.to_string()[..8]
        ),
        candidate_provider_id,
        &config.spec.candidate.model,
        config.spec.candidate.prompt.system.as_deref(),
        &serde_json::to_value(&config.spec.candidate.parameters)?,
    )
    .await?;

    // ── Build policy + strategy JSON ─────────────────────────────────────────
    let policy = RolloutPolicy::default();
    let policy_json = serde_json::to_value(&policy)?;

    let strategy = build_strategy(&config)?;
    let strategy_json = serde_json::to_value(&strategy)?;

    // ── Create rollout ────────────────────────────────────────────────────────
    sqlx::query(
        r#"
        INSERT INTO rollouts (
            id, name, baseline_version_id, candidate_version_id,
            state, current_weight, policy, strategy,
            created_at, updated_at
        ) VALUES ($1, $2, $3, $4, 'created', 0.0, $5, $6, NOW(), NOW())
        "#,
    )
    .bind(rollout_id)
    .bind(rollout_name)
    .bind(baseline_version_id)
    .bind(candidate_version_id)
    .bind(&policy_json)
    .bind(&strategy_json)
    .execute(&mut *tx)
    .await
    .with_context(|| format!("Failed to create rollout '{rollout_name}'"))?;

    // ── Create rollout steps ──────────────────────────────────────────────────
    for (i, step) in config.spec.strategy.steps.iter().enumerate() {
        let target_weight = step.weight as f64 / 100.0;
        let gate_expr = build_gate_expression(&step.gate);
        let pause_secs = step.duration.as_deref().and_then(parse_duration_secs);

        sqlx::query(
            r#"
            INSERT INTO rollout_steps (
                id, rollout_id, step_number, target_weight,
                gate_expression, pause_duration_seconds, status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(rollout_id)
        .bind((i + 1) as i32)
        .bind(target_weight)
        .bind(&gate_expr)
        .bind(pause_secs.map(|s| s as i32))
        .execute(&mut *tx)
        .await
        .with_context(|| format!("Failed to create step {}", i + 1))?;
    }

    tx.commit().await.context("Failed to commit transaction")?;

    // ── Success output ─────────────────────────────────────────────────────────
    println!(
        "{} Rollout {} created",
        "✓".green().bold(),
        rollout_name.bold()
    );
    println!();
    println!("  {:<22} {}", "ID:".dimmed(), rollout_id);
    println!(
        "  {:<22} {} → {}",
        "Versions:".dimmed(),
        config.spec.baseline.model.cyan(),
        config.spec.candidate.model.cyan(),
    );
    println!(
        "  {:<22} {} steps",
        "Strategy:".dimmed(),
        config.spec.strategy.steps.len()
    );
    println!();
    println!(
        "{}",
        "The controller will start routing traffic automatically.".dimmed()
    );
    println!(
        "{}",
        format!("Run `repath rollout status {rollout_name}` to monitor progress.").dimmed()
    );

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async fn upsert_provider(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    provider_name: &str,
) -> Result<Uuid> {
    use sqlx::Row;

    // Provider base URL and type derived from name
    let (base_url, provider_type) = match provider_name {
        "openai" => ("https://api.openai.com/v1", "openai"),
        "anthropic" => ("https://api.anthropic.com/v1", "anthropic"),
        "gemini" => ("https://generativelanguage.googleapis.com/v1", "gemini"),
        other => (other, "openai"), // Custom base URL used as name
    };

    // Upsert: create if not exists, return existing ID if it does
    let row = sqlx::query(
        r#"
        INSERT INTO providers (id, name, base_url, api_key_encrypted, provider_type)
        VALUES ($1, $2, $3, 'CONFIGURED_VIA_GATEWAY', $4)
        ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
        RETURNING id
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(provider_name)
    .bind(base_url)
    .bind(provider_type)
    .fetch_one(&mut **tx)
    .await
    .with_context(|| format!("Failed to upsert provider '{provider_name}'"))?;

    Ok(row.get("id"))
}

async fn insert_version(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    name: &str,
    provider_id: Uuid,
    model: &str,
    prompt_template: Option<&str>,
    parameters: &serde_json::Value,
) -> Result<Uuid> {
    let version_id = Uuid::new_v4();

    sqlx::query(
        r#"
        INSERT INTO versions (id, name, provider_id, model, prompt_template, parameters)
        VALUES ($1, $2, $3, $4, $5, $6)
        "#,
    )
    .bind(version_id)
    .bind(name)
    .bind(provider_id)
    .bind(model)
    .bind(prompt_template)
    .bind(parameters)
    .execute(&mut **tx)
    .await
    .with_context(|| format!("Failed to create version '{name}'"))?;

    Ok(version_id)
}

fn build_strategy(config: &RolloutConfig) -> Result<RolloutStrategy> {
    use repath_common::types::RolloutStep;

    let steps = config
        .spec
        .strategy
        .steps
        .iter()
        .enumerate()
        .map(|(i, s)| RolloutStep {
            step_number: (i + 1) as u32,
            target_weight: s.weight as f64 / 100.0,
            gate_expression: build_gate_expression(&s.gate),
            pause_duration_seconds: s.duration.as_deref().and_then(parse_duration_secs),
        })
        .collect();

    let strategy_type = config.spec.strategy.strategy_type;

    Ok(RolloutStrategy {
        strategy_type,
        steps,
    })
}

/// Convert a gate HashMap like `{"quality_score": ">= 0.9"}` into a
/// simple expression string: `"quality_score >= 0.9"`.
fn build_gate_expression(gate: &std::collections::HashMap<String, String>) -> String {
    gate.iter()
        .map(|(k, v)| format!("{} {}", k, v))
        .collect::<Vec<_>>()
        .join(" AND ")
}

/// Parse a duration string like "10m", "1h", "30s" into seconds.
fn parse_duration_secs(s: &str) -> Option<u32> {
    let s = s.trim();
    if let Some(m) = s.strip_suffix('m') {
        m.parse::<u32>().ok().map(|v| v * 60)
    } else if let Some(h) = s.strip_suffix('h') {
        h.parse::<u32>().ok().map(|v| v * 3600)
    } else if let Some(sec) = s.strip_suffix('s') {
        sec.parse::<u32>().ok()
    } else {
        s.parse::<u32>().ok() // Plain seconds
    }
}

fn validate_config(config: &RolloutConfig) -> Result<()> {
    if config.metadata.name.is_empty() {
        anyhow::bail!("Rollout name cannot be empty");
    }
    if config.spec.strategy.steps.is_empty() {
        anyhow::bail!("Strategy must have at least one step");
    }
    let last_weight = config
        .spec
        .strategy
        .steps
        .last()
        .map(|s| s.weight)
        .unwrap_or(0);
    if last_weight != 100 {
        anyhow::bail!(
            "Last strategy step must have weight: 100 (got {})",
            last_weight
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_duration_secs() {
        assert_eq!(parse_duration_secs("10m"), Some(600));
        assert_eq!(parse_duration_secs("1h"), Some(3600));
        assert_eq!(parse_duration_secs("30s"), Some(30));
        assert_eq!(parse_duration_secs("120"), Some(120));
        assert_eq!(parse_duration_secs("bad"), None);
    }

    #[test]
    fn test_build_gate_expression() {
        let mut gate = std::collections::HashMap::new();
        gate.insert("quality_score".to_string(), ">= 0.9".to_string());
        let expr = build_gate_expression(&gate);
        assert_eq!(expr, "quality_score >= 0.9");
    }

    #[test]
    fn test_validate_config_empty_name() {
        let yaml = r#"
apiVersion: repath/v1
kind: Rollout
metadata:
  name: ""
spec:
  baseline:
    provider: openai
    model: gpt-4o
  candidate:
    provider: openai
    model: gpt-4o-mini
  strategy:
    type: canary
    steps:
      - weight: 100
        gate: {}
    rollback:
      trigger: {}
      action: instant
"#;
        let config: RolloutConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(validate_config(&config).is_err());
    }

    #[test]
    fn test_validate_config_last_step_not_100() {
        let yaml = r#"
apiVersion: repath/v1
kind: Rollout
metadata:
  name: test
spec:
  baseline:
    provider: openai
    model: gpt-4o
  candidate:
    provider: openai
    model: gpt-4o-mini
  strategy:
    type: canary
    steps:
      - weight: 50
        gate: {}
    rollback:
      trigger: {}
      action: instant
"#;
        let config: RolloutConfig = serde_yaml::from_str(yaml).unwrap();
        assert!(validate_config(&config).is_err());
    }
}
