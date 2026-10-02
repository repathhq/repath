//! Shared by integration suites that need the *real* schema.
//!
//! Hand-built test tables only contain what a test's author remembered to
//! write, with the types they assumed. The request log read `status_code` as
//! i32 for exactly that reason — every suite that touched `requests` created
//! it with an INTEGER column, while migration 002 made it SMALLINT — and the
//! mismatch panicked the production gateway. Suites built on this module run
//! the same embedded migrator the gateway runs at startup.
#![allow(dead_code)]

use sqlx::{Connection, Executor, PgConnection, PgPool};
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

pub struct TempDb {
    name: String,
    base: String,
    pub pool: Option<PgPool>,
}

impl TempDb {
    /// A fresh, empty database, or `None` when `DATABASE_URL` is unset.
    pub async fn create() -> Option<Self> {
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

impl TempDb {
    /// A fresh database with every migration applied.
    pub async fn migrated() -> Option<Self> {
        let db = Self::create().await?;
        repath_gateway::db::migrate::run_migrations(db.pool())
            .await
            .expect("migrations must apply to an empty database");
        Some(db)
    }

    pub fn pool(&self) -> &PgPool {
        self.pool.as_ref().expect("pool is present until drop")
    }
}
