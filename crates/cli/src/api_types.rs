//! Response shapes returned by the management API.
//!
//! These mirror the serialised structs in the gateway's `api::handlers`. They
//! are declared here rather than shared through `repath-common` deliberately:
//! the CLI is a client of a versioned HTTP API, and a field the gateway adds
//! should not break an older CLI. Every optional field is therefore `Option`
//! and unknown fields are ignored.

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct RolloutList {
    pub rollouts: Vec<RolloutSummary>,
}

#[derive(Debug, Deserialize)]
pub struct RolloutSummary {
    /// Not displayed in the list view (names are friendlier), but kept so a
    /// caller piping `--json` still gets a stable identifier.
    #[allow(dead_code)]
    pub id: Uuid,
    pub name: String,
    pub state: String,
    pub current_weight: f64,
    pub baseline_model: String,
    pub candidate_model: String,
    pub avg_quality_candidate: Option<f64>,
    pub avg_quality_baseline: Option<f64>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct RolloutDetail {
    pub id: Uuid,
    pub name: String,
    pub state: String,
    pub current_weight: f64,
    pub baseline_model: String,
    pub candidate_model: String,
    pub baseline_prompt: Option<String>,
    pub candidate_prompt: Option<String>,
    pub avg_quality_baseline: Option<f64>,
    pub avg_quality_candidate: Option<f64>,
    pub p95_latency_baseline: Option<i64>,
    pub p95_latency_candidate: Option<i64>,
    pub error_rate_baseline: Option<f64>,
    pub error_rate_candidate: Option<f64>,
    pub sample_count_baseline: Option<i64>,
    pub sample_count_candidate: Option<i64>,
    pub created_at: DateTime<Utc>,
    #[allow(dead_code)]
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct StepList {
    pub steps: Vec<StepInfo>,
}

#[derive(Debug, Deserialize)]
pub struct StepInfo {
    pub step_number: i32,
    pub target_weight: f64,
    pub gate_expression: Option<String>,
    pub status: String,
    #[allow(dead_code)]
    pub pause_duration_seconds: Option<i32>,
    #[allow(dead_code)]
    pub started_at: Option<DateTime<Utc>>,
    #[allow(dead_code)]
    pub completed_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Deserialize)]
pub struct DecisionList {
    pub decisions: Vec<DecisionInfo>,
}

#[derive(Debug, Deserialize)]
pub struct DecisionInfo {
    pub action: String,
    pub reason: Option<String>,
    pub previous_weight: Option<f64>,
    pub new_weight: Option<f64>,
    pub triggered_by: Option<String>,
    #[allow(dead_code)]
    pub metrics_snapshot: Option<Value>,
    pub created_at: DateTime<Utc>,
}

/// Response to any action that just reports an outcome (promote, pause, …).
#[derive(Debug, Deserialize)]
pub struct MessageResponse {
    pub message: String,
}

/// Response to a successful rollout create.
#[derive(Debug, Deserialize)]
pub struct CreatedRollout {
    pub id: Uuid,
    pub name: String,
    pub steps: usize,
}

#[derive(Debug, Deserialize)]
pub struct DeletedResponse {
    #[allow(dead_code)]
    pub deleted: bool,
}
