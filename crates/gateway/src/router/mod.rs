//! Traffic routing — version selection for incoming requests.
//!
//! # Design
//!
//! Every request needs to know which version (baseline or candidate) to send
//! to. That decision is driven by the active rollout. The naive approach of
//! querying the database on every request would add 1–5ms latency and saturate
//! the DB at high throughput.
//!
//! Instead, we maintain a local in-process cache (`RolloutCache`) that is
//! refreshed every 5 seconds by a background task. Each request reads the
//! cache with a single atomic pointer load — zero locking, zero allocations on
//! the hot path.
//!
//! # Cache freshness
//!
//! 5-second staleness is acceptable here because:
//! - Rollout weight changes happen at most once per `decision_interval` (30s)
//! - An instant rollback triggered by the controller writes a new state to the
//!   DB; the cache will pick it up within 5 seconds
//! - In extreme cases (controller triggers rollback at T=0, cache picks it up
//!   at T=5), at most 5s of traffic goes to a degraded candidate — which is
//!   better than any locking approach that would trade correctness for latency

pub mod version_selector;

use arc_swap::ArcSwap;
use repath_common::Result;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info};
use uuid::Uuid;

pub use version_selector::{select_version, VersionAssignment};

/// Cached representation of the currently active rollout.
///
/// This struct is what every request handler loads from the ArcSwap. It
/// contains everything needed to make a routing decision with no further
/// I/O.
#[derive(Debug, Clone)]
pub struct RolloutCache {
    /// The active rollout, if one exists. None means pass-through to default.
    pub active: Option<ActiveRollout>,
    /// Monotonic timestamp of last refresh (for staleness metrics)
    pub refreshed_at: std::time::Instant,
}

/// An active rollout — the minimal data needed per-request for routing.
#[derive(Debug, Clone)]
pub struct ActiveRollout {
    pub rollout_id: Uuid,
    pub baseline_version_id: Uuid,
    pub candidate_version_id: Uuid,
    /// Fraction of traffic to route to the candidate (0.0 – 1.0).
    /// Written by the controller, read on every request.
    pub candidate_weight: f64,
    pub baseline_model: String,
    pub baseline_prompt: Option<String>,
    pub candidate_model: String,
    pub candidate_prompt: Option<String>,
}

impl RolloutCache {
    pub fn empty() -> Self {
        Self {
            active: None,
            refreshed_at: std::time::Instant::now(),
        }
    }
}

/// Background task that periodically refreshes the rollout cache from the DB.
///
/// This task runs forever until its `JoinHandle` is aborted (on shutdown).
/// It replaces the ArcSwap pointer atomically — no reader is ever blocked.
///
/// # Why a background refresher instead of per-request DB reads?
///
/// At 50K req/s, a 2ms DB query per request = 100K DB queries/second. That
/// would saturate any reasonable PostgreSQL instance. The refresher reduces
/// this to 1 query every 5 seconds regardless of request rate.
pub async fn run_cache_refresher(
    db_pool: PgPool,
    cache: Arc<ArcSwap<RolloutCache>>,
) {
    info!("Rollout cache refresher started (interval: 5s)");

    let mut interval = tokio::time::interval(Duration::from_secs(5));
    // Skip missed ticks rather than burst-catching up after a slow DB query
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        match fetch_active_rollout(&db_pool).await {
            Ok(new_cache) => {
                debug!(
                    active = new_cache.active.is_some(),
                    "Rollout cache refreshed"
                );
                // ArcSwap::store is a single atomic pointer swap — O(1), never
                // blocks any concurrent reader. Old Arc is dropped when the
                // last holder releases it.
                cache.store(Arc::new(new_cache));
            }
            Err(e) => {
                // Log and continue with stale cache. Serving stale routing
                // is far better than panicking or blocking requests.
                error!(
                    error = %e,
                    "Failed to refresh rollout cache — serving stale routing"
                );
            }
        }
    }
}

/// Query the database for the currently active rollout.
///
/// Returns a `RolloutCache` with `active = None` if no rollout is in
/// `shadow` or `canary` state.
async fn fetch_active_rollout(pool: &PgPool) -> Result<RolloutCache> {
    // Uses sqlx::query (not sqlx::query!) to avoid requiring DATABASE_URL at
    // compile time. Column types are mapped manually below.
    let row = sqlx::query(
        r#"
        SELECT
            r.id                    AS rollout_id,
            r.baseline_version_id,
            r.candidate_version_id,
            r.current_weight        AS candidate_weight,
            bv.model                AS baseline_model,
            bv.prompt_template      AS baseline_prompt,
            cv.model                AS candidate_model,
            cv.prompt_template      AS candidate_prompt
        FROM rollouts r
        JOIN versions bv ON r.baseline_version_id = bv.id
        JOIN versions cv ON r.candidate_version_id = cv.id
        WHERE r.state IN ('shadow', 'canary')
        ORDER BY r.created_at DESC
        LIMIT 1
        "#,
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| repath_common::Error::Database {
        operation: "fetch active rollout".to_string(),
        source: e.into(),
    })?;

    let active = row.map(|r: sqlx::postgres::PgRow| {
        use sqlx::Row;
        ActiveRollout {
            rollout_id:           r.get("rollout_id"),
            baseline_version_id:  r.get("baseline_version_id"),
            candidate_version_id: r.get("candidate_version_id"),
            candidate_weight:     r.get("candidate_weight"),
            baseline_model:       r.get("baseline_model"),
            baseline_prompt:      r.get("baseline_prompt"),
            candidate_model:      r.get("candidate_model"),
            candidate_prompt:     r.get("candidate_prompt"),
        }
    });

    Ok(RolloutCache {
        active,
        refreshed_at: std::time::Instant::now(),
    })
}
