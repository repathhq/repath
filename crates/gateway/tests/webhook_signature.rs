//! Payment-webhook signature verification must fail closed.
//!
//! These endpoints are deliberately unauthenticated — Razorpay and Paddle
//! cannot carry our operator token — so the signature is the only thing
//! between the internet and a free plan upgrade.
//!
//! An earlier version returned `true` when the webhook secret was unset, "for
//! dev/test", and the secret was never configured in any environment. Verified
//! against production before the fix: an unsigned POST claiming
//! `payment.captured`, with any tenant id in its notes, upgraded that tenant
//! to Pro and answered 200. Every customer can see their own tenant id, so
//! every customer could grant themselves the top plan for free.
//!
//! **Do not weaken these tests.** If one fails, the product is being given
//! away.

use repath_gateway::api::cloud::{verify_paddle_signature, verify_razorpay_signature};

/// Env access is process-global, so these tests must not run concurrently.
static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_env<T>(key: &str, value: Option<&str>, f: impl FnOnce() -> T) -> T {
    let _guard = ENV_MUTEX.lock().unwrap_or_else(|e| e.into_inner());
    let previous = std::env::var(key).ok();
    match value {
        Some(v) => std::env::set_var(key, v),
        None => std::env::remove_var(key),
    }
    let out = f();
    match previous {
        Some(p) => std::env::set_var(key, p),
        None => std::env::remove_var(key),
    }
    out
}

fn hmac_hex(secret: &str, message: &[u8]) -> String {
    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    hmac::sign(&key, message)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn razorpay_rejects_everything_when_no_secret_is_configured() {
    with_env("RAZORPAY_WEBHOOK_SECRET", None, || {
        assert!(
            !verify_razorpay_signature(b"{}", ""),
            "an unconfigured deployment must REJECT webhooks, never trust them"
        );
        assert!(
            !verify_razorpay_signature(b"{}", "anything"),
            "a bogus signature must not pass just because no secret is set"
        );
    });
}

#[test]
fn razorpay_accepts_only_a_correct_signature() {
    with_env("RAZORPAY_WEBHOOK_SECRET", Some("shh"), || {
        let body = br#"{"event":"payment.captured"}"#;
        assert!(verify_razorpay_signature(body, &hmac_hex("shh", body)));
        assert!(!verify_razorpay_signature(body, &hmac_hex("wrong", body)));
        assert!(!verify_razorpay_signature(body, "deadbeef"));
        assert!(!verify_razorpay_signature(body, ""));
    });
}

#[test]
fn razorpay_signature_is_bound_to_the_body() {
    with_env("RAZORPAY_WEBHOOK_SECRET", Some("shh"), || {
        let signed = br#"{"plan":"indie"}"#;
        let tampered = br#"{"plan":"pro"}"#;
        let signature = hmac_hex("shh", signed);
        assert!(
            !verify_razorpay_signature(tampered, &signature),
            "a signature captured from one payload must not validate another — \
             otherwise the plan field can be swapped in flight"
        );
    });
}

#[test]
fn paddle_rejects_everything_when_no_secret_is_configured() {
    with_env("PADDLE_WEBHOOK_SECRET", None, || {
        assert!(!verify_paddle_signature(b"{}", "ts=1;h1=abc"));
        assert!(!verify_paddle_signature(b"{}", ""));
    });
}

#[test]
fn paddle_accepts_only_a_correct_signature() {
    with_env("PADDLE_WEBHOOK_SECRET", Some("shh"), || {
        let body = br#"{"event_type":"transaction.completed"}"#;
        let ts = "1735689600";
        let payload = format!("{}:{}", ts, String::from_utf8_lossy(body));
        let good = hmac_hex("shh", payload.as_bytes());

        assert!(verify_paddle_signature(body, &format!("ts={ts};h1={good}")));
        assert!(!verify_paddle_signature(
            body,
            &format!("ts={ts};h1=deadbeef")
        ));
        assert!(
            !verify_paddle_signature(body, &format!("ts=9999999999;h1={good}")),
            "the timestamp is part of the signed payload, so changing it must invalidate"
        );
    });
}
