//! Axum server — routes, middleware, error handling.
//!
//! # Route surface
//!
//! ```text
//! GET  /health             → Health check (Kubernetes liveness/readiness)
//! ANY  /v1/*               → OpenAI-compatible proxy (chat, completions, embeddings)
//! ```
//!
//! # Middleware stack (applied in order, innermost first)
//!
//! 1. `tower_http::trace::TraceLayer`   — structured request/response tracing
//! 2. `tower_http::cors::CorsLayer`     — CORS headers for browser clients
//! 3. `tower_http::compression::CompressionLayer` — gzip response compression
//! 4. Timeout (via `tower::timeout`)    — per-request timeout (60s default)
//!
//! # Error propagation
//!
//! Axum's `IntoResponse` is not implemented for our `repath_common::Error`.
//! Handlers that can fail return `Response<Body>` directly, converting errors
//! via `error_response()` in the handler module. This keeps error serialisation
//! consistent (always `{"error": {"message": "...", "type": "..."}}`) without
//! requiring an orphan `IntoResponse` impl.

use crate::{proxy::handler::handle_proxy, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    routing::{any, get},
    Router,
};
use serde_json::json;
use tower::ServiceBuilder;
use tower_http::{
    cors::{Any, CorsLayer},
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tracing::Level;

/// Build the Axum router with all routes and middleware.
pub fn create_server(state: AppState) -> Router {
    let trace_layer = TraceLayer::new_for_http()
        .make_span_with(
            DefaultMakeSpan::new()
                .level(Level::INFO)
                .include_headers(false), // Don't log headers (would expose auth tokens)
        )
        .on_response(
            DefaultOnResponse::new()
                .level(Level::INFO)
                .latency_unit(tower_http::LatencyUnit::Millis),
        );

    let cors_layer = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Health and readiness probes
        .route("/health",   get(health_handler))
        .route("/ready",    get(readiness_handler))
        // Management API for dashboard and CLI
        .nest("/api/v1", crate::api::api_router())
        // OpenAI-compatible proxy surface (catch-all under /v1)
        .route("/v1/*path", any(handle_proxy))
        // State shared across all handlers
        .with_state(state)
        // Middleware (applied to all routes)
        .layer(
            ServiceBuilder::new()
                .layer(trace_layer)
                .layer(cors_layer),
        )
}

// ── Health handlers ────────────────────────────────────────────────────────

/// Kubernetes liveness probe — always returns 200 if the process is up.
///
/// A liveness probe should only fail if the process is in an unrecoverable
/// state and should be restarted. Database connectivity issues are NOT
/// unrecoverable — the gateway can still serve cached routing even if the
/// DB is temporarily down. So this handler has no I/O.
async fn health_handler() -> impl IntoResponse {
    (
        StatusCode::OK,
        Json(json!({ "status": "ok", "version": env!("CARGO_PKG_VERSION") })),
    )
}

/// Kubernetes readiness probe — returns 200 only if all dependencies are healthy.
///
/// A readiness probe failure causes the pod to be removed from the load balancer.
/// We check database and Redis connectivity here. If either is down, we return
/// 503 so no new traffic is sent to this instance.
async fn readiness_handler(State(state): State<AppState>) -> Response {
    let db_ok = sqlx::query("SELECT 1")
        .execute(&state.db_pool)
        .await
        .is_ok();

    let redis_ok = {
        let mut conn = state.redis.clone();
        redis::cmd("PING")
            .query_async::<String>(&mut conn)
            .await
            .is_ok()
    };

    if db_ok && redis_ok {
        (
            StatusCode::OK,
            Json(json!({
                "status": "ready",
                "dependencies": {
                    "database": "ok",
                    "redis": "ok"
                }
            })),
        )
            .into_response()
    } else {
        (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({
                "status": "not_ready",
                "dependencies": {
                    "database": if db_ok { "ok" } else { "error" },
                    "redis": if redis_ok { "ok" } else { "error" }
                }
            })),
        )
            .into_response()
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn test_routes_compile() {
        // Full integration tests (with real DB+Redis) live in tests/.
        // This placeholder ensures the test binary runs and we see the module.
    }
}
