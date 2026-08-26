//! Repath Gateway binary.
//!
//! Thin wrapper around the `repath_gateway` library: wire up tracing,
//! build the application state, and serve until shutdown. All logic lives
//! in the library so it can be tested directly.

use repath_common::{Error, Result};
use repath_gateway::{
    circuit_breaker, config, db, observability, proxy, recorder, router, server, tenant, AppState,
};
use std::sync::Arc;
use tokio::signal;
use tracing::{error, info};

use repath_gateway::observability::init_tracing;

#[tokio::main]
async fn main() -> Result<()> {
    // Initialize tracing subscriber (structured JSON logging in production)
    init_tracing();

    // Print startup banner
    print_banner();

    // Load configuration from file and environment
    let config = config::load_config().map_err(|e| {
        error!("Failed to load configuration: {}", e);
        e
    })?;

    info!(
        host = %config.server.host,
        port = config.server.port,
        "Configuration loaded"
    );

    // Validate configuration
    config.validate().map_err(|e| {
        error!("Configuration validation failed: {}", e);
        e
    })?;

    // Initialize database connection pool
    let db_pool = db::create_pool(&config.database).await.map_err(|e| {
        error!("Failed to create database pool: {}", e);
        e
    })?;

    info!(
        url = %config.database.url.split('@').next_back().unwrap_or("***"),
        max_connections = config.database.max_connections,
        "Database pool created"
    );

    // Verify database connectivity
    db::verify_connection(&db_pool).await.map_err(|e| {
        error!("Database connection verification failed: {}", e);
        e
    })?;

    info!("Database connection verified");

    // Bring the schema up to date before anything reads or writes it.
    // Aborts startup on failure — see db::migrate for why.
    db::run_migrations(&db_pool).await.map_err(|e| {
        error!("Database migration failed: {}", e);
        e
    })?;

    // Initialize Redis connection manager.
    //
    // ConnectionManager (not raw Client) gives us:
    // - A single multiplexed connection (pipelining, no per-request alloc)
    // - Automatic reconnection on network failures
    // - Clone() is O(1) (internal Arc)
    let redis = recorder::create_redis_connection(&config.redis.url)
        .await
        .map_err(|e| {
            error!("Failed to connect to Redis: {}", e);
            e
        })?;

    info!(url = %config.redis.url, "Redis connection established");

    // Initialize HTTP client with connection pooling
    let http_client = proxy::create_http_client(&config).map_err(|e| {
        error!("Failed to create HTTP client: {}", e);
        e
    })?;

    info!("HTTP client initialized with connection pooling");

    // Initialize metrics registry
    let metrics = Arc::new(observability::Metrics::new());

    info!("Metrics registry initialized");

    // Spawn background recorder task.
    //
    // The bounded channel (1024 slots) provides back-pressure: if the DB is
    // slow and the recorder falls behind, the channel fills and senders get
    // Err(Full) which we log and discard. The request itself is never delayed.
    // Capacity of 1024 at 50K req/s gives ~20ms of buffer before back-pressure
    // kicks in — sufficient for any normal DB hiccup.
    let (record_tx, record_rx) = tokio::sync::mpsc::channel(1024);
    let recorder_handle = tokio::spawn(recorder::run_recorder(
        record_rx,
        db_pool.clone(),
        redis.clone(),
    ));

    // Initialize rollout cache (empty on startup; populated by first DB query)
    let rollout_cache = Arc::new(arc_swap::ArcSwap::from_pointee(
        router::RolloutCache::empty(),
    ));

    // Initialize tenant cache and spawn its refresher.
    let tenant_cache = Arc::new(arc_swap::ArcSwap::from_pointee(tenant::TenantCache::empty()));
    let tenant_refresh_handle = tokio::spawn(tenant::run_tenant_cache_refresher(
        db_pool.clone(),
        tenant_cache.clone(),
    ));

    // Spawn background rollout cache refresher.
    // Polls the DB every 5 seconds and swaps the cache atomically.
    // This decouples every request handler from direct DB reads for routing.
    let cache_refresh_handle = tokio::spawn(router::run_cache_refresher(
        db_pool.clone(),
        rollout_cache.clone(),
    ));

    // Build application state
    let state = AppState {
        db_pool: db_pool.clone(),
        redis,
        http_client,
        config: Arc::new(config.clone()),
        metrics: metrics.clone(),
        record_tx,
        rollout_cache,
        circuit_breaker: circuit_breaker::CircuitBreakerRegistry::new(),
        provider_health: proxy::failover::ProviderHealthRegistry::new(),
        tenant_cache,
    };

    // Create Axum server
    let app = server::create_server(state.clone());

    // Bind to address
    let addr = format!("{}:{}", config.server.host, config.server.port);
    let listener = tokio::net::TcpListener::bind(&addr).await.map_err(|e| {
        error!("Failed to bind to {}: {}", addr, e);
        Error::Internal {
            message: format!("Failed to bind to address: {}", addr),
            source: Some(e.into()),
        }
    })?;

    info!(
        addr = %addr,
        "Gateway listening"
    );

    // Start metrics server on separate port
    let metrics_handle = tokio::spawn(observability::serve_metrics(
        config.server.metrics_port,
        metrics,
    ));

    info!(
        port = config.server.metrics_port,
        "Metrics server listening"
    );

    // Graceful shutdown signal handler
    let shutdown_signal = async {
        let ctrl_c = async {
            signal::ctrl_c()
                .await
                .expect("Failed to install Ctrl+C handler");
        };

        #[cfg(unix)]
        let terminate = async {
            signal::unix::signal(signal::unix::SignalKind::terminate())
                .expect("Failed to install SIGTERM handler")
                .recv()
                .await;
        };

        #[cfg(not(unix))]
        let terminate = std::future::pending::<()>();

        tokio::select! {
            _ = ctrl_c => {
                info!("Received Ctrl+C signal");
            }
            _ = terminate => {
                info!("Received SIGTERM signal");
            }
        }
    };

    // Serve with graceful shutdown
    info!("🚀 Repath Gateway started successfully");
    info!("API endpoint: http://{}", addr);
    info!(
        "Metrics endpoint: http://{}:{}/metrics",
        config.server.host, config.server.metrics_port
    );

    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await
        .map_err(|e| {
            error!("Server error: {}", e);
            Error::Internal {
                message: "Server crashed".to_string(),
                source: Some(e.into()),
            }
        })?;

    // ── Graceful shutdown sequence ────────────────────────────────────────────
    //
    // Order matters:
    // 1. Stop the cache refresher first (no more DB reads for routing)
    // 2. Drop record_tx — this signals the recorder to drain and exit
    // 3. Wait for recorder to finish writing in-flight records to DB
    // 4. Close DB pool (all writes are done at this point)
    // 5. Abort metrics server (stateless, safe to kill)
    //
    // If we closed the DB pool before the recorder drained, in-flight request
    // records would be lost. This sequence prevents that.
    info!("Initiating graceful shutdown...");

    cache_refresh_handle.abort();
    tenant_refresh_handle.abort();
    info!("Rollout cache refresher stopped");

    // Drop the sender to signal the recorder channel is closed
    drop(state); // drops record_tx inside AppState

    // Give recorder up to 5 seconds to drain its in-flight queue
    match tokio::time::timeout(std::time::Duration::from_secs(5), recorder_handle).await {
        Ok(Ok(())) => info!("Recorder drained and exited cleanly"),
        Ok(Err(e)) => error!("Recorder task panicked: {}", e),
        Err(_) => error!("Recorder did not drain within 5s — some records may be lost"),
    }

    metrics_handle.abort();

    db_pool.close().await;
    info!("Database pool closed");

    info!("✓ Shutdown complete");

    Ok(())
}

/// Print startup banner to stdout
fn print_banner() {
    println!(
        r#"
    ____                  __  __
   / __ \___  ____  ____ _/ /_/ /_
  / /_/ / _ \/ __ \/ __ `/ __/ __ \
 / _, _/  __/ /_/ / /_/ / /_/ / / /
/_/ |_|\___/ .___/\__,_/\__/_/ /_/
          /_/

Progressive Delivery for AI Models
Version: {}
"#,
        env!("CARGO_PKG_VERSION")
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_banner_prints() {
        // Smoke test - just verify the function doesn't panic
        print_banner();
    }
}
// force rebuild Fri Jun 19 22:12:31 IST 2026
// rebuild 1781887636
// rebuild 1781887842
// rebuild 1781888160
// rebuild 1781928954
