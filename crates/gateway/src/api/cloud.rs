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

use crate::AppState;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json},
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
    created_at: DateTime<Utc>,
}

#[derive(Deserialize)]
pub struct UpgradePlanRequest {
    pub plan: String,             // "starter" | "pro" | "enterprise"
    pub payment_id: String,       // Razorpay payment_id or Paddle transaction_id
    pub payment_provider: String, // "razorpay" | "paddle"
}

// ── Handlers ────────────────────────────────────────────────────────────────

/// GET /api/v1/cloud/tenants/by-email/:email
/// Used by the login API route to look up a tenant by email.
pub async fn get_tenant_by_email(
    State(state): State<AppState>,
    Path(email): Path<String>,
) -> impl IntoResponse {
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
    Json(body): Json<CreateTenantRequest>,
) -> impl IntoResponse {
    let trial_ends_at = Utc::now() + Duration::days(7);
    let gateway_url = build_gateway_url(&body.id);

    let result = sqlx::query(
        r#"
        INSERT INTO tenants (id, name, email, plan, trial_ends_at, eval_quota_monthly, active, password_hash)
        VALUES ($1, $2, $3, 'trial', $4, 1000, true, $5)
        ON CONFLICT (id) DO UPDATE SET
            name          = EXCLUDED.name,
            email         = EXCLUDED.email,
            password_hash = COALESCE(EXCLUDED.password_hash, tenants.password_hash)
        RETURNING id, name, email, plan, trial_ends_at, eval_quota_monthly,
                  evals_used_this_month, active, created_at
        "#,
    )
    .bind(&body.id)
    .bind(&body.name)
    .bind(&body.email)
    .bind(trial_ends_at)
    .bind(&body.password_hash)
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
                created_at: row.get("created_at"),
            };
            (StatusCode::CREATED, Json(json!(tenant))).into_response()
        }
        Err(e) => cloud_error(StatusCode::INTERNAL_SERVER_ERROR, e.to_string()),
    }
}

/// GET /api/v1/cloud/tenants/:id
pub async fn get_tenant(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> impl IntoResponse {
    let result = sqlx::query(
        r#"
        SELECT id, name, email, plan, trial_ends_at, eval_quota_monthly,
               evals_used_this_month, active, created_at
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
    Path(id): Path<String>,
    Json(body): Json<UpgradePlanRequest>,
) -> impl IntoResponse {
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
pub async fn get_usage(State(state): State<AppState>, Path(id): Path<String>) -> impl IntoResponse {
    let result = sqlx::query(
        r#"
        SELECT
            t.plan,
            t.eval_quota_monthly,
            t.evals_used_this_month,
            t.trial_ends_at,
            t.active,
            COALESCE(u.evals_count, 0) AS this_month_evals,
            date_trunc('month', NOW()) AS month_start
        FROM tenants t
        LEFT JOIN eval_usage u ON u.tenant_id = t.id
            AND u.month = date_trunc('month', NOW())::date
        WHERE t.id = $1
        "#,
    )
    .bind(&id)
    .fetch_optional(&state.db_pool)
    .await;

    match result {
        Ok(Some(row)) => {
            let quota: i32 = row.get("eval_quota_monthly");
            let used: i64 = row.get("this_month_evals");
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
                "month_start": row.get::<DateTime<Utc>, _>("month_start"),
            }))
            .into_response()
        }
        Ok(None) => cloud_error(StatusCode::NOT_FOUND, format!("Tenant not found: {id}")),
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

fn plan_quota(plan: &str) -> i32 {
    match plan {
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
    // For now, tenant_id is passed as X-Repath-Tenant-Id header
    // This avoids needing wildcard SSL certs at launch
}

fn verify_razorpay_signature(body: &[u8], signature: &str) -> bool {
    use std::fmt::Write;

    let secret = std::env::var("RAZORPAY_WEBHOOK_SECRET").unwrap_or_default();

    if secret.is_empty() {
        // In dev/test mode, skip verification
        tracing::warn!("RAZORPAY_WEBHOOK_SECRET not set — skipping signature verification");
        return true;
    }

    // HMAC-SHA256: hmac(secret, body) == signature
    use ring::hmac;
    let key = hmac::Key::new(hmac::HMAC_SHA256, secret.as_bytes());
    let computed = hmac::sign(&key, body);
    let computed_hex = computed.as_ref().iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{:02x}", b);
        out
    });
    computed_hex == signature
}

fn verify_paddle_signature(body: &[u8], signature: &str) -> bool {
    use std::fmt::Write;

    let secret = std::env::var("PADDLE_WEBHOOK_SECRET").unwrap_or_default();

    if secret.is_empty() {
        tracing::warn!("PADDLE_WEBHOOK_SECRET not set — skipping signature verification");
        return true;
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
    computed_hex == provided_hash
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
