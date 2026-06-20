//! Management API — REST endpoints for the dashboard and external tooling.
//!
//! All routes require `Authorization: Bearer <REPATH_API_TOKEN>`.
//! The proxy surface (`/v1/*`) does NOT require this token.
//!
//! # Route surface
//!
//! ```text
//! GET  /api/v1/rollouts                  List all rollouts
//! GET  /api/v1/rollouts/:id              Rollout detail + metrics
//! GET  /api/v1/rollouts/:id/metrics      Time-series quality data
//! GET  /api/v1/rollouts/:id/steps        Step list with status
//! GET  /api/v1/rollouts/:id/decisions    Decision audit log
//! POST /api/v1/rollouts/:id/promote      Manual promote
//! POST /api/v1/rollouts/:id/rollback     Manual rollback
//! GET  /api/v1/system/health             System health
//!
//! Cloud-only:
//! POST /api/v1/cloud/tenants             Create tenant (Clerk webhook)
//! GET  /api/v1/cloud/tenants/:id         Get tenant
//! POST /api/v1/cloud/tenants/:id/upgrade Upgrade plan (after payment)
//! GET  /api/v1/cloud/tenants/:id/usage   Usage + quota
//!
//! Payment webhooks (signed, no auth token required):
//! POST /api/v1/webhooks/razorpay         Razorpay payment.captured
//! POST /api/v1/webhooks/paddle           Paddle transaction.completed
//! ```

pub mod cloud;
pub mod handlers;

use crate::{auth::require_api_token, AppState};
use axum::{
    middleware,
    routing::{get, post},
    Router,
};

pub fn api_router() -> Router<AppState> {
    // Webhook routes — no API token, but payload is signature-verified
    let webhook_router = Router::new()
        .route("/razorpay", post(cloud::razorpay_webhook))
        .route("/paddle", post(cloud::paddle_webhook));

    // Cloud management routes — require API token
    let cloud_router = Router::new()
        .route("/tenants", post(cloud::create_tenant))
        .route("/tenants/:id", get(cloud::get_tenant))
        .route("/tenants/:id/upgrade", post(cloud::upgrade_tenant))
        .route("/tenants/:id/usage", get(cloud::get_usage))
        .route("/tenants/by-email/:email", get(cloud::get_tenant_by_email))
        .layer(middleware::from_fn(require_api_token));

    // Core rollout + system routes — require API token
    let core_router = Router::new()
        .route("/rollouts", get(handlers::list_rollouts))
        .route("/rollouts/:id", get(handlers::get_rollout))
        .route("/rollouts/:id/metrics", get(handlers::get_rollout_metrics))
        .route("/rollouts/:id/steps", get(handlers::get_rollout_steps))
        .route(
            "/rollouts/:id/decisions",
            get(handlers::get_rollout_decisions),
        )
        .route("/rollouts/:id/promote", post(handlers::promote_rollout))
        .route("/rollouts/:id/rollback", post(handlers::rollback_rollout))
        .route("/system/health", get(handlers::system_health))
        .route("/system/providers", get(handlers::provider_health))
        .layer(middleware::from_fn(require_api_token));

    Router::new()
        .merge(core_router)
        .nest("/cloud", cloud_router)
        .nest("/webhooks", webhook_router)
}
