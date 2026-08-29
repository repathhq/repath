//! Transactional email via Amazon SES.
//!
//! # Why SES, and why no stored credential
//!
//! The gateway already runs on EC2 with an instance role. `aws-config`'s
//! default provider chain picks that role up, so sending mail needs no API
//! key anywhere — nothing to rotate, nothing to leak. `infra/ses.tf` grants
//! the role `ses:SendEmail` scoped to this one domain identity.
//!
//! # Failure policy differs by caller, so this module never decides
//!
//! A failed *alert* should be logged and dropped — losing a notification must
//! not fail the rollout decision that produced it. A failed *password reset*
//! must surface, or the user waits forever for mail that will never arrive.
//! So every function here returns a `Result` and lets the caller choose.
//!
//! # Client construction
//!
//! The SDK client is built once and shared. Building it per-send would
//! re-resolve credentials from IMDS on every call, adding latency and
//! hammering the metadata endpoint.

use aws_sdk_sesv2::types::{Body, Content, Destination, EmailContent, Message};
use aws_sdk_sesv2::Client;
use std::sync::Arc;
use tokio::sync::OnceCell;
use tracing::{info, warn};

/// Address mail is sent from. Must be a verified SES identity — see
/// `infra/ses.tf` for the DNS records that make it one.
fn from_address() -> String {
    std::env::var("REPATH_MAIL_FROM").unwrap_or_else(|_| "Repath <no-reply@tryrepath.com>".into())
}

/// Base URL used to build links inside emails. Wrong value here produces
/// reset links that 404, so it is explicit rather than inferred.
pub fn app_url() -> String {
    std::env::var("NEXT_PUBLIC_APP_URL")
        .or_else(|_| std::env::var("REPATH_APP_URL"))
        .unwrap_or_else(|_| "https://tryrepath.com".into())
}

static CLIENT: OnceCell<Option<Arc<Client>>> = OnceCell::const_new();

/// The shared SES client, or `None` when email is disabled.
///
/// Email is opt-in via `REPATH_EMAIL_ENABLED`. A deployment without SES
/// verified would otherwise fail every send with an opaque SDK error; an
/// explicit flag makes "email is off here" a stated configuration rather than
/// something you discover from a stack trace.
async fn client() -> Option<Arc<Client>> {
    CLIENT
        .get_or_init(|| async {
            let enabled = std::env::var("REPATH_EMAIL_ENABLED")
                .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            if !enabled {
                info!("Email disabled (REPATH_EMAIL_ENABLED not set) — sends will be skipped");
                return None;
            }
            let config = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
            Some(Arc::new(Client::new(&config)))
        })
        .await
        .clone()
}

/// Whether email sending is configured in this deployment.
pub async fn is_enabled() -> bool {
    client().await.is_some()
}

#[derive(Debug, thiserror::Error)]
pub enum EmailError {
    #[error("email is not enabled in this deployment (set REPATH_EMAIL_ENABLED=1)")]
    Disabled,
    #[error("SES rejected the message: {0}")]
    Send(String),
}

/// Send one plain-text + HTML email.
///
/// Both bodies are supplied: HTML for readability, text because some clients
/// and most spam filters want a real alternative rather than a stripped copy.
pub async fn send(to: &str, subject: &str, text: &str, html: &str) -> Result<(), EmailError> {
    let Some(client) = client().await else {
        return Err(EmailError::Disabled);
    };

    let body = Body::builder()
        .text(
            Content::builder()
                .data(text)
                .charset("UTF-8")
                .build()
                .map_err(|e| EmailError::Send(e.to_string()))?,
        )
        .html(
            Content::builder()
                .data(html)
                .charset("UTF-8")
                .build()
                .map_err(|e| EmailError::Send(e.to_string()))?,
        )
        .build();

    let message = Message::builder()
        .subject(
            Content::builder()
                .data(subject)
                .charset("UTF-8")
                .build()
                .map_err(|e| EmailError::Send(e.to_string()))?,
        )
        .body(body)
        .build();

    client
        .send_email()
        .from_email_address(from_address())
        .destination(Destination::builder().to_addresses(to).build())
        .content(EmailContent::builder().simple(message).build())
        .send()
        .await
        .map_err(|e| {
            // The SDK's Display is a bare "service error"; the source chain
            // carries the reason SES actually gave, which is what anyone
            // debugging a bounce needs.
            let detail = std::error::Error::source(&e)
                .map(|s| s.to_string())
                .unwrap_or_else(|| e.to_string());
            warn!(to, subject, error = %detail, "SES send failed");
            EmailError::Send(detail)
        })?;

    info!(to, subject, "Email sent");
    Ok(())
}

/// The password-reset email.
///
/// Deliberately says the link expires and that an unrequested mail can be
/// ignored: both are what a real person needs in order to decide whether
/// they are being phished.
pub async fn send_password_reset(
    to: &str,
    token: &str,
    ttl_minutes: i64,
) -> Result<(), EmailError> {
    let link = format!("{}/reset-password?token={}", app_url(), token);

    let text = format!(
        "Reset your Repath password\n\n\
         Open this link to choose a new password:\n{link}\n\n\
         The link expires in {ttl_minutes} minutes and can be used once.\n\n\
         If you did not ask to reset your password, you can ignore this email — \
         your password has not changed."
    );

    let html = format!(
        r#"<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#16161d">
  <h2 style="font-size:19px;margin:0 0 14px">Reset your Repath password</h2>
  <p style="font-size:14px;line-height:1.6;color:#43434f;margin:0 0 20px">
    Choose a new password using the button below. The link expires in {ttl_minutes} minutes and can be used once.
  </p>
  <p style="margin:0 0 24px">
    <a href="{link}" style="display:inline-block;background:#6d3beb;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:600">Set a new password</a>
  </p>
  <p style="font-size:12.5px;line-height:1.6;color:#6e6e7e;margin:0 0 6px">
    If the button does not work, paste this into your browser:
  </p>
  <p style="font-size:12px;word-break:break-all;color:#6e6e7e;margin:0 0 20px">{link}</p>
  <p style="font-size:12.5px;line-height:1.6;color:#6e6e7e;margin:0;border-top:1px solid #e3e3ec;padding-top:14px">
    If you did not ask to reset your password you can ignore this email — your password has not changed.
  </p>
</div>"#
    );

    send(to, "Reset your Repath password", &text, &html).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_url_falls_back_to_production() {
        // No env set in the test process, so the fallback is what a
        // misconfigured deployment would use — it must still be a real URL,
        // because it goes into password-reset links people click.
        let url = app_url();
        assert!(
            url.starts_with("https://"),
            "app_url must be absolute and https, got {url}"
        );
    }

    #[tokio::test]
    async fn sending_is_refused_when_disabled_rather_than_silently_dropped() {
        // The old email "feature" accepted a subscription and dropped it.
        // A disabled deployment must return an error the caller can surface,
        // never Ok(()).
        if std::env::var("REPATH_EMAIL_ENABLED").is_ok() {
            return; // A configured environment is not what this test asserts.
        }
        let err = send("nobody@example.com", "s", "t", "<p>t</p>")
            .await
            .expect_err("must not report success while disabled");
        assert!(matches!(err, EmailError::Disabled));
    }
}
