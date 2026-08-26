//! Schema migrations, run automatically at gateway startup.
//!
//! # Why the gateway owns migrations
//!
//! Before this existed, migrations only ever ran in local development, where
//! docker-compose mounted `migrations/` into the Postgres container's
//! `docker-entrypoint-initdb.d`. That hook fires exactly once, on an empty
//! data directory, and does not exist on a managed database like RDS — so a
//! production deploy came up against a schema-less database and every query
//! failed. Running them here means the same code path applies everywhere.
//!
//! # Concurrency
//!
//! Several gateway containers may boot at once. `sqlx`'s migrator takes a
//! Postgres advisory lock for the duration of the run, so exactly one process
//! applies a given migration and the rest block until it finishes, then see
//! the migration as already applied. No coordination needed on our side.
//!
//! # Failure policy
//!
//! A failed migration aborts startup. Serving traffic against a half-migrated
//! schema produces corrupt data and confusing errors; refusing to start is
//! loud, immediate, and safe — the previous container keeps serving until the
//! new one is healthy.

use repath_common::{Error, Result};
use sqlx::PgPool;
use tracing::{info, warn};

/// Migrations are embedded in the binary at compile time, so the running
/// container never needs the `migrations/` directory on disk.
static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("../../migrations");

/// Apply any outstanding migrations. Blocks until the schema is current.
pub async fn run_migrations(pool: &PgPool) -> Result<()> {
    let applied_before = applied_count(pool).await;

    info!("Checking database schema...");

    MIGRATOR.run(pool).await.map_err(|e| Error::Internal {
        message: format!("Database migration failed: {e}"),
        source: Some(e.into()),
    })?;

    let applied_after = applied_count(pool).await;

    match (applied_before, applied_after) {
        (Some(before), Some(after)) if after > before => {
            info!(
                applied = after - before,
                total = after,
                "Database schema migrated"
            );
        }
        (_, Some(total)) => {
            info!(total, "Database schema already current");
        }
        _ => {
            info!("Database schema current");
        }
    }

    Ok(())
}

/// Number of migrations already recorded, or `None` before the migrator has
/// created its bookkeeping table. Only used to make the startup log useful —
/// never to decide whether to run.
async fn applied_count(pool: &PgPool) -> Option<i64> {
    match sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
    {
        Ok(n) => Some(n),
        Err(sqlx::Error::Database(_)) => None, // table not created yet — first run
        Err(e) => {
            warn!(error = %e, "Could not read migration state (continuing)");
            None
        }
    }
}
