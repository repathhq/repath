//! Database connection pool management
//!
//! This module handles the creation and lifecycle of the PostgreSQL connection pool.
//! The pool is configured for high-concurrency workloads with appropriate timeouts.

use repath_common::{config::DatabaseSettings, Error, Result};
use sqlx::postgres::{PgPool, PgPoolOptions};
use std::time::Duration;
use tracing::{debug, info};

/// Create a PostgreSQL connection pool with configured settings
///
/// The pool is configured with:
/// - Connection timeouts to prevent hanging
/// - Maximum connections based on config
/// - Idle connection cleanup
/// - Statement caching for performance
///
/// # Arguments
///
/// * `settings` - Database configuration (URL, max connections, timeouts)
///
/// # Errors
///
/// Returns `Error::Database` if:
/// - Connection string is invalid
/// - Cannot connect to PostgreSQL
/// - Authentication fails
pub async fn create_pool(settings: &DatabaseSettings) -> Result<PgPool> {
    debug!(
        url = %sanitize_url(&settings.url),
        max_connections = settings.max_connections,
        connect_timeout = settings.connect_timeout_seconds,
        "Creating database connection pool"
    );

    let pool = PgPoolOptions::new()
        .max_connections(settings.max_connections)
        .acquire_timeout(Duration::from_secs(settings.connect_timeout_seconds))
        .idle_timeout(Some(Duration::from_secs(600))) // Close idle connections after 10 minutes
        .max_lifetime(Some(Duration::from_secs(3600))) // Recycle connections after 1 hour
        .connect(&settings.url)
        .await
        .map_err(|e| {
            Error::Database {
                operation: "create connection pool".to_string(),
                source: e.into(),
            }
        })?;

    info!(
        max_connections = settings.max_connections,
        "Database connection pool created successfully"
    );

    Ok(pool)
}

/// Verify database connectivity by running a simple query
///
/// This function executes `SELECT 1` to ensure the database is reachable
/// and the connection pool is working correctly.
///
/// # Arguments
///
/// * `pool` - The PostgreSQL connection pool to test
///
/// # Errors
///
/// Returns `Error::Database` if the query fails
pub async fn verify_connection(pool: &PgPool) -> Result<()> {
    debug!("Verifying database connection");

    sqlx::query("SELECT 1")
        .execute(pool)
        .await
        .map_err(|e| {
            Error::Database {
                operation: "verify connection".to_string(),
                source: e.into(),
            }
        })?;

    info!("Database connection verified");

    Ok(())
}

/// Sanitize database URL for logging (remove password)
fn sanitize_url(url: &str) -> String {
    if let Some(at_pos) = url.find('@') {
        if let Some(scheme_end) = url.find("://") {
            let scheme = &url[..scheme_end + 3];
            let host_and_path = &url[at_pos..];
            return format!("{}***:***{}", scheme, host_and_path);
        }
    }
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_url() {
        let url = "postgres://user:password@localhost:5432/db";
        let sanitized = sanitize_url(url);
        assert!(!sanitized.contains("password"));
        assert!(sanitized.contains("localhost:5432/db"));
    }

    #[tokio::test]
    async fn test_create_pool_invalid_url() {
        let settings = DatabaseSettings {
            url: "invalid://url".to_string(),
            max_connections: 5,
            connect_timeout_seconds: 1,
        };

        let result = create_pool(&settings).await;
        assert!(result.is_err());
    }
}
