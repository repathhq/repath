//! Repath Controller binary.
//!
//! Runs the rollout decision loop as a standalone process.
//!
//! # Usage
//!
//! ```bash
//! REPATH_DATABASE_URL=postgres://... repath-controller
//! ```
//!
//! # Configuration (environment variables)
//!
//! - `REPATH_DATABASE_URL`                 — PostgreSQL connection string (required)
//! - `REPATH_CONTROLLER_INTERVAL_SECS`     — Decision loop interval (default: 30)
//! - `REPATH_CONTROLLER_WINDOW_MINUTES`    — Metric aggregation window (default: 10)
//! - `REPATH_CONTROLLER_METRICS_PORT`      — Prometheus metrics server port (default: 9091)
//! - `RUST_LOG`                             — Log level filter (default: info)

use repath_controller::{
    loop_runner::{run, ControllerConfig},
    metrics::{serve_metrics, ControllerMetrics},
};
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;
use tracing::info;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialise structured logging
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,repath_controller=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer().with_target(true))
        .init();

    // Load required configuration from environment
    let db_url = std::env::var("REPATH_DATABASE_URL")
        .map_err(|_| anyhow::anyhow!("REPATH_DATABASE_URL must be set"))?;

    let decision_interval_secs = std::env::var("REPATH_CONTROLLER_INTERVAL_SECS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(30u64);

    let metric_window_minutes = std::env::var("REPATH_CONTROLLER_WINDOW_MINUTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(10i32);

    let metrics_port = std::env::var("REPATH_CONTROLLER_METRICS_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(9091u16);

    info!(
        decision_interval_secs,
        metric_window_minutes,
        metrics_port,
        "Starting Repath Controller"
    );

    // Create database pool — controller only needs a small pool (1-2 conns)
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&db_url)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to connect to database: {}", e))?;

    info!("Database connection established");

    // Initialise metrics and start the metrics HTTP server in the background.
    // The server runs for the lifetime of the process — we intentionally do not
    // await its handle so a metrics server failure does not crash the controller.
    let metrics = Arc::new(ControllerMetrics::new());

    let metrics_for_server = metrics.clone();
    tokio::spawn(async move {
        if let Err(e) = serve_metrics(metrics_port, metrics_for_server).await {
            // Log the error but do not panic — the controller can still run
            // without metrics; losing observability is preferable to crashing.
            tracing::error!(error = %e, port = metrics_port, "Metrics server failed");
        }
    });

    let config = ControllerConfig {
        decision_interval_secs,
        confidence_level: 0.95,
        metric_window_minutes,
        metrics,
    };

    // Run the decision loop — returns only on task abort (shutdown)
    run(pool, config).await;

    Ok(())
}
