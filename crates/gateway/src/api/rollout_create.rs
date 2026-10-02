//! `POST /api/v1/rollouts` — create a rollout over HTTP.
//!
//! # Why this exists
//!
//! Creating a rollout used to be possible only through the CLI, which opened a
//! direct PostgreSQL connection. In production that database sits in a private
//! subnet reachable only from the gateway host, so the central action of the
//! product could not be performed by a customer at all — onboarding meant an
//! operator running the CLI by hand. This endpoint is what makes Repath
//! self-serve.
//!
//! The gateway is now the single owner of this write. The CLI posts here rather
//! than talking to the database, so validation, tenant scoping and the
//! transaction boundary exist in exactly one place.
//!
//! # Atomicity
//!
//! A rollout spans four tables (providers, versions, rollouts, rollout_steps).
//! All of it runs in one transaction: a partial create that left an orphaned
//! version or a rollout with no steps would be picked up by the controller and
//! used to route production traffic.

use crate::{tenant::AuthContext, AppState};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    Extension,
};
use repath_common::types::{
    RolloutConfig, RolloutPolicy, RolloutStep, RolloutStrategy, StrategyType, VersionSpec,
};
use serde_json::json;
use sqlx::{Postgres, Row, Transaction};
use std::collections::HashMap;
use uuid::Uuid;

/// Ceiling on steps per rollout. Guards against a malformed or hostile request
/// creating an unbounded number of rows inside one transaction.
const MAX_STEPS: usize = 20;

/// Ceiling on a system prompt, in bytes. Well above any realistic prompt while
/// keeping a single request from writing megabytes.
const MAX_PROMPT_BYTES: usize = 100_000;

pub async fn create_rollout(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(config): Json<RolloutConfig>,
) -> Response {
    let tenant_id = auth.owning_tenant().to_string();

    if let Err(message) = validate_config(&config) {
        return error(StatusCode::BAD_REQUEST, message);
    }
    if let Err(message) = check_providers(&config, custom_providers_allowed()) {
        return error(StatusCode::BAD_REQUEST, message);
    }

    match insert_rollout(&state, &config, &tenant_id).await {
        Ok(rollout_id) => (
            StatusCode::CREATED,
            Json(json!({
                "id": rollout_id,
                "name": config.metadata.name,
                "state": "created",
                "steps": config.spec.strategy.steps.len(),
                "message": "Rollout created. The controller will begin routing traffic on its next cycle.",
            })),
        )
            .into_response(),

        Err(CreateError::DuplicateName) => error(
            StatusCode::CONFLICT,
            format!(
                "You already have a rollout named '{}'. Pick a different name or delete the existing one.",
                config.metadata.name
            ),
        ),
        Err(CreateError::Database(e)) => {
            tracing::error!(error = %e, tenant_id = %tenant_id, "Rollout create failed");
            error(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not create the rollout. Please try again.".to_string(),
            )
        }
    }
}

enum CreateError {
    DuplicateName,
    Database(sqlx::Error),
}

impl From<sqlx::Error> for CreateError {
    fn from(e: sqlx::Error) -> Self {
        // 23505 = unique_violation. The only unique constraint reachable here
        // is (tenant_id, name), so this is a duplicate rollout name.
        if let sqlx::Error::Database(ref db) = e {
            if db.code().as_deref() == Some("23505") {
                return CreateError::DuplicateName;
            }
        }
        CreateError::Database(e)
    }
}

async fn insert_rollout(
    state: &AppState,
    config: &RolloutConfig,
    tenant_id: &str,
) -> Result<Uuid, CreateError> {
    let rollout_id = Uuid::new_v4();
    let name = &config.metadata.name;

    let mut tx = state.db_pool.begin().await?;

    let baseline_provider = upsert_provider(&mut tx, config.spec.baseline.provider.trim()).await?;
    let candidate_provider =
        upsert_provider(&mut tx, config.spec.candidate.provider.trim()).await?;

    // Version names carry the rollout id so that recreating a same-named
    // rollout after deleting the old one cannot collide.
    let suffix = &rollout_id.to_string()[..8];
    let baseline_version = insert_version(
        &mut tx,
        &format!("{name}-baseline-{suffix}"),
        &baseline_provider,
        &config.spec.baseline,
    )
    .await?;
    let candidate_version = insert_version(
        &mut tx,
        &format!("{name}-candidate-{suffix}"),
        &candidate_provider,
        &config.spec.candidate,
    )
    .await?;

    let policy = serde_json::to_value(derive_policy(config)).unwrap_or_else(|_| json!({}));
    let strategy = serde_json::to_value(build_strategy(config)).unwrap_or_else(|_| json!({}));

    sqlx::query(
        r#"
        INSERT INTO rollouts (
            id, name, tenant_id, baseline_version_id, candidate_version_id,
            state, current_weight, policy, strategy, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 'created', 0.0, $6, $7, NOW(), NOW())
        "#,
    )
    .bind(rollout_id)
    .bind(name)
    .bind(tenant_id)
    .bind(baseline_version)
    .bind(candidate_version)
    .bind(&policy)
    .bind(&strategy)
    .execute(&mut *tx)
    .await?;

    for (i, step) in config.spec.strategy.steps.iter().enumerate() {
        sqlx::query(
            r#"
            INSERT INTO rollout_steps (
                id, rollout_id, step_number, target_weight,
                gate_expression, pause_duration_seconds, status
            ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
            "#,
        )
        .bind(Uuid::new_v4())
        .bind(rollout_id)
        .bind((i + 1) as i32)
        .bind(step.weight as f64 / 100.0)
        .bind(build_gate_expression(&step.gate))
        .bind(
            step.duration
                .as_deref()
                .and_then(parse_duration_secs)
                .map(|s| s as i32),
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;

    tracing::info!(
        rollout_id = %rollout_id,
        tenant_id = %tenant_id,
        name = %name,
        steps = config.spec.strategy.steps.len(),
        "Rollout created"
    );

    Ok(rollout_id)
}

/// Base URL and wire type for a provider the gateway knows by name.
fn known_provider(name: &str) -> Option<(&'static str, &'static str)> {
    Some(match name {
        "openai" => ("https://api.openai.com/v1", "openai"),
        "anthropic" => ("https://api.anthropic.com/v1", "anthropic"),
        "gemini" => (
            "https://generativelanguage.googleapis.com/v1beta/openai",
            "gemini",
        ),
        "openrouter" => ("https://openrouter.ai/api/v1", "openrouter"),
        _ => return None,
    })
}

/// Whether a rollout may name an arbitrary base URL as its provider.
///
/// Self-hosted: yes — the operator owns the network. Cloud: no, unless the
/// operator opts in. The proxy forwards the client's method and path to that
/// URL from inside our network, so a tenant who could choose it could aim the
/// gateway at the instance metadata service (and its credentials), at Redis,
/// or at anything else only the gateway can reach.
fn custom_providers_allowed() -> bool {
    !crate::tenant::middleware::cloud_mode()
        || std::env::var("REPATH_ALLOW_CUSTOM_PROVIDERS")
            .map(|v| v.eq_ignore_ascii_case("true") || v == "1")
            .unwrap_or(false)
}

fn check_providers(config: &RolloutConfig, custom_allowed: bool) -> Result<(), String> {
    for (label, spec) in [
        ("baseline", &config.spec.baseline),
        ("candidate", &config.spec.candidate),
    ] {
        let p = spec.provider.trim();
        if known_provider(p).is_some() {
            continue;
        }
        if !custom_allowed {
            return Err(format!(
                "The {label} provider must be one of openai, anthropic, gemini or openrouter \
                 (got '{p}'). OpenRouter reaches most other models; custom endpoints are \
                 available on self-hosted Repath."
            ));
        }
        if !(p.starts_with("https://") || p.starts_with("http://")) {
            return Err(format!(
                "The {label} provider '{p}' is neither a known provider nor an http(s) URL."
            ));
        }
    }
    Ok(())
}

async fn upsert_provider(
    tx: &mut Transaction<'_, Postgres>,
    provider_name: &str,
) -> Result<(Uuid, String), sqlx::Error> {
    let (base_url, provider_type) =
        known_provider(provider_name).unwrap_or((provider_name, "openai"));

    let row = sqlx::query(
        r#"
        INSERT INTO providers (id, name, base_url, api_key_encrypted, provider_type)
        VALUES ($1, $2, $3, 'CONFIGURED_VIA_GATEWAY', $4)
        ON CONFLICT (name) DO UPDATE SET updated_at = NOW()
        RETURNING id, base_url
        "#,
    )
    .bind(Uuid::new_v4())
    .bind(provider_name)
    .bind(base_url)
    .bind(provider_type)
    .fetch_one(&mut **tx)
    .await?;

    Ok((row.try_get("id")?, row.try_get("base_url")?))
}

async fn insert_version(
    tx: &mut Transaction<'_, Postgres>,
    name: &str,
    (provider_id, provider_url): &(Uuid, String),
    spec: &VersionSpec,
) -> Result<Uuid, sqlx::Error> {
    let version_id = Uuid::new_v4();
    let parameters = serde_json::to_value(&spec.parameters).unwrap_or_else(|_| json!({}));

    sqlx::query(
        r#"
        INSERT INTO versions (id, name, provider_id, provider_url, model, prompt_template, parameters)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
    )
    .bind(version_id)
    .bind(name)
    .bind(provider_id)
    // The router reads this column on the hot path. It was never written, and
    // the router defaulted a NULL to OpenAI — so every rollout created here
    // sent its traffic to api.openai.com whatever provider it named, and
    // every Anthropic, Gemini and OpenRouter rollout failed.
    .bind(provider_url)
    .bind(&spec.model)
    .bind(spec.prompt.system.as_deref())
    .bind(&parameters)
    .execute(&mut **tx)
    .await?;

    Ok(version_id)
}

// ── Shared logic (also used by the CLI via this endpoint) ───────────────────

fn build_strategy(config: &RolloutConfig) -> RolloutStrategy {
    RolloutStrategy {
        strategy_type: config.spec.strategy.strategy_type,
        steps: config
            .spec
            .strategy
            .steps
            .iter()
            .enumerate()
            .map(|(i, s)| RolloutStep {
                step_number: (i + 1) as u32,
                target_weight: s.weight as f64 / 100.0,
                gate_expression: build_gate_expression(&s.gate),
                pause_duration_seconds: s.duration.as_deref().and_then(parse_duration_secs),
            })
            .collect(),
    }
}

/// Turn `{"quality_score": ">= 0.9"}` into `"quality_score >= 0.9"`.
///
/// Keys are sorted so the expression is deterministic — a HashMap iterates in
/// arbitrary order, which would otherwise make the stored text vary between
/// identical requests and churn the audit trail.
fn build_gate_expression(gate: &HashMap<String, String>) -> String {
    let mut parts: Vec<String> = gate.iter().map(|(k, v)| format!("{k} {v}")).collect();
    parts.sort();
    parts.join(" AND ")
}

fn parse_duration_secs(s: &str) -> Option<u32> {
    let s = s.trim();
    if let Some(m) = s.strip_suffix('m') {
        m.parse::<u32>().ok().map(|v| v * 60)
    } else if let Some(h) = s.strip_suffix('h') {
        h.parse::<u32>().ok().map(|v| v * 3600)
    } else if let Some(sec) = s.strip_suffix('s') {
        sec.parse::<u32>().ok()
    } else {
        s.parse::<u32>().ok()
    }
}

/// Reject configurations that would produce a rollout the controller cannot
/// drive. Messages are written for the person who wrote the config.
/// The thresholds the controller will actually decide with.
///
/// The controller reads `rollouts.policy` and nothing else. This used to be
/// `RolloutPolicy::default()` regardless of the request, so the dashboard's
/// "roll back below" and per-step "minimum quality" fields — and the same
/// keys in YAML — were stored and then ignored. Worse, the form pre-filled a
/// 0.8 gate while the controller silently required 0.9, so a candidate
/// scoring 0.85 held forever with its owner believing the gate was met.
///
/// Precedence, most specific first: the rollback trigger and step gates, then
/// an explicit `spec.policy`, then defaults. The controller applies one
/// advance threshold to every step, so differing step gates resolve to the
/// strictest — it may hold longer than one step asked, never advance sooner.
fn derive_policy(config: &RolloutConfig) -> RolloutPolicy {
    let mut policy = config.spec.policy.clone().unwrap_or_default();

    if let Some(t) = config
        .spec
        .strategy
        .rollback
        .trigger
        .get("quality_score")
        .and_then(|e| parse_threshold(e))
    {
        policy.rollback_threshold = t;
    }

    // `error_rate: "> 0.10"` in the rollback trigger is the error ceiling the
    // controller holds the candidate to, for advancing and for rolling back.
    if let Some(t) = config
        .spec
        .strategy
        .rollback
        .trigger
        .get("error_rate")
        .and_then(|e| parse_threshold(e))
    {
        policy.max_error_rate = t;
    }

    if let Some(t) = config
        .spec
        .strategy
        .steps
        .iter()
        .filter_map(|s| s.gate.get("quality_score").and_then(|e| parse_threshold(e)))
        .reduce(f64::max)
    {
        policy.advance_threshold = t;
    }

    policy
}

/// The number in a gate expression like `">= 0.8"`, `"<0.7"` or `"0.75"`.
fn parse_threshold(expr: &str) -> Option<f64> {
    let n = expr.trim().trim_start_matches(['<', '>', '=', ' ']).trim();
    n.parse::<f64>().ok().filter(|v| v.is_finite())
}

fn validate_config(config: &RolloutConfig) -> Result<(), String> {
    let name = config.metadata.name.trim();
    if name.is_empty() {
        return Err("Rollout name cannot be empty.".into());
    }
    if name.len() > 255 {
        return Err("Rollout name must be 255 characters or fewer.".into());
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return Err(
            "Rollout name may contain only letters, numbers, hyphens and underscores.".into(),
        );
    }

    // Only canary is implemented end to end. Shadow and blue-green parse, but
    // nothing downstream treats them differently, so they ran as a canary —
    // and shadow's whole promise is that users never see the candidate. A
    // customer choosing it for zero risk got real exposure instead. Refuse
    // until they exist, rather than quietly doing something else.
    if !matches!(config.spec.strategy.strategy_type, StrategyType::Canary) {
        return Err(
            "Only canary rollouts are available today. Shadow and blue-green are on the roadmap \
             — use `type: canary` with a small first step (e.g. 5%) to limit exposure."
                .into(),
        );
    }

    let steps = &config.spec.strategy.steps;
    if steps.is_empty() {
        return Err("Strategy must have at least one step.".into());
    }
    if steps.len() > MAX_STEPS {
        return Err(format!("Strategy may have at most {MAX_STEPS} steps."));
    }

    // Weights must climb to 100. A step that goes backwards, or a final step
    // below 100, means the candidate can never fully promote and the rollout
    // would sit unfinished forever.
    let mut previous = 0u8;
    for (i, step) in steps.iter().enumerate() {
        if step.weight > 100 {
            return Err(format!(
                "Step {} has weight {} — weights are percentages and cannot exceed 100.",
                i + 1,
                step.weight
            ));
        }
        if step.weight <= previous && i > 0 {
            return Err(format!(
                "Step {} has weight {} which is not greater than the previous step's {}. Weights must increase.",
                i + 1,
                step.weight,
                previous
            ));
        }
        if let Some(d) = step.duration.as_deref() {
            if parse_duration_secs(d).is_none() {
                return Err(format!(
                    "Step {} has an unparseable duration '{}'. Use forms like 30s, 10m or 1h.",
                    i + 1,
                    d
                ));
            }
        }
        previous = step.weight;
    }

    if previous != 100 {
        return Err(format!(
            "The last step must reach weight 100 so the candidate can fully promote (got {previous})."
        ));
    }

    validate_version("baseline", &config.spec.baseline)?;
    validate_version("candidate", &config.spec.candidate)?;

    // Validate what will actually be stored, after the gates are applied.
    let policy = derive_policy(config);
    for (label, v) in [
        ("rollback threshold", policy.rollback_threshold),
        ("quality gate", policy.advance_threshold),
    ] {
        if !(0.0..=1.0).contains(&v) {
            return Err(format!(
                "The {label} must be between 0 and 1 — scores are 0–1 (got {v})."
            ));
        }
    }
    if policy.rollback_threshold >= policy.advance_threshold {
        return Err(format!(
            "The rollback threshold ({}) must be below the quality gate ({}); otherwise every \
             score that is good enough to advance is also bad enough to roll back.",
            policy.rollback_threshold, policy.advance_threshold
        ));
    }
    if policy.min_samples == 0 {
        return Err("min_samples must be at least 1 — a decision needs evidence.".into());
    }

    Ok(())
}

fn validate_version(label: &str, spec: &VersionSpec) -> Result<(), String> {
    if spec.model.trim().is_empty() {
        return Err(format!("The {label} version must specify a model."));
    }
    if spec.provider.trim().is_empty() {
        return Err(format!("The {label} version must specify a provider."));
    }
    if let Some(prompt) = spec.prompt.system.as_deref() {
        if prompt.len() > MAX_PROMPT_BYTES {
            return Err(format!(
                "The {label} system prompt is {} bytes; the limit is {MAX_PROMPT_BYTES}.",
                prompt.len()
            ));
        }
    }
    Ok(())
}

fn error(status: StatusCode, message: String) -> Response {
    (
        status,
        Json(json!({ "error": { "message": message, "type": "invalid_request" } })),
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use repath_common::types::{
        PromptSpec, RollbackSpec, RolloutMetadata, RolloutSpec, StepSpec, StrategySpec,
        StrategyType, VersionParameters,
    };

    fn version(model: &str) -> VersionSpec {
        VersionSpec {
            provider: "openai".into(),
            model: model.into(),
            prompt: PromptSpec::default(),
            parameters: VersionParameters::default(),
        }
    }

    fn step(weight: u8, duration: Option<&str>) -> StepSpec {
        StepSpec {
            weight,
            duration: duration.map(str::to_owned),
            gate: HashMap::new(),
        }
    }

    fn config_with(name: &str, steps: Vec<StepSpec>) -> RolloutConfig {
        RolloutConfig {
            api_version: "repath/v1".into(),
            kind: "Rollout".into(),
            metadata: RolloutMetadata {
                name: name.into(),
                labels: HashMap::new(),
            },
            spec: RolloutSpec {
                baseline: version("gpt-4o-mini"),
                candidate: version("gpt-4o-mini"),
                strategy: StrategySpec {
                    strategy_type: StrategyType::Canary,
                    steps,
                    rollback: RollbackSpec {
                        trigger: HashMap::new(),
                        action: "rollback".into(),
                        cooldown: None,
                    },
                },
                evaluation: vec![],
                routing: Default::default(),
                policy: None,
            },
        }
    }

    fn gated(gates: &[&str], rollback: Option<&str>) -> RolloutConfig {
        let weights = [10u8, 50, 100];
        let steps = gates
            .iter()
            .zip(weights.iter().skip(weights.len() - gates.len()))
            .map(|(g, w)| StepSpec {
                weight: *w,
                duration: None,
                gate: HashMap::from([("quality_score".to_string(), g.to_string())]),
            })
            .collect();
        let mut c = config_with("gated", steps);
        if let Some(r) = rollback {
            c.spec
                .strategy
                .rollback
                .trigger
                .insert("quality_score".into(), r.into());
        }
        c
    }

    #[test]
    fn the_customers_thresholds_are_the_ones_stored() {
        // The dashboard sends these. They used to be stored and ignored, with
        // the controller deciding on 0.9 / 0.7 regardless.
        let p = derive_policy(&gated(&[">= 0.8", ">= 0.8"], Some("< 0.6")));
        assert_eq!(p.advance_threshold, 0.8);
        assert_eq!(p.rollback_threshold, 0.6);
    }

    #[test]
    fn differing_step_gates_resolve_to_the_strictest() {
        // One threshold covers every step, so it must never advance on
        // quality lower than any step asked for.
        let p = derive_policy(&gated(&[">= 0.75", ">= 0.85", ">=0.8"], None));
        assert_eq!(p.advance_threshold, 0.85);
    }

    #[test]
    fn explicit_policy_supplies_what_gates_do_not() {
        let mut c = gated(&[">= 0.8"], None);
        c.spec.policy = Some(RolloutPolicy {
            min_samples: 10,
            ..Default::default()
        });
        let p = derive_policy(&c);
        assert_eq!(p.min_samples, 10);
        assert_eq!(
            p.advance_threshold, 0.8,
            "the gate still wins over the policy default"
        );
    }

    #[test]
    fn no_gates_keeps_the_defaults() {
        let p = derive_policy(&valid());
        assert_eq!(
            p.advance_threshold,
            RolloutPolicy::default().advance_threshold
        );
        assert_eq!(
            p.rollback_threshold,
            RolloutPolicy::default().rollback_threshold
        );
    }

    #[test]
    fn rejects_a_rollback_threshold_at_or_above_the_gate() {
        let c = gated(&[">= 0.7"], Some("< 0.8"));
        assert!(validate_config(&c)
            .unwrap_err()
            .contains("must be below the quality gate"));
    }

    #[test]
    fn rejects_out_of_range_thresholds() {
        let c = gated(&[">= 80"], None);
        assert!(validate_config(&c).unwrap_err().contains("between 0 and 1"));
    }

    #[test]
    fn rejects_strategies_that_are_not_implemented() {
        // Shadow used to run as a canary, serving the candidate to real users.
        let mut c = valid();
        c.spec.strategy.strategy_type = StrategyType::Shadow;
        assert!(validate_config(&c).unwrap_err().contains("Only canary"));
    }

    #[test]
    fn rollback_error_rate_sets_the_ceiling() {
        let mut c = valid();
        c.spec
            .strategy
            .rollback
            .trigger
            .insert("error_rate".into(), "> 0.10".into());
        assert_eq!(derive_policy(&c).max_error_rate, 0.10);
    }

    #[test]
    fn cloud_refuses_arbitrary_provider_urls() {
        // The proxy forwards the client's method and path to this URL from
        // inside our network: the metadata service is one request away.
        let mut c = valid();
        c.spec.candidate.provider = "http://169.254.169.254".into();
        let err = check_providers(&c, false).unwrap_err();
        assert!(err.contains("must be one of"), "{err}");
    }

    #[test]
    fn named_providers_are_always_allowed() {
        for p in ["openai", "anthropic", "gemini", "openrouter"] {
            let mut c = valid();
            c.spec.candidate.provider = p.into();
            assert!(check_providers(&c, false).is_ok(), "{p}");
        }
    }

    #[test]
    fn self_hosted_may_use_a_custom_endpoint_but_it_must_be_a_url() {
        let mut c = valid();
        c.spec.candidate.provider = "https://llm.internal.example/v1".into();
        assert!(check_providers(&c, true).is_ok());
        c.spec.candidate.provider = "my-llm".into();
        assert!(check_providers(&c, true).is_err());
    }

    #[test]
    fn parses_gate_expressions() {
        assert_eq!(parse_threshold(">= 0.8"), Some(0.8));
        assert_eq!(parse_threshold("<0.7"), Some(0.7));
        assert_eq!(parse_threshold("0.75"), Some(0.75));
        assert_eq!(parse_threshold(">= high"), None);
    }

    fn valid() -> RolloutConfig {
        config_with(
            "checkout-prompt",
            vec![step(10, Some("5m")), step(50, Some("10m")), step(100, None)],
        )
    }

    #[test]
    fn accepts_a_well_formed_config() {
        assert!(validate_config(&valid()).is_ok());
    }

    #[test]
    fn rejects_empty_name() {
        let c = config_with("", vec![step(100, None)]);
        assert!(validate_config(&c).unwrap_err().contains("cannot be empty"));
    }

    #[test]
    fn rejects_name_with_spaces() {
        let c = config_with("my rollout", vec![step(100, None)]);
        assert!(validate_config(&c).unwrap_err().contains("only letters"));
    }

    #[test]
    fn rejects_no_steps() {
        let c = config_with("x", vec![]);
        assert!(validate_config(&c)
            .unwrap_err()
            .contains("at least one step"));
    }

    #[test]
    fn rejects_too_many_steps() {
        let steps: Vec<StepSpec> = (1..=MAX_STEPS + 1).map(|i| step(i as u8, None)).collect();
        let c = config_with("x", steps);
        assert!(validate_config(&c).unwrap_err().contains("at most"));
    }

    #[test]
    fn rejects_final_step_below_100() {
        let c = config_with("x", vec![step(10, None), step(50, None)]);
        assert!(validate_config(&c)
            .unwrap_err()
            .contains("must reach weight 100"));
    }

    #[test]
    fn rejects_non_increasing_weights() {
        let c = config_with("x", vec![step(50, None), step(20, None), step(100, None)]);
        assert!(validate_config(&c).unwrap_err().contains("must increase"));
    }

    #[test]
    fn rejects_weight_above_100() {
        let c = config_with("x", vec![step(120, None)]);
        assert!(validate_config(&c)
            .unwrap_err()
            .contains("cannot exceed 100"));
    }

    #[test]
    fn rejects_unparseable_duration() {
        let c = config_with("x", vec![step(100, Some("soon"))]);
        assert!(validate_config(&c)
            .unwrap_err()
            .contains("unparseable duration"));
    }

    #[test]
    fn rejects_empty_model() {
        let mut c = valid();
        c.spec.candidate.model = "  ".into();
        assert!(validate_config(&c)
            .unwrap_err()
            .contains("must specify a model"));
    }

    #[test]
    fn rejects_oversized_prompt() {
        let mut c = valid();
        c.spec.baseline.prompt.system = Some("x".repeat(MAX_PROMPT_BYTES + 1));
        assert!(validate_config(&c).unwrap_err().contains("limit is"));
    }

    #[test]
    fn single_step_to_100_is_valid() {
        assert!(validate_config(&config_with("x", vec![step(100, None)])).is_ok());
    }

    #[test]
    fn gate_expression_is_deterministic() {
        let mut gate = HashMap::new();
        gate.insert("quality_score".to_string(), ">= 0.9".to_string());
        gate.insert("error_rate".to_string(), "< 0.05".to_string());
        // Sorted, so repeated builds of the same gate produce identical text.
        assert_eq!(
            build_gate_expression(&gate),
            "error_rate < 0.05 AND quality_score >= 0.9"
        );
    }

    #[test]
    fn empty_gate_produces_empty_expression() {
        assert_eq!(build_gate_expression(&HashMap::new()), "");
    }

    #[test]
    fn parses_duration_units() {
        assert_eq!(parse_duration_secs("30s"), Some(30));
        assert_eq!(parse_duration_secs("10m"), Some(600));
        assert_eq!(parse_duration_secs("2h"), Some(7200));
        assert_eq!(parse_duration_secs("120"), Some(120));
        assert_eq!(parse_duration_secs("nope"), None);
    }
}
