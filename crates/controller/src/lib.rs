//! Repath Rollout Controller
//!
//! The controller is the decision-making brain of Repath. It runs as a separate
//! process (or a dedicated background task) that:
//!
//! 1. Periodically queries active rollouts from PostgreSQL
//! 2. Aggregates evaluation scores for each active rollout (rolling window)
//! 3. Applies the rollout policy to decide: advance, rollback, or hold
//! 4. Writes decisions back to PostgreSQL atomically
//!
//! # Architecture
//!
//! ```text
//! PostgreSQL                    Controller loop (every 30s)
//! ─────────                    ──────────────────────────
//! rollouts (state='canary') ──▶ fetch_active_rollouts()
//! evaluations (last 10min)  ──▶ aggregate_scores()
//!                               │
//!                               ▼
//!                           evaluate_policy()
//!                               │
//!                         ┌─────┴──────┐
//!                         ▼            ▼
//!                     advance()   rollback()
//!                         │            │
//!                         ▼            ▼
//!                    UPDATE rollouts (atomic with state guard)
//!                    INSERT decisions (full audit trail)
//! ```
//!
//! # Correctness guarantees
//!
//! - **Idempotent on restart**: all state lives in PostgreSQL. A crashed
//!   controller resumes correctly on restart with no data loss.
//!
//! - **Race-free writes**: the `UPDATE rollouts SET state='rolled_back'
//!   WHERE state='canary'` guard ensures that even if two controller
//!   instances run simultaneously (misconfiguration), only one applies
//!   a state transition. The second sees 0 rows updated and skips.
//!
//! - **No silent promotion**: a rollout can only advance if the policy
//!   gates all pass AND the minimum sample size is met. Sparse traffic
//!   (< min_samples evaluations) never triggers premature decisions.

pub mod decision;
pub mod loop_runner;
pub mod metrics;
pub mod metrics_aggregator;
pub mod policy;
pub mod store;
