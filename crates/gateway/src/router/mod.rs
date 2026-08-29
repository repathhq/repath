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

/// Query the database for each tenant's current traffic-routing config.
///
/// In self-hosted mode (REPATH_CLOUD_MODE not set) this returns the single
/// config. In cloud mode the gateway receives tenant_id per-request and the
/// handler filters in the hot path — this cache holds one entry per tenant,
/// keyed by tenant_id, but for simplicity we only support one rollout
/// determining a tenant's routing at a time.
///
/// This deliberately includes more than rollouts that are still being
/// *tested* (`shadow`/`canary`). A `promoted` rollout's `current_weight` is
/// set to 1.0, and a `rolled_back` one's to 0.0 (see `apply_manual_action`
/// and `store::apply_advance`) — those weights are exactly what should keep
/// being served after the experiment ends, since there is no separate
/// "tenant's current baseline" record anywhere else in the schema. A rollout
/// is the only place a version's model/prompt config lives. Excluding
/// `promoted`/`rolled_back` here (as an earlier version of this query did)
/// meant a request's rollout simply vanished from the cache the moment an
/// experiment finished, silently falling through to raw passthrough with no
/// prompt override at all — for a promoted candidate as much as a rolled-
/// back baseline. `paused` is included for the same reason: pausing holds
/// the current split, it does not stop serving it. Only `created` (not yet
/// started) is excluded. `ORDER BY created_at DESC` + `.first()` in
/// `active_for` means a newer rollout for the same tenant always takes
/// precedence over an older promoted/rolled-back one.
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
        WHERE r.state IN ('shadow', 'canary', 'paused', 'promoted', 'rolled_back')
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

#[cfg(test)]
mod tests {
    //! Regression tests for the promoted/rolled-back routing gap: a rollout
    //! used to vanish from this cache the instant it left `shadow`/`canary`,
    //! silently dropping prompt injection for the rest of its life. Skipped
    //! (not failed) when `DATABASE_URL` is unset, matching the convention in
    //! `tests/tenant_isolation.rs`.
    //!
    //! ```
    //! DATABASE_URL=postgres://... cargo test -p repath-gateway --lib router::tests
    //! ```

    use super::*;
    use sqlx::Row;

    struct TestDb {
        pool: PgPool,
        schema: String,
        admin_url: String,
    }

    impl TestDb {
        async fn new() -> Option<Self> {
            let database_url = std::env::var("DATABASE_URL").ok()?;
            let schema = format!("router_{}", Uuid::new_v4().simple());

            let root = PgPool::connect(&database_url).await.expect("connect");
            sqlx::query(&format!("CREATE SCHEMA \"{schema}\""))
                .execute(&root)
                .await
                .expect("create schema");
            root.close().await;

            let mut opts: sqlx::postgres::PgConnectOptions =
                database_url.parse().expect("parse DATABASE_URL");
            opts = opts.options([("search_path", schema.as_str())]);
            let pool = PgPool::connect_with(opts).await.expect("connect to schema");

            // A minimal, hand-rolled schema rather than the real migrations
            // (as tests/tenant_isolation.rs also does): `sqlx::migrate!`
            // would run `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`, which
            // is database-wide and lands in whichever schema happens to run
            // it first — every other test's schema-scoped search_path then
            // can't see uuid_generate_v4() and fails. gen_random_uuid() is
            // built into Postgres 13+, so no extension is needed.
            for ddl in [
                r#"CREATE TABLE providers (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL UNIQUE,
                    base_url VARCHAR(500) NOT NULL,
                    api_key_encrypted TEXT NOT NULL,
                    provider_type VARCHAR(50) NOT NULL
                )"#,
                r#"CREATE TABLE versions (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL UNIQUE,
                    provider_id UUID NOT NULL REFERENCES providers(id),
                    model VARCHAR(255) NOT NULL,
                    prompt_template TEXT,
                    provider_url VARCHAR(500),
                    parameters JSONB NOT NULL DEFAULT '{}'::jsonb
                )"#,
                r#"CREATE TABLE rollouts (
                    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    name VARCHAR(255) NOT NULL UNIQUE,
                    tenant_id VARCHAR(64),
                    baseline_version_id UUID NOT NULL REFERENCES versions(id),
                    candidate_version_id UUID NOT NULL REFERENCES versions(id),
                    state VARCHAR(50) NOT NULL DEFAULT 'created',
                    current_weight DOUBLE PRECISION NOT NULL DEFAULT 0.0,
                    policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                    strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )"#,
            ] {
                sqlx::query(ddl).execute(&pool).await.expect("create table");
            }

            Some(Self {
                pool,
                schema,
                admin_url: database_url,
            })
        }

        /// Inserts a provider, a baseline + candidate version, and a rollout
        /// in the given `state`/`current_weight`. Returns the rollout id.
        async fn seed_rollout(&self, state: &str, weight: f64) -> Uuid {
            let suffix = Uuid::new_v4().simple().to_string();

            let provider_id: Uuid = sqlx::query(
                "INSERT INTO providers (name, base_url, api_key_encrypted, provider_type) \
                 VALUES ($1, 'https://api.openai.com/v1', 'enc', 'openai') RETURNING id",
            )
            .bind(format!("provider-{suffix}"))
            .fetch_one(&self.pool)
            .await
            .expect("insert provider")
            .get("id");

            let baseline_id: Uuid = sqlx::query(
                "INSERT INTO versions (name, provider_id, model, prompt_template) \
                 VALUES ($1, $2, 'gpt-4o', 'baseline prompt') RETURNING id",
            )
            .bind(format!("baseline-{suffix}"))
            .bind(provider_id)
            .fetch_one(&self.pool)
            .await
            .expect("insert baseline version")
            .get("id");

            let candidate_id: Uuid = sqlx::query(
                "INSERT INTO versions (name, provider_id, model, prompt_template) \
                 VALUES ($1, $2, 'gpt-4o-mini', 'hello babye') RETURNING id",
            )
            .bind(format!("candidate-{suffix}"))
            .bind(provider_id)
            .fetch_one(&self.pool)
            .await
            .expect("insert candidate version")
            .get("id");

            sqlx::query(
                "INSERT INTO rollouts \
                 (name, baseline_version_id, candidate_version_id, state, current_weight, policy, strategy) \
                 VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, '{}'::jsonb) RETURNING id",
            )
            .bind(format!("rollout-{suffix}"))
            .bind(baseline_id)
            .bind(candidate_id)
            .bind(state)
            .bind(weight)
            .fetch_one(&self.pool)
            .await
            .expect("insert rollout")
            .get("id")
        }
    }

    impl Drop for TestDb {
        fn drop(&mut self) {
            let schema = self.schema.clone();
            let admin_url = self.admin_url.clone();
            std::thread::spawn(move || {
                tokio::runtime::Runtime::new().unwrap().block_on(async {
                    if let Ok(root) = PgPool::connect(&admin_url).await {
                        let _ = sqlx::query(&format!("DROP SCHEMA \"{schema}\" CASCADE"))
                            .execute(&root)
                            .await;
                    }
                });
            })
            .join()
            .ok();
        }
    }

    #[tokio::test]
    async fn promoted_rollout_still_routes_at_full_candidate_weight() {
        let Some(db) = TestDb::new().await else {
            eprintln!("skipping: DATABASE_URL not set");
            return;
        };
        let rollout_id = db.seed_rollout("promoted", 1.0).await;

        let cache = fetch_active_rollout(&db.pool).await.expect("fetch");
        let active = cache
            .active_for("default")
            .expect("promoted rollout must still be routable — this is the bug being fixed");

        assert_eq!(active.rollout_id, rollout_id);
        assert_eq!(active.candidate_weight, 1.0);
        assert_eq!(active.candidate_prompt.as_deref(), Some("hello babye"));
    }

    #[tokio::test]
    async fn rolled_back_rollout_still_routes_at_zero_candidate_weight() {
        let Some(db) = TestDb::new().await else {
            eprintln!("skipping: DATABASE_URL not set");
            return;
        };
        let rollout_id = db.seed_rollout("rolled_back", 0.0).await;

        let cache = fetch_active_rollout(&db.pool).await.expect("fetch");
        let active = cache.active_for("default").expect(
            "rolled-back rollout must still route to baseline, not fall through to nil passthrough",
        );

        assert_eq!(active.rollout_id, rollout_id);
        assert_eq!(active.candidate_weight, 0.0);
        assert_eq!(active.baseline_prompt.as_deref(), Some("baseline prompt"));
    }

    #[tokio::test]
    async fn paused_rollout_holds_its_split() {
        let Some(db) = TestDb::new().await else {
            eprintln!("skipping: DATABASE_URL not set");
            return;
        };
        db.seed_rollout("paused", 0.3).await;

        let cache = fetch_active_rollout(&db.pool).await.expect("fetch");
        let active = cache
            .active_for("default")
            .expect("paused rollout must keep serving its current split");

        assert_eq!(active.candidate_weight, 0.3);
    }

    #[tokio::test]
    async fn not_yet_started_rollout_is_excluded() {
        let Some(db) = TestDb::new().await else {
            eprintln!("skipping: DATABASE_URL not set");
            return;
        };
        db.seed_rollout("created", 0.0).await;

        let cache = fetch_active_rollout(&db.pool).await.expect("fetch");
        assert!(
            cache.active_for("default").is_none(),
            "a rollout that was never started should not serve traffic"
        );
    }

    #[tokio::test]
    async fn newer_rollout_supersedes_an_older_promoted_one() {
        let Some(db) = TestDb::new().await else {
            eprintln!("skipping: DATABASE_URL not set");
            return;
        };
        let _old_promoted = db.seed_rollout("promoted", 1.0).await;
        // created_at is DEFAULT NOW(); force a later timestamp for the second one.
        tokio::time::sleep(Duration::from_millis(20)).await;
        let newer_id = db.seed_rollout("canary", 0.1).await;

        let cache = fetch_active_rollout(&db.pool).await.expect("fetch");
        let active = cache.active_for("default").expect("some rollout active");

        assert_eq!(
            active.rollout_id, newer_id,
            "the newer rollout must win over an older promoted one for the same tenant"
        );
    }
}
