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
        _ => body.clone(),
    }
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
///   "model": "claude-3-5-sonnet-20241022",
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
        let anthropic_model = map_model_to_anthropic(model);
        json["model"] = Value::String(anthropic_model.to_string());
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

fn map_model_to_anthropic(openai_model: &str) -> &str {
    // If the caller already specified a claude model, use it as-is
    if openai_model.starts_with("claude") {
        return openai_model;
    }
    // Map common OpenAI models to Anthropic equivalents
    match openai_model {
        "gpt-4o" | "gpt-4" | "gpt-4-turbo" => "claude-3-5-sonnet-20241022",
        "gpt-4o-mini" | "gpt-3.5-turbo" => "claude-3-5-haiku-20241022",
        _ => "claude-3-5-sonnet-20241022",
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
        assert_eq!(result["model"], "claude-3-5-sonnet-20241022");
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
