//! Configuration loading and validation
//!
//! This module handles the layered configuration loading strategy:
//! 1. Default values (hardcoded in repath-common)
//! 2. Configuration file (deployguard.toml or path from --config flag)
//! 3. Environment variables (REPATH_* prefix)
//! 4. Command-line arguments (highest priority, not implemented in gateway binary)
//!
//! Environment variable mapping:
//! - REPATH_SERVER_PORT -> config.server.port
//! - REPATH_DATABASE_URL -> config.database.url
//! - REPATH_REDIS_URL -> config.redis.url

use repath_common::{config::ServerConfig, Error, Result};
use std::path::Path;
use tracing::{debug, info};

/// Default configuration file path
const DEFAULT_CONFIG_PATH: &str = "repath.toml";

/// Load configuration from file and environment
///
/// This function implements the configuration hierarchy:
/// 1. Load from file (default: repath.toml in current directory)
/// 2. Override with environment variables
/// 3. Validate the final configuration
///
/// # Environment Variables
///
/// - REPATH_CONFIG_PATH: Override default config file path
/// - REPATH_SERVER_HOST: Override server host
/// - REPATH_SERVER_PORT: Override server port
/// - REPATH_DATABASE_URL: Override database URL
/// - REPATH_REDIS_URL: Override Redis URL
///
/// # Errors
///
/// Returns `Error::Config` if:
/// - Configuration file cannot be read
/// - TOML parsing fails
/// - Environment variable values are invalid
/// - Validation fails
pub fn load_config() -> Result<ServerConfig> {
    // Determine config file path
    let config_path =
        std::env::var("REPATH_CONFIG_PATH").unwrap_or_else(|_| DEFAULT_CONFIG_PATH.to_string());

    debug!(path = %config_path, "Loading configuration file");

    // Check if config file exists
    let config = if Path::new(&config_path).exists() {
        info!(path = %config_path, "Loading configuration from file");
        ServerConfig::from_file_with_env(&config_path)?
    } else {
        // If no config file exists, use defaults and environment only
        info!("No configuration file found, using defaults + environment variables");

        // Create minimal valid config
        let toml = r#"
            [server]
            host = "0.0.0.0"
            port = 8080

            [database]
            url = "postgres://repath:repath@localhost:5432/repath"

            [redis]
            url = "redis://localhost:6379"
        "#;

        let mut config = ServerConfig::from_toml(toml)?;

        // Apply environment overrides
        apply_env_overrides(&mut config)?;

        config
    };

    // Log loaded configuration (sanitized - no secrets)
    info!(
        server_host = %config.server.host,
        server_port = config.server.port,
        metrics_port = config.server.metrics_port,
        db_host = %sanitize_connection_string(&config.database.url),
        redis_host = %sanitize_connection_string(&config.redis.url),
        "Configuration loaded successfully"
    );

    Ok(config)
}

/// Apply environment variable overrides to configuration
///
/// This function checks for REPATH_* environment variables and applies them
/// to the configuration struct, overriding file-based values.
fn apply_env_overrides(config: &mut ServerConfig) -> Result<()> {
    // Server overrides
    if let Ok(host) = std::env::var("REPATH_SERVER_HOST") {
        debug!(old = %config.server.host, new = %host, "Overriding server host from environment");
        config.server.host = host;
    }

    if let Ok(port_str) = std::env::var("REPATH_SERVER_PORT") {
        let port = port_str.parse::<u16>().map_err(|e| Error::Config {
            message: format!("Invalid REPATH_SERVER_PORT: {}", port_str),
            source: Some(e.into()),
        })?;
        debug!(
            old = config.server.port,
            new = port,
            "Overriding server port from environment"
        );
        config.server.port = port;
    }

    if let Ok(metrics_port_str) = std::env::var("REPATH_METRICS_PORT") {
        let port = metrics_port_str.parse::<u16>().map_err(|e| Error::Config {
            message: format!("Invalid REPATH_METRICS_PORT: {}", metrics_port_str),
            source: Some(e.into()),
        })?;
        debug!(
            old = config.server.metrics_port,
            new = port,
            "Overriding metrics port from environment"
        );
        config.server.metrics_port = port;
    }

    // Database overrides
    if let Ok(url) = std::env::var("REPATH_DATABASE_URL") {
        debug!("Overriding database URL from environment");
        config.database.url = url;
    }

    // Redis overrides
    if let Ok(url) = std::env::var("REPATH_REDIS_URL") {
        debug!("Overriding Redis URL from environment");
        config.redis.url = url;
    }

    // Evaluation overrides
    if let Ok(sample_rate_str) = std::env::var("REPATH_EVALUATION_SAMPLE_RATE") {
        let sample_rate = sample_rate_str.parse::<f64>().map_err(|e| Error::Config {
            message: format!("Invalid REPATH_EVALUATION_SAMPLE_RATE: {}", sample_rate_str),
            source: Some(e.into()),
        })?;
        debug!(
            old = config.evaluation.sample_rate,
            new = sample_rate,
            "Overriding evaluation sample rate from environment"
        );
        config.evaluation.sample_rate = sample_rate;
    }

    Ok(())
}

/// Sanitize connection string for logging (remove credentials)
///
/// This function removes username:password from connection strings to prevent
/// secrets from appearing in logs.
///
/// # Examples
///
/// ```
/// use repath_gateway::config::sanitize_connection_string;
///
/// assert_eq!(
///     sanitize_connection_string("postgres://user:pass@localhost:5432/db"),
///     "postgres://***:***@localhost:5432/db"
/// );
/// ```
fn sanitize_connection_string(url: &str) -> String {
    // Parse URL and replace credentials
    if let Some(at_pos) = url.find('@') {
        if let Some(scheme_end) = url.find("://") {
            let scheme = &url[..scheme_end + 3]; // Include "://"
            let host_and_path = &url[at_pos..]; // Include "@" onwards
            return format!("{}***:***{}", scheme, host_and_path);
        }
    }

    // If parsing fails, return as-is (shouldn't happen with valid URLs)
    url.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_postgres_url() {
        let url = "postgres://user:secretpass@localhost:5432/repath";
        let sanitized = sanitize_connection_string(url);
        assert_eq!(sanitized, "postgres://***:***@localhost:5432/repath");
        assert!(!sanitized.contains("secretpass"));
    }

    #[test]
    fn test_sanitize_redis_url() {
        let url = "redis://user:password@redis.example.com:6379/0";
        let sanitized = sanitize_connection_string(url);
        assert_eq!(sanitized, "redis://***:***@redis.example.com:6379/0");
        assert!(!sanitized.contains("password"));
    }

    #[test]
    fn test_sanitize_url_without_credentials() {
        let url = "redis://localhost:6379";
        let sanitized = sanitize_connection_string(url);
        // Should return original since no credentials to remove
        assert_eq!(sanitized, url);
    }

    #[test]
    fn test_load_config_with_defaults() {
        // Test that config loading doesn't panic with minimal environment
        std::env::remove_var("REPATH_CONFIG_PATH");
        std::env::set_var("REPATH_DATABASE_URL", "postgres://test:test@localhost/test");

        let result = load_config();

        // Clean up
        std::env::remove_var("REPATH_DATABASE_URL");

        assert!(result.is_ok());
    }

    // Note: env var mutation tests run serially via a mutex to prevent
    // cross-test pollution when cargo test runs them in parallel threads.
    static ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[test]
    fn test_apply_env_overrides_port() {
        let _guard = ENV_MUTEX.lock().unwrap();

        let mut config = ServerConfig::from_toml(
            r#"
            [server]
            host = "0.0.0.0"
            port = 8080

            [database]
            url = "postgres://localhost/test"
        "#,
        )
        .unwrap();

        std::env::set_var("REPATH_SERVER_PORT", "9000");
        let result = apply_env_overrides(&mut config);
        std::env::remove_var("REPATH_SERVER_PORT");

        result.unwrap();
        assert_eq!(config.server.port, 9000);
    }

    #[test]
    fn test_apply_env_overrides_invalid_port() {
        let _guard = ENV_MUTEX.lock().unwrap();

        let mut config = ServerConfig::from_toml(
            r#"
            [server]
            host = "0.0.0.0"
            port = 8080

            [database]
            url = "postgres://localhost/test"
        "#,
        )
        .unwrap();

        std::env::set_var("REPATH_SERVER_PORT", "not_a_number");
        let result = apply_env_overrides(&mut config);
        std::env::remove_var("REPATH_SERVER_PORT");

        assert!(result.is_err());
    }
}
