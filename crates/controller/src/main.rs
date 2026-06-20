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
//! - `REPATH_DATABASE_URL`               — PostgreSQL connection string (required)
//! - `REPATH_CONTROLLER_INTERVAL_SECS`   — Decision loop interval (default: 30)
//! - `REPATH_CONTROLLER_WINDOW_MINUTES`  — Metric aggregation window (default: 10)
//! - `RUST_LOG`                           — Log level filter (default: info)

use repath_controller::loop_runner::{run, ControllerConfig};
use sqlx::postgres::PgPoolOptions;
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

    info!(
        decision_interval_secs,
        metric_window_minutes, "Starting Repath Controller"
    );

    // Create database pool — controller only needs a small pool (1-2 conns)
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(Duration::from_secs(5))
        .connect(&db_url)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to connect to database: {}", e))?;

    info!("Database connection established");

    let config = ControllerConfig {
        decision_interval_secs,
        confidence_level: 0.95,
        metric_window_minutes,
    };

    // Run the decision loop — returns only on task abort (shutdown)
    run(pool, config).await;

    Ok(())
}
