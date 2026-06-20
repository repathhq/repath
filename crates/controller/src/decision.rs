//! Decision execution — applies a `PolicyVerdict` to the database.
//!
//! This module bridges the pure policy logic and the I/O store layer.
//! It is responsible for:
//!
//! 1. Translating a `PolicyVerdict` into the correct `store::apply_*` calls
//! 2. Calculating `new_weight` for advance (uses the step's `target_weight`)
//! 3. Emitting structured log events at the appropriate severity
//! 4. Returning a `DecisionOutcome` for the loop to observe
//!
//! # Why separate from policy.rs?
//!
//! `policy.rs` is pure logic — it can be tested without a database.
//! `decision.rs` is impure — it performs I/O. Keeping them separate makes
//! the policy 100% unit-testable and the decision layer integration-testable.

use crate::{
    metrics_aggregator::{build_snapshot_json, RolloutMetrics},
    policy::PolicyVerdict,
    store,
};
use repath_common::Result;
use sqlx::PgPool;
use tracing::{error, info, warn};
use uuid::Uuid;

/// What happened after applying a verdict to the database.
#[derive(Debug, Clone)]
pub enum DecisionOutcome {
    /// Candidate weight advanced to `new_weight`.
    Advanced { rollout_id: Uuid, new_weight: f64 },
    /// Candidate weight set to 0.0; rollout marked `rolled_back`.
    RolledBack { rollout_id: Uuid, reason: String },
    /// Rollout reached 100%; marked `promoted`.
    Promoted { rollout_id: Uuid },
    /// No action taken this cycle.
    Held { rollout_id: Uuid, reason: String },
    /// The DB guard prevented double-application (concurrent controller).
    AlreadyActedOn { rollout_id: Uuid },
}

/// Apply a `PolicyVerdict` to the database and return what was done.
pub async fn apply_verdict(
    pool: &PgPool,
    rollout_id: Uuid,
    rollout_name: &str,
    current_weight: f64,
    verdict: PolicyVerdict,
    metrics: &RolloutMetrics,
) -> Result<DecisionOutcome> {
    let snapshot = build_snapshot_json(metrics);

    match verdict {
        PolicyVerdict::Rollback { reason } => {
            error!(
                rollout_id = %rollout_id,
                rollout_name,
                reason = %reason,
                current_weight,
                quality = metrics.candidate.avg_quality,
                error_rate = metrics.candidate.error_rate,
                "ROLLBACK triggered"
            );

            let applied =
                store::apply_rollback(pool, rollout_id, &reason, current_weight, snapshot).await?;

            if applied {
                Ok(DecisionOutcome::RolledBack { rollout_id, reason })
            } else {
                warn!(
                    rollout_id = %rollout_id,
                    "Rollback state guard blocked double-application"
                );
                Ok(DecisionOutcome::AlreadyActedOn { rollout_id })
            }
        }

        PolicyVerdict::Advance {
            new_weight,
            is_final,
            reason,
        } => {
            let new_state = if is_final { "promoted" } else { "canary" };

            info!(
                rollout_id = %rollout_id,
                rollout_name,
                old_weight = current_weight,
                new_weight,
                is_final,
                reason = %reason,
                "Advancing rollout"
            );

            let applied = store::apply_advance(
                pool,
                rollout_id,
                new_weight,
                new_state,
                &reason,
                current_weight,
                snapshot,
            )
            .await?;

            if !applied {
                warn!(
                    rollout_id = %rollout_id,
                    "Advance state guard blocked double-application"
                );
                return Ok(DecisionOutcome::AlreadyActedOn { rollout_id });
            }

            if is_final {
                Ok(DecisionOutcome::Promoted { rollout_id })
            } else {
                // Activate the next step so the loop can track duration
                store::activate_next_step(pool, rollout_id).await?;
                Ok(DecisionOutcome::Advanced {
                    rollout_id,
                    new_weight,
                })
            }
        }

        PolicyVerdict::Hold { reason } => {
            // Hold is extremely common (most cycles) — log at debug only
            // to avoid flooding logs with "waiting for samples" every 30s
            tracing::debug!(
                rollout_id = %rollout_id,
                rollout_name,
                reason = %reason,
                "Holding rollout"
            );
            Ok(DecisionOutcome::Held { rollout_id, reason })
        }
    }
}
