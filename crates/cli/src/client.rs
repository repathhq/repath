//! HTTP client for the Repath management API.
//!
//! # Why the CLI no longer talks to PostgreSQL
//!
//! The CLI used to open a direct database connection. That works for an
//! operator sitting next to the database, but in a hosted deployment the
//! database lives in a private subnet reachable only from the gateway host —
//! so a customer could not use the CLI at all, and creating a rollout required
//! someone with server access to run it by hand.
//!
//! Talking to the management API instead means the CLI works from anywhere the
//! gateway is reachable, authenticates with the same key as everything else,
//! and inherits tenant scoping for free.
//!
//! # Configuration
//!
//! ```text
//! REPATH_API_URL   Base URL of the gateway   (default: http://localhost:8080)
//! REPATH_API_KEY   Your Repath API key       (from the dashboard, Settings)
//! ```

use anyhow::{bail, Context, Result};
use colored::Colorize;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::time::Duration;

const DEFAULT_API_URL: &str = "http://localhost:8080";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Debug is derived so tests can `.unwrap()` a `Result<Client, _>`. The key
/// field is redacted rather than printed.
pub struct Client {
    http: reqwest::Client,
    base_url: String,
    api_key: String,
}

impl Client {
    /// Build a client from explicit values, falling back to the environment.
    pub fn new(base_url: Option<String>, api_key: Option<String>) -> Result<Self> {
        let base_url = base_url
            .or_else(|| std::env::var("REPATH_API_URL").ok())
            .unwrap_or_else(|| DEFAULT_API_URL.to_string())
            .trim_end_matches('/')
            .to_string();

        let api_key = match api_key.or_else(|| std::env::var("REPATH_API_KEY").ok()) {
            Some(k) if !k.is_empty() => k,
            _ => bail!(
                "No API key found.\n\n  \
                 Set {} to the key from your dashboard (Settings → API key),\n  \
                 or pass {}.\n\n  \
                 Self-hosted? Use your {} instead.",
                "REPATH_API_KEY".bold(),
                "--api-key <KEY>".bold(),
                "REPATH_API_TOKEN".bold()
            ),
        };

        let http = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .build()
            .context("Failed to build HTTP client")?;

        Ok(Self {
            http,
            base_url,
            api_key,
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/api/v1/{}", self.base_url, path.trim_start_matches('/'))
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let res = self
            .http
            .get(self.url(path))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .with_context(|| self.connection_hint())?;

        self.decode(res).await
    }

    pub async fn post<T: DeserializeOwned>(&self, path: &str, body: Option<&Value>) -> Result<T> {
        let mut req = self.http.post(self.url(path)).bearer_auth(&self.api_key);
        if let Some(b) = body {
            req = req.json(b);
        }

        let res = req.send().await.with_context(|| self.connection_hint())?;
        self.decode(res).await
    }

    pub async fn delete<T: DeserializeOwned>(&self, path: &str) -> Result<T> {
        let res = self
            .http
            .delete(self.url(path))
            .bearer_auth(&self.api_key)
            .send()
            .await
            .with_context(|| self.connection_hint())?;

        self.decode(res).await
    }

    /// Turn a response into either the decoded body or a useful error.
    ///
    /// The API reports failures as `{"error": {"message": ...}}`; surfacing
    /// that message beats printing a bare status code.
    async fn decode<T: DeserializeOwned>(&self, res: reqwest::Response) -> Result<T> {
        let status = res.status();
        let text = res.text().await.unwrap_or_default();

        if status.is_success() {
            return serde_json::from_str(&text).with_context(|| {
                format!("Unexpected response from the gateway: {}", truncate(&text))
            });
        }

        let api_message = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| truncate(&text));

        match status.as_u16() {
            401 => bail!("{api_message}\n\n  Check that REPATH_API_KEY is set to a current key."),
            404 => bail!("{api_message}"),
            409 => bail!("{api_message}"),
            _ => bail!("Gateway returned {status}: {api_message}"),
        }
    }

    fn connection_hint(&self) -> String {
        format!(
            "Could not reach the Repath gateway at {}.\n  \
             Set REPATH_API_URL if it runs somewhere else.",
            self.base_url
        )
    }
}

impl std::fmt::Debug for Client {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Client")
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

/// Cap an error body at a readable length.
///
/// Counts characters rather than bytes: slicing a `&str` at an arbitrary byte
/// offset panics when that offset falls inside a multi-byte character, and an
/// error path is the worst possible place to panic.
fn truncate(s: &str) -> String {
    const MAX_CHARS: usize = 300;
    let s = s.trim();
    if s.chars().count() > MAX_CHARS {
        let head: String = s.chars().take(MAX_CHARS).collect();
        format!("{head}…")
    } else {
        s.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Guard against double slashes or a missing `/api/v1` prefix.
    #[test]
    fn builds_urls_correctly() {
        let c = Client {
            http: reqwest::Client::new(),
            base_url: "https://api.tryrepath.com".into(),
            api_key: "rp_live_x".into(),
        };
        assert_eq!(
            c.url("rollouts"),
            "https://api.tryrepath.com/api/v1/rollouts"
        );
        assert_eq!(
            c.url("/rollouts/abc/promote"),
            "https://api.tryrepath.com/api/v1/rollouts/abc/promote"
        );
    }

    #[test]
    fn strips_trailing_slash_from_base_url() {
        let c = Client::new(
            Some("https://api.tryrepath.com/".into()),
            Some("rp_live_x".into()),
        )
        .unwrap();
        assert_eq!(c.base_url, "https://api.tryrepath.com");
    }

    #[test]
    fn missing_key_is_an_actionable_error() {
        // Explicitly clear so a developer's own env cannot make this pass.
        std::env::remove_var("REPATH_API_KEY");
        let err = Client::new(Some("http://localhost:8080".into()), None)
            .unwrap_err()
            .to_string();
        assert!(err.contains("REPATH_API_KEY"), "got: {err}");
    }

    #[test]
    fn truncate_leaves_short_strings_alone() {
        assert_eq!(truncate("  hello  "), "hello");
    }

    #[test]
    fn truncate_caps_long_strings() {
        let out = truncate(&"x".repeat(1000));
        assert_eq!(out.chars().count(), 301, "300 chars plus the ellipsis");
        assert!(out.ends_with('…'));
    }

    #[test]
    fn truncate_does_not_panic_on_multibyte_boundaries() {
        // A byte-based slice at 300 would land inside one of these 3-byte
        // characters and panic. Non-ASCII error bodies are entirely normal.
        let out = truncate(&"→".repeat(500));
        assert_eq!(out.chars().count(), 301);
    }
}
