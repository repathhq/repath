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
        // Never touch the test's own pool from another runtime. This used to
        // `pool.close().await` on a fresh runtime while the test's runtime —
        // which owns the pool's sockets — sat blocked in `.join()` below. Each
        // side waited on the other: an intermittent deadlock that held CI's
        // test job for 40+ minutes (twice) until it was cancelled.
        //
        // Instead: release the pool without waiting, then drop the database
        // from a brand-new connection on a brand-new runtime. WITH (FORCE)
        // (Postgres 13+) ends any session the released pool has not closed
        // yet, so the drop cannot wait on it either.
        drop(self.pool.take());
        let name = self.name.clone();
        let admin = admin_url(&self.base);
        std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
            {
                rt.block_on(async {
                    if let Ok(mut c) = PgConnection::connect(&admin).await {
                        let _ = c
                            .execute(
                                format!("DROP DATABASE IF EXISTS \"{name}\" WITH (FORCE)").as_str(),
                            )
                            .await;
                        let _ = c.close().await;
                    }
                });
            }
        })
        .join()
        .ok();
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
