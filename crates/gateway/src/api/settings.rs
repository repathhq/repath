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

use crate::{routing, tenant::AuthContext, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    Extension,
};
use repath_common::crypto;
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

// ════════════════════════════════════════════════════════════════════════════
// Webhooks
// ════════════════════════════════════════════════════════════════════════════

#[derive(Serialize)]
struct WebhookView {
    id: Uuid,
    url: String,
    events: Vec<String>,
    enabled: bool,
    created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Deserialize)]
pub struct SaveWebhook {
    pub url: String,
    #[serde(default)]
    pub events: Vec<String>,
    #[serde(default = "default_true")]
    pub enabled: bool,
}

/// GET /api/v1/settings/webhooks
pub async fn list_webhooks(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let rows = sqlx::query(
        "SELECT id, url, events, enabled, created_at FROM webhooks
          WHERE tenant_id = $1 ORDER BY created_at DESC",
    )
    .bind(auth.owning_tenant())
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let hooks: Vec<WebhookView> = rows
                .iter()
                .map(|r| WebhookView {
                    id: r.get("id"),
                    url: r.get("url"),
                    events: r.get("events"),
                    enabled: r.get("enabled"),
                    created_at: r.get("created_at"),
                })
                .collect();
            Json(json!({ "webhooks": hooks })).into_response()
        }
        Err(e) => db_err(e),
    }
}

/// POST /api/v1/settings/webhooks
///
/// Returns the signing secret exactly once. It is stored encrypted and never
/// shown again — the receiver needs it to verify `X-Repath-Signature`.
pub async fn create_webhook(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveWebhook>,
) -> Response {
    if let Some(resp) = require_encryption() {
        return resp;
    }

    let url = body.url.trim();
    if let Err(message) = validate_webhook_url(url) {
        return err(StatusCode::BAD_REQUEST, message);
    }

    let events = if body.events.is_empty() {
        vec![
            "rollback".to_string(),
            "advance".to_string(),
            "promote".to_string(),
            "provider_outage".to_string(),
        ]
    } else {
        match normalise_events(&body.events) {
            Ok(e) => e,
            Err(message) => return err(StatusCode::BAD_REQUEST, message),
        }
    };

    // 32 bytes of entropy, same shape as an API key.
    let secret = crate::tenant::generate_key()
        .raw
        .replace("rp_live_", "whsec_");
    let sealed = match crypto::encrypt(&secret) {
        Ok(s) => s,
        Err(_) => {
            return err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not securely store the signing secret.",
            )
        }
    };

    let result = sqlx::query(
        "INSERT INTO webhooks (tenant_id, url, secret_sealed, events, enabled)
         VALUES ($1, $2, $3, $4, $5) RETURNING id",
    )
    .bind(auth.owning_tenant())
    .bind(url)
    .bind(&sealed)
    .bind(&events)
    .bind(body.enabled)
    .fetch_one(&state.db_pool)
    .await;

    match result {
        Ok(row) => {
            let id: Uuid = row.get("id");
            (
                StatusCode::CREATED,
                Json(json!({
                    "id": id,
                    "url": url,
                    "events": events,
                    "signing_secret": secret,
                    "note": "Store this secret now — it is shown once. Use it to verify the X-Repath-Signature header.",
                })),
            )
                .into_response()
        }
        Err(e) => db_err(e),
    }
}

/// DELETE /api/v1/settings/webhooks/:id
pub async fn delete_webhook(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Response {
    let result = sqlx::query("DELETE FROM webhooks WHERE id = $1 AND tenant_id = $2 RETURNING id")
        .bind(id)
        .bind(auth.owning_tenant())
        .fetch_optional(&state.db_pool)
        .await;

    match result {
        Ok(Some(_)) => Json(json!({ "deleted": true })).into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Webhook not found."),
        Err(e) => db_err(e),
    }
}

/// GET /api/v1/settings/webhooks/:id/deliveries
///
/// Recent attempts, so a customer can diagnose "it stopped arriving" without
/// asking us.
pub async fn webhook_deliveries(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Response {
    // Join through webhooks so one tenant cannot read another's delivery log
    // by guessing a webhook id.
    let rows = sqlx::query(
        "SELECT d.event, d.status_code, d.error, d.attempts, d.delivered_at, d.created_at
           FROM webhook_deliveries d
           JOIN webhooks w ON w.id = d.webhook_id
          WHERE d.webhook_id = $1 AND w.tenant_id = $2
          ORDER BY d.created_at DESC LIMIT 50",
    )
    .bind(id)
    .bind(auth.owning_tenant())
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let deliveries: Vec<Value> = rows
                .iter()
                .map(|r| {
                    json!({
                        "event": r.get::<String, _>("event"),
                        "status_code": r.get::<Option<i32>, _>("status_code"),
                        "error": r.get::<Option<String>, _>("error"),
                        "attempts": r.get::<i32, _>("attempts"),
                        "delivered": r.get::<Option<chrono::DateTime<chrono::Utc>>, _>("delivered_at").is_some(),
                        "created_at": r.get::<chrono::DateTime<chrono::Utc>, _>("created_at"),
                    })
                })
                .collect();
            Json(json!({ "deliveries": deliveries })).into_response()
        }
        Err(e) => db_err(e),
    }
}

/// POST /api/v1/settings/webhooks/:id/test
///
/// Send a sample payload now. Configuring a webhook and waiting for a real
/// rollback to find out whether it works is a bad way to learn.
pub async fn test_webhook(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<Uuid>,
) -> Response {
    let exists = sqlx::query("SELECT id FROM webhooks WHERE id = $1 AND tenant_id = $2")
        .bind(id)
        .bind(auth.owning_tenant())
        .fetch_optional(&state.db_pool)
        .await;

    match exists {
        Ok(Some(_)) => {
            repath_common::notify::dispatch_event(
                state.db_pool.clone(),
                state.http_client.clone(),
                repath_common::notify::Event {
                    kind: repath_common::notify::EventKind::Rollback,
                    tenant_id: auth.owning_tenant().to_string(),
                    rollout_id: None,
                    rollout_name: "test-rollout".into(),
                    detail: "This is a test delivery from Repath. No rollout was affected.".into(),
                    context: json!({ "test": true }),
                },
            );
            Json(json!({
                "message": "Test event sent. Check the delivery log in a few seconds."
            }))
            .into_response()
        }
        Ok(None) => err(StatusCode::NOT_FOUND, "Webhook not found."),
        Err(e) => db_err(e),
    }
}

fn validate_webhook_url(url: &str) -> Result<(), String> {
    if url.is_empty() {
        return Err("Enter the URL Repath should POST to.".into());
    }
    let is_local = url.starts_with("http://localhost") || url.starts_with("http://127.0.0.1");
    if !url.starts_with("https://") && !is_local {
        return Err(
            "Webhook URLs must use HTTPS — these payloads describe production deployments. \
             (http://localhost is allowed for local testing.)"
                .into(),
        );
    }
    if url.len() > 2000 {
        return Err("That URL is implausibly long.".into());
    }
    Ok(())
}

fn normalise_events(events: &[String]) -> Result<Vec<String>, String> {
    let mut out = Vec::with_capacity(events.len());
    for e in events {
        let e = e.trim().to_ascii_lowercase();
        if repath_common::notify::EventKind::parse(&e).is_none() {
            return Err(format!(
                "Unknown event '{e}'. Supported: rollback, advance, promote, provider_outage."
            ));
        }
        if !out.contains(&e) {
            out.push(e);
        }
    }
    if out.is_empty() {
        return Err("Subscribe to at least one event.".into());
    }
    Ok(out)
}

// ════════════════════════════════════════════════════════════════════════════
// Notification settings
// ════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct SaveNotifications {
    #[serde(default = "default_true")]
    pub email_enabled: bool,
    #[serde(default)]
    pub email_address: Option<String>,
    #[serde(default)]
    pub slack_enabled: bool,
    /// Omitted to keep the stored URL; empty string to clear it.
    #[serde(default)]
    pub slack_webhook_url: Option<String>,
    #[serde(default)]
    pub events: Vec<String>,
}

/// GET /api/v1/settings/notifications
pub async fn get_notifications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let row = sqlx::query(
        "SELECT email_enabled, email_address, slack_enabled,
                slack_url_sealed IS NOT NULL AS slack_configured, events
           FROM notification_settings WHERE tenant_id = $1",
    )
    .bind(auth.owning_tenant())
    .fetch_optional(&state.db_pool)
    .await;

    match row {
        Ok(Some(r)) => Json(json!({
            "email_enabled": r.get::<bool, _>("email_enabled"),
            "email_address": r.get::<Option<String>, _>("email_address"),
            "slack_enabled": r.get::<bool, _>("slack_enabled"),
            "slack_configured": r.get::<bool, _>("slack_configured"),
            "events": r.get::<Vec<String>, _>("events"),
        }))
        .into_response(),
        // No row yet — report the defaults the schema would apply.
        Ok(None) => Json(json!({
            "email_enabled": true,
            "email_address": null,
            "slack_enabled": false,
            "slack_configured": false,
            "events": ["rollback", "provider_outage"],
        }))
        .into_response(),
        Err(e) => db_err(e),
    }
}

/// PUT /api/v1/settings/notifications
pub async fn save_notifications(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveNotifications>,
) -> Response {
    let tenant = auth.owning_tenant();

    let events = if body.events.is_empty() {
        vec!["rollback".to_string(), "provider_outage".to_string()]
    } else {
        match normalise_events(&body.events) {
            Ok(e) => e,
            Err(message) => return err(StatusCode::BAD_REQUEST, message),
        }
    };

    if let Some(ref email) = body.email_address {
        if !email.trim().is_empty() && !email.contains('@') {
            return err(
                StatusCode::BAD_REQUEST,
                "That does not look like an email address.",
            );
        }
    }

    // Three cases: a new URL to seal, an explicit clear, or leave as-is.
    let slack_sealed: Option<Option<String>> = match body.slack_webhook_url.as_deref() {
        None => None,
        Some("") => Some(None),
        Some(url) => {
            if !url.starts_with("https://hooks.slack.com/") {
                return err(
                    StatusCode::BAD_REQUEST,
                    "That is not a Slack incoming-webhook URL — they start with \
                     https://hooks.slack.com/",
                );
            }
            if let Some(resp) = require_encryption() {
                return resp;
            }
            match crypto::encrypt(url) {
                Ok(s) => Some(Some(s)),
                Err(_) => {
                    return err(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Could not securely store the Slack URL.",
                    )
                }
            }
        }
    };

    let result = match slack_sealed {
        Some(sealed) => {
            sqlx::query(
                "INSERT INTO notification_settings
                     (tenant_id, email_enabled, email_address, slack_enabled, slack_url_sealed, events, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW())
                 ON CONFLICT (tenant_id) DO UPDATE SET
                     email_enabled = EXCLUDED.email_enabled,
                     email_address = EXCLUDED.email_address,
                     slack_enabled = EXCLUDED.slack_enabled,
                     slack_url_sealed = EXCLUDED.slack_url_sealed,
                     events = EXCLUDED.events,
                     updated_at = NOW()",
            )
            .bind(tenant)
            .bind(body.email_enabled)
            .bind(body.email_address.as_deref().map(str::trim))
            .bind(body.slack_enabled)
            .bind(sealed)
            .bind(&events)
            .execute(&state.db_pool)
            .await
        }
        None => {
            sqlx::query(
                "INSERT INTO notification_settings
                     (tenant_id, email_enabled, email_address, slack_enabled, events, updated_at)
                 VALUES ($1, $2, $3, $4, $5, NOW())
                 ON CONFLICT (tenant_id) DO UPDATE SET
                     email_enabled = EXCLUDED.email_enabled,
                     email_address = EXCLUDED.email_address,
                     slack_enabled = EXCLUDED.slack_enabled,
                     events = EXCLUDED.events,
                     updated_at = NOW()",
            )
            .bind(tenant)
            .bind(body.email_enabled)
            .bind(body.email_address.as_deref().map(str::trim))
            .bind(body.slack_enabled)
            .bind(&events)
            .execute(&state.db_pool)
            .await
        }
    };

    match result {
        Ok(_) => Json(json!({ "message": "Notification preferences saved." })).into_response(),
        Err(e) => db_err(e),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Gateway options
// ════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct SaveGateway {
    pub request_timeout_seconds: Option<i32>,
    pub eval_sample_rate: Option<f64>,
    /// Whether to store prompt and response text for judged requests.
    ///
    /// Off means the request log still shows metrics and scores, but no
    /// payloads — for customers who cannot have end-user text held by a
    /// third party at all. Turning it off does not delete what was already
    /// captured; that expires on its own retention schedule.
    pub capture_payloads: Option<bool>,
}

/// GET /api/v1/settings/gateway
pub async fn get_gateway_settings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
) -> Response {
    let row = sqlx::query(
        "SELECT request_timeout_seconds, eval_sample_rate, capture_payloads, \
                    retention_days(plan) AS retention_days \
               FROM tenants WHERE id = $1",
    )
    .bind(auth.owning_tenant())
    .fetch_optional(&state.db_pool)
    .await;

    match row {
        Ok(Some(r)) => Json(json!({
            "request_timeout_seconds": r.get::<i32, _>("request_timeout_seconds"),
            "eval_sample_rate": r.get::<f64, _>("eval_sample_rate"),
            "capture_payloads": r.get::<bool, _>("capture_payloads"),
            // Surfaced so the UI can state the actual window rather than
            // repeating a number from the pricing page that might drift.
            "retention_days": r.get::<i32, _>("retention_days"),
        }))
        .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Tenant not found."),
        Err(e) => db_err(e),
    }
}

/// PUT /api/v1/settings/gateway
pub async fn save_gateway_settings(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveGateway>,
) -> Response {
    if let Some(t) = body.request_timeout_seconds {
        if !(5..=600).contains(&t) {
            return err(
                StatusCode::BAD_REQUEST,
                "Request timeout must be between 5 and 600 seconds.",
            );
        }
    }
    if let Some(r) = body.eval_sample_rate {
        if !(0.0..=1.0).contains(&r) {
            return err(
                StatusCode::BAD_REQUEST,
                "Sample rate is a fraction between 0 and 1 — 0.25 means a quarter of requests.",
            );
        }
    }

    let result = sqlx::query(
        "UPDATE tenants
            SET request_timeout_seconds = COALESCE($2, request_timeout_seconds),
                eval_sample_rate        = COALESCE($3, eval_sample_rate),
                capture_payloads        = COALESCE($4, capture_payloads),
                updated_at = NOW()
          WHERE id = $1",
    )
    .bind(auth.owning_tenant())
    .bind(body.request_timeout_seconds)
    .bind(body.eval_sample_rate)
    .bind(body.capture_payloads)
    .execute(&state.db_pool)
    .await;

    match result {
        Ok(_) => Json(json!({ "message": "Gateway settings saved." })).into_response(),
        Err(e) => db_err(e),
    }
}

// ════════════════════════════════════════════════════════════════════════════
// Profile
// ════════════════════════════════════════════════════════════════════════════

#[derive(Deserialize)]
pub struct SaveProfile {
    pub name: Option<String>,
    pub email: Option<String>,
    /// bcrypt hash, computed by the dashboard. The gateway never sees a
    /// plaintext password — hashing stays where signup already does it, so
    /// there is exactly one implementation to keep correct.
    pub password_hash: Option<String>,
}

/// PUT /api/v1/settings/profile
pub async fn save_profile(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<SaveProfile>,
) -> Response {
    if let Some(ref name) = body.name {
        if name.trim().is_empty() {
            return err(StatusCode::BAD_REQUEST, "Your name cannot be empty.");
        }
        if name.len() > 255 {
            return err(StatusCode::BAD_REQUEST, "That name is too long.");
        }
    }
    if let Some(ref email) = body.email {
        let e = email.trim();
        if e.is_empty() || !e.contains('@') || e.len() > 255 {
            return err(
                StatusCode::BAD_REQUEST,
                "That does not look like an email address.",
            );
        }
    }

    let result = sqlx::query(
        "UPDATE tenants
            SET name          = COALESCE($2, name),
                email         = COALESCE($3, email),
                password_hash = COALESCE($4, password_hash),
                updated_at    = NOW()
          WHERE id = $1
        RETURNING name, email",
    )
    .bind(auth.owning_tenant())
    .bind(body.name.as_deref().map(str::trim))
    .bind(body.email.as_deref().map(str::trim))
    .bind(body.password_hash.as_deref())
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(row)) => Json(json!({
            "name": row.get::<String, _>("name"),
            "email": row.get::<String, _>("email"),
            "message": "Saved."
        }))
        .into_response(),
        Ok(None) => err(StatusCode::NOT_FOUND, "Account not found."),
        // Email is unique across tenants.
        Err(sqlx::Error::Database(ref d)) if d.code().as_deref() == Some("23505") => err(
            StatusCode::CONFLICT,
            "Another account already uses that email address.",
        ),
        Err(e) => db_err(e),
    }
}
