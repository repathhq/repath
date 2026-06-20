//! Provider failover — automatic retry and fallback when a provider is down.
//!
//! # How it works
//!
//! When a provider returns a 5xx error or times out:
//!
//! 1. **Retry once** on the same provider after 300ms (handles brief blips)
//! 2. **Failover** to the next provider in the tenant's fallback chain
//! 3. **Record the incident** so the customer can see it in their dashboard
//! 4. If all providers fail, return the last error with X-Repath-Provider-Failed header
//!    so the client SDK can call the provider directly as a last resort
//!
//! # Failover chain configuration
//!
//! Set in the tenant's account settings or per-rollout:
//! ```
//! primary:   openai/gpt-4o
//! fallback:  anthropic/claude-3-5-sonnet
//! fallback2: openrouter  (catches everything)
//! ```
//!
//! If not configured, single provider with one retry only.
//!
//! # Provider health tracking
//!
//! The health tracker maintains a rolling 60-second error rate per provider.
//! A provider is marked "degraded" when error rate > 20% over 60s.
//! This feeds the dashboard's provider status display.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tracing::{info, warn};

/// A single provider endpoint with its API key override (if any).
#[derive(Debug, Clone)]
pub struct ProviderEndpoint {
    /// Provider base URL, e.g. "https://api.openai.com/v1"
    pub url: String,
    /// Human-readable name for logging
    pub name: String,
    /// Optional API key override — if None, forward the client's key
    pub api_key: Option<String>,
}

impl ProviderEndpoint {
    pub fn new(url: impl Into<String>, name: impl Into<String>) -> Self {
        Self { url: url.into(), name: name.into(), api_key: None }
    }

    pub fn with_key(mut self, key: impl Into<String>) -> Self {
        self.api_key = Some(key.into());
        self
    }
}

/// Well-known provider configurations.
pub fn openai_endpoint() -> ProviderEndpoint {
    ProviderEndpoint::new("https://api.openai.com/v1", "openai")
}

pub fn anthropic_endpoint() -> ProviderEndpoint {
    ProviderEndpoint::new("https://api.anthropic.com/v1", "anthropic")
}

pub fn gemini_endpoint() -> ProviderEndpoint {
    ProviderEndpoint::new("https://generativelanguage.googleapis.com/v1beta/openai", "gemini")
}

/// OpenRouter — acts as a universal fallback hub.
/// One API key gives access to 100+ models. If primary provider is down,
/// OpenRouter can route to a working alternative automatically.
pub fn openrouter_endpoint(api_key: impl Into<String>) -> ProviderEndpoint {
    ProviderEndpoint::new("https://openrouter.ai/api/v1", "openrouter")
        .with_key(api_key)
}

// ── Health tracking ─────────────────────────────────────────────────────────

const HEALTH_WINDOW: Duration = Duration::from_secs(60);
const DEGRADED_THRESHOLD: f64 = 0.20; // 20% error rate = degraded
const MIN_SAMPLES: u32 = 5;           // need at least 5 requests to assess health

#[derive(Debug)]
struct ProviderHealthEntry {
    /// Ring buffer of (timestamp, is_error) for the last 60s
    samples: Vec<(Instant, bool)>,
}

impl ProviderHealthEntry {
    fn new() -> Self {
        Self { samples: Vec::with_capacity(64) }
    }

    fn record(&mut self, is_error: bool) {
        let now = Instant::now();
        // Evict samples older than the window
        self.samples.retain(|(t, _)| now.duration_since(*t) < HEALTH_WINDOW);
        self.samples.push((now, is_error));
    }

    fn error_rate(&self) -> f64 {
        let now = Instant::now();
        let recent: Vec<_> = self.samples.iter()
            .filter(|(t, _)| now.duration_since(*t) < HEALTH_WINDOW)
            .collect();
        if recent.len() < MIN_SAMPLES as usize {
            return 0.0;
        }
        let errors = recent.iter().filter(|(_, e)| *e).count();
        errors as f64 / recent.len() as f64
    }

    fn is_degraded(&self) -> bool {
        self.error_rate() > DEGRADED_THRESHOLD
    }

    fn total_requests(&self) -> u32 {
        let now = Instant::now();
        self.samples.iter()
            .filter(|(t, _)| now.duration_since(*t) < HEALTH_WINDOW)
            .count() as u32
    }
}

/// Shared provider health registry — one entry per provider URL.
///
/// Clone-safe (internal Arc). Reads and writes are lock-guarded but fast —
/// the critical section is O(n) where n = samples in 60s window (typically <200).
#[derive(Clone)]
pub struct ProviderHealthRegistry {
    entries: Arc<Mutex<HashMap<String, ProviderHealthEntry>>>,
}

impl ProviderHealthRegistry {
    pub fn new() -> Self {
        Self { entries: Arc::new(Mutex::new(HashMap::new())) }
    }

    pub fn record_success(&self, provider_url: &str) {
        let mut map = self.entries.lock().unwrap();
        map.entry(provider_url.to_string())
            .or_insert_with(ProviderHealthEntry::new)
            .record(false);
    }

    pub fn record_error(&self, provider_url: &str) {
        let mut map = self.entries.lock().unwrap();
        map.entry(provider_url.to_string())
            .or_insert_with(ProviderHealthEntry::new)
            .record(true);
    }

    pub fn is_degraded(&self, provider_url: &str) -> bool {
        let map = self.entries.lock().unwrap();
        map.get(provider_url)
            .map(|e| e.is_degraded())
            .unwrap_or(false)
    }

    pub fn error_rate(&self, provider_url: &str) -> f64 {
        let map = self.entries.lock().unwrap();
        map.get(provider_url)
            .map(|e| e.error_rate())
            .unwrap_or(0.0)
    }

    /// Snapshot of all provider health for the dashboard API.
    pub fn snapshot(&self) -> Vec<ProviderHealthSnapshot> {
        let map = self.entries.lock().unwrap();
        map.iter().map(|(url, entry)| ProviderHealthSnapshot {
            provider_url: url.clone(),
            error_rate: entry.error_rate(),
            total_requests: entry.total_requests(),
            degraded: entry.is_degraded(),
        }).collect()
    }
}

impl Default for ProviderHealthRegistry {
    fn default() -> Self { Self::new() }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct ProviderHealthSnapshot {
    pub provider_url: String,
    pub error_rate: f64,
    pub total_requests: u32,
    pub degraded: bool,
}

// ── Failover logic ───────────────────────────────────────────────────────────

/// Result of a single provider attempt.
#[derive(Debug)]
pub enum AttemptOutcome {
    /// Provider responded (even with 4xx — those are not retried).
    Success(reqwest::Response),
    /// Provider returned 5xx or timed out — eligible for failover.
    ProviderError { status: Option<u16>, message: String },
}

/// Classify a reqwest error or response status for failover eligibility.
pub fn should_failover(status: u16) -> bool {
    // 5xx = provider is down/overloaded → failover
    // 4xx = our request is wrong → don't failover (would fail everywhere)
    // 429 = rate limited → failover to another provider
    status >= 500 || status == 429
}

/// Build the fallback provider chain for a given primary URL.
///
/// If the customer has configured fallback providers in their tenant settings,
/// those are used. Otherwise we try OpenRouter as a universal fallback
/// if OPENROUTER_API_KEY is set in env.
pub fn build_fallback_chain(
    primary_url: &str,
    tenant_fallbacks: &[ProviderEndpoint],
) -> Vec<ProviderEndpoint> {
    let mut chain: Vec<ProviderEndpoint> = tenant_fallbacks.to_vec();

    // If no tenant-configured fallbacks, check if OpenRouter is available
    if chain.is_empty() {
        if let Ok(key) = std::env::var("OPENROUTER_API_KEY") {
            if !key.is_empty() {
                // Don't add OpenRouter as fallback for OpenRouter itself
                if !primary_url.contains("openrouter.ai") {
                    chain.push(openrouter_endpoint(key));
                }
            }
        }
    }

    chain
}

/// Log a provider failover incident.
pub fn log_failover(
    primary: &str,
    fallback: &str,
    reason: &str,
    request_id: uuid::Uuid,
) {
    warn!(
        request_id = %request_id,
        primary_provider = primary,
        fallback_provider = fallback,
        reason = reason,
        "Provider failover triggered"
    );
}

/// Log provider recovery.
pub fn log_recovery(provider: &str) {
    info!(provider = provider, "Provider health recovered");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_registry_starts_healthy() {
        let registry = ProviderHealthRegistry::new();
        assert!(!registry.is_degraded("https://api.openai.com/v1"));
        assert_eq!(registry.error_rate("https://api.openai.com/v1"), 0.0);
    }

    #[test]
    fn test_degraded_after_threshold() {
        let registry = ProviderHealthRegistry::new();
        let url = "https://api.openai.com/v1";
        // Record 8 errors out of 10 = 80% error rate
        for _ in 0..10 {
            registry.record_error(url);
        }
        // Need MIN_SAMPLES=5 so this should be degraded
        assert!(registry.is_degraded(url));
    }

    #[test]
    fn test_healthy_with_few_samples() {
        let registry = ProviderHealthRegistry::new();
        let url = "https://api.openai.com/v1";
        // Only 2 errors — below MIN_SAMPLES threshold
        registry.record_error(url);
        registry.record_error(url);
        assert!(!registry.is_degraded(url));
    }

    #[test]
    fn test_provider_isolation() {
        let registry = ProviderHealthRegistry::new();
        let openai = "https://api.openai.com/v1";
        let anthropic = "https://api.anthropic.com/v1";
        for _ in 0..10 { registry.record_error(openai); }
        assert!(registry.is_degraded(openai));
        assert!(!registry.is_degraded(anthropic));
    }

    #[test]
    fn test_should_failover() {
        assert!(should_failover(500));
        assert!(should_failover(503));
        assert!(should_failover(429));
        assert!(!should_failover(400));
        assert!(!should_failover(401));
        assert!(!should_failover(404));
        assert!(!should_failover(200));
    }

    #[test]
    fn test_openrouter_endpoint() {
        let ep = openrouter_endpoint("key123");
        assert!(ep.url.contains("openrouter.ai"));
        assert_eq!(ep.api_key.as_deref(), Some("key123"));
    }
}
