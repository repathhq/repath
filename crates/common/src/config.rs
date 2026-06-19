//! Configuration loading and parsing.
//!
//! Repath uses a layered configuration approach:
//! 1. Default values (hardcoded)
//! 2. Config file (deployguard.toml)
//! 3. Environment variables (overrides)
//! 4. Runtime overrides (from CLI flags)

use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Root server configuration.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    pub server: ServerSettings,
    pub database: DatabaseSettings,
    #[serde(default)]
    pub redis: RedisSettings,
    #[serde(default)]
    pub providers: HashMap<String, ProviderSettings>,
    #[serde(default)]
    pub evaluation: EvaluationSettings,
    #[serde(default)]
    pub controller: ControllerSettings,
    #[serde(default)]
    pub observability: ObservabilitySettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerSettings {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default = "default_metrics_port")]
    pub metrics_port: u16,
    #[serde(default = "default_timeout_seconds")]
    pub timeout_seconds: u64,
}

fn default_host() -> String {
    "0.0.0.0".to_string()
}

fn default_port() -> u16 {
    8080
}

fn default_metrics_port() -> u16 {
    9090
}

fn default_timeout_seconds() -> u64 {
    30
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseSettings {
    pub url: String,
    #[serde(default = "default_max_connections")]
    pub max_connections: u32,
    #[serde(default = "default_connect_timeout")]
    pub connect_timeout_seconds: u64,
}

fn default_max_connections() -> u32 {
    10
}

fn default_connect_timeout() -> u64 {
    5
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedisSettings {
    #[serde(default = "default_redis_url")]
    pub url: String,
    #[serde(default = "default_eval_stream")]
    pub eval_stream_name: String,
}

fn default_redis_url() -> String {
    "redis://localhost:6379".to_string()
}

fn default_eval_stream() -> String {
    "repath:evaluations".to_string()
}

impl Default for RedisSettings {
    fn default() -> Self {
        Self {
            url: default_redis_url(),
            eval_stream_name: default_eval_stream(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProviderSettings {
    pub api_key: String,
    pub base_url: String,
    #[serde(default = "default_provider_timeout")]
    pub timeout_seconds: u64,
}

fn default_provider_timeout() -> u64 {
    60
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationSettings {
    #[serde(default = "default_evaluator")]
    pub default_evaluator: String,
    #[serde(default = "default_sample_rate")]
    pub sample_rate: f64,
    #[serde(default)]
    pub programmatic: ProgrammaticEvalSettings,
    #[serde(default)]
    pub llm_judge: LlmJudgeSettings,
}

fn default_evaluator() -> String {
    "programmatic".to_string()
}

fn default_sample_rate() -> f64 {
    1.0
}

impl Default for EvaluationSettings {
    fn default() -> Self {
        Self {
            default_evaluator: default_evaluator(),
            sample_rate: default_sample_rate(),
            programmatic: ProgrammaticEvalSettings::default(),
            llm_judge: LlmJudgeSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgrammaticEvalSettings {
    #[serde(default = "default_checks")]
    pub checks: Vec<String>,
}

fn default_checks() -> Vec<String> {
    vec![
        "response_not_empty".to_string(),
        "valid_json".to_string(),
        "latency_under_5s".to_string(),
    ]
}

impl Default for ProgrammaticEvalSettings {
    fn default() -> Self {
        Self {
            checks: default_checks(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LlmJudgeSettings {
    #[serde(default = "default_judge_model")]
    pub model: String,
    #[serde(default = "default_judge_provider")]
    pub provider: String,
}

fn default_judge_model() -> String {
    "gpt-4o-mini".to_string()
}

fn default_judge_provider() -> String {
    "openai".to_string()
}

impl Default for LlmJudgeSettings {
    fn default() -> Self {
        Self {
            model: default_judge_model(),
            provider: default_judge_provider(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ControllerSettings {
    /// How often the controller checks metrics and makes decisions (seconds)
    #[serde(default = "default_decision_interval")]
    pub decision_interval_seconds: u64,
    /// Minimum samples required before making any decision
    #[serde(default = "default_min_samples")]
    pub min_samples_per_decision: u32,
    /// Statistical confidence level for decisions
    #[serde(default = "default_confidence")]
    pub confidence_level: f64,
}

fn default_decision_interval() -> u64 {
    30
}

fn default_min_samples() -> u32 {
    100
}

fn default_confidence() -> f64 {
    0.95
}

impl Default for ControllerSettings {
    fn default() -> Self {
        Self {
            decision_interval_seconds: default_decision_interval(),
            min_samples_per_decision: default_min_samples(),
            confidence_level: default_confidence(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ObservabilitySettings {
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default = "default_log_format")]
    pub log_format: String,
    #[serde(default)]
    pub enable_tracing: bool,
    #[serde(default)]
    pub enable_metrics: bool,
}

fn default_log_level() -> String {
    "info".to_string()
}

fn default_log_format() -> String {
    "json".to_string()
}

impl Default for ObservabilitySettings {
    fn default() -> Self {
        Self {
            log_level: default_log_level(),
            log_format: default_log_format(),
            enable_tracing: true,
            enable_metrics: true,
        }
    }
}

impl ServerConfig {
    /// Load configuration from a TOML file.
    pub fn from_file<P: AsRef<Path>>(path: P) -> Result<Self> {
        let content = std::fs::read_to_string(path.as_ref()).map_err(|e| Error::Config {
            message: format!("Failed to read config file: {}", path.as_ref().display()),
            source: Some(e.into()),
        })?;

        Self::from_toml(&content)
    }

    /// Parse configuration from TOML string.
    pub fn from_toml(toml: &str) -> Result<Self> {
        toml::from_str(toml).map_err(|e| Error::Config {
            message: "Failed to parse TOML config".to_string(),
            source: Some(e.into()),
        })
    }

    /// Load configuration with environment variable overrides.
    ///
    /// Environment variables follow the pattern: REPATH_<SECTION>_<KEY>
    /// Example: REPATH_SERVER_PORT=8080
    pub fn from_file_with_env<P: AsRef<Path>>(path: P) -> Result<Self> {
        let mut config = Self::from_file(path)?;

        // Override with environment variables
        if let Ok(port) = std::env::var("REPATH_SERVER_PORT") {
            config.server.port = port.parse().map_err(|e| Error::Config {
                message: "Invalid REPATH_SERVER_PORT".to_string(),
                source: Some(anyhow::Error::from(e)),
            })?;
        }

        if let Ok(db_url) = std::env::var("REPATH_DATABASE_URL") {
            config.database.url = db_url;
        }

        if let Ok(redis_url) = std::env::var("REPATH_REDIS_URL") {
            config.redis.url = redis_url;
        }

        Ok(config)
    }

    /// Validate the configuration.
    pub fn validate(&self) -> Result<()> {
        // Validate port ranges
        if self.server.port == 0 {
            return Err(Error::Config {
                message: "Server port cannot be 0".to_string(),
                source: None,
            });
        }

        if self.server.metrics_port == 0 {
            return Err(Error::Config {
                message: "Metrics port cannot be 0".to_string(),
                source: None,
            });
        }

        if self.server.port == self.server.metrics_port {
            return Err(Error::Config {
                message: "Server port and metrics port cannot be the same".to_string(),
                source: None,
            });
        }

        // Validate database URL
        if self.database.url.is_empty() {
            return Err(Error::Config {
                message: "Database URL cannot be empty".to_string(),
                source: None,
            });
        }

        // Validate controller settings
        if self.controller.confidence_level < 0.0 || self.controller.confidence_level > 1.0 {
            return Err(Error::Config {
                message: "Controller confidence level must be between 0.0 and 1.0".to_string(),
                source: None,
            });
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_server_config() {
        let config = ServerSettings {
            host: default_host(),
            port: default_port(),
            metrics_port: default_metrics_port(),
            timeout_seconds: default_timeout_seconds(),
        };

        assert_eq!(config.host, "0.0.0.0");
        assert_eq!(config.port, 8080);
        assert_eq!(config.metrics_port, 9090);
    }

    #[test]
    fn test_config_validation() {
        let mut config = ServerConfig {
            server: ServerSettings {
                host: "0.0.0.0".to_string(),
                port: 8080,
                metrics_port: 9090,
                timeout_seconds: 30,
            },
            database: DatabaseSettings {
                url: "postgres://localhost/repath".to_string(),
                max_connections: 10,
                connect_timeout_seconds: 5,
            },
            redis: RedisSettings::default(),
            providers: HashMap::new(),
            evaluation: EvaluationSettings::default(),
            controller: ControllerSettings::default(),
            observability: ObservabilitySettings::default(),
        };

        assert!(config.validate().is_ok());

        // Test invalid port
        config.server.port = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_parse_toml_config() {
        let toml = r#"
            [server]
            host = "127.0.0.1"
            port = 3000

            [database]
            url = "postgres://localhost/test"
        "#;

        let config = ServerConfig::from_toml(toml).unwrap();
        assert_eq!(config.server.host, "127.0.0.1");
        assert_eq!(config.server.port, 3000);
        assert_eq!(config.database.url, "postgres://localhost/test");
    }
}
