//! The real migrations must apply to an empty database.
//!
//! # Why this did not exist, and why it should have
//!
//! Every other integration suite builds its tables by hand — `tenant_isolation`
//! and the rest each `CREATE TABLE` exactly what they need. That keeps them
//! fast and independent, but it means the migration files themselves were
//! never executed by any test. The only thing that ran them was the gateway
//! at startup, in production, where a syntax error or a bad constraint takes
//! the service down instead of failing a build.
//!
//! This runs the embedded migrator — the same `sqlx::migrate!` the gateway
//! uses — against a throwaway database, then asserts the schema the code
//! actually depends on came out the other side.
//!
//! # A fresh database, not a schema
//!
//! Migration 001 runs `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`, which is
//! database-wide and lands wherever it is first created. Running that inside a
//! search_path-scoped schema leaves every *other* test's schema unable to see
//! `uuid_generate_v4()`. So this test gets its own database and drops it after.
//!
//! Skipped (not failed) when `DATABASE_URL` is unset.

use sqlx::{Connection, Executor, PgConnection, PgPool, Row};
use uuid::Uuid;

/// Connect to the maintenance database so `CREATE DATABASE` is legal.
fn admin_url(base: &str) -> String {
    match base.rfind('/') {
        Some(i) => format!("{}/postgres", &base[..i]),
        None => base.to_string(),
    }
}

fn with_database(base: &str, name: &str) -> String {
    // Preserve any query string (?sslmode=require and friends) while swapping
    // the database name.
    let (head, query) = match base.split_once('?') {
        Some((h, q)) => (h, Some(q)),
        None => (base, None),
    };
    let stem = &head[..head.rfind('/').unwrap_or(head.len())];
    match query {
        Some(q) => format!("{stem}/{name}?{q}"),
        None => format!("{stem}/{name}"),
    }
}

struct TempDb {
    name: String,
    base: String,
    pool: Option<PgPool>,
}

impl TempDb {
    async fn create() -> Option<Self> {
        let base = std::env::var("DATABASE_URL").ok()?;
        let name = format!("mig_{}", Uuid::new_v4().simple());

        let mut admin = PgConnection::connect(&admin_url(&base))
            .await
            .expect("connect to maintenance database");
        admin
            .execute(format!("CREATE DATABASE \"{name}\"").as_str())
            .await
            .expect("create temp database");

        let pool = PgPool::connect(&with_database(&base, &name))
            .await
            .expect("connect to temp database");

        Some(Self {
            name,
            base,
            pool: Some(pool),
        })
    }
}

impl Drop for TempDb {
    fn drop(&mut self) {
        // The pool must close before the database can be dropped, and Drop
        // cannot await — hence the short-lived runtime on its own thread.
        if let Some(pool) = self.pool.take() {
            let name = self.name.clone();
            let admin = admin_url(&self.base);
            std::thread::spawn(move || {
                if let Ok(rt) = tokio::runtime::Runtime::new() {
                    rt.block_on(async {
                        pool.close().await;
                        if let Ok(mut c) = PgConnection::connect(&admin).await {
                            let _ = c
                                .execute(format!("DROP DATABASE IF EXISTS \"{name}\"").as_str())
                                .await;
                        }
                    });
                }
            })
            .join()
            .ok();
        }
    }
}

#[tokio::test]
async fn every_migration_applies_to_an_empty_database() {
    let Some(db) = TempDb::create().await else {
        eprintln!("skipping: DATABASE_URL not set");
        return;
    };
    let pool = db.pool.as_ref().unwrap();

    repath_gateway::db::migrate::run_migrations(pool)
        .await
        .expect("migrations must apply cleanly to an empty database");

    // Re-running must be a no-op. The gateway migrates on every boot, and
    // several containers may boot at once.
    repath_gateway::db::migrate::run_migrations(pool)
        .await
        .expect("migrations must be idempotent — the gateway runs them on every start");
}

#[tokio::test]
async fn schema_matches_what_the_code_queries() {
    let Some(db) = TempDb::create().await else {
        return;
    };
    let pool = db.pool.as_ref().unwrap();
    repath_gateway::db::migrate::run_migrations(pool)
        .await
        .expect("migrate");

    // Tables and columns the running code selects by name. A migration that
    // applies cleanly but renames one of these still breaks the gateway, and
    // "it migrated fine" is exactly the false comfort this guards against.
    for (table, column) in [
        ("requests", "tenant_id"),
        ("requests", "cost_micro_usd"),
        ("requests", "provider"),
        ("request_payloads", "expires_at"),
        ("request_payloads", "truncated"),
        ("tenants", "capture_payloads"),
        ("tenants", "subscription_id"),
        ("tenants", "current_period_end"),
        ("password_reset_tokens", "token_hash"),
        ("payments", "provider_payment_id"),
        ("evaluations", "evaluator_type"),
        ("rollouts", "current_weight"),
    ] {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM information_schema.columns \
              WHERE table_name = $1 AND column_name = $2)",
        )
        .bind(table)
        .bind(column)
        .fetch_one(pool)
        .await
        .expect("introspect");
        assert!(exists, "{table}.{column} is missing after migration");
    }
}

#[tokio::test]
async fn retention_days_matches_what_the_plans_promise() {
    let Some(db) = TempDb::create().await else {
        return;
    };
    let pool = db.pool.as_ref().unwrap();
    repath_gateway::db::migrate::run_migrations(pool)
        .await
        .expect("migrate");

    // These are sold on the pricing page. The function is the only place the
    // numbers live, so this is the test that keeps the promise honest.
    for (plan, days) in [
        ("pro", 90),
        ("enterprise", 90),
        ("starter", 7),
        ("indie", 7),
        ("trial", 7),
    ] {
        let got: i32 = sqlx::query_scalar("SELECT retention_days($1)")
            .bind(plan)
            .fetch_one(pool)
            .await
            .expect("retention_days");
        assert_eq!(got, days, "retention for {plan} should be {days} days");
    }

    // An unknown or lapsed plan must get the shortest window, never the
    // longest — erring long means holding end-user text for someone who is
    // no longer paying us to hold it.
    let unknown: i32 = sqlx::query_scalar("SELECT retention_days($1)")
        .bind("something-we-never-shipped")
        .fetch_one(pool)
        .await
        .expect("retention_days");
    assert_eq!(
        unknown, 1,
        "an unrecognised plan must get the shortest window"
    );
}

#[tokio::test]
async fn openrouter_is_a_permitted_provider_type() {
    let Some(db) = TempDb::create().await else {
        return;
    };
    let pool = db.pool.as_ref().unwrap();
    repath_gateway::db::migrate::run_migrations(pool)
        .await
        .expect("migrate");

    // Migration 008 widened this constraint. Rollouts against OpenRouter were
    // previously rejected by it, after silently storing a broken base URL.
    sqlx::query(
        "INSERT INTO providers (name, base_url, api_key_encrypted, provider_type) \
         VALUES ('openrouter', 'https://openrouter.ai/api/v1', 'x', 'openrouter')",
    )
    .execute(pool)
    .await
    .expect("openrouter must be an accepted provider_type");

    // ...and the constraint must still reject genuine nonsense.
    let bad = sqlx::query(
        "INSERT INTO providers (name, base_url, api_key_encrypted, provider_type) \
         VALUES ('bogus', 'x', 'y', 'not-a-provider')",
    )
    .execute(pool)
    .await;
    assert!(
        bad.is_err(),
        "the provider_type constraint must still reject unknown values"
    );
}

#[tokio::test]
async fn payload_retention_sweep_deletes_only_expired_rows() {
    let Some(db) = TempDb::create().await else {
        return;
    };
    let pool = db.pool.as_ref().unwrap();
    repath_gateway::db::migrate::run_migrations(pool)
        .await
        .expect("migrate");

    sqlx::query("INSERT INTO tenants (id, name, email) VALUES ('ten_r', 'R', 'r@example.com')")
        .execute(pool)
        .await
        .expect("seed tenant");

    // Two payloads: one already past its window, one still inside it.
    for (offset, label) in [("-1 day", "expired"), ("+30 days", "live")] {
        let req: Uuid = sqlx::query(
            "INSERT INTO requests (tenant_id, model, latency_ms, status_code) \
             VALUES ('ten_r', $1, 10, 200) RETURNING id",
        )
        .bind(label)
        .fetch_one(pool)
        .await
        .expect("seed request")
        .get("id");

        sqlx::query(
            "INSERT INTO request_payloads (request_id, tenant_id, request_body, response_text, expires_at) \
             VALUES ($1, 'ten_r', 'p', 'r', NOW() + $2::INTERVAL)",
        )
        .bind(req)
        .bind(offset)
        .execute(pool)
        .await
        .expect("seed payload");
    }

    // The sweep the controller runs.
    let deleted = sqlx::query(
        "DELETE FROM request_payloads \
          WHERE request_id IN (SELECT request_id FROM request_payloads WHERE expires_at < NOW() LIMIT 5000)",
    )
    .execute(pool)
    .await
    .expect("sweep")
    .rows_affected();

    assert_eq!(deleted, 1, "exactly the expired payload should be deleted");

    let remaining: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM request_payloads")
        .fetch_one(pool)
        .await
        .expect("count");
    assert_eq!(
        remaining, 1,
        "a payload inside its retention window must survive the sweep"
    );
}
