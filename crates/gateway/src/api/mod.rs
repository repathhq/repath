//! Management API — REST endpoints for the dashboard and external tooling.
//!
//! All routes require `Authorization: Bearer <REPATH_API_TOKEN>`.
//! The proxy surface (`/v1/*`) does NOT require this token — clients use
//! their own OpenAI/Anthropic credentials.
//!
//! # Route surface
//!
//! ```text
//! GET  /api/v1/rollouts              List all rollouts
//! GET  /api/v1/rollouts/:id          Rollout detail + metrics
//! GET  /api/v1/rollouts/:id/metrics  Time-series quality data
//! GET  /api/v1/rollouts/:id/steps    Step list with status
//! GET  /api/v1/rollouts/:id/decisions Decision audit log
//! GET  /api/v1/system/health         System health
//! ```

pub mod handlers;

use axum::{middleware, routing::{get, post}, Router};
use crate::{auth::require_api_token, AppState};

pub fn api_router() -> Router<AppState> {
    Router::new()
        .route("/rollouts",                       get(handlers::list_rollouts))
        .route("/rollouts/:id",                   get(handlers::get_rollout))
        .route("/rollouts/:id/metrics",           get(handlers::get_rollout_metrics))
        .route("/rollouts/:id/steps",             get(handlers::get_rollout_steps))
        .route("/rollouts/:id/decisions",         get(handlers::get_rollout_decisions))
        .route("/rollouts/:id/promote",           post(handlers::promote_rollout))
        .route("/rollouts/:id/rollback",          post(handlers::rollback_rollout))
        .route("/system/health",                  get(handlers::system_health))
        // Auth applied to ALL management API routes — the dashboard and CLI
        // must include Authorization: Bearer <REPATH_API_TOKEN>
        .layer(middleware::from_fn(require_api_token))
}
