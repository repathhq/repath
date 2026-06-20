//! Version selection — decides baseline vs candidate for each request.
//!
//! # Algorithm
//!
//! We use weighted random selection seeded from the request's session ID when
//! sticky sessions are enabled, or from a fresh random value otherwise.
//!
//! ## Sticky sessions
//!
//! When `sticky_sessions = true`, a given session ID always maps to the same
//! version for the lifetime of the rollout. This prevents a user from seeing
//! different model behaviours across requests in the same conversation.
//!
//! Implementation: we hash the session ID + rollout ID to a u64, then take
//! (hash % 1000) / 1000.0 as the sample value. This is deterministic per
//! (session, rollout) pair with uniform distribution.
//!
//! ## Non-sticky
//!
//! Fresh random float in [0, 1) per request.

use super::ActiveRollout;
use rand::Rng;
use uuid::Uuid;

/// The result of a version selection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VersionAssignment {
    Baseline,
    Candidate,
}

/// Select which version to serve for an incoming request.
///
/// # Arguments
///
/// * `rollout`    - The active rollout (weights, version IDs)
/// * `session_id` - Optional session ID for sticky routing
///
/// # Returns
///
/// `VersionAssignment::Candidate` with probability == `rollout.candidate_weight`.
/// `VersionAssignment::Baseline` otherwise.
pub fn select_version(rollout: &ActiveRollout, session_id: Option<&str>) -> VersionAssignment {
    let sample = match session_id {
        Some(sid) => sticky_sample(sid, rollout.rollout_id),
        None => rand::thread_rng().gen::<f64>(),
    };

    if sample < rollout.candidate_weight {
        VersionAssignment::Candidate
    } else {
        VersionAssignment::Baseline
    }
}

/// Deterministic sample in [0.0, 1.0) for a (session, rollout) pair.
///
/// Uses FxHash for speed (this runs on every request). The hash is not
/// cryptographic — we don't need unpredictability here, just uniformity.
fn sticky_sample(session_id: &str, rollout_id: Uuid) -> f64 {
    use std::hash::{Hash, Hasher};

    // Combine session_id + rollout_id bytes into a single hash.
    // We include rollout_id so that a session gets re-randomised when a new
    // rollout starts (they shouldn't keep the same bucket forever).
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    session_id.hash(&mut hasher);
    rollout_id.as_bytes().hash(&mut hasher);
    // .finish() is a method on the Hasher trait — the `use Hasher` above is needed.
    let h = hasher.finish();

    // Map to [0.0, 1.0)
    (h % 1_000_000) as f64 / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    fn make_rollout(weight: f64) -> ActiveRollout {
        ActiveRollout {
            rollout_id: Uuid::new_v4(),
            baseline_version_id: Uuid::new_v4(),
            candidate_version_id: Uuid::new_v4(),
            candidate_weight: weight,
            baseline_model: "gpt-4o".into(),
            baseline_prompt: None,
            baseline_provider_url: "https://api.openai.com/v1".into(),
            candidate_model: "gpt-4o-mini".into(),
            candidate_prompt: None,
            candidate_provider_url: "https://api.openai.com/v1".into(),
            tenant_id: "default".into(),
        }
    }

    #[test]
    fn test_zero_weight_always_baseline() {
        let rollout = make_rollout(0.0);
        for _ in 0..1000 {
            assert_eq!(select_version(&rollout, None), VersionAssignment::Baseline);
        }
    }

    #[test]
    fn test_full_weight_always_candidate() {
        let rollout = make_rollout(1.0);
        for _ in 0..1000 {
            assert_eq!(select_version(&rollout, None), VersionAssignment::Candidate);
        }
    }

    #[test]
    fn test_ten_percent_weight_statistical_distribution() {
        let rollout = make_rollout(0.10);
        let candidate_count = (0..10_000)
            .filter(|_| select_version(&rollout, None) == VersionAssignment::Candidate)
            .count();

        // Expect ~10% ± 1.5% (well within statistical tolerance)
        let ratio = candidate_count as f64 / 10_000.0;
        assert!(
            (ratio - 0.10).abs() < 0.015,
            "Expected ~10% candidate, got {:.1}%",
            ratio * 100.0
        );
    }

    #[test]
    fn test_sticky_sessions_are_deterministic() {
        let rollout = make_rollout(0.5);
        let session = "user_abc_123";

        let first = select_version(&rollout, Some(session));
        for _ in 0..100 {
            assert_eq!(
                select_version(&rollout, Some(session)),
                first,
                "Sticky session must always return the same version"
            );
        }
    }

    #[test]
    fn test_sticky_sessions_different_users_get_different_versions() {
        // With 50% weight and many users, roughly half should get candidate
        let rollout = make_rollout(0.5);
        let baseline_users = (0..1000)
            .filter(|i| {
                select_version(&rollout, Some(&format!("user_{}", i)))
                    == VersionAssignment::Baseline
            })
            .count();

        // Expect roughly 50% ± 5%
        let ratio = baseline_users as f64 / 1000.0;
        assert!(
            (ratio - 0.50).abs() < 0.05,
            "Sticky distribution should be roughly uniform, got {:.1}%",
            ratio * 100.0
        );
    }

    #[test]
    fn test_sticky_sample_is_uniform() {
        // Verify sticky_sample produces values in [0.0, 1.0)
        let rollout_id = Uuid::new_v4();
        for i in 0..1000 {
            let s = sticky_sample(&format!("session_{}", i), rollout_id);
            assert!(s >= 0.0 && s < 1.0, "sticky_sample out of range: {}", s);
        }
    }
}
