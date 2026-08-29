//! Tenant identity — who is making this request, and what may they see.
//!
//! # The problem this replaces
//!
//! Repath used to read tenant identity straight out of an `X-Repath-Tenant-Id`
//! request header and trust it. Nothing verified that the caller owned that
//! tenant, so anyone who learned a tenant ID could send traffic as that tenant,
//! burn their quota, poison the evaluation data their rollback decisions depend
//! on, and receive their injected system prompts back in the response. On the
//! management side a single global token was shared by every dashboard user and
//! no query filtered by tenant, so every customer could read — and promote or
//! roll back — every other customer's rollouts.
//!
//! # The model now
//!
//! Every tenant gets an API key at signup. We store only its SHA-256 hash, so a
//! database dump yields no usable credentials. Identity is derived from that
//! key and never from a client-supplied identifier.
//!
//! Two kinds of caller exist:
//!
//! - [`AuthContext::Admin`] — presented the global `REPATH_API_TOKEN`. This is
//!   the self-hosted operator and our own ops tooling. Sees everything.
//! - [`AuthContext::Tenant`] — presented a valid tenant key. Sees only its own
//!   rows.
//!
//! # Why a cache
//!
//! Key lookup happens on every proxied request, and a database round trip per
//! request would put Postgres on the hot path — exactly what the rollout cache
//! exists to avoid. Tenants are refreshed into memory every 5 seconds, with a
//! direct database fallback on miss so a key works the instant it is created
//! rather than up to 5 seconds later.

use chrono::{DateTime, Utc};
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, error, info, warn};

pub mod middleware;
pub mod rate_limit;

pub use middleware::{require_auth, resolve_proxy_auth};

/// Tenant ID used by self-hosted, single-tenant installations.
pub const DEFAULT_TENANT_ID: &str = "default";

/// Prefix on every issued key. Makes keys greppable in logs and lets secret
/// scanners recognise them.
const KEY_PREFIX: &str = "rp_live_";

/// Bytes of entropy in an API key. 24 bytes = 192 bits, well beyond guessing.
const KEY_ENTROPY_BYTES: usize = 24;

// ── Tenant record ───────────────────────────────────────────────────────────

/// The subset of a tenant row needed to authorise and meter a request.
#[derive(Debug, Clone)]
pub struct TenantInfo {
    pub id: String,
    pub plan: String,
    pub active: bool,
    pub trial_ends_at: Option<DateTime<Utc>>,
    pub eval_quota_monthly: i32,
    pub evals_used_this_month: i32,
}

impl TenantInfo {
    /// Whether this tenant may still have traffic routed and evaluated.
    ///
    /// A lapsed trial or a deactivated account does not mean we break the
    /// customer's application — the gateway still proxies. It means we stop
    /// doing the paid work (rollout routing and LLM-judged evaluation) and
    /// pass traffic straight through to their provider.
    pub fn is_entitled(&self) -> bool {
        if !self.active {
            return false;
        }
        match self.trial_ends_at {
            // A trial that has lapsed only blocks a tenant still ON the trial
            // plan. Paying customers keep the timestamp but are unaffected.
            Some(ends) if self.plan == "trial" => ends > Utc::now(),
            _ => true,
        }
    }

    /// Whether this tenant has LLM-judge evaluations left this month.
    ///
    /// Over quota, programmatic scoring continues (it costs us nothing) and
    /// only the paid judge calls stop — matching what the pricing page promises.
    pub fn has_eval_quota(&self) -> bool {
        self.evals_used_this_month < self.eval_quota_monthly
    }
}

// ── Auth context ────────────────────────────────────────────────────────────

/// Who is calling. Attached to every authenticated request as an extension.
#[derive(Debug, Clone)]
pub enum AuthContext {
    /// Global operator token — unscoped, sees all tenants.
    Admin,
    /// A specific tenant, resolved from a verified API key.
    Tenant(Arc<TenantInfo>),
}

impl AuthContext {
    /// The tenant to filter queries by, or `None` for an unscoped admin.
    ///
    /// Handlers must treat `None` as "no filter" and `Some(id)` as a mandatory
    /// predicate. Getting this backwards is the whole bug class this module
    /// exists to prevent.
    pub fn tenant_filter(&self) -> Option<&str> {
        match self {
            AuthContext::Admin => None,
            AuthContext::Tenant(t) => Some(&t.id),
        }
    }

    /// The tenant to attribute newly created rows to. Admin writes land on the
    /// default tenant so self-hosted installs stay consistent.
    pub fn owning_tenant(&self) -> &str {
        match self {
            AuthContext::Admin => DEFAULT_TENANT_ID,
            AuthContext::Tenant(t) => &t.id,
        }
    }

    pub fn tenant(&self) -> Option<&TenantInfo> {
        match self {
            AuthContext::Admin => None,
            AuthContext::Tenant(t) => Some(t),
        }
    }
}

// ── Key hashing and generation ──────────────────────────────────────────────

/// SHA-256 of a key, lowercase hex. This is what the database stores.
pub fn hash_key(raw: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, raw.as_bytes());
    to_hex(digest.as_ref())
}

/// A freshly generated API key.
pub struct GeneratedKey {
    /// Shown to the user exactly once. Never persisted.
    pub raw: String,
    /// Stored in `tenants.api_key_hash`.
    pub hash: String,
    /// Stored in `tenants.api_key_prefix` for display ("rp_live_a1b2…").
    pub prefix: String,
}

/// Mint a new API key using the OS CSPRNG.
pub fn generate_key() -> GeneratedKey {
    use rand::RngCore;

    let mut bytes = [0u8; KEY_ENTROPY_BYTES];
    // thread_rng is seeded from the OS entropy pool and is a CSPRNG.
    rand::thread_rng().fill_bytes(&mut bytes);

    let raw = format!("{}{}", KEY_PREFIX, to_hex(&bytes));
    let hash = hash_key(&raw);
    // Enough to identify a key in a list, far too little to reconstruct it.
    let prefix = raw.chars().take(KEY_PREFIX.len() + 4).collect();

    GeneratedKey { raw, hash, prefix }
}

fn to_hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02x}");
    }
    s
}

// ── Tenant cache ────────────────────────────────────────────────────────────

/// Immutable snapshot of every tenant that has an API key, indexed by key hash.
#[derive(Debug, Default)]
pub struct TenantCache {
    by_key_hash: HashMap<String, Arc<TenantInfo>>,
}

impl TenantCache {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn get(&self, key_hash: &str) -> Option<Arc<TenantInfo>> {
        self.by_key_hash.get(key_hash).cloned()
    }

    pub fn len(&self) -> usize {
        self.by_key_hash.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_key_hash.is_empty()
    }
}

/// Resolve a raw API key to a tenant.
///
/// Checks the in-memory snapshot first, then falls back to the database so a
/// key issued moments ago authenticates immediately instead of waiting for the
/// next refresh.
///
/// A miss costs one indexed lookup. That is an acceptable price for an invalid
/// key at current scale; if key-guessing traffic ever becomes a problem, add a
/// short-lived negative cache here rather than removing the fallback.
pub async fn resolve_key(
    pool: &PgPool,
    cache: &arc_swap::ArcSwap<TenantCache>,
    raw_key: &str,
) -> Option<Arc<TenantInfo>> {
    let key_hash = hash_key(raw_key);

    if let Some(tenant) = cache.load().get(&key_hash) {
        return Some(tenant);
    }

    match load_tenant_by_key_hash(pool, &key_hash).await {
        Ok(Some(tenant)) => {
            debug!(tenant_id = %tenant.id, "Tenant key resolved via database fallback");
            Some(Arc::new(tenant))
        }
        Ok(None) => None,
        Err(e) => {
            // Fail closed: an unavailable database must not authenticate anyone.
            error!(error = %e, "Tenant key lookup failed");
            None
        }
    }
}

async fn load_tenant_by_key_hash(
    pool: &PgPool,
    key_hash: &str,
) -> Result<Option<TenantInfo>, sqlx::Error> {
    let row = sqlx::query(
        r#"
        SELECT id, plan, active, trial_ends_at,
               eval_quota_monthly, evals_used_this_month
        FROM tenants
        WHERE api_key_hash = $1 AND active = TRUE
        "#,
    )
    .bind(key_hash)
    .fetch_optional(pool)
    .await?;

    Ok(row.map(row_to_tenant))
}

fn row_to_tenant(row: sqlx::postgres::PgRow) -> TenantInfo {
    TenantInfo {
        id: row.get("id"),
        plan: row.get("plan"),
        active: row.get("active"),
        trial_ends_at: row.get("trial_ends_at"),
        eval_quota_monthly: row.get("eval_quota_monthly"),
        evals_used_this_month: row.get("evals_used_this_month"),
    }
}

/// Background task that refreshes the tenant snapshot every 5 seconds.
///
/// Mirrors the rollout cache refresher: one query on a fixed interval instead
/// of a query per request. Plan changes, quota consumption and deactivations
/// therefore take effect within 5 seconds, which is well inside the resolution
/// anything here needs.
pub async fn run_tenant_cache_refresher(
    db_pool: PgPool,
    cache: Arc<arc_swap::ArcSwap<TenantCache>>,
) {
    info!("Tenant cache refresher started (interval: 5s)");

    let mut interval = tokio::time::interval(Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        match load_all_tenants(&db_pool).await {
            Ok(new_cache) => {
                debug!(tenants = new_cache.len(), "Tenant cache refreshed");
                cache.store(Arc::new(new_cache));
            }
            Err(e) => {
                // Keep serving the previous snapshot rather than locking
                // everybody out on a transient database blip.
                warn!(error = %e, "Failed to refresh tenant cache — serving stale");
            }
        }
    }
}

async fn load_all_tenants(pool: &PgPool) -> Result<TenantCache, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT api_key_hash, id, plan, active, trial_ends_at,
               eval_quota_monthly, evals_used_this_month
        FROM tenants
        WHERE api_key_hash IS NOT NULL AND active = TRUE
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut by_key_hash = HashMap::with_capacity(rows.len());
    for row in rows {
        let hash: String = row.get("api_key_hash");
        by_key_hash.insert(hash, Arc::new(row_to_tenant(row)));
    }

    Ok(TenantCache { by_key_hash })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_keys_have_expected_shape() {
        let key = generate_key();
        assert!(key.raw.starts_with(KEY_PREFIX));
        assert_eq!(key.raw.len(), KEY_PREFIX.len() + KEY_ENTROPY_BYTES * 2);
        assert_eq!(key.hash.len(), 64, "SHA-256 hex is 64 chars");
        assert_eq!(key.prefix.len(), KEY_PREFIX.len() + 4);
        assert!(key.raw.starts_with(&key.prefix));
    }

    #[test]
    fn generated_keys_are_unique() {
        let a = generate_key();
        let b = generate_key();
        assert_ne!(a.raw, b.raw);
        assert_ne!(a.hash, b.hash);
    }

    #[test]
    fn hash_is_stable_and_matches_generation() {
        let key = generate_key();
        assert_eq!(hash_key(&key.raw), key.hash);
        assert_eq!(hash_key(&key.raw), hash_key(&key.raw));
    }

    #[test]
    fn hash_differs_for_different_keys() {
        assert_ne!(hash_key("rp_live_aaa"), hash_key("rp_live_aab"));
    }

    #[test]
    fn known_sha256_vector() {
        // SHA-256("abc") — guards against the digest algorithm being swapped.
        assert_eq!(
            hash_key("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    fn tenant(plan: &str, active: bool, trial: Option<DateTime<Utc>>) -> TenantInfo {
        TenantInfo {
            id: "ten_test".into(),
            plan: plan.into(),
            active,
            trial_ends_at: trial,
            eval_quota_monthly: 100,
            evals_used_this_month: 0,
        }
    }

    #[test]
    fn inactive_tenant_is_not_entitled() {
        assert!(!tenant("pro", false, None).is_entitled());
    }

    #[test]
    fn lapsed_trial_is_not_entitled() {
        let past = Utc::now() - chrono::Duration::days(1);
        assert!(!tenant("trial", true, Some(past)).is_entitled());
    }

    #[test]
    fn live_trial_is_entitled() {
        let future = Utc::now() + chrono::Duration::days(3);
        assert!(tenant("trial", true, Some(future)).is_entitled());
    }

    #[test]
    fn paying_customer_unaffected_by_old_trial_date() {
        let past = Utc::now() - chrono::Duration::days(90);
        assert!(
            tenant("pro", true, Some(past)).is_entitled(),
            "an upgraded customer keeps their original trial timestamp"
        );
    }

    #[test]
    fn quota_boundary_is_exclusive() {
        let mut t = tenant("starter", true, None);
        t.evals_used_this_month = 99;
        assert!(t.has_eval_quota());
        t.evals_used_this_month = 100;
        assert!(!t.has_eval_quota(), "at quota means no quota left");
    }

    #[test]
    fn admin_context_is_unscoped() {
        let ctx = AuthContext::Admin;
        assert_eq!(ctx.tenant_filter(), None);
        assert_eq!(ctx.owning_tenant(), DEFAULT_TENANT_ID);
    }

    #[test]
    fn tenant_context_is_scoped_to_itself() {
        let ctx = AuthContext::Tenant(Arc::new(tenant("pro", true, None)));
        assert_eq!(ctx.tenant_filter(), Some("ten_test"));
        assert_eq!(ctx.owning_tenant(), "ten_test");
    }

    #[test]
    fn cache_returns_none_for_unknown_key() {
        let cache = TenantCache::empty();
        assert!(cache.get(&hash_key("rp_live_nope")).is_none());
    }
}
