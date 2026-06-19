//! Core proxy handler — forwards requests to upstream providers.
//!
//! This is the hot path. Every proxied request goes through `handle_proxy`.
//!
//! # Request flow
//!
//! ```text
//! 1. Extract session ID and select version (ArcSwap load — lock-free)
//! 2. Build upstream URL + headers
//! 3. Send request to upstream provider
//! 4. If streaming: tee through accumulate_and_forward
//!    If not streaming: return body directly
//! 5. Post RecordRequest to background channel (non-blocking)
//! 6. Return response to client
//! ```
//!
//! Steps 1–4 and 6 happen on the critical path.
//! Step 5 is fire-and-forget.
//!
//! # Header forwarding
//!
//! We forward all client headers except a small blocklist of hop-by-hop headers
//! that are meaningless or harmful to forward to the upstream. We also inject
//! `X-Repath-Request-Id` and `X-Repath-Version` for observability.

use crate::{
    proxy::{provider::Provider, streaming},
    recorder::RecordRequest,
    router::{select_version, ActiveRollout, VersionAssignment},
    AppState,
};
use axum::{
    body::Body,
    extract::State,
    http::{header, HeaderMap, HeaderName, HeaderValue, Request},
    response::Response,
};
use bytes::Bytes;
use futures::StreamExt;
use repath_common::{Error, Result};
use std::time::Instant;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// HTTP headers that must not be forwarded to the upstream provider.
///
/// These are hop-by-hop headers (RFC 9110) plus headers that would confuse the
/// upstream or expose internal infrastructure details.
static BLOCKED_HEADERS: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
    "host",           // reqwest sets this correctly for the upstream URL
    "content-length", // reqwest recalculates this from the actual body bytes;
                      // forwarding the original value causes OpenAI to truncate
                      // the body if we injected a system prompt (changing body size)
];

/// Main proxy handler — handles all requests to /v1/* paths.
///
/// This function is registered as the catch-all handler for the OpenAI-compatible
/// API surface. It selects the correct version, forwards the request, and records
/// the result without blocking the response.
#[tracing::instrument(
    name = "proxy.handle",
    skip(state, req),
    fields(
        request_id = %Uuid::new_v4(),
        method = %req.method(),
        path = %req.uri().path(),
        version_id = tracing::field::Empty,
        rollout_id = tracing::field::Empty,
        latency_ms = tracing::field::Empty,
    )
)]
pub async fn handle_proxy(
    State(state): State<AppState>,
    req: Request<Body>,
) -> Response<Body> {
    let request_id = Uuid::new_v4();
    let span = tracing::Span::current();
    span.record("request_id", request_id.to_string());

    // Extract tenant ID early for circuit breaker check.
    let tenant_id = extract_tenant_id(req.headers());

    // Circuit breaker: if open, return bypass response immediately.
    // The client SDK sees X-Repath-Bypass: true and calls the provider directly.
    // This guarantees Repath is NEVER a bottleneck to the customer's app.
    if state.circuit_breaker.is_open(&tenant_id) {
        warn!(tenant_id, "Circuit open — returning bypass response");
        return bypass_response(request_id);
    }

    match proxy_inner(state.clone(), req, request_id, &tenant_id).await {
        Ok(response) => {
            state.circuit_breaker.record_success(&tenant_id);
            response
        }
        Err(e) => {
            state.circuit_breaker.record_failure(&tenant_id);
            warn!(error = %e, tenant_id, "Proxy request failed");
            error_response(e.status_code(), e.to_string())
        }
    }
}

/// Inner proxy logic with proper `Result` error propagation.
///
/// Separated from `handle_proxy` so we can use `?` throughout without
/// manually building error responses on every failure.
async fn proxy_inner(
    state: AppState,
    req: Request<Body>,
    request_id: Uuid,
    _tenant_id: &str,
) -> Result<Response<Body>> {
    let span = tracing::Span::current();

    // Decompose the request immediately so we can use parts independently.
    // `into_parts()` is the idiomatic way to get headers + body without cloning
    // the entire request.
    let (parts, body) = req.into_parts();
    let method = parts.method.clone();
    let path = parts.uri.path_and_query()
        .map(|pq| pq.as_str().to_owned())
        .unwrap_or_default();

    // ── Version selection (lock-free ArcSwap read) ────────────────────────
    let cache = state.rollout_cache.load();
    let session_id = extract_session_id(&parts.headers);

    let (version, rollout_id) = match &cache.active {
        Some(rollout) => {
            let assignment = select_version(rollout, session_id.as_deref());
            let version = active_version(rollout, assignment);
            span.record("rollout_id", rollout.rollout_id.to_string());
            span.record("version_id", version.version_id.to_string());
            (version, Some(rollout.rollout_id))
        }
        None => {
            // No active rollout — use default provider from config
            let version = default_version(&state)?;
            (version, None)
        }
    };

    debug!(
        model = %version.model,
        provider = %version.provider_url,
        "Routing request"
    );

    // ── Build upstream headers ─────────────────────────────────────────────
    //
    // Forward all non-hop-by-hop headers from the original request.
    // This is critical: the client's `Authorization: Bearer sk-...` must reach
    // the upstream or every request will be rejected with 401.
    // `host` is excluded — reqwest sets it correctly from the upstream URL.
    // Forwarding the client's `host` would send the gateway hostname to OpenAI.
    let upstream_headers: HeaderMap = parts.headers.iter()
        .filter(|(name, _)| !is_blocked_header(name.as_str()))
        .map(|(n, v)| (n.clone(), v.clone()))
        .collect();

    // ── Build upstream request ─────────────────────────────────────────────
    //
    // The gateway route is `/v1/*path`. Clients send `/v1/chat/completions`.
    // The upstream URL already ends with `/v1` (e.g. https://api.openai.com/v1).
    // Strip the leading `/v1` from path to avoid `/v1/v1/chat/completions`.
    let upstream_path = path
        .strip_prefix("/v1")
        .unwrap_or(&path);
    let upstream_url = format!(
        "{}{}",
        version.provider_url.trim_end_matches('/'),
        upstream_path
    );

    // Reconstruct the request to pass to read_request_body
    let req = Request::from_parts(parts, body);

    // Detect provider for request/response translation
    let detected_provider = Provider::from_url(&version.provider_url);

    // Read body; optionally inject system prompt for candidate version
    let (body_bytes_raw, is_streaming) = read_request_body(req, &version).await?;

    // Translate request body for non-OpenAI providers (e.g. Anthropic format)
    let body_bytes = crate::proxy::provider::translate_request_body(
        &body_bytes_raw, &detected_provider,
    );

    // Normalize headers for the target provider (Anthropic needs x-api-key, not Bearer)
    let upstream_headers = crate::proxy::provider::normalize_headers(
        upstream_headers, &detected_provider, None,
    );

    // ── Forward to upstream ───────────────────────────────────────────────
    let start = Instant::now();

    let upstream_response = state.http_client
        .request(method, &upstream_url)
        .headers(upstream_headers)
        .body(body_bytes.clone())
        .send()
        .await
        .map_err(|e| Error::Provider {
            provider: detected_provider.clone().to_str().to_string(),
            message: e.to_string(),
            status_code: None,
            source: Some(e.into()),
        })?;

    let upstream_status = upstream_response.status();
    let upstream_headers_response = upstream_response.headers().clone();

    // ── Build client response ─────────────────────────────────────────────
    let mut response_builder = Response::builder()
        .status(upstream_status.as_u16());

    // Forward upstream headers to client (minus hop-by-hop)
    for (name, value) in &upstream_headers_response {
        if !is_blocked_header(name.as_str()) {
            if let Some(b) = response_builder.headers_mut() {
                b.insert(name.clone(), value.clone());
            }
        }
    }

    // Inject observability headers
    if let Some(b) = response_builder.headers_mut() {
        // HeaderValue::from_str can only fail if the string contains invalid
        // bytes. UUIDs are ASCII-only, so this is infallible in practice.
        if let Ok(v) = HeaderValue::from_str(&request_id.to_string()) {
            b.insert(HeaderName::from_static("x-repath-request-id"), v);
        }
        if let Ok(v) = HeaderValue::from_str(&version.version_id.to_string()) {
            b.insert(HeaderName::from_static("x-repath-version-id"), v);
        }
    }

    // ── Streaming vs non-streaming path ───────────────────────────────────
    let (response_body, stream_result) = if is_streaming {
        build_streaming_response(upstream_response.bytes_stream()).await?
    } else {
        build_buffered_response(upstream_response, &detected_provider).await?
    };

    let latency_ms = start.elapsed().as_millis() as u32;
    span.record("latency_ms", latency_ms);

    // ── Fire-and-forget recording ─────────────────────────────────────────
    let record = RecordRequest {
        request_id,
        rollout_id,
        version_id: version.version_id,
        model: version.model.clone(),
        input_tokens: stream_result.input_tokens,
        output_tokens: stream_result.output_tokens,
        latency_ms,
        status_code: upstream_status.as_u16(),
        error: if upstream_status.is_success() { None } else {
            Some(format!("Upstream returned {}", upstream_status))
        },
        session_id,
        response_text: stream_result.response_text,
        request_body_json: String::from_utf8_lossy(&body_bytes).into_owned(),
    };

    // try_send is non-blocking — if channel is full, we log and drop the record.
    // The request has already been served; we never delay users for observability.
    if let Err(e) = state.record_tx.try_send(record) {
        state.metrics.recorder_dropped_total.inc();
        warn!(
            request_id = %request_id,
            error = %e,
            "Recorder channel full — request record dropped"
        );
    }

    state.metrics.requests_total.inc();
    state.metrics.request_duration
        .observe(latency_ms as f64 / 1000.0);

    info!(
        status = upstream_status.as_u16(),
        latency_ms,
        model = %version.model,
        "Request proxied"
    );

    response_builder
        .body(response_body)
        .map_err(|e| Error::Internal {
            message: "Failed to build response".to_string(),
            source: Some(e.into()),
        })
}

// ── Version resolution helpers ─────────────────────────────────────────────

/// Minimal version data needed for routing a single request.
struct RequestVersion {
    version_id: Uuid,
    provider_url: String,
    model: String,
    /// Injected system prompt override, if the version specifies one.
    prompt_override: Option<String>,
}

fn active_version(rollout: &ActiveRollout, assignment: VersionAssignment) -> RequestVersion {
    match assignment {
        VersionAssignment::Baseline => RequestVersion {
            version_id: rollout.baseline_version_id,
            provider_url: rollout.baseline_provider_url.clone(),
            model: rollout.baseline_model.clone(),
            prompt_override: rollout.baseline_prompt.clone(),
        },
        VersionAssignment::Candidate => RequestVersion {
            version_id: rollout.candidate_version_id,
            provider_url: rollout.candidate_provider_url.clone(),
            model: rollout.candidate_model.clone(),
            prompt_override: rollout.candidate_prompt.clone(),
        },
    }
}

fn default_version(state: &AppState) -> Result<RequestVersion> {
    // If a provider is configured in repath.toml, use it.
    // Otherwise fall back to OpenAI (the client's Authorization header passes through).
    let provider_url = state.config.providers.iter().next()
        .map(|(_, p)| p.base_url.clone())
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

    Ok(RequestVersion {
        version_id: Uuid::nil(), // Sentinel: no version tracking without a rollout
        provider_url,
        model: String::new(), // Pass-through: model comes from client's request
        prompt_override: None,
    })
}

// ── Request body helpers ───────────────────────────────────────────────────

/// Read the request body and detect if the client requested streaming.
///
/// If the version has a `prompt_override`, we inject the system prompt into
/// the messages array. Otherwise we return the raw bytes unchanged.
async fn read_request_body(
    req: Request<Body>,
    version: &RequestVersion,
) -> Result<(Bytes, bool)> {
    use axum::body::to_bytes;

    let body_bytes = to_bytes(req.into_body(), 10 * 1024 * 1024) // 10MB max
        .await
        .map_err(|e| Error::Network {
            context: "Failed to read request body".to_string(),
            source: e.into(),
        })?;

    // Detect streaming from the JSON body's "stream" field.
    // The Content-Type is always application/json for chat completions requests
    // regardless of whether streaming is enabled — it is not a reliable signal.
    let is_streaming = serde_json::from_slice::<serde_json::Value>(&body_bytes)
        .ok()
        .and_then(|v| v.get("stream").and_then(|s| s.as_bool()))
        .unwrap_or(false);

    // If candidate has a system prompt override, inject it
    if let Some(ref system_prompt) = version.prompt_override {
        let bytes = inject_system_prompt(&body_bytes, system_prompt)
            .unwrap_or_else(|_| body_bytes.clone());
        return Ok((bytes, is_streaming));
    }

    Ok((body_bytes, is_streaming))
}

/// Inject a system prompt into a chat completions request body.
///
/// Prepends a system message to the `messages` array. If a system message
/// already exists, it is replaced.
fn inject_system_prompt(body: &Bytes, system_prompt: &str) -> Result<Bytes> {
    let mut json: serde_json::Value = serde_json::from_slice(body)?;

    let messages = json
        .get_mut("messages")
        .and_then(|m| m.as_array_mut())
        .ok_or_else(|| Error::Validation {
            message: "Request body missing 'messages' array".to_string(),
            field: Some("messages".to_string()),
        })?;

    // Remove any existing system message
    messages.retain(|m| m.get("role").and_then(|r| r.as_str()) != Some("system"));

    // Prepend new system message
    messages.insert(
        0,
        serde_json::json!({
            "role": "system",
            "content": system_prompt
        }),
    );

    Ok(Bytes::from(serde_json::to_vec(&json)?))
}

// ── Response building helpers ──────────────────────────────────────────────

struct ResponseParts {
    response_text: String,
    input_tokens: Option<u32>,
    output_tokens: Option<u32>,
}

async fn build_streaming_response(
    upstream_stream: impl futures::Stream<Item = reqwest::Result<Bytes>> + Send + 'static,
) -> Result<(Body, ResponseParts)> {
    // Channel that feeds the Axum Body stream
    let (byte_tx, byte_rx) = mpsc::channel::<Result<Bytes>>(64);

    let accumulator_result = streaming::accumulate_and_forward(
        upstream_stream,
        byte_tx,
    ).await;

    // Convert the receiver into a Body stream
    let body_stream = tokio_stream::wrappers::ReceiverStream::new(byte_rx)
        .map(|r| r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e.to_string())));

    let body = Body::from_stream(body_stream);

    Ok((body, ResponseParts {
        response_text: accumulator_result.response_text,
        input_tokens: accumulator_result.input_tokens,
        output_tokens: accumulator_result.output_tokens,
    }))
}

async fn build_buffered_response(
    upstream_response: reqwest::Response,
    provider: &Provider,
) -> Result<(Body, ResponseParts)> {
    let raw_bytes = upstream_response
        .bytes()
        .await
        .map_err(|e| Error::Network {
            context: "Failed to read upstream response body".to_string(),
            source: e.into(),
        })?;

    // Translate Anthropic format → OpenAI format for uniform recording/evaluation
    let body_bytes = crate::proxy::provider::translate_response_body(&raw_bytes, provider);

    // Extract token counts from the JSON response
    let (input_tokens, output_tokens, response_text) =
        extract_non_streaming_metadata(&body_bytes);

    let body = Body::from(body_bytes);

    Ok((body, ResponseParts {
        response_text,
        input_tokens,
        output_tokens,
    }))
}

/// Extract token usage and response text from a non-streaming completion response.
fn extract_non_streaming_metadata(body: &Bytes) -> (Option<u32>, Option<u32>, String) {
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(body) else {
        return (None, None, String::new());
    };

    let input_tokens = json
        .pointer("/usage/prompt_tokens")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let output_tokens = json
        .pointer("/usage/completion_tokens")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);

    let response_text = json
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    (input_tokens, output_tokens, response_text)
}

// ── Utility helpers ────────────────────────────────────────────────────────

fn extract_session_id(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-user-id")
        .or_else(|| headers.get("x-session-id"))
        .or_else(|| headers.get("x-request-id"))
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// Extract tenant ID from request headers.
/// Cloud: set via X-Repath-Tenant-Id. Self-hosted: always "default".
fn extract_tenant_id(headers: &HeaderMap) -> String {
    headers
        .get("x-repath-tenant-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("default")
        .to_string()
}

/// Bypass response — tells the client SDK to call the provider directly.
///
/// The gateway returns HTTP 503 with X-Repath-Bypass: true.
/// A properly instrumented SDK (or a proxy-aware client) sees this header and
/// immediately retries the request directly against the LLM provider without
/// any Repath involvement. The end user experiences zero downtime.
///
/// For clients without the SDK, the 503 body includes the fallback instruction.
fn bypass_response(request_id: Uuid) -> Response<Body> {
    let body = serde_json::json!({
        "error": {
            "message": "Repath gateway is temporarily bypassed. Call your LLM provider directly.",
            "type": "bypass",
            "code": "circuit_open"
        },
        "x_repath_bypass": true
    });
    Response::builder()
        .status(503)
        .header(header::CONTENT_TYPE, "application/json")
        .header("x-repath-bypass", "true")
        .header("x-repath-request-id", request_id.to_string())
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn is_blocked_header(name: &str) -> bool {
    let lower = name.to_lowercase();
    BLOCKED_HEADERS.iter().any(|&h| h == lower)
}

fn error_response(status: u16, message: String) -> Response<Body> {
    let body = serde_json::json!({
        "error": {
            "message": message,
            "type": "proxy_error"
        }
    });
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inject_system_prompt() {
        let body = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "user", "content": "Hello"}
            ]
        });
        let bytes = Bytes::from(body.to_string());

        let result = inject_system_prompt(&bytes, "You are a helpful assistant.").unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();

        let messages = parsed["messages"].as_array().unwrap();
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[0]["content"], "You are a helpful assistant.");
        assert_eq!(messages[1]["role"], "user");
    }

    #[test]
    fn test_inject_system_prompt_replaces_existing() {
        let body = serde_json::json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "Old system prompt"},
                {"role": "user", "content": "Hello"}
            ]
        });
        let bytes = Bytes::from(body.to_string());

        let result = inject_system_prompt(&bytes, "New system prompt.").unwrap();
        let parsed: serde_json::Value = serde_json::from_slice(&result).unwrap();

        let messages = parsed["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 2, "Old system message should be replaced, not added");
        assert_eq!(messages[0]["content"], "New system prompt.");
    }

    #[test]
    fn test_is_blocked_header() {
        assert!(is_blocked_header("connection"));
        assert!(is_blocked_header("Connection")); // case-insensitive
        assert!(is_blocked_header("Transfer-Encoding"));
        assert!(!is_blocked_header("authorization"));
        assert!(!is_blocked_header("content-type"));
    }

    #[test]
    fn test_extract_non_streaming_metadata() {
        let response = serde_json::json!({
            "choices": [{"message": {"content": "Hello!"}}],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5}
        });
        let bytes = Bytes::from(response.to_string());

        let (input, output, text) = extract_non_streaming_metadata(&bytes);
        assert_eq!(input, Some(10));
        assert_eq!(output, Some(5));
        assert_eq!(text, "Hello!");
    }

    #[test]
    fn test_extract_session_id() {
        let mut headers = HeaderMap::new();
        headers.insert(
            HeaderName::from_static("x-user-id"),
            HeaderValue::from_static("user_123"),
        );

        let session = extract_session_id(&headers);
        assert_eq!(session, Some("user_123".to_string()));
    }

    #[test]
    fn test_extract_session_id_none() {
        let headers = HeaderMap::new();
        let session = extract_session_id(&headers);
        assert_eq!(session, None);
    }
}
