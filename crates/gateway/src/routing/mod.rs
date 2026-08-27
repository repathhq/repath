//! Conditional routing and per-tenant provider credentials.
//!
//! Both are read on every proxied request and both change rarely, so they
//! follow the same pattern as the rollout cache: a background task rebuilds an
//! immutable snapshot every 5 seconds and swaps it in atomically, and requests
//! read it with a single lock-free pointer load.

pub mod rules;

pub use rules::{
    estimate_tokens, Action, Condition, Field, Operator, RequestFacts, RoutingRule, RulesCache,
};

use crate::crypto;
use arc_swap::ArcSwap;
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use tracing::{debug, info, warn};

/// A provider the gateway can call on a tenant's behalf, with the tenant's own
/// key already decrypted.
#[derive(Debug, Clone)]
pub struct ProviderCredential {
    pub provider: String,
    pub api_key: String,
}

/// Everything about a tenant needed to route a request without touching the
/// database: their failover chain and the keys it needs.
#[derive(Debug, Default, Clone)]
pub struct TenantRouting {
    /// Ordered failover chain, e.g. ["anthropic", "openrouter"].
    pub fallback_chain: Vec<String>,
    /// Decrypted provider keys, by provider name.
    pub credentials: HashMap<String, String>,
}

impl TenantRouting {
    pub fn credential_for(&self, provider: &str) -> Option<&str> {
        self.credentials.get(provider).map(String::as_str)
    }
}

/// Immutable snapshot of routing configuration for every tenant.
#[derive(Debug, Default)]
pub struct RoutingCache {
    pub rules: RulesCache,
    by_tenant: HashMap<String, Arc<TenantRouting>>,
}

impl RoutingCache {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn routing_for(&self, tenant_id: &str) -> Option<Arc<TenantRouting>> {
        self.by_tenant.get(tenant_id).cloned()
    }
}

/// Background task that refreshes routing configuration every 5 seconds.
///
/// A failure keeps the previous snapshot rather than emptying it: routing with
/// slightly stale rules is far better than every tenant silently losing their
/// failover chain because the database blipped.
pub async fn run_routing_cache_refresher(db_pool: PgPool, cache: Arc<ArcSwap<RoutingCache>>) {
    info!("Routing cache refresher started (interval: 5s)");

    let mut interval = tokio::time::interval(Duration::from_secs(5));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        interval.tick().await;

        match load_routing(&db_pool).await {
            Ok(fresh) => {
                debug!(
                    rules = fresh.rules.total(),
                    tenants = fresh.by_tenant.len(),
                    "Routing cache refreshed"
                );
                cache.store(Arc::new(fresh));
            }
            Err(e) => {
                warn!(error = %e, "Failed to refresh routing cache — serving stale");
            }
        }
    }
}

async fn load_routing(pool: &PgPool) -> Result<RoutingCache, sqlx::Error> {
    let rules = load_rules(pool).await?;
    let by_tenant = load_tenant_routing(pool).await?;
    Ok(RoutingCache { rules, by_tenant })
}

async fn load_rules(pool: &PgPool) -> Result<RulesCache, sqlx::Error> {
    let rows = sqlx::query(
        r#"
        SELECT id, tenant_id, name, priority, condition, action
        FROM routing_rules
        WHERE enabled = TRUE
        ORDER BY tenant_id, priority, name
        "#,
    )
    .fetch_all(pool)
    .await?;

    let mut by_tenant: HashMap<String, Vec<Arc<RoutingRule>>> = HashMap::new();

    for row in rows {
        let tenant_id: String = row.get("tenant_id");
        let name: String = row.get("name");
        let condition_json: Value = row.get("condition");
        let action_json: Value = row.get("action");

        // A rule whose stored JSON no longer deserialises (hand-edited, or
        // written by a newer version) is skipped rather than allowed to abort
        // the whole refresh and freeze routing for every tenant.
        let condition = match serde_json::from_value(condition_json) {
            Ok(c) => c,
            Err(e) => {
                warn!(tenant_id, rule = %name, error = %e, "Skipping rule with unreadable condition");
                continue;
            }
        };
        let action = match serde_json::from_value(action_json) {
            Ok(a) => a,
            Err(e) => {
                warn!(tenant_id, rule = %name, error = %e, "Skipping rule with unreadable action");
                continue;
            }
        };

        by_tenant
            .entry(tenant_id)
            .or_default()
            .push(Arc::new(RoutingRule {
                id: row.get("id"),
                name,
                priority: row.get("priority"),
                condition,
                action,
            }));
    }

    Ok(RulesCache::from_rules(by_tenant))
}

async fn load_tenant_routing(
    pool: &PgPool,
) -> Result<HashMap<String, Arc<TenantRouting>>, sqlx::Error> {
    let mut out: HashMap<String, TenantRouting> = HashMap::new();

    // Failover chains.
    let chains = sqlx::query(
        "SELECT id, fallback_providers FROM tenants WHERE active = TRUE
         AND jsonb_array_length(COALESCE(fallback_providers, '[]'::jsonb)) > 0",
    )
    .fetch_all(pool)
    .await?;

    for row in chains {
        let tenant_id: String = row.get("id");
        let raw: Value = row.get("fallback_providers");
        let chain: Vec<String> = raw
            .as_array()
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|e| e.get("provider").and_then(Value::as_str).map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();

        out.entry(tenant_id).or_default().fallback_chain = chain;
    }

    // Provider credentials, decrypted once per refresh rather than per request.
    let creds =
        sqlx::query("SELECT tenant_id, provider, key_sealed FROM tenant_provider_credentials")
            .fetch_all(pool)
            .await?;

    let mut undecryptable = 0usize;
    for row in creds {
        let tenant_id: String = row.get("tenant_id");
        let provider: String = row.get("provider");
        let sealed: String = row.get("key_sealed");

        match crypto::decrypt(&sealed) {
            Ok(key) => {
                out.entry(tenant_id)
                    .or_default()
                    .credentials
                    .insert(provider, key);
            }
            Err(_) => {
                // Almost always a changed REPATH_ENCRYPTION_KEY. Count rather
                // than log per row so a key change does not flood the logs
                // every 5 seconds forever.
                undecryptable += 1;
            }
        }
    }

    if undecryptable > 0 {
        warn!(
            count = undecryptable,
            "Stored provider keys could not be decrypted — REPATH_ENCRYPTION_KEY may have changed. \
             Affected tenants must re-enter their provider keys."
        );
    }

    Ok(out.into_iter().map(|(k, v)| (k, Arc::new(v))).collect())
}

/// Record that a rule matched.
///
/// Fire-and-forget on a detached task: this is a counter for the UI, and a
/// request must never wait on it. A lost increment under load is acceptable;
/// a slower proxy is not.
pub fn record_rule_match(pool: PgPool, rule_id: uuid::Uuid) {
    tokio::spawn(async move {
        let _ = sqlx::query(
            "UPDATE routing_rules
                SET match_count = match_count + 1, last_matched_at = NOW()
              WHERE id = $1",
        )
        .bind(rule_id)
        .execute(&pool)
        .await;
    });
}
