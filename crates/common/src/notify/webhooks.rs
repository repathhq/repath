//! Webhook and Slack delivery.
//!
//! # Signing
//!
//! Every webhook carries `X-Repath-Signature: sha256=<hex>`, an HMAC-SHA256 of
//! the exact request body under the tenant's webhook secret. Without a
//! signature a receiver has no way to know a POST claiming a production
//! rollback actually came from us — anyone who learns the URL could forge one.
//!
//! `X-Repath-Timestamp` is included and signed so a captured payload cannot be
//! replayed indefinitely; receivers should reject timestamps far from now.
//!
//! # Retries
//!
//! Three attempts with exponential backoff. 5xx and network errors are retried;
//! 4xx is not, because a rejected payload will be rejected again and retrying
//! only hammers an endpoint that has already given its answer.

use super::EventKind;
use ring::hmac;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::{PgPool, Row};
use std::time::Duration;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Attempts per delivery, including the first.
const MAX_ATTEMPTS: u32 = 3;

/// Base backoff; doubles each retry (1s, 2s).
const BACKOFF_BASE: Duration = Duration::from_secs(1);

/// Per-attempt timeout. Generous enough for a slow endpoint, short enough that
/// three attempts cannot pile up for minutes.
const DELIVERY_TIMEOUT: Duration = Duration::from_secs(10);

/// An event worth telling someone about.
#[derive(Debug, Clone)]
pub struct Event {
    pub kind: EventKind,
    pub tenant_id: String,
    pub rollout_id: Option<Uuid>,
    pub rollout_name: String,
    pub detail: String,
    /// Extra structured context, merged into the payload.
    pub context: Value,
}

/// The JSON body delivered to a webhook.
#[derive(Debug, Serialize, Deserialize)]
pub struct EventPayload {
    pub event: String,
    pub rollout_id: Option<Uuid>,
    pub rollout_name: String,
    pub detail: String,
    pub context: Value,
    pub timestamp: String,
}

impl Event {
    fn payload(&self) -> EventPayload {
        EventPayload {
            event: self.kind.as_str().to_string(),
            rollout_id: self.rollout_id,
            rollout_name: self.rollout_name.clone(),
            detail: self.detail.clone(),
            context: self.context.clone(),
            timestamp: chrono::Utc::now().to_rfc3339(),
        }
    }
}

/// HMAC-SHA256 of `timestamp.body`, hex-encoded.
///
/// The timestamp is inside the signed material rather than only a header, so it
/// cannot be altered without invalidating the signature.
pub fn sign(secret: &str, timestamp: &str, body: &str) -> String {
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let signed = hmac::sign(&key, format!("{timestamp}.{body}").as_bytes());

    use std::fmt::Write;
    let mut hex = String::with_capacity(64);
    for b in signed.as_ref() {
        let _ = write!(hex, "{b:02x}");
    }
    hex
}

/// Fan an event out to every channel the tenant has enabled.
///
/// Detached: the caller — a controller decision or a proxy failover — must
/// never wait on, or fail because of, someone else's HTTP endpoint.
pub fn dispatch_event(pool: PgPool, http: reqwest::Client, event: Event) {
    tokio::spawn(async move {
        if let Err(e) = deliver_webhooks(&pool, &http, &event).await {
            warn!(error = %e, event = event.kind.as_str(), "Webhook dispatch failed");
        }
        if let Err(e) = deliver_slack(&pool, &http, &event).await {
            warn!(error = %e, event = event.kind.as_str(), "Slack dispatch failed");
        }
    });
}

async fn deliver_webhooks(
    pool: &PgPool,
    http: &reqwest::Client,
    event: &Event,
) -> Result<(), sqlx::Error> {
    // `= ANY(events)` lets Postgres do the subscription filter rather than
    // pulling every webhook back and filtering in Rust.
    let hooks = sqlx::query(
        "SELECT id, url, secret_sealed FROM webhooks
          WHERE tenant_id = $1 AND enabled = TRUE AND $2 = ANY(events)",
    )
    .bind(&event.tenant_id)
    .bind(event.kind.as_str())
    .fetch_all(pool)
    .await?;

    if hooks.is_empty() {
        return Ok(());
    }

    let payload = event.payload();
    let body = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".into());

    for hook in hooks {
        let id: Uuid = hook.get("id");
        let url: String = hook.get("url");
        let sealed: String = hook.get("secret_sealed");

        let Ok(secret) = crate::crypto::decrypt(&sealed) else {
            warn!(webhook = %id, "Could not decrypt webhook secret — skipping");
            continue;
        };

        deliver_one(pool, http, id, &url, &secret, event.kind, &body).await;
    }

    Ok(())
}

async fn deliver_one(
    pool: &PgPool,
    http: &reqwest::Client,
    webhook_id: Uuid,
    url: &str,
    secret: &str,
    kind: EventKind,
    body: &str,
) {
    let timestamp = chrono::Utc::now().timestamp().to_string();
    let signature = sign(secret, &timestamp, body);

    let mut attempts = 0u32;
    let mut last_status: Option<i32> = None;
    let mut last_error: Option<String> = None;

    while attempts < MAX_ATTEMPTS {
        attempts += 1;

        let result = http
            .post(url)
            .header("Content-Type", "application/json")
            .header("X-Repath-Event", kind.as_str())
            .header("X-Repath-Timestamp", &timestamp)
            .header("X-Repath-Signature", format!("sha256={signature}"))
            .timeout(DELIVERY_TIMEOUT)
            .body(body.to_string())
            .send()
            .await;

        match result {
            Ok(res) => {
                let status = res.status();
                last_status = Some(status.as_u16() as i32);

                if status.is_success() {
                    debug!(webhook = %webhook_id, attempts, "Webhook delivered");
                    record_delivery(
                        pool,
                        webhook_id,
                        kind,
                        body,
                        last_status,
                        None,
                        attempts,
                        true,
                    )
                    .await;
                    return;
                }

                // A 4xx is the endpoint's considered answer: the payload is
                // wrong, or auth failed. Retrying cannot change that.
                if status.is_client_error() {
                    last_error = Some(format!("endpoint rejected the payload ({status})"));
                    break;
                }

                last_error = Some(format!("endpoint returned {status}"));
            }
            Err(e) => {
                last_error = Some(if e.is_timeout() {
                    format!("no response within {}s", DELIVERY_TIMEOUT.as_secs())
                } else {
                    format!("could not reach the endpoint: {e}")
                });
            }
        }

        if attempts < MAX_ATTEMPTS {
            tokio::time::sleep(BACKOFF_BASE * 2u32.pow(attempts - 1)).await;
        }
    }

    warn!(
        webhook = %webhook_id,
        attempts,
        error = last_error.as_deref().unwrap_or("unknown"),
        "Webhook delivery failed"
    );
    record_delivery(
        pool,
        webhook_id,
        kind,
        body,
        last_status,
        last_error,
        attempts,
        false,
    )
    .await;
}

#[allow(clippy::too_many_arguments)]
async fn record_delivery(
    pool: &PgPool,
    webhook_id: Uuid,
    kind: EventKind,
    body: &str,
    status_code: Option<i32>,
    error: Option<String>,
    attempts: u32,
    delivered: bool,
) {
    let payload: Value = serde_json::from_str(body).unwrap_or_else(|_| json!({}));

    let result = sqlx::query(
        "INSERT INTO webhook_deliveries
             (webhook_id, event, payload, status_code, error, attempts, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(webhook_id)
    .bind(kind.as_str())
    .bind(&payload)
    .bind(status_code)
    .bind(&error)
    .bind(attempts as i32)
    .bind(if delivered {
        Some(chrono::Utc::now())
    } else {
        None
    })
    .execute(pool)
    .await;

    if let Err(e) = result {
        warn!(error = %e, "Could not record webhook delivery");
    }
}

// ── Slack ───────────────────────────────────────────────────────────────────

async fn deliver_slack(
    pool: &PgPool,
    http: &reqwest::Client,
    event: &Event,
) -> Result<(), sqlx::Error> {
    let row = sqlx::query(
        "SELECT slack_url_sealed FROM notification_settings
          WHERE tenant_id = $1 AND slack_enabled = TRUE
            AND slack_url_sealed IS NOT NULL AND $2 = ANY(events)",
    )
    .bind(&event.tenant_id)
    .bind(event.kind.as_str())
    .fetch_optional(pool)
    .await?;

    let Some(row) = row else { return Ok(()) };
    let sealed: String = row.get("slack_url_sealed");
    let Ok(url) = crate::crypto::decrypt(&sealed) else {
        warn!(tenant = %event.tenant_id, "Could not decrypt Slack URL — skipping");
        return Ok(());
    };

    let message = slack_message(event);

    match http
        .post(&url)
        .json(&message)
        .timeout(DELIVERY_TIMEOUT)
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => {
            info!(tenant = %event.tenant_id, event = event.kind.as_str(), "Slack notified");
        }
        Ok(res) => {
            warn!(status = %res.status(), "Slack rejected the message");
        }
        Err(e) => {
            warn!(error = %e, "Could not reach Slack");
        }
    }

    Ok(())
}

/// Slack Block Kit message.
///
/// Colour carries the meaning at a glance: red for a rollback or outage, green
/// for a promote. Someone scanning a busy channel should not have to read the
/// text to know whether it needs them.
fn slack_message(event: &Event) -> Value {
    let colour = if event.kind.is_alarming() {
        "#9C312B"
    } else {
        "#1B6B57"
    };

    json!({
        "attachments": [{
            "color": colour,
            "blocks": [
                {
                    "type": "header",
                    "text": {
                        "type": "plain_text",
                        "text": event.kind.headline(&event.rollout_name),
                    }
                },
                {
                    "type": "section",
                    "text": { "type": "mrkdwn", "text": event.detail }
                },
                {
                    "type": "context",
                    "elements": [{
                        "type": "mrkdwn",
                        "text": format!("Repath · {}", chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")),
                    }]
                }
            ]
        }]
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_is_stable_for_the_same_input() {
        let a = sign("secret", "1700000000", r#"{"event":"rollback"}"#);
        let b = sign("secret", "1700000000", r#"{"event":"rollback"}"#);
        assert_eq!(a, b);
        assert_eq!(a.len(), 64, "HMAC-SHA256 hex is 64 chars");
    }

    #[test]
    fn signature_changes_with_the_secret() {
        let a = sign("secret-a", "1700000000", "{}");
        let b = sign("secret-b", "1700000000", "{}");
        assert_ne!(a, b);
    }

    #[test]
    fn signature_changes_with_the_body() {
        let a = sign("secret", "1700000000", r#"{"event":"rollback"}"#);
        let b = sign("secret", "1700000000", r#"{"event":"promote"}"#);
        assert_ne!(a, b, "a tampered body must not verify");
    }

    #[test]
    fn signature_changes_with_the_timestamp() {
        // The timestamp is inside the signed material, so a replayed payload
        // with a fresh timestamp will not verify.
        let a = sign("secret", "1700000000", "{}");
        let b = sign("secret", "1700000001", "{}");
        assert_ne!(a, b);
    }

    #[test]
    fn signature_matches_a_known_vector() {
        // HMAC-SHA256(key="key", msg="ts.body") — guards against the algorithm
        // or the concatenation order being changed by accident.
        let sig = sign("key", "ts", "body");
        let expected = {
            let k = hmac::Key::new(hmac::HMAC_SHA256, b"key");
            let t = hmac::sign(&k, b"ts.body");
            t.as_ref()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        };
        assert_eq!(sig, expected);
    }

    fn event(kind: EventKind) -> Event {
        Event {
            kind,
            tenant_id: "ten_a".into(),
            rollout_id: Some(Uuid::nil()),
            rollout_name: "checkout-prompt".into(),
            detail: "Quality fell to 0.61, below the 0.7 threshold.".into(),
            context: json!({ "quality": 0.61 }),
        }
    }

    #[test]
    fn payload_carries_the_event_name_and_rollout() {
        let p = event(EventKind::Rollback).payload();
        assert_eq!(p.event, "rollback");
        assert_eq!(p.rollout_name, "checkout-prompt");
        assert!(p.detail.contains("0.61"));
        assert!(!p.timestamp.is_empty());
    }

    #[test]
    fn payload_serialises_to_the_documented_shape() {
        let json = serde_json::to_string(&event(EventKind::Promote).payload()).unwrap();
        for field in ["event", "rollout_name", "detail", "context", "timestamp"] {
            assert!(json.contains(field), "missing {field} in {json}");
        }
    }

    #[test]
    fn slack_uses_red_for_bad_news_and_green_for_good() {
        let bad = slack_message(&event(EventKind::Rollback));
        let good = slack_message(&event(EventKind::Promote));
        assert_eq!(bad["attachments"][0]["color"], "#9C312B");
        assert_eq!(good["attachments"][0]["color"], "#1B6B57");
    }

    #[test]
    fn slack_message_names_the_rollout_in_its_header() {
        let m = slack_message(&event(EventKind::Rollback));
        let header = m["attachments"][0]["blocks"][0]["text"]["text"]
            .as_str()
            .unwrap();
        assert!(header.contains("checkout-prompt"), "got {header}");
    }
}
