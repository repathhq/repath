//! Tenant settings: provider credentials, failover chain, routing rules,
//! webhooks, notifications and gateway options.
//!
//! Every endpoint here is scoped to the caller's own tenant. Nothing takes a
//! tenant id from the request — it comes from the verified [`AuthContext`], so
//! a caller cannot read or change another tenant's configuration by editing a
//! URL.
//!
//! Secrets (provider keys, webhook signing secrets, Slack URLs) are encrypted
//! before storage and never returned. Reads give a masked hint instead, which
//! is enough to recognise a value without revealing it.

use crate::{crypto, routing, tenant::AuthContext, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    Extension,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;
use uuid::Uuid;

/// Providers we know how to call. Anything else is rejected rather than stored
/// and silently ignored at request time.
const KNOWN_PROVIDERS: &[&str] = &["openai", "anthropic", "gemini", "openrouter"];

fn err(status: StatusCode, message: impl Into<String>) -> Response {
    (
        status,
        Json(json!({ "error": { "message": message.into(), "type": "invalid_request" } })),
    )
        .into_response()
}

fn db_err(e: sqlx::Error) -> Response {
    tracing::error!(error = %e, "Settings query failed");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "Something went wrong saving that. Please try again.",
    )
}

/// Secrets cannot be stored without a master key. Say so plainly rather than
/// failing with a generic error the operator has to go digging for.
fn require_encryption() -> Option<Response> {
    if crypto::is_configured() {
        return None;
    }
    tracing::error!("REPATH_ENCRYPTION_KEY is not configured — cannot store tenant secrets");
    Some(err(
        StatusCode::SERVICE_UNAVAILABLE,
        "This deployment cannot store secrets yet: REPATH_ENCRYPTION_KEY is not set. \
         Ask your operator to configure it.",
    ))
}

// ════════════════════════════════════════════════════════════════════════════
// Provider credentials
// ════════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct CredentialView {
    provider: String,
    key_hint: String,
    updated_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct SaveCredential {
    pub provider: String,
    pub api_key: String,
}

/// GET /api/v1/settings/providers
pub async fn list_credentials(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let tenant = auth.owning_tenant();

    let rows = sqlx::query(
        "SELECT provider, key_hint, updated_at FROM tenant_provider_credentials
          WHERE tenant_id = $1 ORDER BY provider",
    )
    .bind(tenant)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let creds: Vec<CredentialView> = rows
                .iter()
                .map(|r| CredentialView {
                    provider: r.get("provider"),
                    key_hint: r.get("key_hint"),
                    updated_at: r.get("updated_at"),
                })
                .collect();
            Json(json!({ "providers": creds })).into_response()
        }
        Err(e) => db_err(e),
    }
}

/// PUT /api/v1/settings/providers — add or replace one provider key.
pub async fn save_credential(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveCredential>,
) -> Response {
    if let Some(resp) = require_encryption() {
        return resp;
    }

    let provider = body.provider.trim().to_ascii_lowercase();
    if !KNOWN_PROVIDERS.contains(&provider.as_str()) {
        return err(
            StatusCode::BAD_REQUEST,
            format!(
                "Unknown provider '{provider}'. Supported: {}.",
                KNOWN_PROVIDERS.join(", ")
            ),
        );
    }

    let key = body.api_key.trim();
    if key.is_empty() {
        return err(StatusCode::BAD_REQUEST, "The API key cannot be empty.");
    }
    // Catch a pasted placeholder before it fails mysteriously at request time.
    if key.contains('•') || key.starts_with("****") {
        return err(
            StatusCode::BAD_REQUEST,
            "That looks like the masked value rather than a real key. Paste the full key.",
        );
    }

    let sealed = match crypto::encrypt(key) {
        Ok(s) => s,
        Err(e) => {
            tracing::error!(error = %e, "Failed to encrypt provider key");
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not securely store that key.",
            );
        }
    };

    let result = sqlx::query(
        "INSERT INTO tenant_provider_credentials (tenant_id, provider, key_sealed, key_hint)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id, provider)
         DO UPDATE SET key_sealed = EXCLUDED.key_sealed,
                       key_hint   = EXCLUDED.key_hint,
                       updated_at = NOW()",
    )
    .bind(auth.owning_tenant())
    .bind(&provider)
    .bind(&sealed)
    .bind(crypto::hint(key))
    .execute(&state.db_pool)
    .await;

    match result {
        Ok(_) => Json(json!({
            "provider": provider,
            "key_hint": crypto::hint(key),
            "message": "Saved. It takes effect within a few seconds."
        }))
        .into_response(),
        Err(e) => db_err(e),
    }
}

/// DELETE /api/v1/settings/providers/:provider
pub async fn delete_credential(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(provider): Path<String>,
) -> Response {
    let result = sqlx::query(
        "DELETE FROM tenant_provider_credentials WHERE tenant_id = $1 AND provider = $2
         RETURNING provider",
    )
    .bind(auth.owning_tenant())
    .bind(provider.to_ascii_lowercase())
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(_)) => Json(json!({ "deleted": true })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "No key stored for that provider."),
        Err(e) => db_err(e),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Failover chain
// ════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct SaveFailover {
    /// Ordered provider names, e.g. ["anthropic", "openrouter"].
    pub chain: Vec<String>,
}

/// GET /api/v1/settings/failover
pub async fn get_failover(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let row = sqlx::query("SELECT fallback_providers FROM tenants WHERE id = $1")
        .bind(auth.owning_tenant())
        .fetch_optional(&state.db_pool)
        .await;

    match row {
        Ok(Some(r)) => {
            let raw: Value = r.get("fallback_providers");
            let chain: Vec<String> = raw
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|e| {
                            e.get("provider").and_then(Value::as_str).map(str::to_owned)
                        })
                        .collect()
                })
                .unwrap_or_default();
            Json(json!({ "chain": chain })).into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Tenant not found."),
        Err(e) => db_err(e),
    }
}

/// PUT /api/v1/settings/failover
pub async fn save_failover(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveFailover>,
) -> Response {
    let tenant = auth.owning_tenant();

    if body.chain.len() > 4 {
        return err(
            StatusCode::BAD_REQUEST,
            "A failover chain of more than four providers just multiplies latency on a bad day.",
        );
    }

    let mut seen = std::collections::HashSet::new();
    for provider in &body.chain {
        let p = provider.to_ascii_lowercase();
        if !KNOWN_PROVIDERS.contains(&p.as_str()) {
            return err(
                StatusCode::BAD_REQUEST,
                format!("Unknown provider '{provider}'."),
            );
        }
        if !seen.insert(p) {
            return err(
                StatusCode::BAD_REQUEST,
                format!("'{provider}' appears twice — each provider can appear once."),
            );
        }
    }

    // A chain entry with no stored key would be skipped at request time, so the
    // failover would silently not happen. Refuse now, while the user is looking
    // at the screen and can fix it.
    if !body.chain.is_empty() {
        let stored: Vec<String> = match sqlx::query_scalar(
            "SELECT provider FROM tenant_provider_credentials WHERE tenant_id = $1",
        )
        .bind(tenant)
        .fetch_all(&state.db_pool)
        .await
        {
            Ok(v) => v,
            Err(e) => return db_err(e),
        };

        let missing: Vec<&String> = body
            .chain
            .iter()
            .filter(|p| !stored.contains(&p.to_ascii_lowercase()))
            .collect();

        if !missing.is_empty() {
            let names: Vec<&str> = missing.iter().map(|s| s.as_str()).collect();
            return err(
                StatusCode::BAD_REQUEST,
                format!(
                    "Add an API key for {} before using {} in the failover chain — \
                     without a key we cannot call {}.",
                    names.join(" and "),
                    if names.len() == 1 { "it" } else { "them" },
                    if names.len() == 1 { "it" } else { "them" },
                ),
            );
        }
    }

    let stored_chain: Vec<Value> = body
        .chain
        .iter()
        .map(|p| json!({ "provider": p.to_ascii_lowercase() }))
        .collect();

    let result =
        sqlx::query("UPDATE tenants SET fallback_providers = $2, updated_at = NOW() WHERE id = $1")
            .bind(tenant)
            .bind(Value::Array(stored_chain))
            .execute(&state.db_pool)
            .await;

    match result {
        Ok(_) => Json(json!({
            "chain": body.chain,
            "message": "Failover chain saved."
        }))
        .into_response(),
        Err(e) => db_err(e),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Routing rules
// ════════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct RuleView {
    id: Uuid,
    name: String,
    priority: i32,
    enabled: bool,
    condition: Value,
    action: Value,
    match_count: i64,
    last_matched_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Deserialize)]
pub struct SaveRule {
    pub name: String,
    #[serde(default = "default_priority")]
    pub priority: i32,
    #[serde(default = "default_true")]
    pub enabled: bool,
    pub condition: routing::Condition,
    pub action: routing::Action,
}

fn default_priority() -> i32 {
    100
}
fn default_true() -> bool {
    true
}

/// GET /api/v1/routing/rules
pub async fn list_rules(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let rows = sqlx::query(
        "SELECT id, name, priority, enabled, condition, action, match_count, last_matched_at
           FROM routing_rules WHERE tenant_id = $1
          ORDER BY priority, name",
    )
    .bind(auth.owning_tenant())
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let rules: Vec<RuleView> = rows
                .iter()
                .map(|r| RuleView {
                    id: r.get("id"),
                    name: r.get("name"),
                    priority: r.get("priority"),
                    enabled: r.get("enabled"),
                    condition: r.get("condition"),
                    action: r.get("action"),
                    match_count: r.get("match_count"),
                    last_matched_at: r.get("last_matched_at"),
                })
                .collect();
            Json(json!({ "rules": rules })).into_response()
        }
        Err(e) => db_err(e),
    }
}

/// POST /api/v1/routing/rules
pub async fn create_rule(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveRule>,
) -> Response {
    if let Err(message) = validate_rule(&body) {
        return err(StatusCode::BAD_REQUEST, message);
    }

    let condition = serde_json::to_value(&body.condition).unwrap_or_else(|_| json!({}));
    let action = serde_json::to_value(&body.action).unwrap_or_else(|_| json!({}));

    let result = sqlx::query(
        "INSERT INTO routing_rules (tenant_id, name, priority, enabled, condition, action)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
    )
    .bind(auth.owning_tenant())
    .bind(body.name.trim())
    .bind(body.priority)
    .bind(body.enabled)
    .bind(&condition)
    .bind(&action)
    .fetch_one(&state.db_pool)
    .await;

    match result {
        Ok(row) => {
            let id: Uuid = row.get("id");
            (
                StatusCode::CREATED,
                Json(json!({
                    "id": id,
                    "name": body.name.trim(),
                    "message": "Rule created. It starts routing within a few seconds."
                })),
            )
                .into_response()
        }
        Err(sqlx::Error::Database(ref d)) if d.code().as_deref() == Some("23505") => err(
            StatusCode::CONFLICT,
            format!("You already have a rule named '{}'.", body.name.trim()),
        ),
        Err(e) => db_err(e),
    }
}

/// PUT /api/v1/routing/rules/:id
pub async fn update_rule(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
    Json(body): Json<SaveRule>,
) -> Response {
    if let Err(message) = validate_rule(&body) {
        return err(StatusCode::BAD_REQUEST, message);
    }

    let condition = serde_json::to_value(&body.condition).unwrap_or_else(|_| json!({}));
    let action = serde_json::to_value(&body.action).unwrap_or_else(|_| json!({}));

    let result = sqlx::query(
        "UPDATE routing_rules
            SET name = $3, priority = $4, enabled = $5,
                condition = $6, action = $7, updated_at = NOW()
          WHERE id = $1 AND tenant_id = $2
        RETURNING id",
    )
    .bind(id)
    .bind(auth.owning_tenant())
    .bind(body.name.trim())
    .bind(body.priority)
    .bind(body.enabled)
    .bind(&condition)
    .bind(&action)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(_)) => Json(json!({ "id": id, "message": "Rule updated." })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Rule not found."),
        Err(e) => db_err(e),
    }
}

/// DELETE /api/v1/routing/rules/:id
pub async fn delete_rule(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Response {
    let result =
        sqlx::query("DELETE FROM routing_rules WHERE id = $1 AND tenant_id = $2 RETURNING id")
            .bind(id)
            .bind(auth.owning_tenant())
            .fetch_optional(&state.db_pool)
            .await;

    match result {
        Ok(Some(_)) => Json(json!({ "deleted": true })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Rule not found."),
        Err(e) => db_err(e),
    }
}

#[derive(Deserialize)]
pub struct TestRuleRequest {
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub content: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub headers: std::collections::HashMap<String, String>,
}

/// POST /api/v1/routing/test
///
/// Dry-run the tenant's rules against a hypothetical request and report which
/// one would win. Rule sets are ordered and overlapping, so "which of these
/// fires?" is genuinely hard to answer by reading — much better to let someone
/// try it before their production traffic does.
pub async fn test_rules(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<TestRuleRequest>,
) -> Response {
    let tenant = auth.owning_tenant();
    let cache = state.routing_cache.load();

    let facts = routing::RequestFacts {
        input_tokens: routing::estimate_tokens(&body.content),
        model: body.model.clone(),
        path: if body.path.is_empty() {
            "/v1/chat/completions".to_string()
        } else {
            body.path.clone()
        },
        content: body.content.clone(),
        headers: body
            .headers
            .iter()
            .map(|(k, v)| (k.to_ascii_lowercase(), v.clone()))
            .collect(),
    };

    // Report every rule's verdict, not just the winner: seeing that three rules
    // matched and why the first one took it is what makes an ordering mistake
    // obvious.
    let evaluated: Vec<Value> = cache
        .rules
        .rules_for(tenant)
        .iter()
        .map(|r| {
            json!({
                "name": r.name,
                "priority": r.priority,
                "matches": r.condition.matches(&facts),
                "would_route_to": { "provider": r.action.provider, "model": r.action.model },
            })
        })
        .collect();

    let winner = cache.rules.first_match(tenant, &facts);

    Json(json!({
        "estimated_input_tokens": facts.input_tokens,
        "rules": evaluated,
        "result": match winner {
            Some(r) => json!({
                "matched": true,
                "rule": r.name,
                "provider": r.action.provider,
                "model": r.action.model,
            }),
            None => json!({
                "matched": false,
                "explanation": "No rule matched. This request would follow your active rollout, or pass through unchanged.",
            }),
        }
    }))
    .into_response()
}

fn validate_rule(rule: &SaveRule) -> Result<(), String> {
    use routing::{Field, Operator};

    let name = rule.name.trim();
    if name.is_empty() {
        return Err("Give the rule a name.".into());
    }
    if name.len() > 255 {
        return Err("Rule name must be 255 characters or fewer.".into());
    }
    if !(0..=10_000).contains(&rule.priority) {
        return Err("Priority must be between 0 and 10000.".into());
    }

    if rule.action.provider.trim().is_empty() || rule.action.model.trim().is_empty() {
        return Err("A rule must say which provider and model to route to.".into());
    }
    if !KNOWN_PROVIDERS.contains(&rule.action.provider.trim().to_ascii_lowercase().as_str()) {
        return Err(format!(
            "Unknown provider '{}'. Supported: {}.",
            rule.action.provider,
            KNOWN_PROVIDERS.join(", ")
        ));
    }

    let c = &rule.condition;

    // Header conditions are meaningless without a header name.
    if c.field == Field::Header
        && c.header
            .as_ref()
            .map(|h| h.trim().is_empty())
            .unwrap_or(true)
    {
        return Err("A header condition needs the header name.".into());
    }

    // Numeric comparison only makes sense against a numeric field, and the
    // value has to actually be a number.
    let numeric_op = matches!(
        c.op,
        Operator::Lt | Operator::Lte | Operator::Gt | Operator::Gte
    );
    if numeric_op {
        if c.field != Field::InputTokens {
            return Err(
                "Numeric comparisons (<, <=, >, >=) only apply to the prompt size field.".into(),
            );
        }
        if c.value.trim().parse::<f64>().is_err() {
            return Err(format!("'{}' is not a number.", c.value));
        }
    } else if c.op != Operator::Exists && c.value.trim().is_empty() {
        return Err("The condition needs a value to compare against.".into());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use routing::{Action, Condition, Field, Operator};

    fn rule(condition: Condition) -> SaveRule {
        SaveRule {
            name: "cheap-for-short".into(),
            priority: 100,
            enabled: true,
            condition,
            action: Action {
                provider: "anthropic".into(),
                model: "claude-3-5-haiku-20241022".into(),
            },
        }
    }

    fn cond(field: Field, op: Operator, value: &str) -> Condition {
        Condition {
            field,
            op,
            value: value.into(),
            header: None,
        }
    }

    #[test]
    fn accepts_a_sensible_rule() {
        assert!(validate_rule(&rule(cond(Field::InputTokens, Operator::Lt, "500"))).is_ok());
    }

    #[test]
    fn rejects_an_empty_name() {
        let mut r = rule(cond(Field::InputTokens, Operator::Lt, "500"));
        r.name = "   ".into();
        assert!(validate_rule(&r).unwrap_err().contains("name"));
    }

    #[test]
    fn rejects_numeric_comparison_on_a_text_field() {
        let r = rule(cond(Field::Model, Operator::Gt, "5"));
        assert!(validate_rule(&r).unwrap_err().contains("prompt size"));
    }

    #[test]
    fn rejects_a_non_numeric_threshold() {
        let r = rule(cond(Field::InputTokens, Operator::Lt, "many"));
        assert!(validate_rule(&r).unwrap_err().contains("not a number"));
    }

    #[test]
    fn rejects_a_header_condition_without_a_header_name() {
        let r = rule(cond(Field::Header, Operator::Eq, "premium"));
        assert!(validate_rule(&r).unwrap_err().contains("header name"));
    }

    #[test]
    fn accepts_a_header_condition_with_a_name() {
        let mut c = cond(Field::Header, Operator::Eq, "premium");
        c.header = Some("X-Tier".into());
        assert!(validate_rule(&rule(c)).is_ok());
    }

    #[test]
    fn exists_needs_no_value() {
        let mut c = cond(Field::Header, Operator::Exists, "");
        c.header = Some("X-Beta".into());
        assert!(validate_rule(&rule(c)).is_ok());
    }

    #[test]
    fn rejects_an_empty_value_for_a_comparison() {
        let r = rule(cond(Field::Model, Operator::Eq, "  "));
        assert!(validate_rule(&r).unwrap_err().contains("value"));
    }

    #[test]
    fn rejects_an_unknown_provider() {
        let mut r = rule(cond(Field::InputTokens, Operator::Lt, "500"));
        r.action.provider = "definitely-not-a-provider".into();
        assert!(validate_rule(&r).unwrap_err().contains("Unknown provider"));
    }

    #[test]
    fn rejects_an_out_of_range_priority() {
        let mut r = rule(cond(Field::InputTokens, Operator::Lt, "500"));
        r.priority = 99_999;
        assert!(validate_rule(&r).unwrap_err().contains("Priority"));
    }

    #[test]
    fn rejects_a_rule_with_no_target_model() {
        let mut r = rule(cond(Field::InputTokens, Operator::Lt, "500"));
        r.action.model = "".into();
        assert!(validate_rule(&r)
            .unwrap_err()
            .contains("provider and model"));
    }
}
