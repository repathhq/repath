//! Prometheus metrics server and registry for the controller.
//!
//! # Metric design
//!
//! 1. Every metric has a clear unit in its name (suffix `_total`, `_seconds`)
//!    per Prometheus naming conventions.
//! 2. The `repath_controller_last_cycle_timestamp` gauge is the primary liveness
//!    signal: if it has not advanced for >2 minutes the controller is stuck or dead.
//! 3. We do NOT use the global Prometheus registry — a local registry keeps tests
//!    isolated and prevents name conflicts if the controller is embedded in another
//!    process during integration testing.
//!
//! # Endpoints
//!
//! ```text
//! GET /metrics  → Prometheus text format (scraped by Prometheus / Fly metrics)
//! GET /health   → {"status":"ok"}        (used by Fly health checks)
//! ```

use axum::{routing::get, Json, Router};
use prometheus::{
    Counter, CounterVec, Encoder, Gauge, Histogram, HistogramOpts, Opts, Registry, TextEncoder,
};
use repath_common::{Error, Result};
use serde_json::json;
use std::sync::Arc;
use tracing::info;

/// All Prometheus metrics for the controller.
///
/// Created once at startup and threaded through `ControllerConfig` as
/// `Arc<ControllerMetrics>`. All metric types are internally atomic and
/// safe to share across threads without external locking.
pub struct ControllerMetrics {
    pub registry: Registry,

    /// How long each full decision cycle takes end-to-end.
    pub cycle_duration_seconds: Histogram,

    /// Unix timestamp (seconds) of the last successful cycle completion.
    /// Stale for >2 minutes → controller is dead. Primary liveness signal.
    pub last_cycle_timestamp: Gauge,

    /// Count of every decision outcome, labelled by `action`.
    /// Label values: "advance", "rollback", "promote", "hold", "already_acted_on".
    pub decisions_total: CounterVec,

    /// Number of active rollouts processed in the most recent cycle.
    pub active_rollouts: Gauge,

    /// Total number of cycles attempted (including error cycles).
    pub cycles_total: Counter,

    /// Total number of cycles that ended in an error.
    pub cycle_errors_total: Counter,
}

impl std::fmt::Debug for ControllerMetrics {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ControllerMetrics").finish_non_exhaustive()
    }
}

impl Default for ControllerMetrics {
    fn default() -> Self {
        Self::new()
    }
}

impl ControllerMetrics {
    /// Create and register all metrics on a fresh local registry.
    ///
    /// Panics on metric name conflict — that is a programming error and must
    /// be caught at startup, not silently swallowed.
    pub fn new() -> Self {
        let registry = Registry::new();

        // Controller decision cycles are expected to complete in <1s under
        // normal load (a DB round-trip or two). Buckets cover the full
        // range from fast cycles (no rollouts) to slow ones (many rollouts,
        // slow DB).
        let cycle_buckets = vec![0.01, 0.05, 0.1, 0.5, 1.0, 5.0];

        let cycle_duration_seconds = Histogram::with_opts(
            HistogramOpts::new(
                "repath_controller_cycle_duration_seconds",
                "Duration of a full controller decision cycle",
            )
            .buckets(cycle_buckets),
        )
        .expect("metric name conflict: repath_controller_cycle_duration_seconds");

        let last_cycle_timestamp = Gauge::with_opts(Opts::new(
            "repath_controller_last_cycle_timestamp",
            "Unix timestamp of the last successful controller cycle (liveness signal)",
        ))
        .expect("metric name conflict: repath_controller_last_cycle_timestamp");

        let decisions_total = CounterVec::new(
            Opts::new(
                "repath_controller_decisions_total",
                "Total controller decisions by action label",
            ),
            &["action"],
        )
        .expect("metric name conflict: repath_controller_decisions_total");

        let active_rollouts = Gauge::with_opts(Opts::new(
            "repath_controller_active_rollouts",
            "Number of active rollouts processed in the most recent cycle",
        ))
        .expect("metric name conflict: repath_controller_active_rollouts");

        let cycles_total = Counter::with_opts(Opts::new(
            "repath_controller_cycles_total",
            "Total number of controller cycles attempted",
        ))
        .expect("metric name conflict: repath_controller_cycles_total");

        let cycle_errors_total = Counter::with_opts(Opts::new(
            "repath_controller_cycle_errors_total",
            "Total number of controller cycles that ended in an error",
        ))
        .expect("metric name conflict: repath_controller_cycle_errors_total");

        // Register every metric. .expect() is intentional: a collision is a
        // programming error that must crash startup, not be silently ignored.
        registry
            .register(Box::new(cycle_duration_seconds.clone()))
            .expect("failed to register cycle_duration_seconds");
        registry
            .register(Box::new(last_cycle_timestamp.clone()))
            .expect("failed to register last_cycle_timestamp");
        registry
            .register(Box::new(decisions_total.clone()))
            .expect("failed to register decisions_total");
        registry
            .register(Box::new(active_rollouts.clone()))
            .expect("failed to register active_rollouts");
        registry
            .register(Box::new(cycles_total.clone()))
            .expect("failed to register cycles_total");
        registry
            .register(Box::new(cycle_errors_total.clone()))
            .expect("failed to register cycle_errors_total");

        Self {
            registry,
            cycle_duration_seconds,
            last_cycle_timestamp,
            decisions_total,
            active_rollouts,
            cycles_total,
            cycle_errors_total,
        }
    }
}

/// Serve Prometheus metrics and a health endpoint on a dedicated port.
///
/// Runs as a separate HTTP server so the metrics port can be firewalled
/// from public traffic while keeping the health check reachable by the
/// platform (Fly.io).
///
/// ```text
/// GET /metrics  → Prometheus text format
/// GET /health   → {"status":"ok"}
/// ```
pub async fn serve_metrics(port: u16, metrics: Arc<ControllerMetrics>) -> Result<()> {
    let addr = format!("0.0.0.0:{}", port);

    // Clone the Arc once for the scrape handler closure.
    let metrics_for_scrape = metrics.clone();

    let app = Router::new()
        .route(
            "/metrics",
            get(move || {
                let registry = metrics_for_scrape.registry.clone();
                async move {
                    let mf = registry.gather();
                    let mut buf = Vec::with_capacity(4096);
                    TextEncoder::new().encode(&mf, &mut buf).unwrap_or_default();
                    (
                        [(
                            axum::http::header::CONTENT_TYPE,
                            "text/plain; version=0.0.4",
                        )],
                        buf,
                    )
                }
            }),
        )
        .route("/health", get(|| async { Json(json!({"status": "ok"})) }));

    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .map_err(|e| Error::Internal {
            message: format!("Failed to bind metrics server to {}", addr),
            source: Some(e.into()),
        })?;

    info!(addr = %addr, "Controller metrics server listening");

    axum::serve(listener, app)
        .await
        .map_err(|e| Error::Internal {
            message: "Controller metrics server error".to_string(),
            source: Some(e.into()),
        })?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metrics_creation_does_not_panic() {
        let m = ControllerMetrics::new();
        m.cycles_total.inc();
        m.cycle_errors_total.inc();
        m.active_rollouts.set(3.0);
        m.last_cycle_timestamp.set(1_700_000_000.0);
        m.cycle_duration_seconds.observe(0.05);
        m.decisions_total.with_label_values(&["advance"]).inc();
        m.decisions_total.with_label_values(&["rollback"]).inc();
        m.decisions_total.with_label_values(&["promote"]).inc();
        m.decisions_total.with_label_values(&["hold"]).inc();
        m.decisions_total
            .with_label_values(&["already_acted_on"])
            .inc();

        assert!(m.cycles_total.get() > 0.0);
    }

    #[test]
    fn registry_gathers_all_families() {
        let m = ControllerMetrics::new();
        m.cycles_total.inc_by(5.0);
        // CounterVec only emits a family once at least one label set has been used.
        m.decisions_total.with_label_values(&["hold"]).inc();
        let mf = m.registry.gather();
        // Six metric families registered.
        assert_eq!(mf.len(), 6, "expected 6 metric families, got {}", mf.len());
    }

    #[test]
    fn cycle_duration_histogram_buckets_cover_expected_range() {
        let m = ControllerMetrics::new();
        m.cycle_duration_seconds.observe(0.03);
        m.cycle_duration_seconds.observe(2.5);

        let mf = m.registry.gather();
        let family = mf
            .iter()
            .find(|f| f.get_name() == "repath_controller_cycle_duration_seconds")
            .expect("cycle_duration_seconds should be registered");

        assert_eq!(family.get_metric()[0].get_histogram().get_sample_count(), 2);
    }
}
