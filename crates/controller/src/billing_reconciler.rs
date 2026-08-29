//! Keeps plan entitlements in step with what has actually been paid for.
//!
//! # Why poll instead of taking webhooks
//!
//! This deployment has no Razorpay webhook configured, so nothing would ever
//! tell us a renewal succeeded or a mandate was cancelled. Polling also
//! survives the failure mode webhooks have: a missed or rejected delivery
//! leaves the two systems permanently disagreeing, whereas a poller
//! self-heals on the next pass.
//!
//! # What this fixes
//!
//! Before subscriptions existed, "upgrading" set a plan with no end date and
//! nothing ever downgraded anyone. One payment bought the tier permanently —
//! recurring revenue that only ever charged once. A plan can now lapse, and
//! this is what notices.
//!
//! # Ordering
//!
//! Provider state wins over local state. If Razorpay says a subscription is
//! cancelled or expired, the tenant loses the plan even if our row still says
//! otherwise; the provider is the record of who paid.
//!
//! Tenants with no `subscription_id` are never touched. That deliberately
//! includes trials and the legacy one-time purchases made before this
//! existed — cutting those off retroactively would take away something people
//! were sold.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use sqlx::{PgPool, Row};
use std::time::Duration;
use tracing::{debug, error, info, warn};

/// How often to reconcile. Billing periods are months, so this is about
/// bounding how long an unpaid account keeps its plan, not about latency.
const INTERVAL: Duration = Duration::from_secs(15 * 60);

/// Grace period after a period ends before the plan is removed.
///
/// Razorpay retries a failed charge over several days, and a card can be
/// declined for reasons that resolve on their own. Cutting a paying customer
/// off the instant their period ends would punish them for their bank's
/// timing; a day of slack costs us a rupee of quota and avoids that.
const GRACE: chrono::Duration = chrono::Duration::days(1);

/// Statuses that mean "this subscription is still paying".
///
/// `authenticated` is included because a mandate is authorised before the
/// first charge settles; treating it as unpaid would revoke the plan a
/// customer just bought.
const LIVE_STATUSES: &[&str] = &["active", "authenticated", "created", "pending", "halted"];

#[derive(Debug, Deserialize)]
struct RazorpaySubscription {
    status: String,
    /// Unix seconds. Absent until the first cycle is billed.
    current_end: Option<i64>,
}

pub struct ReconcilerConfig {
    pub key_id: String,
    pub key_secret: String,
    pub http: reqwest::Client,
}

impl ReconcilerConfig {
    /// Builds config from the environment, or `None` when billing is not
    /// configured here. Returning `None` rather than defaulting keeps a
    /// misconfigured deployment from silently downgrading every customer.
    pub fn from_env(http: reqwest::Client) -> Option<Self> {
        let key_id = std::env::var("RAZORPAY_KEY_ID")
            .ok()
            .filter(|v| !v.is_empty())?;
        let key_secret = std::env::var("RAZORPAY_KEY_SECRET")
            .ok()
            .filter(|v| !v.is_empty())?;
        Some(Self {
            key_id,
            key_secret,
            http,
        })
    }
}

/// Background task. Runs until aborted.
pub async fn run(pool: PgPool, config: ReconcilerConfig) {
    info!(
        interval_secs = INTERVAL.as_secs(),
        "Billing reconciler started"
    );
    let mut ticker = tokio::time::interval(INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        if let Err(e) = reconcile_once(&pool, &config).await {
            // Never fatal: a reconciler that dies stops downgrading anyone,
            // which fails in the customer's favour but hides the problem.
            error!(error = %e, "Billing reconciliation pass failed");
        }
    }
}

/// One full pass. Public so tests and operators can trigger it directly.
pub async fn reconcile_once(pool: &PgPool, config: &ReconcilerConfig) -> Result<(), sqlx::Error> {
    let rows = sqlx::query(
        "SELECT id, subscription_id, plan FROM tenants \
          WHERE subscription_id IS NOT NULL AND active = TRUE",
    )
    .fetch_all(pool)
    .await?;

    if rows.is_empty() {
        debug!("No subscriptions to reconcile");
        return Ok(());
    }

    let mut checked = 0usize;
    let mut downgraded = 0usize;

    for row in rows {
        let tenant_id: String = row.get("id");
        let subscription_id: String = row.get("subscription_id");

        let remote = match fetch_subscription(config, &subscription_id).await {
            Ok(s) => s,
            Err(e) => {
                // A provider outage must not cascade into mass downgrades.
                // Skipping leaves the tenant as-is until the next pass.
                warn!(
                    tenant_id, subscription_id, error = %e,
                    "Could not read subscription — leaving entitlement unchanged"
                );
                continue;
            }
        };
        checked += 1;

        let period_end = remote
            .current_end
            .and_then(|s| DateTime::from_timestamp(s, 0));
        let still_paying = LIVE_STATUSES.contains(&remote.status.as_str());
        let lapsed = period_end
            .map(|end| Utc::now() > end + GRACE)
            .unwrap_or(false);

        if still_paying && !lapsed {
            sqlx::query(
                "UPDATE tenants \
                    SET subscription_status = $1, current_period_end = $2, \
                        last_synced_at = NOW(), updated_at = NOW() \
                  WHERE id = $3",
            )
            .bind(&remote.status)
            .bind(period_end)
            .bind(&tenant_id)
            .execute(pool)
            .await?;
            continue;
        }

        // Not paying, or paid period is well past. Drop to the free tier
        // rather than deactivating: the account keeps working, the paid
        // allowance does not. Deactivating would break their gateway traffic
        // over a billing problem.
        sqlx::query(
            "UPDATE tenants \
                SET plan = 'free', eval_quota_monthly = 0, \
                    subscription_status = $1, current_period_end = $2, \
                    last_synced_at = NOW(), updated_at = NOW() \
              WHERE id = $3",
        )
        .bind(&remote.status)
        .bind(period_end)
        .bind(&tenant_id)
        .execute(pool)
        .await?;

        downgraded += 1;
        info!(
            tenant_id,
            subscription_id,
            status = %remote.status,
            "Subscription no longer paying — plan removed"
        );
    }

    debug!(checked, downgraded, "Billing reconciliation pass complete");
    Ok(())
}

async fn fetch_subscription(
    config: &ReconcilerConfig,
    subscription_id: &str,
) -> Result<RazorpaySubscription, String> {
    let url = format!("https://api.razorpay.com/v1/subscriptions/{subscription_id}");

    let res = config
        .http
        .get(&url)
        .basic_auth(&config.key_id, Some(&config.key_secret))
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Razorpay returned {}", res.status()));
    }

    res.json::<RazorpaySubscription>()
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn live_statuses_cover_a_freshly_authorised_mandate() {
        // A mandate is `authenticated` before the first charge settles.
        // Treating that as unpaid would revoke a plan seconds after purchase.
        assert!(LIVE_STATUSES.contains(&"authenticated"));
        assert!(LIVE_STATUSES.contains(&"active"));
    }

    #[test]
    fn terminal_statuses_are_not_treated_as_paying() {
        for dead in ["cancelled", "completed", "expired", "paused"] {
            assert!(
                !LIVE_STATUSES.contains(&dead),
                "{dead} must not count as an active subscription"
            );
        }
    }

    #[test]
    fn grace_is_generous_enough_for_a_retry_window() {
        // Razorpay retries a failed charge over days. A grace shorter than a
        // day would cut off customers whose bank simply declined once.
        assert!(GRACE >= chrono::Duration::days(1));
    }

    #[test]
    fn missing_period_end_is_not_treated_as_lapsed() {
        // `current_end` is absent until the first cycle bills. Reading that as
        // "expired at the epoch" would downgrade every new subscriber.
        let period_end: Option<DateTime<Utc>> = None;
        let lapsed = period_end
            .map(|end| Utc::now() > end + GRACE)
            .unwrap_or(false);
        assert!(!lapsed);
    }

    #[test]
    fn a_period_that_ended_within_grace_is_not_lapsed() {
        let ended_recently = Utc::now() - chrono::Duration::hours(2);
        let lapsed = Utc::now() > ended_recently + GRACE;
        assert!(
            !lapsed,
            "a period that ended hours ago is still inside grace"
        );
    }

    #[test]
    fn a_period_well_past_grace_is_lapsed() {
        let long_gone = Utc::now() - chrono::Duration::days(10);
        assert!(Utc::now() > long_gone + GRACE);
    }
}
