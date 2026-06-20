//! Metrics aggregation and snapshot building.
//!
//! This module takes raw per-version metrics from the database and produces
//! a structured `RolloutMetrics` that the policy evaluator works against.
//!
//! # Rolling window
//!
//! We aggregate over the last `window_minutes` (default: 10) rather than
//! the entire lifetime of the rollout. Rationale:
//!
//! - A rollout that starts well but degrades at minute 45 must trigger
//!   rollback. Averaging over all 45 minutes would dilute the recent
//!   degradation below the threshold.
//!
//! - 10 minutes provides enough samples at typical LLM traffic volumes
//!   (hundreds to thousands of requests/minute) without being too sensitive
//!   to transient spikes.
//!
//! The window is configurable via `RolloutPolicy.min_samples` — if fewer
//! than `min_samples` requests exist in the window, we return
//! `InsufficientData` and the policy skips the decision cycle entirely.

use crate::store::{self, VersionMetrics};
use repath_common::Result;
use sqlx::PgPool;
use uuid::Uuid;

/// Default rolling window for metric aggregation (minutes).
const DEFAULT_WINDOW_MINUTES: i32 = 10;

/// Structured metrics for a single rollout, ready for policy evaluation.
#[derive(Debug, Clone)]
pub struct RolloutMetrics {
    pub rollout_id: Uuid,
    pub baseline: VersionSnapshot,
    pub candidate: VersionSnapshot,
}

/// Quality metrics for one version.
#[derive(Debug, Clone)]
pub struct VersionSnapshot {
    pub version_id: Uuid,
    /// Rolling average quality score (0.0 – 1.0)
    pub avg_quality: f64,
    /// 95th-percentile latency in milliseconds
    pub p95_latency_ms: u32,
    /// Fraction of requests with status_code >= 400
    pub error_rate: f64,
    /// Number of evaluated requests in the window
    pub sample_count: u32,
}

/// Result of an aggregation attempt.
#[derive(Debug)]
pub enum AggregationResult {
    /// Both baseline and candidate have sufficient data.
    Ready(RolloutMetrics),
    /// Not enough evaluated requests in the window yet.
    /// The `needed` field tells callers how many more are required.
    InsufficientData { have: u32, need: u32 },
    /// Only baseline data exists (candidate has received no traffic yet).
    /// This is normal at the very start of a canary rollout.
    CandidateNoData,
}

/// Aggregate metrics for a rollout and determine if there's enough data to decide.
///
/// # Arguments
///
/// * `pool` - Database connection pool
/// * `rollout_id` - The rollout to aggregate
/// * `baseline_version_id` - Expected baseline version UUID
/// * `candidate_version_id` - Expected candidate version UUID
/// * `min_samples` - Minimum candidate samples before making any decision
pub async fn aggregate(
    pool: &PgPool,
    rollout_id: Uuid,
    baseline_version_id: Uuid,
    candidate_version_id: Uuid,
    min_samples: u32,
) -> Result<AggregationResult> {
    let raw = store::aggregate_version_metrics(pool, rollout_id, DEFAULT_WINDOW_MINUTES).await?;

    // Find baseline and candidate rows by version_id
    let baseline_raw = raw.iter().find(|m| m.version_id == baseline_version_id);
    let candidate_raw = raw.iter().find(|m| m.version_id == candidate_version_id);

    // If candidate has no rows, it hasn't received any traffic yet —
    // this is normal at rollout start, not an error
    let candidate_raw = match candidate_raw {
        Some(r) => r,
        None => return Ok(AggregationResult::CandidateNoData),
    };

    // Check minimum sample gate
    let candidate_samples = candidate_raw.sample_count as u32;
    if candidate_samples < min_samples {
        return Ok(AggregationResult::InsufficientData {
            have: candidate_samples,
            need: min_samples,
        });
    }

    let baseline = match baseline_raw {
        Some(r) => version_snapshot_from_raw(r),
        None => {
            // Baseline with no data is unusual (it should always have traffic)
            // but not fatal — use zero defaults and let policy decide
            VersionSnapshot {
                version_id: baseline_version_id,
                avg_quality: 0.0,
                p95_latency_ms: 0,
                error_rate: 0.0,
                sample_count: 0,
            }
        }
    };

    let candidate = version_snapshot_from_raw(candidate_raw);

    Ok(AggregationResult::Ready(RolloutMetrics {
        rollout_id,
        baseline,
        candidate,
    }))
}

fn version_snapshot_from_raw(r: &VersionMetrics) -> VersionSnapshot {
    VersionSnapshot {
        version_id: r.version_id,
        avg_quality: r.avg_quality,
        p95_latency_ms: r.p95_latency_ms.max(0) as u32,
        error_rate: r.error_rate.clamp(0.0, 1.0),
        sample_count: r.sample_count.max(0) as u32,
    }
}

/// Build a JSON metrics snapshot for the decisions audit table.
pub fn build_snapshot_json(metrics: &RolloutMetrics) -> serde_json::Value {
    serde_json::json!({
        "quality_score_baseline":  metrics.baseline.avg_quality,
        "quality_score_candidate": metrics.candidate.avg_quality,
        "latency_p95_baseline":    metrics.baseline.p95_latency_ms,
        "latency_p95_candidate":   metrics.candidate.p95_latency_ms,
        "error_rate_baseline":     metrics.baseline.error_rate,
        "error_rate_candidate":    metrics.candidate.error_rate,
        "sample_size_baseline":    metrics.baseline.sample_count,
        "sample_size_candidate":   metrics.candidate.sample_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_snapshot(quality: f64, latency: u32, errors: f64, samples: u32) -> VersionSnapshot {
        VersionSnapshot {
            version_id: Uuid::new_v4(),
            avg_quality: quality,
            p95_latency_ms: latency,
            error_rate: errors,
            sample_count: samples,
        }
    }

    #[test]
    fn test_build_snapshot_json_has_all_fields() {
        let metrics = RolloutMetrics {
            rollout_id: Uuid::new_v4(),
            baseline: make_snapshot(0.92, 850, 0.01, 500),
            candidate: make_snapshot(0.88, 420, 0.02, 250),
        };

        let json = build_snapshot_json(&metrics);

        assert!(json.get("quality_score_baseline").is_some());
        assert!(json.get("quality_score_candidate").is_some());
        assert!(json.get("latency_p95_baseline").is_some());
        assert!(json.get("latency_p95_candidate").is_some());
        assert!(json.get("error_rate_baseline").is_some());
        assert!(json.get("error_rate_candidate").is_some());
        assert!(json.get("sample_size_baseline").is_some());
        assert!(json.get("sample_size_candidate").is_some());
    }

    #[test]
    fn test_build_snapshot_json_values_correct() {
        let metrics = RolloutMetrics {
            rollout_id: Uuid::new_v4(),
            baseline: make_snapshot(0.92, 850, 0.01, 500),
            candidate: make_snapshot(0.88, 420, 0.02, 250),
        };

        let json = build_snapshot_json(&metrics);

        assert_eq!(json["quality_score_baseline"], 0.92);
        assert_eq!(json["quality_score_candidate"], 0.88);
        assert_eq!(json["sample_size_candidate"], 250);
    }
}
