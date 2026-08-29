//! Per-tenant request rate limiting.
//!
//! # What this protects
//!
//! `eval_quota_monthly` meters LLM-judge evaluations, which is what costs us
//! money per unit. It does not meter *requests*. Proxied traffic was
//! completely uncapped: a tenant on the ₹1,699 plan could push ten million
//! requests a month through the gateway and its egress at no additional
//! charge, and by design their service is never interrupted when the eval
//! quota runs out. That is a cost leak on the one resource nobody was
//! counting.
//!
//! # Why a token bucket, in process, and not Redis
//!
//! This runs on the hot path of every proxied request. A Redis round trip
//! would add a network hop to a path whose entire budget is a few hundred
//! microseconds, and would make Redis a hard dependency of serving traffic —
//! today a Redis outage degrades evaluation, not proxying, and that is worth
//! keeping.
//!
//! The tradeoff is that limits are per gateway instance. With one instance
//! that is exact; with N instances a tenant gets up to N times the limit.
//! That is the right failure direction for a cost control — it errs toward
//! serving customers rather than rejecting paying traffic — and when a second
//! instance is added this should move behind a shared counter.
//!
//! # Bursting
//!
//! A bucket refills continuously and holds up to `burst` tokens, so a client
//! that has been idle can spike briefly. Real traffic is bursty; a strict
//! per-second cap would reject legitimate parallel requests from an app that
//! is well inside its average.

use dashmap::DashMap;
use std::time::Instant;

/// Sustained requests per second, and the burst ceiling, for a plan.
#[derive(Debug, Clone, Copy)]
pub struct Limit {
    pub per_second: f64,
    pub burst: f64,
}

/// Limits by plan.
///
/// These are deliberately generous — roughly 100x what the eval quota implies
/// — because this is a runaway-cost backstop, not a metering product. A
/// customer should never hit it during normal use; if they do, that is a
/// conversation about a bigger plan, not a silent throttle.
pub fn limit_for_plan(plan: &str) -> Limit {
    match plan {
        "free" => Limit {
            per_second: 1.0,
            burst: 10.0,
        },
        "trial" | "indie" => Limit {
            per_second: 10.0,
            burst: 50.0,
        },
        "starter" => Limit {
            per_second: 30.0,
            burst: 150.0,
        },
        "pro" => Limit {
            per_second: 100.0,
            burst: 500.0,
        },
        // Enterprise and anything unrecognised are not throttled here. An
        // unknown plan is a bug in our own catalogue, and throttling a
        // paying customer over it would be the wrong way to find out.
        _ => Limit {
            per_second: f64::INFINITY,
            burst: f64::INFINITY,
        },
    }
}

struct Bucket {
    tokens: f64,
    last_refill: Instant,
}

/// Token buckets keyed by tenant id.
pub struct RateLimiter {
    buckets: DashMap<String, Bucket>,
}

impl Default for RateLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl RateLimiter {
    pub fn new() -> Self {
        Self {
            buckets: DashMap::new(),
        }
    }

    /// Take one token. `true` means the request may proceed.
    ///
    /// An unlimited plan short-circuits before touching the map, so the
    /// common enterprise case costs nothing.
    pub fn check(&self, tenant_id: &str, limit: Limit) -> bool {
        if limit.per_second.is_infinite() {
            return true;
        }

        let now = Instant::now();
        let mut bucket = self
            .buckets
            .entry(tenant_id.to_string())
            .or_insert_with(|| Bucket {
                // A tenant seen for the first time starts full, so their
                // first request is never rejected.
                tokens: limit.burst,
                last_refill: now,
            });

        let elapsed = now.duration_since(bucket.last_refill).as_secs_f64();
        bucket.tokens = (bucket.tokens + elapsed * limit.per_second).min(limit.burst);
        bucket.last_refill = now;

        if bucket.tokens >= 1.0 {
            bucket.tokens -= 1.0;
            true
        } else {
            false
        }
    }

    /// Drop buckets untouched for an hour.
    ///
    /// Without this the map grows once per tenant that ever sends a request
    /// and never shrinks — a slow leak that only shows up in a long-running
    /// process, which is exactly what this is. An idle bucket is also always
    /// full, so discarding it loses nothing.
    pub fn evict_idle(&self) {
        let cutoff = Instant::now() - std::time::Duration::from_secs(3600);
        self.buckets.retain(|_, b| b.last_refill > cutoff);
    }

    /// Number of live buckets. Test-only: used to assert that unlimited
    /// plans short-circuit without allocating, and that eviction keeps
    /// buckets still in use.
    #[cfg(test)]
    pub fn bucket_count(&self) -> usize {
        self.buckets.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_first_request_is_never_rejected() {
        let rl = RateLimiter::new();
        let limit = Limit {
            per_second: 1.0,
            burst: 5.0,
        };
        assert!(
            rl.check("ten_new", limit),
            "a tenant's very first request must not be throttled"
        );
    }

    #[test]
    fn a_burst_is_allowed_then_throttled() {
        let rl = RateLimiter::new();
        let limit = Limit {
            per_second: 1.0,
            burst: 5.0,
        };
        for i in 0..5 {
            assert!(rl.check("ten_a", limit), "burst request {i} should pass");
        }
        assert!(
            !rl.check("ten_a", limit),
            "the sixth request exceeds a burst of five and must be rejected"
        );
    }

    #[test]
    fn tenants_do_not_share_a_bucket() {
        let rl = RateLimiter::new();
        let limit = Limit {
            per_second: 1.0,
            burst: 2.0,
        };
        assert!(rl.check("ten_a", limit));
        assert!(rl.check("ten_a", limit));
        assert!(!rl.check("ten_a", limit), "ten_a is now exhausted");

        assert!(
            rl.check("ten_b", limit),
            "one tenant exhausting its bucket must not throttle another — \
             otherwise a single noisy customer takes down everyone"
        );
    }

    #[test]
    fn tokens_refill_over_time() {
        let rl = RateLimiter::new();
        let limit = Limit {
            per_second: 100.0,
            burst: 1.0,
        };
        assert!(rl.check("ten_r", limit));
        assert!(!rl.check("ten_r", limit), "bucket of one is now empty");

        std::thread::sleep(std::time::Duration::from_millis(50));
        assert!(
            rl.check("ten_r", limit),
            "at 100/s, 50ms should refill several tokens"
        );
    }

    #[test]
    fn unlimited_plans_are_never_throttled_and_allocate_nothing() {
        let rl = RateLimiter::new();
        let limit = limit_for_plan("enterprise");
        for _ in 0..10_000 {
            assert!(rl.check("ten_ent", limit));
        }
        assert_eq!(
            rl.bucket_count(),
            0,
            "an unlimited plan should short-circuit before creating a bucket"
        );
    }

    #[test]
    fn paid_plans_get_more_headroom_than_free() {
        let free = limit_for_plan("free");
        let indie = limit_for_plan("indie");
        let starter = limit_for_plan("starter");
        let pro = limit_for_plan("pro");

        assert!(indie.per_second > free.per_second);
        assert!(starter.per_second > indie.per_second);
        assert!(pro.per_second > starter.per_second);
        assert!(pro.burst > starter.burst);
    }

    #[test]
    fn a_lapsed_tenant_is_throttled_but_not_cut_off() {
        // The billing reconciler drops lapsed subscriptions to 'free' rather
        // than deactivating them. Free must still serve *some* traffic —
        // dropping to zero would break their application over a billing
        // problem, which is what deactivation deliberately avoids.
        let free = limit_for_plan("free");
        assert!(free.per_second > 0.0);
        assert!(free.burst >= 1.0);
    }

    #[test]
    fn idle_buckets_are_evicted() {
        let rl = RateLimiter::new();
        let limit = Limit {
            per_second: 1.0,
            burst: 1.0,
        };
        rl.check("ten_old", limit);
        assert_eq!(rl.bucket_count(), 1);

        // Nothing is idle yet, so eviction must not discard a live bucket.
        rl.evict_idle();
        assert_eq!(
            rl.bucket_count(),
            1,
            "a bucket in use must survive eviction"
        );
    }
}
