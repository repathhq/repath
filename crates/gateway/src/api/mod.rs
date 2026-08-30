//! Management API — REST endpoints for the dashboard and external tooling.
//!
//! All routes require `Authorization: Bearer <key>`, where the key is either
//! a tenant's own API key (scoped to that tenant's rows) or the global operator
//! token (unscoped). The proxy surface (`/v1/*`) authenticates separately, via
//! the `X-Repath-Key` header — see `crate::tenant::middleware`.
//!
//! # Route surface
//!
//! ```text
//! GET  /api/v1/rollouts                  List all rollouts
//! POST /api/v1/rollouts                  Create a rollout
//! GET  /api/v1/rollouts/:id              Rollout detail + metrics
//! GET  /api/v1/rollouts/:id/metrics      Time-series quality data
//! GET  /api/v1/rollouts/:id/steps        Step list with status
//! GET  /api/v1/rollouts/:id/decisions    Decision audit log
//! POST /api/v1/rollouts/:id/promote      Manual promote
//! POST /api/v1/rollouts/:id/rollback     Manual rollback
//! POST /api/v1/rollouts/:id/pause        Pause controller decisions
//! POST /api/v1/rollouts/:id/resume       Resume a paused rollout
//! GET  /api/v1/system/health             System health
//!
//! Settings:
//! GET/PUT /api/v1/settings/providers     Per-tenant provider API keys
//! DELETE  /api/v1/settings/providers/:p  Remove a provider key
//! GET/PUT /api/v1/settings/failover      Ordered failover chain
//!
//! Conditional routing:
//! GET  /api/v1/routing/rules             List rules
//! POST /api/v1/routing/rules             Create a rule
//! PUT  /api/v1/routing/rules/:id         Update a rule
//! DELETE /api/v1/routing/rules/:id       Delete a rule
//! POST /api/v1/routing/test              Dry-run rules against a sample request
//!
//! Cloud-only:
//! POST   /api/v1/cloud/tenants             Create tenant (Clerk webhook)
//! GET    /api/v1/cloud/tenants/:id         Get tenant
//! DELETE /api/v1/cloud/tenants/:id         Delete tenant (account deletion)
//! POST   /api/v1/cloud/tenants/:id/upgrade Upgrade plan (after payment)
//! GET    /api/v1/cloud/tenants/:id/usage   Usage + quota
//! POST   /api/v1/cloud/password-reset/request  Email a reset link
//! POST   /api/v1/cloud/password-reset/confirm  Redeem a reset token
//! POST   /api/v1/cloud/tenants/:id/api-key/rotate  Issue a new API key
//!
//! Payment webhooks (signed, no auth token required):
//! POST /api/v1/webhooks/razorpay         Razorpay payment.captured
//! POST /api/v1/webhooks/paddle           Paddle transaction.completed
//! ```

pub mod cloud;
pub mod handlers;
pub mod logs;
pub mod rollout_create;
pub mod settings;

use crate::{tenant::require_auth, AppState};
use axum::{
    middleware,
    routing::{get, post},
    Router,
};

/// Route table without the authentication layer.
///
/// Split out so integration tests can inject a pre-resolved `AuthContext` and
/// exercise the handlers' tenant scoping directly, rather than going through
/// key parsing. Production always goes through [`api_router`], which wraps
/// exactly these routes in the auth middleware.
pub fn api_router_for_tests() -> Router<AppState> {
    core_routes().merge(Router::new().nest("/cloud", cloud_routes()))
}

fn core_routes() -> Router<AppState> {
    Router::new()
        .route(
            "/rollouts",
            get(handlers::list_rollouts).post(rollout_create::create_rollout),
        )
        .route(
            "/rollouts/:id",
            get(handlers::get_rollout).delete(handlers::delete_rollout),
        )
        .route("/rollouts/:id/metrics", get(handlers::get_rollout_metrics))
        .route("/rollouts/:id/steps", get(handlers::get_rollout_steps))
        .route(
            "/rollouts/:id/decisions",
            get(handlers::get_rollout_decisions),
        )
        .route("/rollouts/:id/promote", post(handlers::promote_rollout))
        .route("/rollouts/:id/rollback", post(handlers::rollback_rollout))
        .route("/rollouts/:id/pause", post(handlers::pause_rollout))
        .route("/rollouts/:id/resume", post(handlers::resume_rollout))
        // ── Tenant settings ──────────────────────────────────────────────
        .route(
            "/settings/providers",
            get(settings::list_credentials).put(settings::save_credential),
        )
        .route(
            "/settings/providers/:provider",
            axum::routing::delete(settings::delete_credential),
        )
        .route(
            "/settings/failover",
            get(settings::get_failover).put(settings::save_failover),
        )
        // ── Conditional routing ──────────────────────────────────────────
        .route(
            "/routing/rules",
            get(settings::list_rules).post(settings::create_rule),
        )
        .route(
            "/routing/rules/:id",
            axum::routing::put(settings::update_rule).delete(settings::delete_rule),
        )
        .route("/routing/test", post(settings::test_rules))
        // ── Webhooks ─────────────────────────────────────────────────────
        .route(
            "/settings/webhooks",
            get(settings::list_webhooks).post(settings::create_webhook),
        )
        .route(
            "/settings/webhooks/:id",
            axum::routing::delete(settings::delete_webhook),
        )
        .route(
            "/settings/webhooks/:id/deliveries",
            get(settings::webhook_deliveries),
        )
        .route("/settings/webhooks/:id/test", post(settings::test_webhook))
        // ── Notifications & gateway options ──────────────────────────────
        .route(
            "/settings/notifications",
            get(settings::get_notifications).put(settings::save_notifications),
        )
        .route(
            "/settings/profile",
            axum::routing::put(settings::save_profile),
        )
        .route(
            "/settings/gateway",
            get(settings::get_gateway_settings).put(settings::save_gateway_settings),
        )
        // Request log — the evidence behind scores and decisions.
        .route("/requests", get(logs::list_requests))
        .route("/requests/:id", get(logs::get_request))
        .route("/decisions/:id/requests", get(logs::requests_for_decision))
        .route("/system/health", get(handlers::system_health))
        .route("/system/providers", get(handlers::provider_health))
}

fn cloud_routes() -> Router<AppState> {
    Router::new()
        .route("/tenants", post(cloud::create_tenant))
        .route(
            "/tenants/:id",
            get(cloud::get_tenant).delete(cloud::delete_tenant),
        )
        .route("/tenants/:id/upgrade", post(cloud::upgrade_tenant))
        .route("/tenants/:id/usage", get(cloud::get_usage))
        .route("/tenants/:id/api-key/rotate", post(cloud::rotate_api_key))
        .route(
            "/tenants/:id/subscription",
            post(cloud::activate_subscription),
        )
        .route("/tenants/:id/payments", get(cloud::list_payments))
        .route("/tenants/by-email/:email", get(cloud::get_tenant_by_email))
        .route(
            "/password-reset/request",
            post(cloud::request_password_reset),
        )
        .route(
            "/password-reset/confirm",
            post(cloud::confirm_password_reset),
        )
}

pub fn api_router(state: AppState) -> Router<AppState> {
    // Webhook routes — no API token, but payload is signature-verified
    let webhook_router = Router::new()
        .route("/razorpay", post(cloud::razorpay_webhook))
        .route("/paddle", post(cloud::paddle_webhook));

    // Cloud management routes — require authentication
    let cloud_router =
        cloud_routes().layer(middleware::from_fn_with_state(state.clone(), require_auth));

    // Core rollout + system routes — require authentication
    let core_router =
        core_routes().layer(middleware::from_fn_with_state(state.clone(), require_auth));

    Router::new()
        .merge(core_router)
        .nest("/cloud", cloud_router)
        .nest("/webhooks", webhook_router)
}
