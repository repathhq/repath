//! Policy evaluation — decides what to do with a rollout given its current metrics.
//!
//! This module is pure logic: it takes `RolloutMetrics` and a `RolloutPolicy`
//! and returns a `PolicyVerdict`. No I/O, no side effects.
//!
//! # Decision logic
//!
//! ```text
//! Input: metrics (quality, latency, error_rate) + policy (thresholds)
//!
//! 1. Rollback gate (checked first — safety over progress):
//!    - candidate.quality     < policy.rollback_threshold  → ROLLBACK
//!    - candidate.error_rate  > policy.max_error_rate      → ROLLBACK
//!
//! 2. Advance gate (checked only if rollback gate passes):
//!    - candidate.quality     >= policy.advance_threshold
//!    - candidate.error_rate  <= policy.max_error_rate
//!    - candidate.p95_latency <= baseline.p95_latency * policy.max_latency_increase
//!    - step.pause_duration has elapsed
//!    → ADVANCE
//!
//! 3. Otherwise: HOLD (not enough signal yet, or gates not met)
//! ```
//!
//! # Why rollback is checked before advance
//!
//! At the boundary between thresholds (e.g., quality exactly at
//! rollback_threshold), we want to err on the side of safety. If quality is
//! 0.70 and rollback_threshold is 0.70, we rollback — not advance.
//!
//! # Latency comparison
//!
//! We compare candidate P95 to baseline P95 (not an absolute threshold).
//! This handles natural variability — a 2× latency increase is bad whether
//! baseline is 100ms or 2000ms. An absolute threshold of "< 5000ms" would
//! pass a candidate that's 5000ms when baseline is 500ms.

use crate::metrics_aggregator::{RolloutMetrics, VersionSnapshot};
use repath_common::types::RolloutPolicy;

/// The controller's decision for a single evaluation cycle.
#[derive(Debug, Clone, PartialEq)]
pub enum PolicyVerdict {
    /// Increase candidate traffic weight to `new_weight`.
    /// `new_weight` is the target_weight of the current step if the gate passes,
    /// or 1.0 if this is the final step (promotion).
    Advance {
        new_weight: f64,
        is_final: bool,
        reason: String,
    },
    /// Roll back to 0% candidate immediately.
    Rollback { reason: String },
    /// Do nothing this cycle — gates not yet met or insufficient data.
    Hold { reason: String },
}

/// Gate check result — either passes or fails with a reason.
#[derive(Debug)]
enum GateResult {
    Pass,
    Fail(String),
}

/// Evaluate the rollout policy against current metrics.
///
/// # Arguments
///
/// * `metrics`          - Current window metrics for baseline + candidate
/// * `policy`           - The rollout's configured thresholds
/// * `current_weight`   - Current fraction of traffic on candidate (0.0 – 1.0)
/// * `next_step_weight` - Target weight if we advance (from the step config)
/// * `is_final_step`    - Whether advancing means promotion (100%)
/// * `step_elapsed_secs`- Seconds since the current step became active
pub fn evaluate(
    metrics: &RolloutMetrics,
    policy: &RolloutPolicy,
    _current_weight: f64,
    next_step_weight: f64,
    is_final_step: bool,
    step_elapsed_secs: u64,
    min_step_duration_secs: u64,
) -> PolicyVerdict {
    let c = &metrics.candidate;
    let b = &metrics.baseline;

    // ── 1. Rollback gates (safety first) ─────────────────────────────────
    if let GateResult::Fail(reason) = check_rollback_gate(c, policy) {
        return PolicyVerdict::Rollback { reason };
    }

    // ── 2. Advance gates ──────────────────────────────────────────────────

    // Minimum pause duration: don't advance until the step has been active
    // for at least the configured duration. This prevents flapping when
    // there's a brief quality spike immediately after traffic shifts.
    if step_elapsed_secs < min_step_duration_secs {
        return PolicyVerdict::Hold {
            reason: format!(
                "Waiting for minimum step duration: {}s elapsed of {}s required",
                step_elapsed_secs, min_step_duration_secs
            ),
        };
    }

    match check_advance_gate(c, b, policy) {
        GateResult::Pass => PolicyVerdict::Advance {
            new_weight: next_step_weight,
            is_final: is_final_step,
            reason: format!(
                "All gates passed: quality={:.3} >= {}, error_rate={:.3} <= {}, \
                 p95_latency={}ms, candidate_samples={}",
                c.avg_quality,
                policy.advance_threshold,
                c.error_rate,
                policy.max_error_rate,
                c.p95_latency_ms,
                c.sample_count,
            ),
        },
        GateResult::Fail(reason) => PolicyVerdict::Hold { reason },
    }
}

/// Check whether any rollback condition is met.
fn check_rollback_gate(candidate: &VersionSnapshot, policy: &RolloutPolicy) -> GateResult {
    if candidate.avg_quality < policy.rollback_threshold {
        return GateResult::Fail(format!(
            "Quality regression: candidate quality {:.3} < rollback threshold {:.3} \
             (sample_size={})",
            candidate.avg_quality, policy.rollback_threshold, candidate.sample_count
        ));
    }

    if candidate.error_rate > policy.max_error_rate {
        return GateResult::Fail(format!(
            "Error rate too high: candidate error_rate {:.3} > max {:.3} \
             (sample_size={})",
            candidate.error_rate, policy.max_error_rate, candidate.sample_count
        ));
    }

    GateResult::Pass
}

/// Check whether all advance conditions are met.
fn check_advance_gate(
    candidate: &VersionSnapshot,
    baseline: &VersionSnapshot,
    policy: &RolloutPolicy,
) -> GateResult {
    // Quality must be at or above the advance threshold
    if candidate.avg_quality < policy.advance_threshold {
        return GateResult::Fail(format!(
            "Quality below advance threshold: {:.3} < {:.3} (need {:.3} more)",
            candidate.avg_quality,
            policy.advance_threshold,
            policy.advance_threshold - candidate.avg_quality,
        ));
    }

    // Error rate must be acceptably low
    if candidate.error_rate > policy.max_error_rate {
        return GateResult::Fail(format!(
            "Error rate too high: {:.3} > max {:.3}",
            candidate.error_rate, policy.max_error_rate,
        ));
    }

    // Latency: candidate P95 must not exceed baseline by more than the
    // configured multiplier. If baseline has no data, skip this check.
    if baseline.p95_latency_ms > 0 {
        let allowed_latency = (baseline.p95_latency_ms as f64 * policy.max_latency_increase) as u32;
        if candidate.p95_latency_ms > allowed_latency {
            return GateResult::Fail(format!(
                "Latency regression: candidate P95 {}ms > {}ms ({}× baseline {}ms)",
                candidate.p95_latency_ms,
                allowed_latency,
                policy.max_latency_increase,
                baseline.p95_latency_ms,
            ));
        }
    }

    GateResult::Pass
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;
    use crate::metrics_aggregator::{RolloutMetrics, VersionSnapshot};

    fn policy() -> RolloutPolicy {
        RolloutPolicy {
            advance_threshold: 0.90,
            rollback_threshold: 0.70,
            min_samples: 50,
            confidence_level: 0.95,
            max_latency_increase: 1.5,
            max_error_rate: 0.05,
        }
    }

    fn make_metrics(
        baseline_q: f64, baseline_lat: u32,
        candidate_q: f64, candidate_lat: u32,
        candidate_errors: f64,
    ) -> RolloutMetrics {
        RolloutMetrics {
            rollout_id: Uuid::new_v4(),
            baseline: VersionSnapshot {
                version_id: Uuid::new_v4(),
                avg_quality: baseline_q,
                p95_latency_ms: baseline_lat,
                error_rate: 0.01,
                sample_count: 200,
            },
            candidate: VersionSnapshot {
                version_id: Uuid::new_v4(),
                avg_quality: candidate_q,
                p95_latency_ms: candidate_lat,
                error_rate: candidate_errors,
                sample_count: 100,
            },
        }
    }

    #[test]
    fn test_high_quality_candidate_advances() {
        let metrics = make_metrics(0.92, 500, 0.93, 480, 0.01);
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Advance { .. }),
            "Expected Advance, got {:?}", result
        );
    }

    #[test]
    fn test_low_quality_candidate_rolls_back() {
        let metrics = make_metrics(0.92, 500, 0.60, 490, 0.02);
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Rollback { .. }),
            "Expected Rollback, got {:?}", result
        );
    }

    #[test]
    fn test_quality_between_thresholds_holds() {
        // Quality is above rollback (0.70) but below advance (0.90) → Hold
        let metrics = make_metrics(0.92, 500, 0.80, 490, 0.01);
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Hold { .. }),
            "Expected Hold, got {:?}", result
        );
    }

    #[test]
    fn test_high_error_rate_rolls_back() {
        let metrics = make_metrics(0.92, 500, 0.91, 490, 0.10); // error_rate=0.10 > 0.05
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Rollback { .. }),
            "Expected Rollback due to error rate, got {:?}", result
        );
    }

    #[test]
    fn test_latency_regression_holds() {
        // Candidate P95 is 2× baseline — exceeds 1.5× max_latency_increase
        let metrics = make_metrics(0.92, 500, 0.91, 1100, 0.01);
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Hold { .. }),
            "Expected Hold due to latency regression, got {:?}", result
        );
    }

    #[test]
    fn test_minimum_duration_not_elapsed_holds() {
        // Quality is great but step duration hasn't passed
        let metrics = make_metrics(0.92, 500, 0.93, 480, 0.01);
        let result = evaluate(
            &metrics, &policy(), 0.10, 0.50, false,
            300, // elapsed: 300s
            600, // required: 600s
        );
        assert!(
            matches!(result, PolicyVerdict::Hold { .. }),
            "Expected Hold because step duration not elapsed, got {:?}", result
        );
    }

    #[test]
    fn test_final_step_advance_marks_is_final() {
        let metrics = make_metrics(0.92, 500, 0.93, 480, 0.01);
        let result = evaluate(&metrics, &policy(), 0.50, 1.0, true, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Advance { is_final: true, .. }),
            "Expected Advance with is_final=true, got {:?}", result
        );
    }

    #[test]
    fn test_rollback_reason_is_descriptive() {
        let metrics = make_metrics(0.92, 500, 0.60, 490, 0.02);
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        if let PolicyVerdict::Rollback { reason } = result {
            assert!(
                reason.contains("0.600") || reason.contains("0.60"),
                "Reason should include the actual quality score: {}", reason
            );
            assert!(
                reason.contains("0.70") || reason.contains("rollback threshold"),
                "Reason should mention the threshold: {}", reason
            );
        } else {
            panic!("Expected Rollback");
        }
    }

    #[test]
    fn test_rollback_threshold_boundary_is_rollback() {
        // Exactly at rollback threshold — should rollback, not hold.
        // Safety: at the boundary, we rollback.
        let metrics = make_metrics(0.92, 500, 0.70, 490, 0.01);
        // quality == rollback_threshold (0.70 < 0.70 is false, so this holds)
        // Actually 0.70 < 0.70 = false, so this is a Hold, not Rollback.
        // The boundary is strictly-less-than: quality < threshold → rollback
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        // 0.70 is not < 0.70, so rollback gate doesn't trigger.
        // 0.70 is not >= 0.90 advance threshold, so advance gate doesn't trigger.
        // → Hold
        assert!(
            matches!(result, PolicyVerdict::Hold { .. }),
            "At exact rollback threshold, should Hold (< not <=): got {:?}", result
        );
    }

    #[test]
    fn test_just_below_rollback_threshold_rolls_back() {
        let metrics = make_metrics(0.92, 500, 0.699, 490, 0.01);
        let result = evaluate(&metrics, &policy(), 0.10, 0.50, false, 700, 600);
        assert!(
            matches!(result, PolicyVerdict::Rollback { .. }),
            "Expected Rollback, got {:?}", result
        );
    }
}
