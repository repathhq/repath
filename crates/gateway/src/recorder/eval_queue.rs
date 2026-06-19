//! Redis Streams publisher for evaluation jobs.
//!
//! After each proxied request, the recorder pushes a message to the
//! `repath:evaluations` Redis Stream. The Python evaluation workers
//! (Consumer Group) read from this stream and score the response.
//!
//! # Stream format (XADD fields)
//!
//! ```text
//! request_id      UUID string
//! rollout_id      UUID string
//! version_id      UUID string
//! request_body    JSON string  (original user messages)
//! response_text   string       (full assistant reply)
//! model           string
//! latency_ms      u32 as string
//! ```
//!
//! We use Redis Streams (not Pub/Sub) because:
//! - Messages persist even if no consumer is running
//! - Consumer Groups allow multiple worker instances without duplicate eval
//! - XADD is O(1) and non-blocking from the publisher's perspective

use super::RecordRequest;
use repath_common::{Error, Result};

/// Name of the Redis Stream for evaluation jobs.
pub const EVAL_STREAM: &str = "repath:evaluations";

/// Maximum number of entries to keep in the stream before auto-trimming.
/// At 1000 evals/min this retains ~17 hours of history.
const STREAM_MAX_LEN: usize = 1_000_000;

/// Publish an evaluation job to the Redis Stream.
///
/// Uses `XADD repath:evaluations MAXLEN ~ <MAX_LEN> * <fields>`.
/// The `~` (approximate trimming) is intentional — it lets Redis batch
/// the trim for performance instead of enforcing exact length on every write.
pub async fn publish_eval_job(
    redis: &mut redis::aio::ConnectionManager,
    record: &RecordRequest,
) -> Result<()> {
    let rollout_id = match record.rollout_id {
        Some(id) => id.to_string(),
        None => return Ok(()), // No rollout context — nothing to evaluate
    };

    redis::cmd("XADD")
        .arg(EVAL_STREAM)
        .arg("MAXLEN")
        .arg("~")
        .arg(STREAM_MAX_LEN)
        .arg("*") // Auto-generate stream entry ID
        .arg("request_id")
        .arg(record.request_id.to_string())
        .arg("rollout_id")
        .arg(rollout_id)
        .arg("version_id")
        .arg(record.version_id.to_string())
        .arg("request_body")
        .arg(&record.request_body_json)
        .arg("response_text")
        .arg(&record.response_text)
        .arg("model")
        .arg(&record.model)
        .arg("latency_ms")
        .arg(record.latency_ms.to_string())
        .query_async::<String>(redis)
        .await
        .map_err(|e| Error::Internal {
            message: "Failed to publish eval job to Redis Stream".to_string(),
            source: Some(e.into()),
        })?;

    Ok(())
}
