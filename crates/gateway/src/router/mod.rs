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

use std::collections::HashMap;

/// Cached representation of all currently active rollouts.
///
/// Keyed by tenant_id so every request can O(1) look up the right rollout
/// without any locking. Replacing a single-rollout cache with a per-tenant
/// map lets multiple tenants (or one tenant with multiple features) run
/// independently.
#[derive(Debug, Clone)]
pub struct RolloutCache {
    /// All active rollouts indexed by tenant_id.
    /// A tenant with no active rollout is absent from the map.
    pub by_tenant: HashMap<String, Vec<ActiveRollout>>,
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
    /// Provider base URL for baseline (e.g. "https://api.openai.com/v1")
    pub baseline_provider_url: String,
    pub candidate_model: String,
    pub candidate_prompt: Option<String>,
    /// Provider base URL for candidate (may differ from baseline)
    pub candidate_provider_url: String,
    /// Tenant ID — used for circuit breaker isolation
    pub tenant_id: String,
}

impl RolloutCache {
    pub fn empty() -> Self {
        Self {
            by_tenant: HashMap::new(),
            refreshed_at: std::time::Instant::now(),
        }
    }

    /// Return the first active rollout for this tenant (for simple cases).
    pub fn active_for(&self, tenant_id: &str) -> Option<&ActiveRollout> {
        self.by_tenant.get(tenant_id).and_then(|v| v.first())
    }

    /// Return all active rollouts for this tenant.
    pub fn all_for(&self, tenant_id: &str) -> &[ActiveRollout] {
        self.by_tenant
            .get(tenant_id)
            .map(|v| v.as_slice())
            .unwrap_or(&[])
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
pub async fn run_cache_refresher(db_pool: PgPool, cache: Arc<ArcSwap<RolloutCache>>) {
    info!("Rollout cache refresher started (interval: 5s)");

    let mut interval = tokio::time::interval(Duration::from_secs(5));
    // Skip missed ticks rather than burst-catching up after a slow DB query
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        match fetch_active_rollout(&db_pool).await {
            Ok(new_cache) => {
                let total: usize = new_cache.by_tenant.values().map(|v| v.len()).sum();
                debug!(active_rollouts = total, "Rollout cache refreshed");
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
/// In self-hosted mode (REPATH_CLOUD_MODE not set) this returns the single
/// active rollout. In cloud mode the gateway receives tenant_id per-request
/// and the handler filters in the hot path — this cache holds all active
/// rollouts, keyed by tenant_id, but for simplicity we only support one
/// active rollout per tenant at a time.
async fn fetch_active_rollout(pool: &PgPool) -> Result<RolloutCache> {
    let rows = sqlx::query(
        r#"
        SELECT
            r.id                    AS rollout_id,
            r.baseline_version_id,
            r.candidate_version_id,
            r.current_weight        AS candidate_weight,
            bv.model                AS baseline_model,
            bv.prompt_template      AS baseline_prompt,
            COALESCE(bv.provider_url, 'https://api.openai.com/v1') AS baseline_provider_url,
            cv.model                AS candidate_model,
            cv.prompt_template      AS candidate_prompt,
            COALESCE(cv.provider_url, 'https://api.openai.com/v1') AS candidate_provider_url,
            COALESCE(r.tenant_id, 'default') AS tenant_id
        FROM rollouts r
        JOIN versions bv ON r.baseline_version_id = bv.id
        JOIN versions cv ON r.candidate_version_id = cv.id
        WHERE r.state IN ('shadow', 'canary')
        ORDER BY r.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
    .map_err(|e| repath_common::Error::Database {
        operation: "fetch active rollouts".to_string(),
        source: e.into(),
    })?;

    let mut by_tenant: HashMap<String, Vec<ActiveRollout>> = HashMap::new();

    for r in rows {
        use sqlx::Row;
        let tenant_id: String = r.get("tenant_id");
        let rollout = ActiveRollout {
            rollout_id: r.get("rollout_id"),
            baseline_version_id: r.get("baseline_version_id"),
            candidate_version_id: r.get("candidate_version_id"),
            candidate_weight: r.get("candidate_weight"),
            baseline_model: r.get("baseline_model"),
            baseline_prompt: r.get("baseline_prompt"),
            baseline_provider_url: r.get("baseline_provider_url"),
            candidate_model: r.get("candidate_model"),
            candidate_prompt: r.get("candidate_prompt"),
            candidate_provider_url: r.get("candidate_provider_url"),
            tenant_id: tenant_id.clone(),
        };
        by_tenant.entry(tenant_id).or_default().push(rollout);
    }

    Ok(RolloutCache {
        by_tenant,
        refreshed_at: std::time::Instant::now(),
    })
}
