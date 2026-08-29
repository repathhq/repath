//! Repath Gateway — library surface.
//!
//! The gateway is built as a library plus a thin binary so integration
//! tests can construct an `AppState` and exercise real handlers (notably
//! the tenant-isolation tests) instead of only testing through a spawned
//! process.
//!
//! Original crate documentation follows.
//!
//! # Repath Gateway
//!
//! A high-performance reverse proxy for LLM API requests that enables progressive delivery
//! (canary deployments, shadow testing, automated quality evaluation, instant rollback).
//!
//! # Architecture
//!
//! The gateway is a single-binary Rust application built on Tokio and Axum that:
//! 1. Accepts OpenAI-compatible API requests
//! 2. Routes traffic between baseline and candidate versions (weighted)
//! 3. Proxies requests to upstream providers (OpenAI, Anthropic, etc.)
//! 4. Records request/response metadata asynchronously
//! 5. Enqueues evaluation jobs to Redis Streams
//! 6. Exposes Prometheus metrics for observability
//!
//! # Performance Characteristics
//!
//! - Proxy overhead: < 2ms P99 (measured)
//! - Throughput: > 50K req/s per instance (load tested)
//! - Memory: < 100MB baseline (RSS)
//! - Streaming: Zero-copy SSE passthrough (no buffering)

use repath_common::config::ServerConfig;
use std::sync::Arc;

pub mod api;
pub mod circuit_breaker;
pub mod config;
pub mod db;
pub mod observability;
pub mod proxy;
pub mod recorder;
pub mod router;
pub mod routing;
pub mod server;
pub mod tenant;

/// Application state shared across all request handlers.
///
/// Clone cost is intentionally O(1): every field is either a pool/handle with
/// internal Arc, or an Arc itself. No deep copies happen on clone.
///
/// # Concurrency design
///
/// - `db_pool`: sqlx manages a pool of connections; calling .acquire() is
///   non-blocking (async). No mutex needed.
///
/// - `redis`: ConnectionManager holds a single multiplexed connection with
///   auto-reconnect. Multiplexed means concurrent callers pipeline their
///   commands on one TCP conn without any locking on our side.
///
/// - `http_client`: reqwest::Client is internally Arc-based and maintains its
///   own connection pool. Cloning is a reference count increment.
///
/// - `config`: Arc<ServerConfig> — immutable after startup. Zero-cost reads,
///   no synchronization ever needed.
///
/// - `metrics`: Arc<Metrics> — prometheus counters/histograms use atomic ops
///   internally. No external locking needed.
///
/// - `record_tx`: mpsc::Sender — fire-and-forget channel to a background
///   recorder task. Hot path posts to the channel and returns immediately.
///   Back-pressure: bounded channel; if recorder falls behind, send() returns
///   Err which we log and discard (request is not affected).
///
/// - `rollout_cache`: ArcSwap<Option<ActiveRollout>> — the single most
///   important concurrency choice in this codebase. Every incoming request
///   reads the active rollout to decide routing. ArcSwap gives lock-free reads
///   via a single atomic pointer load. The controller writes at most once per
///   30 seconds — the swap is instantaneous and never blocks any reader.
///   An Arc<RwLock<>> would be wrong here: at 50K req/s even a 1µs read-lock
///   acquisition adds measurable contention when writers occasionally swap.
#[derive(Clone)]
pub struct AppState {
    pub db_pool: sqlx::PgPool,
    pub redis: redis::aio::ConnectionManager,
    pub http_client: reqwest::Client,
    pub config: Arc<ServerConfig>,
    pub metrics: Arc<observability::Metrics>,
    /// Sender half of the bounded channel to the background recorder task.
    /// Bounded at RECORDER_CHANNEL_CAPACITY so a slow DB can't OOM the process.
    pub record_tx: tokio::sync::mpsc::Sender<recorder::RecordRequest>,
    /// Lock-free cache of the currently active rollout.
    /// Reads happen on every proxied request; writes happen ~once/30s from
    /// the controller. ArcSwap gives O(1) lock-free reads.
    pub rollout_cache: Arc<arc_swap::ArcSwap<router::RolloutCache>>,
    /// Per-tenant circuit breaker — ensures Repath is never a bottleneck.
    pub circuit_breaker: circuit_breaker::CircuitBreakerRegistry,
    /// Rolling error rate per provider URL — feeds provider health dashboard.
    pub provider_health: proxy::failover::ProviderHealthRegistry,
    /// Lock-free cache of tenants by API key hash. Read on every authenticated
    /// request; refreshed every 5s by a background task. Same rationale as
    /// `rollout_cache` — key lookup must not put Postgres on the hot path.
    pub tenant_cache: Arc<arc_swap::ArcSwap<tenant::TenantCache>>,
    /// Conditional routing rules and per-tenant provider credentials.
    /// Read on every proxied request; refreshed every 5s like the others.
    pub routing_cache: Arc<arc_swap::ArcSwap<routing::RoutingCache>>,
    /// Per-tenant request rate limiter. In-process token buckets, checked on
    /// every proxied request — see `tenant::rate_limit` for why this is not
    /// backed by Redis.
    pub rate_limiter: Arc<tenant::rate_limit::RateLimiter>,
}

/// Helpers for integration tests.
///
/// Compiled only under `cfg(test)` or when the `test-support` feature is on,
/// so nothing here ships in a release binary.
#[cfg(any(test, feature = "test-support"))]
pub mod test_support {
    use super::*;

    /// Build an [`AppState`] backed by a real database for integration tests.
    ///
    /// Redis is a required field on `AppState`, so a connection is made even
    /// though the handlers under test never touch it. `REPATH_TEST_REDIS_URL`
    /// overrides the default of `redis://localhost:6379`.
    ///
    /// Panics if Redis is unreachable — an integration test that silently
    /// skipped would give false confidence about tenant isolation.
    pub async fn app_state_for_tests(db_pool: sqlx::PgPool) -> AppState {
        let redis_url = std::env::var("REPATH_TEST_REDIS_URL")
            .unwrap_or_else(|_| "redis://localhost:6379".to_string());

        let redis = recorder::create_redis_connection(&redis_url)
            .await
            .unwrap_or_else(|e| {
                panic!("integration tests need Redis at {redis_url}: {e}");
            });

        let config = ServerConfig::from_toml(
            r#"
            [server]
            host = "127.0.0.1"
            port = 0

            [database]
            url = "postgres://unused/in-tests"
            "#,
        )
        .expect("static test config parses");
        // Capacity is irrelevant here: nothing drains this channel in tests,
        // and the handlers under test never send on it.
        let (record_tx, _record_rx) = tokio::sync::mpsc::channel(16);

        AppState {
            db_pool,
            redis,
            http_client: reqwest::Client::new(),
            config: Arc::new(config),
            metrics: Arc::new(observability::Metrics::new()),
            record_tx,
            rollout_cache: Arc::new(arc_swap::ArcSwap::from_pointee(
                router::RolloutCache::empty(),
            )),
            circuit_breaker: circuit_breaker::CircuitBreakerRegistry::new(),
            provider_health: proxy::failover::ProviderHealthRegistry::new(),
            tenant_cache: Arc::new(arc_swap::ArcSwap::from_pointee(tenant::TenantCache::empty())),
            routing_cache: Arc::new(arc_swap::ArcSwap::from_pointee(
                routing::RoutingCache::empty(),
            )),
            rate_limiter: Arc::new(tenant::rate_limit::RateLimiter::new()),
        }
    }
}
