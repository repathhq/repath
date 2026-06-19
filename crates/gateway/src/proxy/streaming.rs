//! SSE streaming passthrough with concurrent response accumulation.
//!
//! # The core problem
//!
//! OpenAI streaming responses use Server-Sent Events (SSE). Each chunk looks like:
//!
//! ```text
//! data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"Hello"}}]}\n\n
//! data: [DONE]\n\n
//! ```
//!
//! We need to:
//! 1. Forward each chunk to the client **immediately** (zero buffering)
//! 2. Accumulate the full response text for evaluation
//! 3. Capture token usage (sent in the final chunk or a separate usage event)
//!
//! # Solution: stream tee with a background accumulator
//!
//! ```text
//!   upstream SSE bytes
//!          │
//!          ▼
//!   ┌──────────────┐
//!   │  tee_stream  │──── bytes ──▶  client (zero-copy forwarding)
//!   └──────────────┘
//!          │
//!          │  decoded chunks (channel)
//!          ▼
//!   ┌──────────────────┐
//!   │  chunk_collector │  builds full response, extracts token counts
//!   └──────────────────┘
//!          │
//!          ▼
//!     StreamResult { text, input_tokens, output_tokens }
//! ```
//!
//! The client sees the first token as soon as the upstream sends it.
//! The accumulator finishes ~concurrently, and we await it only after
//! the stream is fully forwarded.
//!
//! # Why not Arc<Mutex<String>> for accumulation?
//!
//! The naive approach: spawn a background task that appends to a
//! `Arc<Mutex<String>>`. But:
//! - The hot path (forwarding bytes) must lock the Mutex on every chunk
//! - Mutex contention between the forwarder and the accumulator
//! - Worse: the Mutex must be held across the async SSE write, which
//!   means other tasks are blocked while we await I/O
//!
//! The correct approach: a channel. The forwarder sends decoded text onto
//! a `mpsc::channel`. The accumulator owns the `String` exclusively —
//! no sharing, no locks.

use bytes::Bytes;
use futures::Stream;
use repath_common::Result;
use serde::Deserialize;
use tokio::sync::mpsc;
use tracing::{debug, warn};

/// Result of a completed streaming response.
#[derive(Debug)]
pub struct StreamResult {
    /// Full concatenated assistant text
    pub response_text: String,
    /// Prompt tokens (from usage field in final chunk)
    pub input_tokens: Option<u32>,
    /// Completion tokens
    pub output_tokens: Option<u32>,
}

/// Partial structure for parsing SSE data chunks.
///
/// We only deserialise the fields we need. Extra fields are silently ignored.
#[derive(Debug, Deserialize)]
struct SseDelta {
    choices: Option<Vec<SseChoice>>,
    usage: Option<SseUsage>,
}

#[derive(Debug, Deserialize)]
struct SseChoice {
    delta: SseDeltaContent,
}

#[derive(Debug, Deserialize)]
struct SseDeltaContent {
    content: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SseUsage {
    prompt_tokens: Option<u32>,
    completion_tokens: Option<u32>,
}

/// Accumulate an SSE stream while forwarding raw bytes to the client.
///
/// # Arguments
///
/// * `upstream_stream` - Raw byte stream from the upstream (OpenAI etc.)
/// * `byte_tx`         - Sender to the Axum body stream (forwarding to client)
///
/// # Returns
///
/// A `StreamResult` with the full accumulated text and token counts,
/// available after the stream ends.
///
/// # Cancellation safety
///
/// If the client disconnects mid-stream, `byte_tx` will return `Err(SendError)`
/// on the next send. We stop forwarding and return whatever we've accumulated
/// so far. Token counts may be partial if usage wasn't in the chunks sent.
pub async fn accumulate_and_forward(
    upstream_stream: impl Stream<Item = reqwest::Result<Bytes>>,
    byte_tx: mpsc::Sender<Result<Bytes>>,
) -> StreamResult {
    // Channel for decoded chunk text. Bounded to a small buffer — the
    // accumulator reads as fast as the forwarder writes.
    let (text_tx, mut text_rx) = mpsc::channel::<Option<(String, Option<SseUsage>)>>(32);

    // Spawn the accumulator. It owns text_rx exclusively — no Arc, no Mutex.
    let accumulator_handle = tokio::spawn(async move {
        let mut full_text = String::with_capacity(512);
        let mut input_tokens: Option<u32> = None;
        let mut output_tokens: Option<u32> = None;

        while let Some(msg) = text_rx.recv().await {
            match msg {
                Some((text, usage)) => {
                    full_text.push_str(&text);
                    if let Some(u) = usage {
                        input_tokens = u.prompt_tokens.or(input_tokens);
                        output_tokens = u.completion_tokens.or(output_tokens);
                    }
                }
                None => break, // Stream done sentinel
            }
        }

        StreamResult {
            response_text: full_text,
            input_tokens,
            output_tokens,
        }
    });

    // Forward raw bytes to client and send decoded text to accumulator
    use futures::StreamExt;
    tokio::pin!(upstream_stream);

    while let Some(chunk_result) = upstream_stream.next().await {
        match chunk_result {
            Ok(bytes) => {
                // Forward raw bytes to the client immediately
                if byte_tx.send(Ok(bytes.clone())).await.is_err() {
                    // Client disconnected — stop forwarding but let accumulator finish
                    debug!("Client disconnected mid-stream, stopping forward");
                    break;
                }

                // Parse SSE lines for accumulation (best-effort, non-blocking)
                if let Ok(text) = std::str::from_utf8(&bytes) {
                    for line in text.lines() {
                        let line = line.trim();
                        if !line.starts_with("data:") {
                            continue;
                        }
                        let data = line["data:".len()..].trim();
                        if data == "[DONE]" {
                            break;
                        }
                        match serde_json::from_str::<SseDelta>(data) {
                            Ok(delta) => {
                                let content = delta
                                    .choices
                                    .as_ref()
                                    .and_then(|cs| cs.first())
                                    .and_then(|c| c.delta.content.clone())
                                    .unwrap_or_default();

                                let usage = delta.usage;

                                if !content.is_empty() || usage.is_some() {
                                    // Non-blocking send — if accumulator is behind, skip
                                    // rather than blocking the forward path
                                    let _ = text_tx.try_send(Some((content, usage)));
                                }
                            }
                            Err(e) => {
                                // Unparseable chunk — not unusual for keep-alive
                                // comments or new fields added by the provider
                                debug!(
                                    chunk = data,
                                    error = %e,
                                    "Skipping unparseable SSE chunk"
                                );
                            }
                        }
                    }
                }
            }
            Err(e) => {
                // Upstream error mid-stream — forward error to client and stop
                warn!(error = %e, "Upstream error during streaming response");
                let _ = byte_tx
                    .send(Err(repath_common::Error::Network {
                        context: "Upstream error during stream".to_string(),
                        source: e.into(),
                    }))
                    .await;
                break;
            }
        }
    }

    // Signal accumulator that the stream is done
    drop(text_tx);

    // Collect the accumulated result
    accumulator_handle.await.unwrap_or_else(|_| StreamResult {
        response_text: String::new(),
        input_tokens: None,
        output_tokens: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_accumulate_simple_stream() {
        let chunks: Vec<reqwest::Result<Bytes>> = vec![
            Ok(Bytes::from(
                r#"data: {"choices":[{"delta":{"content":"Hello"}}]}"#,
            )),
            Ok(Bytes::from(
                r#"data: {"choices":[{"delta":{"content":" world"}}]}"#,
            )),
            Ok(Bytes::from("data: [DONE]")),
        ];

        let stream = futures::stream::iter(chunks);
        let (tx, mut rx) = mpsc::channel(10);

        let result = accumulate_and_forward(stream, tx).await;

        // Drain channel (client receives bytes)
        while rx.try_recv().is_ok() {}

        assert_eq!(result.response_text, "Hello world");
    }

    #[tokio::test]
    async fn test_accumulate_with_usage() {
        let chunks: Vec<reqwest::Result<Bytes>> = vec![
            Ok(Bytes::from(
                r#"data: {"choices":[{"delta":{"content":"Hi"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}"#,
            )),
            Ok(Bytes::from("data: [DONE]")),
        ];

        let stream = futures::stream::iter(chunks);
        let (tx, _rx) = mpsc::channel(10);

        let result = accumulate_and_forward(stream, tx).await;

        assert_eq!(result.input_tokens, Some(10));
        assert_eq!(result.output_tokens, Some(5));
    }
}
