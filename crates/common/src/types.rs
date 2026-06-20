//! Core domain types for Repath.
//!
//! This module defines the fundamental entities in the Repath system:
//! - Providers (OpenAI, Anthropic, etc.)
//! - Versions (model + prompt + parameters)
//! - Rollouts (transitions from baseline to candidate)
//! - Requests (proxied LLM API calls)
//! - Evaluations (quality scores)
//! - Decisions (controller actions)

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use uuid::Uuid;

// ================================================================================================
// Provider Configuration
// ================================================================================================

/// AI provider configuration (OpenAI, Anthropic, Gemini, etc.).
///
/// A provider represents an LLM API endpoint. Each provider has authentication credentials
/// and a base URL. The gateway uses this to route requests to the correct upstream.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Provider {
    pub id: Uuid,
    pub name: String,
    /// Base URL for the provider API (e.g., "https://api.openai.com/v1")
    pub base_url: String,
    /// Encrypted API key (encrypted at rest, decrypted when needed)
    pub api_key_encrypted: String,
    pub created_at: DateTime<Utc>,
}

/// Type of provider (determines request/response format).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ProviderType {
    OpenAI,
    Anthropic,
    Gemini,
    Azure,
}

impl ProviderType {
    pub fn as_str(&self) -> &'static str {
        match self {
            ProviderType::OpenAI => "openai",
            ProviderType::Anthropic => "anthropic",
            ProviderType::Gemini => "gemini",
            ProviderType::Azure => "azure",
        }
    }
}

// ================================================================================================
// Version (Model + Prompt + Parameters)
// ================================================================================================

/// A specific configuration of an LLM: model, prompt, and generation parameters.
///
/// Versions are immutable once created. When you want to change a prompt or model,
/// you create a new version and use a rollout to migrate traffic.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Version {
    pub id: Uuid,
    pub name: String,
    pub provider_id: Uuid,
    pub model: String,
    /// System prompt template (can contain variables like {{user_name}})
    pub prompt_template: Option<String>,
    /// Generation parameters (temperature, max_tokens, top_p, etc.)
    #[serde(default)]
    pub parameters: VersionParameters,
    pub created_at: DateTime<Utc>,
}

/// LLM generation parameters.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VersionParameters {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f64>,
    /// Additional provider-specific parameters
    #[serde(flatten)]
    pub extra: HashMap<String, serde_json::Value>,
}

impl Default for VersionParameters {
    fn default() -> Self {
        Self {
            temperature: None,
            max_tokens: None,
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            extra: HashMap::new(),
        }
    }
}

// ================================================================================================
// Rollout
// ================================================================================================

/// A progressive rollout from a baseline version to a candidate version.
///
/// The rollout tracks the current state, traffic weight, and policy for advancing/rolling back.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Rollout {
    pub id: Uuid,
    pub name: String,
    pub baseline_version_id: Uuid,
    pub candidate_version_id: Uuid,
    pub state: RolloutState,
    /// Current percentage of traffic going to candidate (0.0 = 0%, 1.0 = 100%)
    pub current_weight: f64,
    pub policy: RolloutPolicy,
    pub strategy: RolloutStrategy,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub completed_at: Option<DateTime<Utc>>,
}

/// Rollout state machine.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, strum_macros::Display)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "SCREAMING_SNAKE_CASE")]
pub enum RolloutState {
    /// Rollout created but not yet started
    Created,
    /// Shadow mode: candidate runs in parallel but results not served to users
    Shadow,
    /// Canary mode: some percentage of traffic goes to candidate
    Canary,
    /// Rollout succeeded: 100% traffic on candidate
    Promoted,
    /// Rollout failed: rolled back to 100% baseline
    RolledBack,
    /// Rollout manually paused
    Paused,
}

impl RolloutState {
    pub fn is_active(&self) -> bool {
        matches!(self, RolloutState::Shadow | RolloutState::Canary)
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self, RolloutState::Promoted | RolloutState::RolledBack)
    }
}

/// Policy governing rollout decisions.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RolloutPolicy {
    /// Quality score must be >= this to advance to next step
    pub advance_threshold: f64,
    /// Quality score below this triggers immediate rollback
    pub rollback_threshold: f64,
    /// Minimum number of evaluations before making a decision
    pub min_samples: u32,
    /// Statistical confidence level required (0.0 - 1.0)
    pub confidence_level: f64,
    /// Maximum acceptable latency increase vs baseline (e.g., 1.2 = 20% increase)
    pub max_latency_increase: f64,
    /// Maximum acceptable error rate (e.g., 0.05 = 5%)
    pub max_error_rate: f64,
}

impl Default for RolloutPolicy {
    fn default() -> Self {
        Self {
            advance_threshold: 0.9,
            rollback_threshold: 0.7,
            min_samples: 100,
            confidence_level: 0.95,
            max_latency_increase: 1.2,
            max_error_rate: 0.05,
        }
    }
}

/// Rollout strategy defining steps and gates.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RolloutStrategy {
    pub strategy_type: StrategyType,
    pub steps: Vec<RolloutStep>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StrategyType {
    /// Gradual traffic increase: 5% → 25% → 50% → 100%
    Canary,
    /// Run candidate in parallel without serving (for evaluation only)
    Shadow,
    /// Instant switch with quick rollback capability
    BlueGreen,
}

/// A single step in a rollout strategy.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RolloutStep {
    pub step_number: u32,
    /// Target traffic weight for this step (0.0 - 1.0)
    pub target_weight: f64,
    /// Gate condition that must pass before advancing (e.g., "quality_score >= 0.9")
    pub gate_expression: String,
    /// Minimum time to stay at this step before advancing
    pub pause_duration_seconds: Option<u32>,
}

// ================================================================================================
// Request (Proxied API Call)
// ================================================================================================

/// A single proxied request through the Repath gateway.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub id: Uuid,
    pub rollout_id: Option<Uuid>,
    pub version_id: Uuid,
    /// Hash of request content (for matching shadow requests)
    pub request_hash: String,
    pub model: String,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    /// Request duration in milliseconds
    pub latency_ms: u32,
    pub status_code: u16,
    pub error: Option<String>,
    /// Session identifier for sticky sessions
    pub session_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

// ================================================================================================
// Evaluation
// ================================================================================================

/// Quality evaluation for a request/response pair.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Evaluation {
    pub id: Uuid,
    pub request_id: Uuid,
    pub evaluator_type: EvaluatorType,
    /// Individual scores per criterion (e.g., {"accuracy": 0.9, "helpfulness": 0.85})
    pub scores: HashMap<String, f64>,
    /// Weighted composite score (0.0 - 1.0)
    pub overall_score: f64,
    /// Evaluator metadata (model used, latency, etc.)
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvaluatorType {
    /// Fast programmatic checks (response not empty, valid JSON, etc.)
    Programmatic,
    /// Embedding similarity to baseline responses
    Embedding,
    /// LLM-as-judge scoring
    LlmJudge,
    /// Human feedback from end users
    Human,
}

// ================================================================================================
// Decision (Controller Action)
// ================================================================================================

/// A decision made by the rollout controller.
///
/// Every state transition and weight change is recorded as a decision for auditability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Decision {
    pub id: Uuid,
    pub rollout_id: Uuid,
    pub action: DecisionAction,
    /// Human-readable explanation of why this decision was made
    pub reason: String,
    pub previous_weight: Option<f64>,
    pub new_weight: Option<f64>,
    pub triggered_by: DecisionTrigger,
    /// Snapshot of metrics at decision time
    pub metrics_snapshot: Option<MetricsSnapshot>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionAction {
    /// Increase traffic weight to candidate
    Advance,
    /// Decrease traffic weight (or set to 0) back to baseline
    Rollback,
    /// Pause the rollout
    Pause,
    /// Resume a paused rollout
    Resume,
    /// Mark rollout as promoted (complete)
    Promote,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DecisionTrigger {
    /// Automated decision by controller
    Controller,
    /// Manual action via CLI/API
    Manual,
    /// Scheduled action
    Schedule,
}

/// Snapshot of system metrics at a point in time.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetricsSnapshot {
    pub quality_score_baseline: Option<f64>,
    pub quality_score_candidate: Option<f64>,
    pub latency_p95_baseline: Option<u32>,
    pub latency_p95_candidate: Option<u32>,
    pub error_rate_baseline: Option<f64>,
    pub error_rate_candidate: Option<f64>,
    pub sample_size_baseline: u32,
    pub sample_size_candidate: u32,
}

// ================================================================================================
// Configuration Types (from YAML/TOML)
// ================================================================================================

/// Root configuration for a rollout (from rollout.yaml).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolloutConfig {
    #[serde(rename = "apiVersion")]
    pub api_version: String,
    pub kind: String,
    pub metadata: RolloutMetadata,
    pub spec: RolloutSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolloutMetadata {
    pub name: String,
    #[serde(default)]
    pub labels: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RolloutSpec {
    pub baseline: VersionSpec,
    pub candidate: VersionSpec,
    pub strategy: StrategySpec,
    #[serde(default)]
    pub evaluation: Vec<EvaluationSpec>,
    #[serde(default)]
    pub routing: RoutingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionSpec {
    pub provider: String,
    pub model: String,
    #[serde(default)]
    pub prompt: PromptSpec,
    #[serde(default)]
    pub parameters: VersionParameters,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PromptSpec {
    pub system: Option<String>,
    pub user: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StrategySpec {
    #[serde(rename = "type")]
    pub strategy_type: StrategyType,
    pub steps: Vec<StepSpec>,
    pub rollback: RollbackSpec,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StepSpec {
    pub weight: u8, // Percentage (0-100)
    #[serde(default)]
    pub duration: Option<String>, // e.g., "10m", "1h"
    #[serde(default)]
    pub gate: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RollbackSpec {
    pub trigger: HashMap<String, String>,
    pub action: String,
    #[serde(default)]
    pub cooldown: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvaluationSpec {
    #[serde(rename = "type")]
    pub evaluator_type: String,
    #[serde(default)]
    pub checks: Vec<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub criteria: Vec<CriterionSpec>,
    #[serde(default = "default_sample_rate")]
    pub sample_rate: f64,
}

fn default_sample_rate() -> f64 {
    1.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CriterionSpec {
    pub name: String,
    pub prompt: String,
    pub weight: f64,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RoutingConfig {
    #[serde(default)]
    pub sticky_sessions: bool,
    pub session_key: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rollout_state_transitions() {
        let state = RolloutState::Created;
        assert!(!state.is_active());
        assert!(!state.is_terminal());

        let state = RolloutState::Canary;
        assert!(state.is_active());
        assert!(!state.is_terminal());

        let state = RolloutState::Promoted;
        assert!(!state.is_active());
        assert!(state.is_terminal());
    }

    #[test]
    fn test_default_rollout_policy() {
        let policy = RolloutPolicy::default();
        assert_eq!(policy.advance_threshold, 0.9);
        assert_eq!(policy.rollback_threshold, 0.7);
        assert_eq!(policy.min_samples, 100);
    }

    #[test]
    fn test_version_parameters_serialization() {
        let params = VersionParameters {
            temperature: Some(0.7),
            max_tokens: Some(1024),
            top_p: None,
            frequency_penalty: None,
            presence_penalty: None,
            extra: HashMap::new(),
        };

        let json = serde_json::to_string(&params).unwrap();
        assert!(json.contains("temperature"));
        assert!(json.contains("max_tokens"));
        assert!(!json.contains("top_p")); // Should be omitted
    }
}
