//! Deletes captured request payloads once their retention window closes.
//!
//! # Why this exists
//!
//! The pricing page has always advertised 7-day retention on the smaller
//! plans and 90-day on Pro. Nothing enforced it — no expiry column, no
//! deletion job, no code path anywhere that removed anything. The claim was
//! marketing copy. Storing customers' end-user prompts and responses forever
//! while telling them it is kept for a week is the kind of gap that turns
//! into a compliance problem rather than a bug report.
//!
//! `expires_at` is written by the gateway when the payload is captured, from
//! the tenant's plan at that moment. This only has to delete what is past it.
//!
//! # Batched, not one big DELETE
//!
//! A single unbounded `DELETE ... WHERE expires_at < NOW()` on a table with
//! months of traffic takes a long transaction and a lot of locks. Deleting in
//! bounded batches keeps each transaction short, so the sweep never blocks
//! the inserts happening beside it.

use sqlx::PgPool;
use std::time::Duration;
use tracing::{debug, error, info};

/// How often to sweep. Retention is measured in days, so this is about
/// bounding how long expired text lingers, not about promptness.
const INTERVAL: Duration = Duration::from_secs(3600);

/// Rows per statement. Small enough that each transaction is short, large
/// enough that a busy tenant's backlog still drains.
const BATCH: i64 = 5_000;

/// Most batches one pass will run before yielding until the next tick.
///
/// Bounds the work a single pass can do, so a large first sweep after this
/// ships cannot hold the database busy indefinitely. Anything left is picked
/// up an hour later.
const MAX_BATCHES: usize = 200;

pub async fn run(pool: PgPool) {
    info!(
        interval_secs = INTERVAL.as_secs(),
        "Payload retention sweeper started"
    );
    let mut ticker = tokio::time::interval(INTERVAL);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        ticker.tick().await;
        match sweep_once(&pool).await {
            Ok(0) => debug!("Retention sweep: nothing expired"),
            Ok(n) => info!(deleted = n, "Retention sweep removed expired payloads"),
            // Never fatal. A sweeper that dies silently stops enforcing the
            // retention promise, which is worse than a noisy failure.
            Err(e) => error!(error = %e, "Retention sweep failed"),
        }
    }
}

/// One pass. Returns how many payload rows were deleted.
///
/// Public so an operator or a test can run a sweep directly rather than
/// waiting an hour to find out whether it works.
pub async fn sweep_once(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let mut total = 0u64;

    for _ in 0..MAX_BATCHES {
        let deleted = sqlx::query(
            "DELETE FROM request_payloads \
              WHERE request_id IN ( \
                    SELECT request_id FROM request_payloads \
                     WHERE expires_at < NOW() \
                     LIMIT $1 \
              )",
        )
        .bind(BATCH)
        .execute(pool)
        .await?
        .rows_affected();

        total += deleted;
        if deleted < BATCH as u64 {
            break;
        }
    }

    Ok(total)
}

#[cfg(test)]
mod tests {
    use super::*;

    // Compile-time, not runtime: these are facts about the constants, so a
    // bad value should fail the build rather than a test run. A BATCH of 0
    // would make the sweep delete nothing forever while looking healthy.
    const _: () = assert!(BATCH > 0);
    const _: () = assert!(MAX_BATCHES > 0);
    const _: () = assert!(
        BATCH * MAX_BATCHES as i64 <= 2_000_000,
        "one sweep pass must stay bounded — the first run after deploy could \
         face months of accumulated rows"
    );

    #[test]
    fn sweeps_at_least_daily() {
        // Retention is sold in days. A sweep interval longer than a day would
        // let a 7-day promise routinely become 8.
        assert!(INTERVAL <= Duration::from_secs(86_400));
    }
}
