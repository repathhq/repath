//! Provider normalization — translates between OpenAI-format requests and
//! provider-specific API formats.
//!
//! # Why this exists
//!
//! Repath's gateway accepts OpenAI-compatible requests from the client.
//! Most providers (OpenAI, Gemini via their OpenAI-compat endpoint) accept
//! these requests directly. Anthropic has its own format.
//!
//! This module detects the provider from the URL and either passes the request
//! through unchanged (OpenAI, Gemini) or translates it (Anthropic).
//!
//! # Supported providers
//!
//! | Provider | URL pattern               | Format          |
//! |----------|--------------------------|-----------------|
//! | OpenAI   | api.openai.com           | OpenAI native   |
//! | Anthropic| api.anthropic.com        | Anthropic format|
//! | Gemini   | generativelanguage.google| OpenAI-compat   |
//! | Azure    | openai.azure.com         | OpenAI native   |
//! | Custom   | anything else            | Pass-through    |

use bytes::Bytes;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq)]
pub enum Provider {
    OpenAI,
    Anthropic,
    Gemini,
    Azure,
    /// OpenAI-compatible aggregator. Needs no body or auth translation, but is
    /// recognised explicitly so incidents and metrics attribute to it by name
    /// rather than to "unknown", and so it gets its attribution headers.
    OpenRouter,
    /// Vercel AI Gateway. OpenAI-compatible with vendor-prefixed model ids,
    /// so it is handled like OpenRouter: no body or auth translation.
    Vercel,
    Unknown,
}

impl Provider {
    pub fn from_url(url: &str) -> Self {
        // Check most-specific patterns first to avoid false matches.
        // Gemini's OpenAI-compat URL contains "/openai" in the path — must
        // check googleapis.com before the generic "openai" substring.
        if url.contains("anthropic.com") {
            Provider::Anthropic
        } else if url.contains("generativelanguage.googleapis.com") {
            Provider::Gemini
        } else if url.contains("openai.azure.com") {
            Provider::Azure
        } else if url.contains("openrouter.ai") {
            Provider::OpenRouter
        } else if url.contains("ai-gateway.vercel.sh") {
            Provider::Vercel
        } else if url.contains("api.openai.com") {
            Provider::OpenAI
        } else {
            Provider::Unknown
        }
    }

    pub fn to_str(&self) -> &str {
        match self {
            Provider::OpenAI => "openai",
            Provider::Anthropic => "anthropic",
            Provider::Gemini => "gemini",
            Provider::Azure => "azure",
            Provider::OpenRouter => "openrouter",
            Provider::Vercel => "vercel",
            Provider::Unknown => "unknown",
        }
    }
}

/// Normalize request headers for the target provider.
///
/// OpenAI uses: `Authorization: Bearer sk-...`
/// Anthropic uses: `x-api-key: sk-ant-...` and `anthropic-version: 2023-06-01`
///
/// We extract the Bearer token from the client's Authorization header and
/// inject the correct auth header for the target provider.
pub fn normalize_headers(
    mut headers: HeaderMap,
    provider: &Provider,
    provider_api_key: Option<&str>,
) -> HeaderMap {
    match provider {
        Provider::Anthropic => {
            // Extract bearer token from Authorization header (or use provider key)
            let api_key = provider_api_key
                .map(str::to_string)
                .or_else(|| {
                    headers
                        .get("authorization")
                        .and_then(|v| v.to_str().ok())
                        .and_then(|v| v.strip_prefix("Bearer "))
                        .map(str::to_string)
                })
                .unwrap_or_default();

            // Remove OpenAI-style Authorization header
            headers.remove("authorization");

            // Add Anthropic-specific headers
            if let Ok(v) = HeaderValue::from_str(&api_key) {
                headers.insert(HeaderName::from_static("x-api-key"), v);
            }
            headers.insert(
                HeaderName::from_static("anthropic-version"),
                HeaderValue::from_static("2023-06-01"),
            );
        }
        Provider::Gemini => {
            // Gemini's OpenAI-compat endpoint uses Bearer auth — pass through as-is
            // but ensure anthropic version header isn't present
        }
        Provider::OpenRouter => {
            // OpenAI-compatible, so auth passes through untouched. These two
            // headers are how OpenRouter attributes traffic on their dashboard
            // and rankings; without them requests show as anonymous.
            headers.insert(
                HeaderName::from_static("http-referer"),
                HeaderValue::from_static("https://tryrepath.com"),
            );
            headers.insert(
                HeaderName::from_static("x-title"),
                HeaderValue::from_static("Repath"),
            );
        }
        _ => {
            // OpenAI, Azure, Unknown — pass Authorization header through as-is
        }
    }
    headers
}

/// Translate an OpenAI-format request body to the target provider's format.
///
/// Returns the original bytes unchanged for pass-through providers.
pub fn translate_request_body(body: &Bytes, provider: &Provider) -> Bytes {
    match provider {
        Provider::Anthropic => translate_to_anthropic(body),
        // OpenAI-compatible on the wire, so only the model name needs to fit.
        // Without this, failing over from OpenAI forwarded "gpt-4o" to Gemini
        // or OpenRouter, which reject it with a 400 — and a 400 is not
        // retried, so the failover that should have rescued the request
        // turned a provider outage into a client error instead.
        Provider::Gemini | Provider::OpenRouter | Provider::Vercel | Provider::OpenAI => {
            rewrite_model(body, |m| map_model_for(provider, m))
        }
        _ => body.clone(),
    }
}

/// Replace the request's `model` with `f(model)`, leaving the body untouched
/// when it is not JSON or the model is already right.
fn rewrite_model(body: &Bytes, f: impl Fn(&str) -> String) -> Bytes {
    let Ok(mut json) = serde_json::from_slice::<Value>(body) else {
        return body.clone();
    };
    let Some(current) = json.get("model").and_then(|m| m.as_str()) else {
        return body.clone();
    };
    let mapped = f(current);
    if mapped == current {
        return body.clone();
    }
    json["model"] = Value::String(mapped);
    Bytes::from(serde_json::to_vec(&json).unwrap_or_else(|_| body.to_vec()))
}

/// Translate an OpenAI chat.completions request to Anthropic Messages format.
///
/// OpenAI format:
/// ```json
/// {
///   "model": "gpt-4o",
///   "messages": [{"role": "user", "content": "Hello"}],
///   "max_tokens": 256,
///   "temperature": 0.7,
///   "stream": false
/// }
/// ```
///
/// Anthropic format:
/// ```json
/// {
///   "model": "claude-sonnet-5-5",
///   "messages": [{"role": "user", "content": "Hello"}],
///   "max_tokens": 256,
///   "temperature": 0.7,
///   "stream": false,
///   "system": "..."  // extracted from messages array
/// }
/// ```
fn translate_to_anthropic(body: &Bytes) -> Bytes {
    let Ok(mut json) = serde_json::from_slice::<Value>(body) else {
        return body.clone();
    };

    // Extract and remove system message from the messages array
    let system_prompt = extract_system_from_messages(&mut json);

    // Inject top-level system field if present
    if let Some(system) = system_prompt {
        json["system"] = Value::String(system);
    }

    // Map model names: OpenAI → Anthropic equivalents
    if let Some(model) = json.get("model").and_then(|m| m.as_str()) {
        let anthropic_model = map_model_for(&Provider::Anthropic, model);
        json["model"] = Value::String(anthropic_model);
    }

    // Ensure max_tokens is present (required by Anthropic, optional in OpenAI)
    if json.get("max_tokens").is_none() {
        json["max_tokens"] = json!(1024);
    }

    Bytes::from(serde_json::to_vec(&json).unwrap_or_else(|_| body.to_vec()))
}

/// Translate an Anthropic response back to OpenAI format so our recorder
/// and evaluator can parse it uniformly.
///
/// Anthropic response:
/// ```json
/// {
///   "id": "msg_...",
///   "type": "message",
///   "role": "assistant",
///   "content": [{"type": "text", "text": "Hello!"}],
///   "usage": {"input_tokens": 10, "output_tokens": 5}
/// }
/// ```
///
/// OpenAI response:
/// ```json
/// {
///   "id": "chatcmpl-...",
///   "choices": [{"message": {"role": "assistant", "content": "Hello!"}}],
///   "usage": {"prompt_tokens": 10, "completion_tokens": 5}
/// }
/// ```
pub fn translate_response_body(body: &Bytes, provider: &Provider) -> Bytes {
    match provider {
        Provider::Anthropic => translate_from_anthropic(body),
        _ => body.clone(),
    }
}

fn translate_from_anthropic(body: &Bytes) -> Bytes {
    let Ok(json) = serde_json::from_slice::<Value>(body) else {
        return body.clone();
    };

    // Check if it's actually an Anthropic message response
    if json.get("type").and_then(|t| t.as_str()) != Some("message") {
        return body.clone();
    }

    // Extract text content from Anthropic's content array
    let content_text = json
        .get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|t| t.as_str())
        .unwrap_or("")
        .to_string();

    let input_tokens = json
        .pointer("/usage/input_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let output_tokens = json
        .pointer("/usage/output_tokens")
        .and_then(|v| v.as_u64())
        .unwrap_or(0);

    let openai_format = json!({
        "id": json.get("id").cloned().unwrap_or(json!("msg_translated")),
        "object": "chat.completion",
        "model": json.get("model").cloned().unwrap_or(json!("claude")),
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": content_text
            },
            "finish_reason": json.get("stop_reason").cloned().unwrap_or(json!("stop"))
        }],
        "usage": {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens
        }
    });

    Bytes::from(serde_json::to_vec(&openai_format).unwrap_or_else(|_| body.to_vec()))
}

fn extract_system_from_messages(json: &mut Value) -> Option<String> {
    let messages = json.get_mut("messages")?.as_array_mut()?;
    let pos = messages
        .iter()
        .position(|m| m.get("role").and_then(|r| r.as_str()) == Some("system"))?;
    let system_msg = messages.remove(pos);
    system_msg.get("content")?.as_str().map(str::to_string)
}

/// How capable a model is, as far as choosing a stand-in on another provider.
///
/// Failover has to send *some* model to the fallback provider, and the
/// customer's choice of size is the one thing worth preserving: a request
/// written for a nano model should not quietly start billing at Opus rates,
/// and one written for a flagship should not be answered by a nano model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Tier {
    Small,
    Standard,
    Top,
}

fn tier(model: &str) -> Tier {
    let m = model
        .rsplit('/')
        .next()
        .unwrap_or(model)
        .to_ascii_lowercase();
    // Whole name segments, never substrings: "gemini" contains "mini", and a
    // substring match filed every Gemini model as small.
    let has = |words: &[&str]| m.split('-').any(|seg| words.contains(&seg));
    if has(&["mini", "nano", "luna", "haiku", "lite"]) || m.starts_with("gpt-3.5") {
        Tier::Small
    } else if has(&["pro", "astra", "opus", "fable", "mythos"]) || m == "o1" {
        Tier::Top
    } else {
        Tier::Standard
    }
}

/// Anthropic's id in the form the aggregators use.
///
/// Anthropic names a model `claude-sonnet-5-5`; OpenRouter and the Vercel AI
/// Gateway both list it as `claude-sonnet-5.5` (checked against both live
/// catalogs on 2026-10-03). Only a trailing `-<major>-<minor>` of short
/// numbers is rewritten, so `claude-opus-5` and the legacy `claude-3-haiku`
/// are left alone, and so is a dated snapshot whose last segment is a date.
fn anthropic_aggregator_id(bare: &str) -> String {
    let parts: Vec<&str> = bare.split('-').collect();
    let short_num =
        |s: &str| !s.is_empty() && s.len() <= 2 && s.bytes().all(|b| b.is_ascii_digit());
    if bare.starts_with("claude-") && parts.len() >= 4 {
        let (major, minor) = (parts[parts.len() - 2], parts[parts.len() - 1]);
        if short_num(major) && short_num(minor) {
            return format!("{}.{minor}", parts[..parts.len() - 1].join("-"));
        }
    }
    bare.to_string()
}

/// The model to send to `provider` for a request that named `model`.
///
/// A model that already belongs to the target provider passes through
/// untouched — this runs on the primary request too, not only on failover.
/// Stand-ins are current models: the previous table mapped everything to
/// claude-3-5-sonnet and claude-3-5-haiku, both retired, so every OpenAI →
/// Anthropic failover failed on arrival.
fn map_model_for(provider: &Provider, model: &str) -> String {
    let bare = model.rsplit('/').next().unwrap_or(model);
    let is_openai = bare.starts_with("gpt-")
        || bare.starts_with("chatgpt")
        || bare.starts_with("o1")
        || bare.starts_with("o3")
        || bare.starts_with("o4");
    match provider {
        Provider::Anthropic => {
            if bare.starts_with("claude") {
                return bare.to_string();
            }
            match tier(model) {
                Tier::Small => "claude-haiku-4-5",
                Tier::Standard => "claude-sonnet-5-5",
                Tier::Top => "claude-opus-5-5",
            }
            .to_string()
        }
        Provider::Gemini => {
            if bare.starts_with("gemini") {
                return bare.to_string();
            }
            match tier(model) {
                Tier::Small => "gemini-3.5-flash-lite",
                Tier::Standard | Tier::Top => "gemini-3.8-flash",
            }
            .to_string()
        }
        Provider::OpenAI => {
            if is_openai {
                return bare.to_string();
            }
            match tier(model) {
                Tier::Small => "gpt-5.4-mini",
                Tier::Standard => "gpt-5.4",
                Tier::Top => "gpt-5.5",
            }
            .to_string()
        }
        // OpenRouter and the Vercel AI Gateway both route on vendor-namespaced
        // ids ("openai/gpt-5.4", "google/gemini-3.8-flash"). A bare id is
        // namespaced by family; an already-namespaced one, or one we cannot
        // place, is left for the gateway to judge.
        Provider::OpenRouter | Provider::Vercel => {
            // Already namespaced: keep the client's choice, except that an
            // Anthropic id in Anthropic's own spelling would be rejected.
            if let Some(rest) = model.strip_prefix("anthropic/") {
                return format!("anthropic/{}", anthropic_aggregator_id(rest));
            }
            if model.contains('/') {
                return model.to_string();
            }
            if is_openai {
                format!("openai/{model}")
            } else if bare.starts_with("claude") {
                format!("anthropic/{}", anthropic_aggregator_id(bare))
            } else if bare.starts_with("gemini") {
                format!("google/{model}")
            } else {
                model.to_string()
            }
        }
        _ => model.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_provider_detection() {
        assert_eq!(
            Provider::from_url("https://api.openai.com/v1"),
            Provider::OpenAI
        );
        assert_eq!(
            Provider::from_url("https://api.anthropic.com/v1"),
            Provider::Anthropic
        );
        assert_eq!(
            Provider::from_url("https://generativelanguage.googleapis.com/v1beta/openai"),
            Provider::Gemini
        );
    }

    #[test]
    fn test_translate_openai_to_anthropic() {
        let body = json!({
            "model": "gpt-4o",
            "messages": [
                {"role": "system", "content": "You are helpful."},
                {"role": "user", "content": "Hello!"}
            ],
            "temperature": 0.7
        });
        let bytes = Bytes::from(body.to_string());
        let translated = translate_to_anthropic(&bytes);
        let result: Value = serde_json::from_slice(&translated).unwrap();

        assert_eq!(result["system"], "You are helpful.");
        assert_eq!(result["model"], "claude-sonnet-5-5");
        // System message removed from messages array
        let messages = result["messages"].as_array().unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["role"], "user");
        // max_tokens injected
        assert!(result.get("max_tokens").is_some());
    }

    #[test]
    fn test_normalize_headers_anthropic() {
        let mut headers = HeaderMap::new();
        headers.insert(
            reqwest::header::AUTHORIZATION,
            HeaderValue::from_static("Bearer sk-ant-test"),
        );
        let normalized = normalize_headers(headers, &Provider::Anthropic, None);
        assert!(normalized.get("authorization").is_none());
        assert_eq!(normalized["x-api-key"], "sk-ant-test");
        assert_eq!(normalized["anthropic-version"], "2023-06-01");
    }
}

#[cfg(test)]
mod openrouter_tests {
    use super::*;

    #[test]
    fn openrouter_is_detected_not_swallowed_as_unknown() {
        // Before this variant existed OpenRouter fell through to Unknown, so
        // every provider incident and metric recorded it as "unknown".
        assert_eq!(
            Provider::from_url("https://openrouter.ai/api/v1"),
            Provider::OpenRouter
        );
        assert_eq!(Provider::OpenRouter.to_str(), "openrouter");
    }

    #[test]
    fn openrouter_keeps_bearer_auth_and_gains_attribution() {
        // It is OpenAI-compatible, so the client's Authorization header must
        // survive untouched — the Anthropic branch's x-api-key rewrite would
        // break it.
        let mut h = HeaderMap::new();
        h.insert(
            "authorization",
            HeaderValue::from_static("Bearer sk-or-v1-x"),
        );

        let out = normalize_headers(h, &Provider::OpenRouter, None);

        assert_eq!(
            out.get("authorization").unwrap(),
            "Bearer sk-or-v1-x",
            "OpenRouter auth must pass through unchanged"
        );
        assert!(out.get("x-api-key").is_none());
        assert_eq!(out.get("http-referer").unwrap(), "https://tryrepath.com");
        assert_eq!(out.get("x-title").unwrap(), "Repath");
    }

    #[test]
    fn openrouter_body_is_not_translated() {
        // OpenAI wire format goes straight through; translating it would
        // corrupt the request.
        let body = Bytes::from(r#"{"model":"anthropic/claude-3.5-sonnet","messages":[]}"#);
        assert_eq!(
            translate_request_body(&body, &Provider::OpenRouter),
            body,
            "OpenRouter speaks OpenAI natively — the body must be untouched"
        );
        assert_eq!(translate_response_body(&body, &Provider::OpenRouter), body);
    }

    #[test]
    fn failover_keeps_the_size_the_customer_chose() {
        // A nano request must not start billing at Opus rates on failover,
        // and a flagship request must not be answered by a nano model.
        assert_eq!(
            map_model_for(&Provider::Anthropic, "gpt-5-nano"),
            "claude-haiku-4-5"
        );
        assert_eq!(
            map_model_for(&Provider::Anthropic, "gpt-4o-mini"),
            "claude-haiku-4-5"
        );
        assert_eq!(
            map_model_for(&Provider::Anthropic, "gpt-5.4"),
            "claude-sonnet-5-5"
        );
        assert_eq!(
            map_model_for(&Provider::Anthropic, "gpt-6-astra"),
            "claude-opus-5-5"
        );
        assert_eq!(
            map_model_for(&Provider::Anthropic, "gpt-5.5-pro"),
            "claude-opus-5-5"
        );
        assert_eq!(
            map_model_for(&Provider::Gemini, "gpt-4.1-mini"),
            "gemini-3.5-flash-lite"
        );
        assert_eq!(
            map_model_for(&Provider::Gemini, "claude-sonnet-5-5"),
            "gemini-3.8-flash"
        );
        assert_eq!(
            map_model_for(&Provider::OpenAI, "claude-haiku-4-5"),
            "gpt-5.4-mini"
        );
        assert_eq!(
            map_model_for(&Provider::OpenAI, "gemini-3.8-flash"),
            "gpt-5.4"
        );
        // "gemini" contains "mini"; it must not make every Gemini model small.
        assert_eq!(tier("gemini-2.5-pro"), Tier::Top);
        assert_eq!(tier("gemini-3.5-flash-lite"), Tier::Small);
    }

    #[test]
    fn a_native_model_passes_through_untouched() {
        // This runs on the primary request, not only on failover. Rewriting
        // a model the customer chose for this provider would be a bug.
        for (p, m) in [
            (Provider::Anthropic, "claude-opus-5-5"),
            (Provider::Gemini, "gemini-2.5-pro"),
            (Provider::OpenAI, "gpt-6-astra"),
            (Provider::OpenAI, "o4-mini"),
            (Provider::OpenRouter, "meta-llama/llama-4-maverick"),
        ] {
            assert_eq!(map_model_for(&p, m), m, "{m} on {p:?} must be left alone");
        }
    }

    #[test]
    fn openrouter_gets_vendor_namespaced_ids() {
        assert_eq!(
            map_model_for(&Provider::OpenRouter, "gpt-5.4"),
            "openai/gpt-5.4"
        );
        assert_eq!(
            map_model_for(&Provider::OpenRouter, "claude-sonnet-5-5"),
            // Both aggregators spell Anthropic versions with a dot.
            "anthropic/claude-sonnet-5.5"
        );
        assert_eq!(
            map_model_for(&Provider::OpenRouter, "gemini-3.8-flash"),
            "google/gemini-3.8-flash"
        );
        // Unplaceable: leave it for OpenRouter to judge rather than guess.
        assert_eq!(
            map_model_for(&Provider::OpenRouter, "mystery-model"),
            "mystery-model"
        );
    }

    #[test]
    fn failover_never_targets_a_retired_model() {
        // The old table pointed every Anthropic failover at claude-3-5-*,
        // retired by Anthropic, so failover failed exactly when it was needed.
        const RETIRED: &[&str] = &[
            "claude-3-5-sonnet",
            "claude-3-5-haiku",
            "claude-3-opus",
            "claude-3-haiku",
            "claude-3-7-sonnet",
            "gemini-1.5",
            "gemini-2.0",
            "o1-mini",
            "gpt-4.5",
        ];
        let probes = [
            "gpt-5-nano",
            "gpt-4o",
            "gpt-6-astra",
            "claude-haiku-4-5",
            "gemini-2.5-pro",
            "o3",
        ];
        for p in [Provider::Anthropic, Provider::Gemini, Provider::OpenAI] {
            for m in probes {
                let out = map_model_for(&p, m);
                // A model native to the target passes through by design; only
                // stand-ins we choose are held to this.
                if out == m {
                    continue;
                }
                assert!(
                    !RETIRED.iter().any(|r| out.starts_with(r)),
                    "{m} -> {out} on {p:?} is a retired model"
                );
            }
        }
    }

    #[test]
    fn vercel_ai_gateway_is_detected_and_gets_namespaced_ids() {
        assert_eq!(
            Provider::from_url("https://ai-gateway.vercel.sh/v1"),
            Provider::Vercel
        );
        assert_eq!(Provider::Vercel.to_str(), "vercel");
        assert_eq!(
            map_model_for(&Provider::Vercel, "gpt-6-luna"),
            "openai/gpt-6-luna"
        );
        assert_eq!(
            map_model_for(&Provider::Vercel, "gemini-3.8-flash"),
            "google/gemini-3.8-flash"
        );
        assert_eq!(
            map_model_for(&Provider::Vercel, "anthropic/claude-opus-5"),
            "anthropic/claude-opus-5"
        );
        // Anthropic spells versions with a hyphen, both aggregators with a dot.
        assert_eq!(
            map_model_for(&Provider::Vercel, "claude-haiku-4-5"),
            "anthropic/claude-haiku-4.5"
        );
        assert_eq!(
            map_model_for(&Provider::Vercel, "anthropic/claude-sonnet-5-5"),
            "anthropic/claude-sonnet-5.5"
        );
        assert_eq!(
            map_model_for(&Provider::Vercel, "anthropic/claude-sonnet-5.5"),
            "anthropic/claude-sonnet-5.5"
        );
        let body = Bytes::from(r#"{"model":"claude-sonnet-5-5","messages":[]}"#);
        let out: Value =
            serde_json::from_slice(&translate_request_body(&body, &Provider::Vercel)).unwrap();
        assert_eq!(out["model"], "anthropic/claude-sonnet-5.5");
    }

    #[test]
    fn only_a_short_major_minor_pair_is_dotted() {
        assert_eq!(
            anthropic_aggregator_id("claude-opus-5-5"),
            "claude-opus-5.5"
        );
        assert_eq!(
            anthropic_aggregator_id("claude-fable-5-1"),
            "claude-fable-5.1"
        );
        assert_eq!(anthropic_aggregator_id("claude-opus-5"), "claude-opus-5");
        assert_eq!(anthropic_aggregator_id("claude-3-haiku"), "claude-3-haiku");
        // A dated snapshot keeps its form rather than becoming "4-5.20251001".
        assert_eq!(
            anthropic_aggregator_id("claude-haiku-4-5-20251001"),
            "claude-haiku-4-5-20251001"
        );
    }

    #[test]
    fn gemini_body_gets_a_gemini_model() {
        let body = Bytes::from(r#"{"model":"gpt-4o","messages":[]}"#);
        let out: Value =
            serde_json::from_slice(&translate_request_body(&body, &Provider::Gemini)).unwrap();
        assert_eq!(out["model"], "gemini-3.8-flash");
    }
}
