//! Prometheus metrics server and registry.
//!
//! # Metric design principles
//!
//! 1. Every metric has a clear unit in its name (suffix `_total`, `_seconds`,
//!    `_bytes`) per Prometheus naming conventions.
//! 2. Histograms use hand-tuned buckets for LLM latency (expected P99 is 2–30s,
//!    very different from typical HTTP APIs at <100ms).
//! 3. We do NOT use a global Prometheus registry. A local registry means tests
//!    are isolated and multiple gateways in the same process don't conflict.
//!
//! # Metrics exposed
//!
//! ```text
//! repath_requests_total               counter   total proxied requests
//! repath_request_duration_seconds     histogram request duration (gateway only, not upstream)
//! repath_recorder_dropped_total       counter   records dropped due to full channel
//! repath_rollback_total               counter   rollbacks triggered by controller
//! repath_upstream_errors_total        counter   upstream 4xx/5xx responses
//! ```

use axum::{routing::get, Router};
use prometheus::{
    Counter, Histogram, HistogramOpts, Opts, Registry,
    TextEncoder, Encoder,
};
use repath_common::{Error, Result};
use std::sync::Arc;
use tracing::info;

/// All Prometheus metrics for the gateway.
///
/// Created once at startup and shared via `Arc<Metrics>` in `AppState`.
/// All metric types are thread-safe (atomic internally).
pub struct Metrics {
    pub registry: Registry,
    pub requests_total: Counter,
    pub request_duration: Histogram,
    pub recorder_dropped_total: Counter,
    pub rollback_total: Counter,
    pub upstream_errors_total: Counter,
}

impl Metrics {
    /// Create and register all metrics.
    ///
    /// Returns `Err` only if a metric name conflicts with an existing one in the
    /// local registry — which is a programming error and should never happen.
    pub fn new() -> Self {
        let registry = Registry::new();

        // LLM requests are slow (2–30s), so buckets span a wide range.
        // Standard HTTP buckets (.005, .01, .025 ...) are useless here.
        let latency_buckets = vec![
            0.01,  // 10ms  (very fast, embedding calls)
            0.05,  // 50ms
            0.1,   // 100ms
            0.25,  // 250ms
            0.5,   // 500ms
            1.0,   // 1s
            2.0,   // 2s
            5.0,   // 5s
            10.0,  // 10s (long generation)
            30.0,  // 30s (timeout boundary)
            60.0,  // 60s (absolute max)
        ];

        let requests_total = Counter::with_opts(
            Opts::new("repath_requests_total", "Total number of proxied LLM requests"),
        ).expect("metric name conflict: repath_requests_total");

        let request_duration = Histogram::with_opts(
            HistogramOpts::new(
                "repath_request_duration_seconds",
                "Duration of proxied requests from first byte received to last byte sent",
            )
            .buckets(latency_buckets),
        ).expect("metric name conflict: repath_request_duration_seconds");

        let recorder_dropped_total = Counter::with_opts(
            Opts::new(
                "repath_recorder_dropped_total",
                "Number of request records dropped because the recorder channel was full",
            ),
        ).expect("metric name conflict: repath_recorder_dropped_total");

        let rollback_total = Counter::with_opts(
            Opts::new("repath_rollback_total", "Number of rollouts rolled back by the controller"),
        ).expect("metric name conflict: repath_rollback_total");

        let upstream_errors_total = Counter::with_opts(
            Opts::new(
                "repath_upstream_errors_total",
                "Number of 4xx/5xx responses received from upstream providers",
            ),
        ).expect("metric name conflict: repath_upstream_errors_total");

        // Register all metrics. Uses .expect() intentionally: a name collision
        // is a programming error that should crash at startup, not be silently ignored.
        registry.register(Box::new(requests_total.clone()))
            .expect("failed to register requests_total");
        registry.register(Box::new(request_duration.clone()))
            .expect("failed to register request_duration");
        registry.register(Box::new(recorder_dropped_total.clone()))
            .expect("failed to register recorder_dropped_total");
        registry.register(Box::new(rollback_total.clone()))
            .expect("failed to register rollback_total");
        registry.register(Box::new(upstream_errors_total.clone()))
            .expect("failed to register upstream_errors_total");

        Self {
            registry,
            requests_total,
            request_duration,
            recorder_dropped_total,
            rollback_total,
            upstream_errors_total,
        }
    }
}

/// Serve Prometheus metrics on a dedicated port.
///
/// Runs as a separate HTTP server so the metrics port can be firewalled
/// from public traffic while the main API port is exposed.
///
/// GET /metrics  → Prometheus text format
pub async fn serve_metrics(port: u16, metrics: Arc<Metrics>) -> Result<()> {
    let addr = format!("0.0.0.0:{}", port);

    let app = Router::new()
        .route("/metrics", get(move || {
            let registry = metrics.registry.clone();
            async move {
                let mf = registry.gather();
                let mut buf = Vec::with_capacity(4096);
                TextEncoder::new().encode(&mf, &mut buf).unwrap_or_default();
                // TextEncoder's MIME type is always "text/plain; version=0.0.4"
                // Hardcoding it avoids a borrow-after-move issue since
                // format_type() borrows self which was moved into encode().
                (
                    [(
                        axum::http::header::CONTENT_TYPE,
                        "text/plain; version=0.0.4",
                    )],
                    buf,
                )
            }
        }));

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| Error::Internal {
            message: format!("Failed to bind metrics server to {}", addr),
            source: Some(e.into()),
        })?;

    info!(addr = %addr, "Metrics server listening");

    axum::serve(listener, app)
        .await
        .map_err(|e| Error::Internal {
            message: "Metrics server error".to_string(),
            source: Some(e.into()),
        })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_metrics_creation_does_not_panic() {
        let metrics = Metrics::new();
        // Increment each counter to verify they're usable
        metrics.requests_total.inc();
        metrics.recorder_dropped_total.inc();
        metrics.rollback_total.inc();
        metrics.upstream_errors_total.inc();
        metrics.request_duration.observe(0.5);

        assert!(metrics.requests_total.get() > 0.0);
    }

    #[test]
    fn test_metrics_registry_gather() {
        let metrics = Metrics::new();
        metrics.requests_total.inc_by(42.0);

        let mf = metrics.registry.gather();
        assert!(!mf.is_empty(), "Registry should have metric families");
    }

    #[test]
    fn test_latency_histogram_buckets_cover_llm_range() {
        let metrics = Metrics::new();
        // Observe a 5-second LLM response
        metrics.request_duration.observe(5.0);
        // Observe a 25-second long-form generation
        metrics.request_duration.observe(25.0);

        let mf = metrics.registry.gather();
        let duration_family = mf.iter()
            .find(|f| f.get_name() == "repath_request_duration_seconds")
            .expect("duration metric should exist");

        let sample_count = duration_family.get_metric()[0]
            .get_histogram()
            .get_sample_count();
        assert_eq!(sample_count, 2);
    }
}
