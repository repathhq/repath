//! API authentication middleware.
//!
//! Repath uses bearer token authentication for the management API (`/api/v1/*`).
//! The proxy surface (`/v1/*`) is intentionally unauthenticated — the client's
//! own OpenAI/Anthropic API key is the credential, forwarded transparently.
//!
//! # Token configuration
//!
//! Set `REPATH_API_TOKEN` in the environment (or `api_token` in repath.toml).
//! If no token is configured, the management API is unreachable and returns 401
//! on every request — this prevents accidentally shipping an open API.
//!
//! # How it works
//!
//! Axum middleware receives every `/api/v1/*` request before it reaches handlers.
//! It extracts `Authorization: Bearer <token>`, compares using constant-time
//! equality (preventing timing attacks), and either passes through or rejects.
//!
//! # Constant-time comparison
//!
//! Naive string equality (`==`) short-circuits on the first differing byte.
//! An attacker making thousands of requests can measure response time to guess
//! the token byte-by-byte. `ring::constant_time::verify_slices_are_equal`
//! always takes the same amount of time regardless of where bytes differ.

use axum::{
    body::Body,
    http::{Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Json, Response},
};
use ring::constant_time;
use serde_json::json;
use tracing::warn;

/// Axum middleware that enforces bearer token authentication.
///
/// Apply this to the `/api/v1` router only — not to `/v1/*` (proxy) or `/health`.
pub async fn require_api_token(
    req: Request<Body>,
    next: Next,
) -> Response {
    // Read the expected token from the environment.
    // This is re-read on every request so token rotation takes effect without restart.
    // In practice, the OS caches env reads and this is effectively free.
    let expected_token = match std::env::var("REPATH_API_TOKEN") {
        Ok(t) if !t.is_empty() => t,
        _ => {
            // No token configured — reject all management API requests.
            // This is a safe default: you must explicitly set a token to enable the API.
            warn!("REPATH_API_TOKEN not set — management API is locked");
            return (
                StatusCode::UNAUTHORIZED,
                Json(json!({
                    "error": {
                        "message": "Management API requires REPATH_API_TOKEN to be set",
                        "type": "configuration_error"
                    }
                })),
            ).into_response();
        }
    };

    // Extract Authorization header
    let provided_token = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");

    // Constant-time comparison — prevents timing attacks
    let matches = constant_time::verify_slices_are_equal(
        provided_token.as_bytes(),
        expected_token.as_bytes(),
    )
    .is_ok();

    if matches {
        next.run(req).await
    } else {
        warn!(
            path = %req.uri().path(),
            "Unauthorized management API request"
        );
        (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "error": {
                    "message": "Invalid or missing API token. Set Authorization: Bearer <REPATH_API_TOKEN>",
                    "type": "unauthorized"
                }
            })),
        ).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constant_time_equal() {
        let a = "abc123";
        let b = "abc123";
        assert!(constant_time::verify_slices_are_equal(a.as_bytes(), b.as_bytes()).is_ok());
    }

    #[test]
    fn test_constant_time_not_equal() {
        let a = "abc123";
        let b = "abc124";
        assert!(constant_time::verify_slices_are_equal(a.as_bytes(), b.as_bytes()).is_err());
    }

    #[test]
    fn test_constant_time_different_lengths() {
        let a = "short";
        let b = "much-longer-token";
        assert!(constant_time::verify_slices_are_equal(a.as_bytes(), b.as_bytes()).is_err());
    }
}
