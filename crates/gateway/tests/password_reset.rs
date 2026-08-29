//! Password reset token semantics.
//!
//! A forgotten password used to be a permanent lockout — no reset route, no
//! link on the login page, no operator tooling. These tests pin the rules the
//! replacement has to keep, because each one is a way the flow could quietly
//! become an account-takeover primitive instead of a recovery path:
//!
//!   * the plaintext token is never stored, so a database dump yields no
//!     working links;
//!   * a token works once, and concurrent redemptions cannot both win;
//!   * an expired token is refused;
//!   * requesting a second link retires the first.
//!
//! # Running
//!
//! ```
//! DATABASE_URL=postgres://... cargo test -p repath-gateway --test password_reset
//! ```
//!
//! Skipped (not failed) when `DATABASE_URL` is unset.

use sqlx::{PgPool, Row};
use uuid::Uuid;

// ── Harness ─────────────────────────────────────────────────────────────────

struct TestDb {
    pool: PgPool,
    schema: String,
    admin_url: String,
}

impl TestDb {
    async fn new() -> Option<Self> {
        let database_url = std::env::var("DATABASE_URL").ok()?;
        let schema = format!("pwreset_{}", Uuid::new_v4().simple());

        let root = PgPool::connect(&database_url).await.expect("connect");
        sqlx::query(&format!("CREATE SCHEMA \"{schema}\""))
            .execute(&root)
            .await
            .expect("create schema");
        root.close().await;

        let mut opts: sqlx::postgres::PgConnectOptions =
            database_url.parse().expect("parse DATABASE_URL");
        opts = opts.options([("search_path", schema.as_str())]);
        let pool = PgPool::connect_with(opts).await.expect("connect to schema");

        // Minimal schema, matching the convention in tenant_isolation.rs:
        // gen_random_uuid() is built in, whereas uuid_generate_v4() lives in
        // `public`, which this search_path deliberately excludes.
        for ddl in [
            r#"CREATE TABLE tenants (
                id VARCHAR(64) PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password_hash TEXT,
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"#,
            r#"CREATE TABLE password_reset_tokens (
                id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                tenant_id  VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                token_hash CHAR(64) NOT NULL UNIQUE,
                expires_at TIMESTAMPTZ NOT NULL,
                used_at    TIMESTAMPTZ,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"#,
        ] {
            sqlx::query(ddl).execute(&pool).await.expect("create table");
        }

        sqlx::query("INSERT INTO tenants (id, email, password_hash) VALUES ($1,$2,$3)")
            .bind("ten_reset")
            .bind("owner@example.com")
            .bind("$2a$12$originalhashvalue")
            .execute(&pool)
            .await
            .expect("seed tenant");

        Some(Self {
            pool,
            schema,
            admin_url: database_url,
        })
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        let schema = self.schema.clone();
        let url = self.admin_url.clone();
        std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Runtime::new() {
                rt.block_on(async {
                    if let Ok(p) = PgPool::connect(&url).await {
                        let _ = sqlx::query(&format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE"))
                            .execute(&p)
                            .await;
                    }
                });
            }
        })
        .join()
        .ok();
    }
}

/// Mirrors the gateway's hashing so the tests exercise the same shape of value.
fn sha256_hex(input: &str) -> String {
    use ring::digest;
    digest::digest(&digest::SHA256, input.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

async fn issue(db: &TestDb, token: &str, minutes: i64) {
    sqlx::query(
        "INSERT INTO password_reset_tokens (tenant_id, token_hash, expires_at) \
         VALUES ($1, $2, NOW() + ($3 || ' minutes')::INTERVAL)",
    )
    .bind("ten_reset")
    .bind(sha256_hex(token))
    .bind(minutes.to_string())
    .execute(&db.pool)
    .await
    .expect("issue token");
}

/// The exact conditional UPDATE the confirm handler runs.
async fn redeem(db: &TestDb, token: &str) -> Option<String> {
    sqlx::query(
        "UPDATE password_reset_tokens SET used_at = NOW() \
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() \
      RETURNING tenant_id",
    )
    .bind(sha256_hex(token))
    .fetch_optional(&db.pool)
    .await
    .expect("redeem")
    .map(|r| r.get("tenant_id"))
}

// ── Tests ───────────────────────────────────────────────────────────────────

#[tokio::test]
async fn plaintext_token_is_never_stored() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let token = "0123456789abcdef0123456789abcdef";
    issue(&db, token, 30).await;

    let stored: String = sqlx::query("SELECT token_hash FROM password_reset_tokens")
        .fetch_one(&db.pool)
        .await
        .expect("read")
        .get("token_hash");

    assert_ne!(stored, token, "the token itself must never reach the table");
    assert_eq!(stored, sha256_hex(token));
    assert_eq!(
        stored.len(),
        64,
        "stored value should be a SHA-256 hex digest"
    );
}

#[tokio::test]
async fn a_token_can_only_be_redeemed_once() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let token = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    issue(&db, token, 30).await;

    assert_eq!(
        redeem(&db, token).await.as_deref(),
        Some("ten_reset"),
        "first redemption should succeed"
    );
    assert!(
        redeem(&db, token).await.is_none(),
        "a reset link must not work twice — otherwise anyone who later reads \
         the email can take the account back"
    );
}

#[tokio::test]
async fn an_expired_token_is_refused() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let token = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    issue(&db, token, -1).await; // already expired

    assert!(
        redeem(&db, token).await.is_none(),
        "an expired link must not be redeemable"
    );
}

#[tokio::test]
async fn an_unknown_token_is_refused() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    assert!(
        redeem(&db, "never-issued").await.is_none(),
        "a token that was never issued must not redeem"
    );
}

#[tokio::test]
async fn requesting_a_second_link_retires_the_first() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let first = "cccccccccccccccccccccccccccccccc";
    issue(&db, first, 30).await;

    // What request_password_reset does before inserting the new token.
    sqlx::query(
        "UPDATE password_reset_tokens SET used_at = NOW() \
          WHERE tenant_id = $1 AND used_at IS NULL",
    )
    .bind("ten_reset")
    .execute(&db.pool)
    .await
    .expect("retire");

    let second = "dddddddddddddddddddddddddddddddd";
    issue(&db, second, 30).await;

    assert!(
        redeem(&db, first).await.is_none(),
        "the superseded link must stop working, so a stolen older email is useless"
    );
    assert_eq!(
        redeem(&db, second).await.as_deref(),
        Some("ten_reset"),
        "the newest link must still work"
    );
}

#[tokio::test]
async fn concurrent_redemptions_cannot_both_win() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let token = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    issue(&db, token, 30).await;

    // Two claims racing on the same row. The conditional UPDATE is what makes
    // this safe; a SELECT-then-UPDATE would let both through.
    let (a, b) = tokio::join!(redeem(&db, token), redeem(&db, token));

    assert_eq!(
        [a.is_some(), b.is_some()].iter().filter(|w| **w).count(),
        1,
        "exactly one concurrent redemption may succeed, got a={a:?} b={b:?}"
    );
}
