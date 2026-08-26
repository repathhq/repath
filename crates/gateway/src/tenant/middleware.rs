//! Authentication middleware for both API surfaces.
//!
//! Two surfaces, two credentials:
//!
//! | Surface     | Header                          | Accepts                        |
//! |-------------|---------------------------------|--------------------------------|
//! | `/api/v1/*` | `Authorization: Bearer <token>` | admin token or tenant key      |
//! | `/v1/*`     | `X-Repath-Key: <key>`           | tenant key                     |
//!
//! The proxy surface needs its own header because `Authorization` already
//! carries the customer's *provider* key (their OpenAI or Anthropic secret),
//! which we forward upstream untouched and never store.
//!
//! Both middlewares insert an [`AuthContext`] into request extensions. Handlers
//! read it to scope their queries; a handler that forgets to is the bug this
//! design is meant to make obvious in review.

use super::{resolve_key, AuthContext, TenantInfo, DEFAULT_TENANT_ID};
use crate::AppState;
use axum::{
    body::Body,
    extract::State,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
#[allow(deprecated)]
use ring::constant_time;
use serde_json::json;
use std::sync::Arc;
use tracing::warn;

/// Header carrying the Repath tenant key on the proxy surface.
pub const KEY_HEADER: &str = "x-repath-key";

/// Header by which an operator-authenticated caller narrows itself to one
/// tenant.
///
/// The dashboard is a trusted first-party server: it authenticates the user
/// itself (signed session cookie), then calls the management API on that
/// user's behalf. It holds the operator token, so without this it would be
/// unscoped and every user would see every tenant's data — which is exactly
/// the bug that shipped.
///
/// Honoured **only** for [`AuthContext::Admin`]. A caller holding a tenant key
/// that sends this header is rejected outright rather than silently ignored,
/// so a privilege-escalation attempt is loud instead of quiet.
pub const ACT_AS_HEADER: &str = "x-repath-act-as-tenant";

/// Whether this deployment serves multiple paying tenants.
///
/// In cloud mode an unauthenticated proxy request is rejected. Self-hosted
/// installs (the default) keep working with no key at all, attributed to the
/// `default` tenant, so the open-source path stays a one-line base URL change.
fn cloud_mode() -> bool {
    std::env::var("REPATH_CLOUD_MODE")
        .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
        .unwrap_or(false)
}

/// The global operator token, if one is configured.
fn admin_token() -> Option<String> {
    std::env::var("REPATH_API_TOKEN")
        .ok()
        .filter(|t| !t.is_empty())
}

/// Constant-time string comparison.
///
/// Naive `==` short-circuits on the first differing byte, which leaks the token
/// one byte at a time to an attacker who can measure response latency across
/// many requests.
fn secure_eq(a: &str, b: &str) -> bool {
    #[allow(deprecated)]
    constant_time::verify_slices_are_equal(a.as_bytes(), b.as_bytes()).is_ok()
}

fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(json!({
            "error": { "message": message, "type": "unauthorized" }
        })),
    )
        .into_response()
}

// ── Management API ──────────────────────────────────────────────────────────

/// Authenticate `/api/v1/*`.
///
/// Accepts either the global admin token (unscoped) or a tenant API key
/// (scoped to that tenant). Rejects everything else.
pub async fn require_auth(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let presented = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("")
        .to_string();

    if presented.is_empty() {
        return unauthorized("Missing credentials. Send Authorization: Bearer <your-api-key>");
    }

    // Admin token first — it is a fixed string compare and costs nothing.
    if let Some(expected) = admin_token() {
        if secure_eq(&presented, &expected) {
            let act_as = req
                .headers()
                .get(ACT_AS_HEADER)
                .and_then(|v| v.to_str().ok())
                .map(str::to_owned);

            let ctx = match act_as {
                Some(tenant_id) if !tenant_id.is_empty() => {
                    match load_tenant_for_impersonation(&state, &tenant_id).await {
                        Some(t) => AuthContext::Tenant(t),
                        None => {
                            warn!(tenant_id, "Operator asked to act as an unknown tenant");
                            return unauthorized("Unknown tenant");
                        }
                    }
                }
                _ => AuthContext::Admin,
            };

            req.extensions_mut().insert(ctx);
            return next.run(req).await;
        }
    }

    // A tenant key must never be able to widen its own scope.
    if req.headers().contains_key(ACT_AS_HEADER) {
        warn!("Tenant key attempted to use the operator act-as header");
        return unauthorized("Invalid API key");
    }

    // Otherwise treat it as a tenant key.
    match resolve_key(&state.db_pool, &state.tenant_cache, &presented).await {
        Some(tenant) => {
            req.extensions_mut().insert(AuthContext::Tenant(tenant));
            next.run(req).await
        }
        None => {
            warn!(path = %req.uri().path(), "Rejected management API request with invalid key");
            unauthorized("Invalid API key")
        }
    }
}

// ── Proxy surface ───────────────────────────────────────────────────────────

/// Authenticate `/v1/*`.
///
/// In cloud mode a valid `X-Repath-Key` is required. Self-hosted requests with
/// no key are attributed to the `default` tenant.
///
/// Note what is deliberately *not* here: the old `X-Repath-Tenant-Id` header is
/// no longer consulted at all. Identity comes only from a verified key.
pub async fn resolve_proxy_auth(
    State(state): State<AppState>,
    mut req: Request<Body>,
    next: Next,
) -> Response {
    let presented = req
        .headers()
        .get(KEY_HEADER)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    let ctx = match presented {
        Some(key) if !key.is_empty() => {
            match resolve_key(&state.db_pool, &state.tenant_cache, &key).await {
                Some(tenant) => AuthContext::Tenant(tenant),
                None => {
                    warn!("Rejected proxy request with invalid X-Repath-Key");
                    return unauthorized(
                        "Invalid Repath API key. Find yours in the dashboard under Settings.",
                    );
                }
            }
        }
        _ if cloud_mode() => {
            return unauthorized(
                "Missing Repath API key. Send it as the X-Repath-Key header — your provider key stays in Authorization.",
            );
        }
        // Self-hosted: no key configured, single implicit tenant.
        _ => AuthContext::Tenant(Arc::new(self_hosted_tenant())),
    };

    req.extensions_mut().insert(ctx);
    next.run(req).await
}

/// Look up a tenant by id so an operator can act on its behalf.
///
/// Deliberately does not go through the key cache: this path is keyed by
/// tenant id, not by key hash, and is called once per dashboard request rather
/// than once per proxied LLM request, so a direct indexed lookup is fine.
async fn load_tenant_for_impersonation(
    state: &AppState,
    tenant_id: &str,
) -> Option<Arc<TenantInfo>> {
    use sqlx::Row;

    let row = sqlx::query(
        r#"
        SELECT id, plan, active, trial_ends_at,
               eval_quota_monthly, evals_used_this_month
        FROM tenants
        WHERE id = $1 AND active = TRUE
        "#,
    )
    .bind(tenant_id)
    .fetch_optional(&state.db_pool)
    .await
    .ok()
    .flatten()?;

    Some(Arc::new(TenantInfo {
        id: row.get("id"),
        plan: row.get("plan"),
        active: row.get("active"),
        trial_ends_at: row.get("trial_ends_at"),
        eval_quota_monthly: row.get("eval_quota_monthly"),
        evals_used_this_month: row.get("evals_used_this_month"),
    }))
}

/// The implicit tenant for self-hosted installs: always entitled, no quota.
fn self_hosted_tenant() -> TenantInfo {
    TenantInfo {
        id: DEFAULT_TENANT_ID.to_string(),
        plan: "enterprise".to_string(),
        active: true,
        trial_ends_at: None,
        eval_quota_monthly: i32::MAX,
        evals_used_this_month: 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secure_eq_matches_identical() {
        assert!(secure_eq("rp_live_abc", "rp_live_abc"));
    }

    #[test]
    fn secure_eq_rejects_different() {
        assert!(!secure_eq("rp_live_abc", "rp_live_abd"));
    }

    #[test]
    fn secure_eq_rejects_different_lengths() {
        assert!(!secure_eq("short", "much-longer-value"));
    }

    #[test]
    fn secure_eq_rejects_prefix() {
        // A prefix must not authenticate — this is the timing-attack shape.
        assert!(!secure_eq("rp_live_a", "rp_live_abc"));
    }

    #[test]
    fn self_hosted_tenant_is_entitled_and_unmetered() {
        let t = self_hosted_tenant();
        assert_eq!(t.id, DEFAULT_TENANT_ID);
        assert!(t.is_entitled());
        assert!(t.has_eval_quota());
    }
}
