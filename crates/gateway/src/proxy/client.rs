//! HTTP client configuration and management
//!
//! This module creates a properly-configured reqwest client for proxying requests
//! to upstream providers. The client includes:
//! - Connection pooling (reuse TCP connections)
//! - Configurable timeouts
//! - HTTP/2 support
//! - Compression (gzip, brotli)

use repath_common::{config::ServerConfig, Error, Result};
use reqwest::Client;
use std::time::Duration;
use tracing::info;

/// Create an HTTP client optimized for proxying LLM API requests
///
/// The client is configured with:
/// - Connection pooling (100 connections per host)
/// - 60-second timeout for long-running LLM requests
/// - HTTP/2 enabled for better performance
/// - Automatic decompression (gzip, br)
/// - User-Agent header identifying Repath
///
/// # Performance Considerations
///
/// - Connection pooling significantly reduces latency by reusing TCP connections
/// - HTTP/2 multiplexing allows multiple requests on a single connection
/// - Compression reduces bandwidth usage for large responses
///
/// # Arguments
///
/// * `config` - Server configuration containing timeout settings
///
/// # Errors
///
/// Returns `Error::Internal` if client creation fails (rare - usually indicates
/// invalid TLS configuration or system resource exhaustion)
pub fn create_http_client(config: &ServerConfig) -> Result<Client> {
    let timeout_duration = Duration::from_secs(config.server.timeout_seconds);

    let client = Client::builder()
        // Connection pooling: maintain up to 100 connections per host
        .pool_max_idle_per_host(100)
        // Timeout for entire request (including response body streaming)
        .timeout(timeout_duration)
        // HTTP/2 via ALPN over TLS (standard negotiation).
        // Note: http2_prior_knowledge() is only for plaintext HTTP/2 (h2c),
        // NOT for HTTPS — OpenAI/Anthropic use HTTPS so we let TLS ALPN decide.
        // Enable automatic decompression
        .gzip(true)
        .brotli(true)
        // Set User-Agent to identify Repath
        .user_agent(format!("Repath-Gateway/{}", env!("CARGO_PKG_VERSION")))
        // Build the client
        .build()
        .map_err(|e| {
            Error::Internal {
                message: "Failed to create HTTP client".to_string(),
                source: Some(e.into()),
            }
        })?;

    info!(
        timeout_seconds = config.server.timeout_seconds,
        "HTTP client created with connection pooling"
    );

    Ok(client)
}

#[cfg(test)]
mod tests {
    use super::*;
    use repath_common::config::{DatabaseSettings, ServerSettings};
    use std::collections::HashMap;

    #[test]
    fn test_create_http_client() {
        let config = ServerConfig {
            server: ServerSettings {
                host: "0.0.0.0".to_string(),
                port: 8080,
                metrics_port: 9090,
                timeout_seconds: 30,
            },
            database: DatabaseSettings {
                url: "postgres://localhost/test".to_string(),
                max_connections: 10,
                connect_timeout_seconds: 5,
            },
            redis: repath_common::config::RedisSettings::default(),
            providers: HashMap::new(),
            evaluation: repath_common::config::EvaluationSettings::default(),
            controller: repath_common::config::ControllerSettings::default(),
            observability: repath_common::config::ObservabilitySettings::default(),
        };

        let client = create_http_client(&config);
        assert!(client.is_ok());
    }
}
