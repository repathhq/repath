//! Controller main loop.
//!
//! Runs every `decision_interval` seconds, processes every active rollout,
//! and logs a structured summary of what was decided.
//!
//! # Lifecycle
//!
//! ```text
//! start()
//!   └── loop every decision_interval
//!         └── for each active rollout:
//!               1. fetch_active_rollouts()
//!               2. for each rollout in 'created' state → start_rollout()
//!               3. for each rollout in 'canary'/'shadow':
//!                    a. aggregate_version_metrics()
//!                    b. evaluate_policy()
//!                    c. apply_verdict() → DB write + audit log
//! ```
//!
//! # Shutdown
//!
//! The loop runs until its `JoinHandle` is aborted. In the gateway's main.rs,
//! the controller runs as a `tokio::spawn`'d task aborted during graceful shutdown.
//!
//! # Single instance
//!
//! Only one controller should run per deployment. Multiple instances are safe
//! (all writes are guarded with optimistic locking in `store.rs`), but wasteful
//! and will produce duplicate `Hold` log entries. Use a Kubernetes Deployment
//! with `replicas: 1` or a leader election mechanism for HA setups.

use crate::{
    decision::{self, DecisionOutcome},
    metrics_aggregator::{self, AggregationResult},
    policy,
    store::{self, ActiveRolloutRow},
};
use chrono::Utc;
use repath_common::types::RolloutPolicy;
use repath_common::Result;
use sqlx::PgPool;
use std::time::Duration;
use tracing::{debug, error, info, warn};

/// Configuration for the controller loop.
#[derive(Debug, Clone)]
pub struct ControllerConfig {
    /// How often to run the decision loop (seconds).
    pub decision_interval_secs: u64,
    /// Minimum confidence level for statistical significance (unused in MVP;
    /// reserved for future SPRT implementation).
    pub confidence_level: f64,
    /// Rolling window for metric aggregation (minutes).
    pub metric_window_minutes: i32,
}

impl Default for ControllerConfig {
    fn default() -> Self {
        Self {
            decision_interval_secs: 30,
            confidence_level: 0.95,
            metric_window_minutes: 10,
        }
    }
}

/// Start the controller loop. Runs forever until the task is aborted.
///
/// # Arguments
///
/// * `pool`   - PostgreSQL connection pool (shared with gateway)
/// * `config` - Controller configuration
pub async fn run(pool: PgPool, config: ControllerConfig) {
    info!(
        decision_interval_secs = config.decision_interval_secs,
        metric_window_minutes = config.metric_window_minutes,
        "Controller loop started"
    );

    let mut interval = tokio::time::interval(Duration::from_secs(config.decision_interval_secs));
    // Skip missed ticks rather than burst-catching up after a slow DB cycle
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        if let Err(e) = run_once(&pool, &config).await {
            // A single cycle failure (e.g., transient DB error) must not
            // crash the controller. Log the error and continue to the next tick.
            error!(error = %e, "Controller cycle failed — will retry next interval");
        }
    }
}

/// Run a single decision cycle across all active rollouts.
///
/// Returns `Err` only on database failures that affect all rollouts.
/// Per-rollout failures are logged and skipped.
async fn run_once(pool: &PgPool, config: &ControllerConfig) -> Result<()> {
    let rollouts = store::fetch_active_rollouts(pool).await?;

    if rollouts.is_empty() {
        debug!("No active rollouts");
        return Ok(());
    }

    info!(count = rollouts.len(), "Processing active rollouts");

    for rollout in &rollouts {
        if let Err(e) = process_rollout(pool, rollout, config).await {
            // Per-rollout error: log and continue to the next one.
            // A broken rollout must not block others.
            error!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                error = %e,
                "Failed to process rollout — skipping this cycle"
            );
        }
    }

    Ok(())
}

/// Process a single rollout: start it if new, evaluate if active.
async fn process_rollout(
    pool: &PgPool,
    rollout: &ActiveRolloutRow,
    _config: &ControllerConfig,
) -> Result<()> {
    // Parse the policy from JSONB — if it's malformed, fail loudly
    let policy: RolloutPolicy =
        serde_json::from_value(rollout.policy_json.clone()).map_err(|e| {
            repath_common::Error::Serialization {
                context: format!("policy field for rollout {}", rollout.id),
                source: e.into(),
            }
        })?;

    // Start 'created' rollouts (transition created → canary)
    if rollout.state == "created" {
        match store::start_rollout(pool, rollout.id).await? {
            true => info!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                "Rollout started (created → canary)"
            ),
            false => debug!(
                rollout_id = %rollout.id,
                "Rollout already started (race condition or duplicate loop)"
            ),
        }
        return Ok(());
    }

    // --- Rollout is in 'canary' or 'shadow' state ---

    // Get the currently active step for duration tracking
    let active_step = store::get_active_step(pool, rollout.id).await?;

    let (step_elapsed_secs, step_target_weight, is_final_step, min_step_duration_secs) =
        match &active_step {
            Some(step) => {
                let elapsed = step
                    .started_at
                    .map(|t| (Utc::now() - t).num_seconds().max(0) as u64)
                    .unwrap_or(0);
                let duration = step.pause_duration_seconds.unwrap_or(0).max(0) as u64;
                let is_final = step.target_weight >= 1.0;
                (elapsed, step.target_weight, is_final, duration)
            }
            None => {
                // No active step — either all steps passed or none started yet.
                // Activate the next pending step and skip this cycle.
                match store::activate_next_step(pool, rollout.id).await? {
                    Some(step_num) => {
                        info!(
                            rollout_id = %rollout.id,
                            step_number = step_num,
                            "Activated next step"
                        );
                    }
                    None => {
                        warn!(
                            rollout_id = %rollout.id,
                            "No pending steps found — rollout may be stuck"
                        );
                    }
                }
                return Ok(());
            }
        };

    // Fetch the rollout's baseline and candidate version IDs
    let (baseline_version_id, candidate_version_id) = fetch_version_ids(pool, rollout.id).await?;

    // Aggregate metrics for this rollout's rolling window
    let agg = metrics_aggregator::aggregate(
        pool,
        rollout.id,
        baseline_version_id,
        candidate_version_id,
        policy.min_samples,
    )
    .await?;

    let metrics = match agg {
        AggregationResult::Ready(m) => m,

        AggregationResult::InsufficientData { have, need } => {
            debug!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                have,
                need,
                "Insufficient evaluation data — holding"
            );
            return Ok(());
        }

        AggregationResult::CandidateNoData => {
            debug!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                "Candidate has received no traffic yet — holding"
            );
            return Ok(());
        }
    };

    // Evaluate policy
    let verdict = policy::evaluate(
        &metrics,
        &policy,
        rollout.current_weight,
        step_target_weight,
        is_final_step,
        step_elapsed_secs,
        min_step_duration_secs,
    );

    // Apply verdict to database
    let outcome = decision::apply_verdict(
        pool,
        rollout.id,
        &rollout.name,
        rollout.current_weight,
        verdict,
        &metrics,
    )
    .await?;

    // Log outcome at the appropriate level
    match &outcome {
        DecisionOutcome::RolledBack { reason, .. } => {
            error!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                reason = %reason,
                candidate_quality = metrics.candidate.avg_quality,
                candidate_errors = metrics.candidate.error_rate,
                samples = metrics.candidate.sample_count,
                "🚨 ROLLBACK: candidate rolled back to 0%"
            );
        }
        DecisionOutcome::Promoted { .. } => {
            info!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                candidate_quality = metrics.candidate.avg_quality,
                "✅ PROMOTED: candidate at 100%"
            );
        }
        DecisionOutcome::Advanced { new_weight, .. } => {
            info!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                old_weight = rollout.current_weight,
                new_weight,
                candidate_quality = metrics.candidate.avg_quality,
                "↑ ADVANCED: candidate traffic increased"
            );
        }
        DecisionOutcome::Held { reason, .. } => {
            debug!(
                rollout_id = %rollout.id,
                rollout_name = %rollout.name,
                reason = %reason,
                "— HOLD: no change this cycle"
            );
        }
        DecisionOutcome::AlreadyActedOn { .. } => {
            debug!(
                rollout_id = %rollout.id,
                "State guard blocked double-application"
            );
        }
    }

    Ok(())
}

/// Fetch the baseline and candidate version IDs for a rollout.
async fn fetch_version_ids(pool: &PgPool, rollout_id: Uuid) -> Result<(Uuid, Uuid)> {
    use sqlx::Row;

    let row =
        sqlx::query("SELECT baseline_version_id, candidate_version_id FROM rollouts WHERE id = $1")
            .bind(rollout_id)
            .fetch_one(pool)
            .await
            .map_err(|e| repath_common::Error::Database {
                operation: "fetch rollout version IDs".to_string(),
                source: e.into(),
            })?;

    Ok((
        row.get("baseline_version_id"),
        row.get("candidate_version_id"),
    ))
}

use uuid::Uuid;
