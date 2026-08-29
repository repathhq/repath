//! Cloud tenant management API.
//!
//! Endpoints consumed by the cloud dashboard for:
//! - Tenant registration (from Clerk webhook on user.created)
//! - Plan upgrades (from Razorpay/Paddle webhook on payment.success)
//! - Usage metering (read-only, for billing display)
//! - Trial status (trial_ends_at vs NOW())
//!
//! All endpoints require the management API token (same as dashboard/CLI).
//! In production, Clerk and payment webhooks also send signed payloads —
//! we verify signatures in the webhook handlers.

use crate::{tenant::AuthContext, AppState};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
    Extension,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::Row;

// ── Request / Response types ───────────────────────────────────────────────

#[derive(Deserialize)]
pub struct CreateTenantRequest {
    pub id: String,
    pub name: String,
    pub email: String,
    pub password_hash: Option<String>,
}

#[derive(Serialize)]
struct TenantResponse {
    id: String,
    name: String,
    email: String,
    plan: String,
    trial_ends_at: Option<DateTime<Utc>>,
    eval_quota_monthly: i32,
    evals_used_this_month: i32,
    active: bool,
    gateway_url: String,
    /// First few characters of the tenant's API key, e.g. "rp_live_a1b2".
    /// Enough to recognise which key is in use; never enough to use it.
    api_key_prefix: Option<String>,
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct UpgradePlanRequest {
    pub plan: String,             // "starter" | "pro" | "enterprise"
    pub payment_id: String,       // Razorpay payment_id or Paddle transaction_id
    pub payment_provider: String, // "razorpay" | "paddle"
}

/// POST /api/v1/cloud/tenants/:id/api-key/rotate
///
/// Issue a new API key and invalidate the old one immediately. Used when a key
/// is leaked, or when the user never saved the one shown at signup.
///
/// The new plaintext is returned once and never stored. Rotation takes effect
/// on the next tenant-cache refresh (≤5s) for cached lookups, and immediately
/// for anything that falls through to the database.
pub async fn rotate_api_key(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(resp) = reject_cross_tenant(&auth, &id) {
        return resp;
    }

    let key = crate::tenant::generate_key();

    let result = sqlx::query(
        r#"
        UPDATE tenants
           SET api_key_hash = $2, api_key_prefix = $3,
               api_key_created_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND active = TRUE
        RETURNING id
        "#,
    )
    .bind(&id)
    .bind(&key.hash)
    .bind(&key.prefix)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(_)) => {
            tracing::info!(tenant_id = %id, "API key rotated");
            Json(json!({
                "api_key": key.raw,
                "api_key_prefix": key.prefix,
                "note": "Store this now — it is shown once and cannot be recovered. The previous key no longer works."
            }))
            .into_response()
        }
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, format!("Tenant not found: {id}")),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

// ── Authorisation guard ─────────────────────────────────────────────────────

/// Returns a rejection response if the caller may not act on this tenant.
///
/// Admins (the global operator token, used by the dashboard's own signup and
/// billing server routes) may act on any tenant. A caller holding a tenant API
/// key may act only on itself — without this, any customer could read, upgrade,
/// or delete any other customer's account just by putting their id in the URL.
///
/// Returns 404 rather than 403 on mismatch so tenant ids cannot be probed.
fn reject_cross_tenant(auth: &AuthContext, target_id: &str) -> Option<Response> {
    match auth {
        AuthContext::Admin => None,
        AuthContext::Tenant(t) if t.id == target_id => None,
        AuthContext::Tenant(t) => {
            tracing::warn!(
                caller = %t.id,
                target = %target_id,
                "Blocked cross-tenant account access"
            );
            Some(cloud_error(
                StatusCode::NOT_FOUND,
                format!("Tenant not found: {target_id}"),
            ))
        }
    }
}

/// Returns a rejection response unless the caller is the global operator.
fn reject_non_admin(auth: &AuthContext) -> Option<Response> {
    match auth {
        AuthContext::Admin => None,
        AuthContext::Tenant(t) => {
            tracing::warn!(caller = %t.id, "Blocked tenant call to an admin-only endpoint");
            Some(cloud_error(
                StatusCode::FORBIDDEN,
                "This endpoint requires operator credentials".into(),
            ))
        }
    }
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// GET /api/v1/cloud/tenants/by-email/:email
/// Used by the login API route to look up a tenant by email.
pub async fn get_tenant_by_email(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(email): Path<String>,
) -> impl IntoResponse {
    // Returns a password hash — operator credentials only. The dashboard's
    // login route calls this server-side with the admin token.
    if let Some(resp) = reject_non_admin(&auth) {
        return resp;
    }
    let result = sqlx::query(
        r#"
        SELECT id, name, email, plan, password_hash, trial_ends_at,
               eval_quota_monthly, evals_used_this_month, active, created_at
        FROM tenants WHERE email = $1 AND active = true
        "#,
    )
    .bind(&email)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(row)) => {
            use sqlx::Row;
            Json(serde_json::json!({
                "id": row.get::<String, _>("id"),
                "name": row.get::<String, _>("name"),
                "email": row.get::<String, _>("email"),
                "plan": row.get::<String, _>("plan"),
                "password_hash": row.get::<Option<String>, _>("password_hash"),
                "active": row.get::<bool, _>("active"),
            }))
            .into_response()
        }
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, "Tenant not found".into()),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// POST /api/v1/cloud/tenants
/// Called by Clerk webhook (user.created) via cloud dashboard backend.
pub async fn create_tenant(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<CreateTenantRequest>,
) -> impl IntoResponse {
    // Signup is driven by the dashboard server-side with the admin token.
    if let Some(resp) = reject_non_admin(&auth) {
        return resp;
    }

    let trial_ends_at = Utc::now() + Duration::days(7);
    let gateway_url = build_gateway_url(&body.id);

    // Mint the tenant's API key here. The plaintext is returned exactly once,
    // in this response, and never stored — only its SHA-256 hash goes to the
    // database, so a dump yields nothing usable.
    let key = crate::tenant::generate_key();

    let result = sqlx::query(
        r#"
        INSERT INTO tenants (id, name, email, plan, trial_ends_at, eval_quota_monthly, active,
                             password_hash, api_key_hash, api_key_prefix, api_key_created_at)
        VALUES ($1, $2, $3, 'trial', $4, 1000, true, $5, $6, $7, NOW())
        ON CONFLICT (id) DO UPDATE SET
            name          = EXCLUDED.name,
            email         = EXCLUDED.email,
            password_hash = COALESCE(EXCLUDED.password_hash, tenants.password_hash)
        RETURNING id, name, email, plan, trial_ends_at, eval_quota_monthly,
                  evals_used_this_month, active, created_at, api_key_prefix,
                  (xmax = 0) AS is_new
        "#,
    )
    .bind(&body.id)
    .bind(&body.name)
    .bind(&body.email)
    .bind(trial_ends_at)
    .bind(&body.password_hash)
    .bind(&key.hash)
    .bind(&key.prefix)
    .fetch_one(&state.db_pool)
    .await;

    match result {
        Ok(row) => {
            let tenant = TenantResponse {
                id: row.get("id"),
                name: row.get("name"),
                email: row.get("email"),
                plan: row.get("plan"),
                trial_ends_at: row.get("trial_ends_at"),
                eval_quota_monthly: row.get("eval_quota_monthly"),
                evals_used_this_month: row.get("evals_used_this_month"),
                active: row.get("active"),
                gateway_url,
                api_key_prefix: row.try_get("api_key_prefix").ok().flatten(),
                created_at: row.get("created_at"),
            };
            // `xmax = 0` is true only for a freshly inserted row, so a repeat
            // signup for an existing id does not leak a key that does not match
            // the stored hash.
            let is_new: bool = row.try_get("is_new").unwrap_or(false);
            let mut payload = json!(tenant);
            if is_new {
                payload["api_key"] = json!(key.raw);
                payload["api_key_note"] =
                    json!("Store this now — it is shown once and cannot be recovered.");
            }
            (StatusCode::CREATED, Json(payload)).into_response()
        }
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// GET /api/v1/cloud/tenants/:id
pub async fn get_tenant(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(resp) = reject_cross_tenant(&auth, &id) {
        return resp;
    }
    let result = sqlx::query(
        r#"
        SELECT id, name, email, plan, trial_ends_at, eval_quota_monthly,
               evals_used_this_month, active, created_at, api_key_prefix
        FROM tenants WHERE id = $1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(row)) => {
            let tenant = TenantResponse {
                id: row.get("id"),
                name: row.get("name"),
                email: row.get("email"),
                plan: row.get("plan"),
                trial_ends_at: row.get("trial_ends_at"),
                eval_quota_monthly: row.get("eval_quota_monthly"),
                evals_used_this_month: row.get("evals_used_this_month"),
                active: row.get("active"),
                gateway_url: build_gateway_url(&row.get::<String, _>("id")),
                api_key_prefix: row.try_get("api_key_prefix").ok().flatten(),
                created_at: row.get("created_at"),
            };
            Json(json!(tenant)).into_response()
        }
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, format!("Tenant not found: {id}")),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// POST /api/v1/cloud/tenants/:id/upgrade
/// Called after successful payment to activate paid plan.
pub async fn upgrade_tenant(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(body): Json<UpgradePlanRequest>,
) -> impl IntoResponse {
    // Plan changes follow a verified payment, so only the operator token (used
    // by the billing routes and payment webhooks) may call this. A tenant must
    // not be able to upgrade itself for free.
    if let Some(resp) = reject_non_admin(&auth) {
        return resp;
    }

    let quota = plan_quota(&body.plan);
    if quota == 0 {
        return cloud_error(
            StatusCode::BAD_REQUEST,
            format!("Unknown plan: {}", body.plan),
        );
    }

    let result = sqlx::query(
        r#"
        UPDATE tenants
        SET plan = $1,
            eval_quota_monthly = $2,
            trial_ends_at = NULL,
            active = true,
            updated_at = NOW()
        WHERE id = $3
        RETURNING id, plan, eval_quota_monthly
        "#,
    )
    .bind(&body.plan)
    .bind(quota)
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(_)) => Json(json!({
            "message": format!("Upgraded to {} plan", body.plan),
            "plan": body.plan,
            "eval_quota_monthly": quota,
            "payment_id": body.payment_id,
            "payment_provider": body.payment_provider,
        }))
        .into_response(),
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, format!("Tenant not found: {id}")),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// GET /api/v1/cloud/tenants/:id/usage
/// Current month evaluation usage for billing display.
pub async fn get_usage(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(resp) = reject_cross_tenant(&auth, &id) {
        return resp;
    }
    let result = sqlx::query(
        r#"
        SELECT
            t.plan,
            t.eval_quota_monthly,
            -- Read the same counter the quota check enforces against. This
            -- previously joined eval_usage, a table nothing writes to, so the
            -- dashboard always showed zero usage while the gateway was
            -- separately counting and could cut a tenant off without warning.
            t.evals_used_this_month AS this_month_evals,
            t.trial_ends_at,
            t.active,
            t.api_key_prefix,
            date_trunc('month', NOW()) AS month_start
        FROM tenants t
        WHERE t.id = $1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(row)) => {
            let quota: i32 = row.get("eval_quota_monthly");
            let used: i64 = row.get::<i32, _>("this_month_evals") as i64;
            let trial_ends_at: Option<DateTime<Utc>> = row.get("trial_ends_at");

            let trial_active = trial_ends_at.map(|t| t > Utc::now()).unwrap_or(false);

            Json(json!({
                "plan": row.get::<String, _>("plan"),
                "eval_quota_monthly": quota,
                "evals_used": used,
                "evals_remaining": (quota as i64 - used).max(0),
                "usage_percent": if quota > 0 { (used as f64 / quota as f64 * 100.0).min(100.0) } else { 0.0 },
                "trial_active": trial_active,
                "trial_ends_at": trial_ends_at,
                "active": row.get::<bool, _>("active"),
                "api_key_prefix": row.try_get::<Option<String>, _>("api_key_prefix").ok().flatten(),
                "month_start": row.get::<DateTime<Utc>, _>("month_start"),
            }))
            .into_response()
        }
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, format!("Tenant not found: {id}")),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// DELETE /api/v1/cloud/tenants/:id
/// Permanently deactivates a tenant account and marks all data for deletion.
pub async fn delete_tenant(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(resp) = reject_cross_tenant(&auth, &id) {
        return resp;
    }
    // Soft-delete: set active=false and clear sensitive data.
    // Actual data purge happens via background cleanup job.
    let result = sqlx::query(
        r#"
        UPDATE tenants
        SET active = false,
            plan = 'deleted',
            eval_quota_monthly = 0,
            password_hash = NULL,
            updated_at = NOW()
        WHERE id = $1 AND active = true
        RETURNING id
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(_)) => {
            // Also pause all rollouts for this tenant
            let _ = sqlx::query(
                "UPDATE rollouts SET state = 'paused' WHERE tenant_id = $1 AND state IN ('canary', 'shadow')",
            )
            .bind(&id)
            .execute(&state.db_pool)
            .await;

            tracing::info!(tenant_id = id, "Tenant account deleted");
            Json(json!({ "message": "Account deleted", "id": id })).into_response()
        }
        Ok(None) => cloud_error(
            StatusCode::NOT_FOUND,
            format!("Tenant not found or already deleted: {id}"),
        ),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

// ── Payment webhooks ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RazorpayWebhook {
    pub event: String,
    pub payload: serde_json::Value,
}

/// POST /api/v1/webhooks/razorpay
/// Handles Razorpay payment.captured events to activate paid plans.
///
/// Razorpay sends a signed HMAC-SHA256 payload. We verify the signature
/// using RAZORPAY_WEBHOOK_SECRET from env before processing.
pub async fn razorpay_webhook(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    // Verify Razorpay signature
    let signature = headers
        .get("x-razorpay-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !verify_razorpay_signature(&body, signature) {
        return cloud_error(StatusCode::UNAUTHORIZED, "Invalid webhook signature".into());
    }

    let event: RazorpayWebhook = match serde_json::from_slice(&body) {
        Ok(e) => e,
        Err(e) => return cloud_error(StatusCode::BAD_REQUEST, e.to_string()),
    };

    if event.event != "payment.captured" {
        // Acknowledge but ignore non-payment events
        return Json(json!({ "status": "ignored", "event": event.event })).into_response();
    }

    // Extract tenant_id and plan from notes (set during checkout creation)
    let tenant_id = event
        .payload
        .pointer("/payment/entity/notes/tenant_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let plan = event
        .payload
        .pointer("/payment/entity/notes/plan")
        .and_then(|v| v.as_str())
        .unwrap_or("starter");

    let payment_id = event
        .payload
        .pointer("/payment/entity/id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    if tenant_id.is_empty() {
        return cloud_error(
            StatusCode::BAD_REQUEST,
            "Missing tenant_id in payment notes".into(),
        );
    }

    let quota = plan_quota(plan);
    let _ = sqlx::query(
        "UPDATE tenants SET plan=$1, eval_quota_monthly=$2, trial_ends_at=NULL, active=true, updated_at=NOW() WHERE id=$3",
    )
    .bind(plan)
    .bind(quota)
    .bind(tenant_id)
    .execute(&state.db_pool)
    .await;

    tracing::info!(
        tenant_id,
        plan,
        payment_id,
        "Razorpay payment captured — plan activated"
    );

    Json(json!({ "status": "ok", "tenant_id": tenant_id, "plan": plan })).into_response()
}

#[derive(Deserialize)]
pub struct PaddleWebhook {
    pub event_type: String,
    pub data: serde_json::Value,
}

/// POST /api/v1/webhooks/paddle
/// Handles Paddle transaction.completed events to activate paid plans.
pub async fn paddle_webhook(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
    body: axum::body::Bytes,
) -> impl IntoResponse {
    // Verify Paddle signature
    let signature = headers
        .get("paddle-signature")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    if !verify_paddle_signature(&body, signature) {
        return cloud_error(StatusCode::UNAUTHORIZED, "Invalid webhook signature".into());
    }

    let event: PaddleWebhook = match serde_json::from_slice(&body) {
        Ok(e) => e,
        Err(e) => return cloud_error(StatusCode::BAD_REQUEST, e.to_string()),
    };

    if event.event_type != "transaction.completed" {
        return Json(json!({ "status": "ignored", "event": event.event_type })).into_response();
    }

    // Paddle custom_data contains tenant_id and plan set during checkout
    let tenant_id = event
        .data
        .pointer("/custom_data/tenant_id")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let plan = event
        .data
        .pointer("/custom_data/plan")
        .and_then(|v| v.as_str())
        .unwrap_or("starter");

    let transaction_id = event.data.get("id").and_then(|v| v.as_str()).unwrap_or("");

    if tenant_id.is_empty() {
        return cloud_error(
            StatusCode::BAD_REQUEST,
            "Missing tenant_id in custom_data".into(),
        );
    }

    let quota = plan_quota(plan);
    let _ = sqlx::query(
        "UPDATE tenants SET plan=$1, eval_quota_monthly=$2, trial_ends_at=NULL, active=true, updated_at=NOW() WHERE id=$3",
    )
    .bind(plan)
    .bind(quota)
    .bind(tenant_id)
    .execute(&state.db_pool)
    .await;

    tracing::info!(
        tenant_id,
        plan,
        transaction_id,
        "Paddle transaction completed — plan activated"
    );

    Json(json!({ "status": "ok", "tenant_id": tenant_id, "plan": plan })).into_response()
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/// Monthly LLM-judge evaluation allowance per plan.
///
/// The quotas descend in price-per-evaluation as the plan rises — indie
/// ₹/eval > starter > pro — so that growing is rewarded and downgrading never
/// is. Indie deliberately sits at 3,000 rather than 5,000: at 5,000 it would
/// undercut starter's unit price and every starter customer would rationally
/// move down.
fn plan_quota(plan: &str) -> i32 {
    match plan {
        "indie" => 3_000,
        "starter" => 10_000,
        "pro" => 100_000,
        "enterprise" => i32::MAX,
        _ => 0,
    }
}

fn build_gateway_url(_tenant_id: &str) -> String {
    let domain =
        std::env::var("REPATH_CLOUD_DOMAIN").unwrap_or_else(|_| "localhost:8080".to_string());
    format!("https://{}/v1", domain)
    // In production with subdomain routing:
    // format!("https://gw-{}.{}/v1", tenant_id, domain)
    // Tenant identity comes from the verified API key, not the URL
    // This avoids needing wildcard SSL certs at launch
}

/// Verify a payment-provider webhook signature.
///
/// # This must fail closed
///
/// These endpoints are deliberately unauthenticated — the provider cannot
/// carry our operator token — so the signature is the *only* thing standing
/// between the internet and a free plan upgrade. An earlier version returned
/// `true` when the secret was unset "for dev/test", and the secret was never
/// configured in any environment. The result, verified against production:
/// an unsigned POST claiming `payment.captured` with any tenant id in its
/// notes upgraded that tenant to Pro and answered 200. Every customer knows
/// their own tenant id, so every customer could grant themselves Pro.
///
/// Refusing to verify without a secret means an unconfigured deployment
/// rejects webhooks instead of trusting them. That is the safe direction: a
/// dropped webhook delays an upgrade, a forged one gives the product away.
fn verify_hmac_sha256_hex(secret_var: &str, body: &[u8], signature: &str) -> bool {
    use std::fmt::Write;

    let secret = std::env::var(secret_var).unwrap_or_default();

    if secret.is_empty() {
        tracing::error!(
            "{secret_var} is not set — rejecting webhook. Configure it, or this \
             endpoint cannot be trusted."
        );
        return false;
    }

    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let computed = hmac::sign(&key, body);
    let computed_hex = computed.as_ref().iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{:02x}", b);
        out
    });

    // Constant-time compare. A byte-at-a-time `==` short-circuits on the first
    // difference, which leaks the expected digest to anyone who can measure
    // response latency across enough attempts.
    #[allow(deprecated)]
    ring::constant_time::verify_slices_are_equal(computed_hex.as_bytes(), signature.as_bytes())
        .is_ok()
}

pub fn verify_razorpay_signature(body: &[u8], signature: &str) -> bool {
    verify_hmac_sha256_hex("RAZORPAY_WEBHOOK_SECRET", body, signature)
}

pub fn verify_paddle_signature(body: &[u8], signature: &str) -> bool {
    use std::fmt::Write;

    let secret = std::env::var("PADDLE_WEBHOOK_SECRET").unwrap_or_default();

    // Fails closed for the same reason as Razorpay above: this endpoint is
    // unauthenticated, so trusting an unverifiable payload hands out plan
    // upgrades to anyone who can send a POST.
    if secret.is_empty() {
        tracing::error!(
            "PADDLE_WEBHOOK_SECRET is not set — rejecting webhook. Configure it, \
             or this endpoint cannot be trusted."
        );
        return false;
    }

    // Paddle uses: sha256(ts:body) with HMAC
    // signature format: "ts=1234567890;h1=hexhash"
    let ts = signature
        .split(';')
        .find(|p| p.starts_with("ts="))
        .and_then(|p| p.strip_prefix("ts="))
        .unwrap_or("");
    let provided_hash = signature
        .split(';')
        .find(|p| p.starts_with("h1="))
        .and_then(|p| p.strip_prefix("h1="))
        .unwrap_or("");

    let payload = format!("{}:{}", ts, String::from_utf8_lossy(body));
    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let computed = hmac::sign(&key, payload.as_bytes());
    let computed_hex = computed.as_ref().iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{:02x}", b);
        out
    });

    #[allow(deprecated)]
    ring::constant_time::verify_slices_are_equal(computed_hex.as_bytes(), provided_hash.as_bytes())
        .is_ok()
}

fn cloud_error(status: StatusCode, message: String) -> axum::response::Response {
    (
        status,
        Json(json!({
            "error": {
                "message": message,
                "type": "cloud_error"
            }
        })),
    )
        .into_response()
}

// ── Password reset ─────────────────────────────────────────────────────────
//
// Both endpoints are admin-only: the dashboard calls them server-side with the
// operator token, exactly as it already does for login. Exposing them to the
// browser would let anyone trigger mail to any address.
//
// The token is random 32 bytes, hex-encoded. Only its SHA-256 is stored, so a
// database dump does not yield working reset links.

/// How long a reset link stays valid. Long enough to find the mail, short
/// enough that a link left in an inbox is not a standing key to the account.
const RESET_TTL_MINUTES: i64 = 30;

#[derive(Deserialize)]
pub struct PasswordResetRequest {
    pub email: String,
}

/// POST /api/v1/cloud/password-reset/request
///
/// Always answers 200 with the same body, whether or not the address exists.
/// Anything else turns this into an account-enumeration oracle — the one place
/// where being helpful about "no such user" is a security bug.
pub async fn request_password_reset(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<PasswordResetRequest>,
) -> impl IntoResponse {
    if let Some(resp) = reject_non_admin(&auth) {
        return resp;
    }

    let ok = || {
        Json(json!({
            "message": "If that address has an account, a reset link is on its way."
        }))
        .into_response()
    };

    let email = body.email.trim().to_lowercase();
    let row = sqlx::query("SELECT id, name FROM tenants WHERE LOWER(email) = $1 LIMIT 1")
        .bind(&email)
        .fetch_optional(&state.db_pool)
        .await;

    let Ok(Some(row)) = row else {
        // Unknown address, or a database error. Both answer identically; the
        // error case is logged rather than surfaced.
        if let Err(e) = row {
            tracing::error!(error = %e, "Password reset lookup failed");
        }
        return ok();
    };

    let tenant_id: String = row.get("id");

    // 32 bytes of OS randomness. Hex so it survives being pasted out of a
    // mail client without any escaping question.
    let token = {
        use rand::Rng;
        let bytes: [u8; 32] = rand::thread_rng().gen();
        bytes.iter().map(|b| format!("{b:02x}")).collect::<String>()
    };
    let token_hash = sha256_hex(&token);
    let expires_at = Utc::now() + Duration::minutes(RESET_TTL_MINUTES);

    // Any older live token is retired first, so a second request invalidates
    // the first link rather than leaving several usable at once.
    let _ = sqlx::query(
        "UPDATE password_reset_tokens SET used_at = NOW() \
         WHERE tenant_id = $1 AND used_at IS NULL",
    )
    .bind(&tenant_id)
    .execute(&state.db_pool)
    .await;

    if let Err(e) = sqlx::query(
        "INSERT INTO password_reset_tokens (tenant_id, token_hash, expires_at) \
         VALUES ($1, $2, $3)",
    )
    .bind(&tenant_id)
    .bind(&token_hash)
    .bind(expires_at)
    .execute(&state.db_pool)
    .await
    {
        tracing::error!(error = %e, "Could not store password reset token");
        return ok();
    }

    match repath_common::notify::email::send_password_reset(&email, &token, RESET_TTL_MINUTES).await
    {
        Ok(()) => tracing::info!(tenant_id, "Password reset email sent"),
        Err(e) => {
            // The token is already stored, so retiring it here keeps the
            // system honest: no live token exists for mail that never went.
            tracing::error!(error = %e, tenant_id, "Password reset email failed to send");
            let _ = sqlx::query(
                "UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = $1",
            )
            .bind(&token_hash)
            .execute(&state.db_pool)
            .await;
        }
    }

    ok()
}

#[derive(Deserialize)]
pub struct PasswordResetConfirm {
    pub token: String,
    /// Already bcrypt-hashed by the dashboard, which is where every other
    /// password hash in this system is produced. The gateway never sees a
    /// plaintext password.
    pub password_hash: String,
}

/// POST /api/v1/cloud/password-reset/confirm
pub async fn confirm_password_reset(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Json(body): Json<PasswordResetConfirm>,
) -> impl IntoResponse {
    if let Some(resp) = reject_non_admin(&auth) {
        return resp;
    }

    if body.password_hash.trim().is_empty() {
        return cloud_error(StatusCode::BAD_REQUEST, "Missing password hash".into());
    }

    let token_hash = sha256_hex(body.token.trim());

    // Claim the token and read its tenant in one statement. Doing this as a
    // conditional UPDATE rather than SELECT-then-UPDATE means two concurrent
    // redemptions of the same link cannot both succeed.
    let claimed = sqlx::query(
        "UPDATE password_reset_tokens \
            SET used_at = NOW() \
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW() \
      RETURNING tenant_id",
    )
    .bind(&token_hash)
    .fetch_optional(&state.db_pool)
    .await;

    let tenant_id: String = match claimed {
        Ok(Some(r)) => r.get("tenant_id"),
        Ok(None) => {
            return cloud_error(
                StatusCode::BAD_REQUEST,
                "That reset link has expired or already been used. Request a new one.".into(),
            )
        }
        Err(e) => return cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    };

    match sqlx::query("UPDATE tenants SET password_hash = $1, updated_at = NOW() WHERE id = $2")
        .bind(&body.password_hash)
        .bind(&tenant_id)
        .execute(&state.db_pool)
        .await
    {
        Ok(_) => {
            tracing::info!(tenant_id, "Password reset completed");
            Json(json!({ "message": "Password updated." })).into_response()
        }
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

fn sha256_hex(input: &str) -> String {
    use ring::digest;
    digest::digest(&digest::SHA256, input.as_bytes())
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

// ── Subscriptions ──────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct ActivateSubscriptionRequest {
    pub plan: String,
    pub subscription_id: String,
    pub subscription_status: String,
    /// End of the paid period, as reported by the provider. `None` when the
    /// provider has not set one yet (a mandate authorised but not yet
    /// charged), in which case no expiry is enforced until the reconciler
    /// learns one.
    pub current_period_end: Option<DateTime<Utc>>,
    pub payment_id: Option<String>,
}

/// POST /api/v1/cloud/tenants/:id/subscription
///
/// Records a subscription and grants its plan. Replaces the old `upgrade`
/// endpoint's behaviour of setting a plan with no end date, under which one
/// payment bought the tier permanently.
pub async fn activate_subscription(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
    Json(body): Json<ActivateSubscriptionRequest>,
) -> impl IntoResponse {
    // Admin-only: the dashboard's billing route calls this server-side after
    // verifying the provider's signature. A tenant must never be able to grant
    // itself a plan.
    if let Some(resp) = reject_non_admin(&auth) {
        return resp;
    }

    let quota = plan_quota(&body.plan);
    if quota == 0 {
        return cloud_error(
            StatusCode::BAD_REQUEST,
            format!("Unknown plan: {}", body.plan),
        );
    }

    let result = sqlx::query(
        r#"
        UPDATE tenants
           SET plan                = $1,
               eval_quota_monthly  = $2,
               subscription_id     = $3,
               subscription_status = $4,
               current_period_end  = $5,
               last_synced_at      = NOW(),
               trial_ends_at       = NULL,
               active              = true,
               updated_at          = NOW()
         WHERE id = $6
        RETURNING id
        "#,
    )
    .bind(&body.plan)
    .bind(quota)
    .bind(&body.subscription_id)
    .bind(&body.subscription_status)
    .bind(body.current_period_end)
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(_)) => {
            // Record the charge. Best-effort and separate from the activation
            // above: a customer who paid must get their plan even if the
            // history row fails to write. ON CONFLICT makes a retried
            // callback idempotent rather than double-recording one payment.
            if let Some(payment_id) = &body.payment_id {
                let _ = sqlx::query(
                    "INSERT INTO payments \
                       (tenant_id, provider_payment_id, provider, subscription_id, plan, \
                        amount_minor, currency, status) \
                     VALUES ($1, $2, 'razorpay', $3, $4, $5, 'INR', 'captured') \
                     ON CONFLICT (provider_payment_id) DO NOTHING",
                )
                .bind(&id)
                .bind(payment_id)
                .bind(&body.subscription_id)
                .bind(&body.plan)
                .bind(plan_amount_minor(&body.plan))
                .execute(&state.db_pool)
                .await;
            }

            tracing::info!(
                tenant_id = %id,
                plan = %body.plan,
                subscription_id = %body.subscription_id,
                "Subscription activated"
            );
            Json(json!({
                "message": format!("Subscribed to {}", body.plan),
                "plan": body.plan,
                "eval_quota_monthly": quota,
                "current_period_end": body.current_period_end,
            }))
            .into_response()
        }
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, format!("Tenant not found: {id}")),
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// GET /api/v1/cloud/tenants/:id/payments
///
/// Payment history for the Billing page. Previously nothing recorded a
/// payment at all — the id was logged and discarded — so a customer had no
/// way to see what they had been charged.
pub async fn list_payments(
    State(state): State<AppState>,
    Extension(auth): Extension<AuthContext>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    if let Some(resp) = reject_cross_tenant(&auth, &id) {
        return resp;
    }

    let rows = sqlx::query(
        "SELECT provider_payment_id, plan, amount_minor, currency, status, created_at \
           FROM payments WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50",
    )
    .bind(&id)
    .fetch_all(&state.db_pool)
    .await;

    match rows {
        Ok(rows) => {
            let payments: Vec<_> = rows
                .iter()
                .map(|r| {
                    json!({
                        "payment_id":   r.get::<String, _>("provider_payment_id"),
                        "plan":         r.get::<String, _>("plan"),
                        "amount_minor": r.get::<i64, _>("amount_minor"),
                        "currency":     r.get::<String, _>("currency"),
                        "status":       r.get::<String, _>("status"),
                        "created_at":   r.get::<DateTime<Utc>, _>("created_at"),
                    })
                })
                .collect();
            Json(json!({ "payments": payments })).into_response()
        }
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// Price in paise, mirroring dashboard/lib/plans.ts.
fn plan_amount_minor(plan: &str) -> i64 {
    match plan {
        "indie" => 169_900,
        "starter" => 409_900,
        "pro" => 1_249_900,
        _ => 0,
    }
}
