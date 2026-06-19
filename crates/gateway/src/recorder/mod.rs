//! Asynchronous request recorder and evaluation queue publisher.
//!
//! # Design rationale
//!
//! Writing a DB row and publishing to Redis on every proxied request cannot
//! happen synchronously in the request handler — it would add the round-trip
//! latency of both I/O operations to every user-visible response.
//!
//! Instead we use a classic producer/consumer pattern:
//!
//! ```text
//! Request handler  ──mpsc::Sender──▶  Background recorder task
//!  (O(1), async)      (bounded)         (batches DB writes, pushes Redis)
//! ```
//!
//! The channel is bounded at `CHANNEL_CAPACITY` items. If the recorder falls
//! behind (slow DB, network hiccup), the channel fills and `try_send` returns
//! `TrySendError::Full` — we log a metric and discard the record. The user
//! request is **never** delayed. This is the correct trade-off: losing a small
//! number of observability events is acceptable; adding latency to production
//! traffic is not.
//!
//! # Shutdown sequence
//!
//! When the last `Sender` is dropped (happens in `main.rs` during shutdown),
//! the channel closes and the `run_recorder` loop exits its `recv()` loop
//! naturally. The task then flushes any remaining records and returns.

pub mod eval_queue;
pub mod request_logger;

use repath_common::{Error, Result};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Maximum number of record requests buffered in the channel.
///
/// At 50K req/s this is ~20ms of buffer. Sized to absorb normal DB jitter
/// without growing unboundedly. If this fills consistently, it indicates the
/// recorder worker is a bottleneck and needs batching or more workers.
const CHANNEL_CAPACITY: usize = 1024;

/// Data the handler passes to the recorder for a completed request.
///
/// All fields are captured after the upstream response is fully received.
/// Strings are owned (not borrowed) so the handler can return to the caller
/// immediately after the channel send.
#[derive(Debug)]
pub struct RecordRequest {
    pub request_id: Uuid,
    pub rollout_id: Option<Uuid>,
    pub version_id: Uuid,
    pub model: String,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub latency_ms: u32,
    pub status_code: u16,
    pub error: Option<String>,
    pub session_id: Option<String>,
    /// Full response text (captured from the tee'd stream).
    /// Used by the eval queue publisher — not stored in `requests` table.
    pub response_text: String,
    /// Original user messages, serialised as JSON.
    pub request_body_json: String,
}

/// Create a Redis `ConnectionManager` — a single multiplexed async connection
/// with automatic reconnection on failure.
///
/// # Why ConnectionManager instead of Client?
///
/// `redis::Client` is just a factory for new connections. If the handler called
/// `client.get_multiplexed_async_connection()` on every request, it would open
/// a new TCP connection each time (or pull from an unmanaged pool). That means:
/// - TCP handshake overhead per request
/// - No automatic reconnection on network blips
///
/// `ConnectionManager` maintains one persistent connection that multiplexes all
/// commands. It reconnects transparently on failure and exposes a `Clone`-able
/// handle backed by an internal Arc.
pub async fn create_redis_connection(url: &str) -> Result<redis::aio::ConnectionManager> {
    let client = redis::Client::open(url).map_err(|e| Error::Internal {
        message: "Invalid Redis URL".to_string(),
        source: Some(e.into()),
    })?;

    let manager = redis::aio::ConnectionManager::new(client)
        .await
        .map_err(|e| Error::Internal {
            message: "Failed to establish Redis connection".to_string(),
            source: Some(e.into()),
        })?;

    // Ping to verify the connection is live
    let mut conn = manager.clone();
    redis::cmd("PING")
        .query_async::<String>(&mut conn)
        .await
        .map_err(|e| Error::Internal {
            message: "Redis PING failed — server may be down".to_string(),
            source: Some(e.into()),
        })?;

    info!("Redis connection verified");

    Ok(manager)
}

/// Run the background recorder task.
///
/// Receives `RecordRequest` messages from the bounded channel, writes to
/// PostgreSQL, and publishes to the Redis eval stream.
///
/// Returns when the channel is closed (all `Sender` handles have been dropped),
/// which happens during graceful shutdown after `main` drops `AppState`.
pub async fn run_recorder(
    mut rx: mpsc::Receiver<RecordRequest>,
    pool: PgPool,
    mut redis: redis::aio::ConnectionManager,
) {
    info!(channel_capacity = CHANNEL_CAPACITY, "Recorder task started");

    let mut records_written: u64 = 0;
    let mut records_discarded: u64 = 0;

    while let Some(record) = rx.recv().await {
        // Write to PostgreSQL
        match request_logger::insert_request(&pool, &record).await {
            Ok(()) => {
                records_written += 1;
                debug!(
                    request_id = %record.request_id,
                    "Request logged to database"
                );
            }
            Err(e) => {
                records_discarded += 1;
                error!(
                    request_id = %record.request_id,
                    error = %e,
                    "Failed to log request to database"
                );
            }
        }

        // Publish to Redis eval stream (only if we have a rollout context)
        if record.rollout_id.is_some() {
            match eval_queue::publish_eval_job(&mut redis, &record).await {
                Ok(()) => {
                    debug!(
                        request_id = %record.request_id,
                        "Evaluation job published to Redis"
                    );
                }
                Err(e) => {
                    // Non-fatal: evaluation is best-effort. Missing an eval job
                    // means the controller has less data, but the request was
                    // already served correctly.
                    warn!(
                        request_id = %record.request_id,
                        error = %e,
                        "Failed to publish evaluation job — eval data will be missing"
                    );
                }
            }
        }
    }

    // Channel closed — we are in graceful shutdown.
    info!(
        records_written,
        records_discarded,
        "Recorder task draining and exiting"
    );
}
