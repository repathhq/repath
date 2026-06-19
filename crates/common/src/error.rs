//! Error types for Repath.
//!
//! This module defines a comprehensive error hierarchy that:
//! - Provides context at every error site
//! - Maps cleanly to HTTP status codes for API responses
//! - Includes structured fields for observability (trace IDs, resource IDs, etc.)
//! - Distinguishes between client errors (4xx) and server errors (5xx)

/// Result type alias for Repath operations.
pub type Result<T> = std::result::Result<T, Error>;

/// Top-level error type for all Repath operations.
///
/// Each variant represents a distinct failure mode and carries enough context
/// to diagnose the problem without additional logging.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Configuration is invalid or missing required fields.
    #[error("Configuration error: {message}")]
    Config {
        message: String,
        #[source]
        source: Option<anyhow::Error>,
    },

    /// Database operation failed.
    #[error("Database error: {operation} failed")]
    Database {
        operation: String,
        #[source]
        source: anyhow::Error,
    },

    /// External provider (OpenAI, Anthropic, etc.) returned an error.
    #[error("Provider '{provider}' error: {message}")]
    Provider {
        provider: String,
        message: String,
        status_code: Option<u16>,
        #[source]
        source: Option<anyhow::Error>,
    },

    /// Request validation failed (invalid input from client).
    #[error("Validation error: {message}")]
    Validation {
        message: String,
        field: Option<String>,
    },

    /// Requested resource was not found.
    #[error("{resource_type} not found: {resource_id}")]
    NotFound {
        resource_type: String,
        resource_id: String,
    },

    /// Operation conflicts with current state (e.g., rollout already exists).
    #[error("Conflict: {message}")]
    Conflict { message: String },

    /// Operation not permitted in current state.
    #[error("Invalid state transition: {message}")]
    InvalidState { message: String },

    /// Serialization/deserialization failed.
    #[error("Serialization error: {context}")]
    Serialization {
        context: String,
        #[source]
        source: anyhow::Error,
    },

    /// Network I/O error.
    #[error("Network error: {context}")]
    Network {
        context: String,
        #[source]
        source: anyhow::Error,
    },

    /// Internal error that indicates a bug (should never happen in correct code).
    #[error("Internal error: {message}")]
    Internal {
        message: String,
        #[source]
        source: Option<anyhow::Error>,
    },
}

impl Error {
    /// Returns the HTTP status code that should be returned for this error.
    pub fn status_code(&self) -> u16 {
        match self {
            Error::Config { .. } => 500,
            Error::Database { .. } => 500,
            Error::Provider { status_code, .. } => status_code.unwrap_or(502),
            Error::Validation { .. } => 400,
            Error::NotFound { .. } => 404,
            Error::Conflict { .. } => 409,
            Error::InvalidState { .. } => 409,
            Error::Serialization { .. } => 400,
            Error::Network { .. } => 502,
            Error::Internal { .. } => 500,
        }
    }

    /// Returns true if this error is considered a client error (4xx).
    pub fn is_client_error(&self) -> bool {
        matches!(
            self,
            Error::Validation { .. }
                | Error::NotFound { .. }
                | Error::Conflict { .. }
                | Error::InvalidState { .. }
                | Error::Serialization { .. }
        )
    }

    /// Returns true if this error is considered a server error (5xx).
    pub fn is_server_error(&self) -> bool {
        !self.is_client_error()
    }
}

// Conversion helpers for common error sources
impl From<sqlx::Error> for Error {
    fn from(err: sqlx::Error) -> Self {
        Error::Database {
            operation: "database query".to_string(),
            source: err.into(),
        }
    }
}

impl From<serde_json::Error> for Error {
    fn from(err: serde_json::Error) -> Self {
        Error::Serialization {
            context: "JSON".to_string(),
            source: err.into(),
        }
    }
}

impl From<serde_yaml::Error> for Error {
    fn from(err: serde_yaml::Error) -> Self {
        Error::Serialization {
            context: "YAML".to_string(),
            source: err.into(),
        }
    }
}
