//! Every read endpoint, through the production router, against the real schema.
//!
//! # What this exists to catch
//!
//! On 2026-10-02 opening the request log took the gateway down. The handler
//! read `requests.status_code` — SMALLINT since migration 002 — as an `i32`,
//! sqlx's `Row::get` panics on a type mismatch, and the release profile
//! aborted on panic, so the whole process died, taking every customer's
//! in-flight LLM traffic with it, on every page load.
//!
//! Every existing suite missed it for the same reason: each builds its own
//! tables by hand, and each declared `status_code INTEGER`. The tests agreed
//! with the code and both disagreed with production.
//!
//! This suite seeds realistic rows into a database built by the real embedded
//! migrator, then calls every GET endpoint the dashboard uses, the way the
//! dashboard calls it: the operator token, acting as a tenant. Any 5xx fails.
//! A handler that decodes a column as the wrong type now fails here, in CI,
//! instead of in front of a customer.
//!
//! Skipped (not failed) when `DATABASE_URL` is unset; needs Redis.

mod common;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use common::TempDb;
use serde_json::{json, Value};
use sqlx::PgPool;
use tower::ServiceExt;
use uuid::Uuid;

const TENANT: &str = "ten_smoke";
const OPERATOR_TOKEN: &str = "smoke-operator-token-0123456789abcdef";

struct Seeded {
    rollout: Uuid,
    request_ok: Uuid,
    request_throttled: Uuid,
    request_failed: Uuid,
    decision: Uuid,
    webhook: Uuid,
}

/// Rows shaped like production: every status class, both evaluator types, a
/// stored payload, judge reasoning in metadata, a decision, a rule, a webhook
/// with a delivery, a payment.
async fn seed(pool: &PgPool) -> Seeded {
    let exec = |sql: &'static str| async move {
        sqlx::query(sql)
            .execute(pool)
            .await
            .unwrap_or_else(|e| panic!("seed failed: {e}\n{sql}"));
    };

    exec("INSERT INTO tenants (id, name, email, plan) VALUES ('ten_smoke', 'Smoke', 'smoke@example.com', 'indie')").await;

    let provider: Uuid = sqlx::query_scalar(
        "INSERT INTO providers (name, base_url, api_key_encrypted, provider_type) \
         VALUES ('openai', 'https://api.openai.com/v1', 'x', 'openai') RETURNING id",
    )
    .fetch_one(pool)
    .await
    .expect("provider");

    let version = |name: &'static str, model: &'static str| async move {
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO versions (name, provider_id, model, prompt_template) VALUES ($1, $2, $3, 'You are helpful.') RETURNING id",
        )
        .bind(name)
        .bind(provider)
        .bind(model)
        .fetch_one(pool)
        .await
        .expect("version")
    };
    let baseline = version("baseline", "gpt-4o-mini").await;
    let candidate = version("candidate", "gpt-5.4-mini").await;

    let rollout: Uuid = sqlx::query_scalar(
        "INSERT INTO rollouts (name, tenant_id, baseline_version_id, candidate_version_id, \
                               state, current_weight, policy, strategy) \
         VALUES ('smoke-rollout', $1, $2, $3, 'canary', 0.1, \
                 '{\"rollback_threshold\": 0.7, \"advance_threshold\": 0.9, \"min_samples\": 5}', \
                 '{\"steps\": [{\"weight\": 10}, {\"weight\": 100}]}') RETURNING id",
    )
    .bind(TENANT)
    .bind(baseline)
    .bind(candidate)
    .fetch_one(pool)
    .await
    .expect("rollout");

    sqlx::query(
        "INSERT INTO rollout_steps (rollout_id, step_number, target_weight, gate_expression) \
         VALUES ($1, 1, 0.1, 'quality >= 0.8'), ($1, 2, 1.0, 'quality >= 0.8')",
    )
    .bind(rollout)
    .execute(pool)
    .await
    .expect("steps");

    // One request per status class. 429 and 500 are exactly the values a
    // SMALLINT holds that an i32 read used to choke on.
    let request = |status: i16, version: Uuid| async move {
        sqlx::query_scalar::<_, Uuid>(
            "INSERT INTO requests (tenant_id, rollout_id, version_id, model, provider, latency_ms, \
                                   status_code, input_tokens, output_tokens, cost_micro_usd, session_id) \
             VALUES ($1, $2, $3, 'gpt-5.4-mini', 'openai', 420, $4, 1200, 300, 2250, 'sess-1') RETURNING id",
        )
        .bind(TENANT)
        .bind(rollout)
        .bind(version)
        .bind(status)
        .fetch_one(pool)
        .await
        .expect("request")
    };
    let request_ok = request(200, candidate).await;
    let request_throttled = request(429, baseline).await;
    let request_failed = request(500, candidate).await;

    sqlx::query(
        "INSERT INTO evaluations (request_id, evaluator_type, scores, overall_score, metadata) VALUES \
         ($1, 'programmatic', '{\"non_empty\": 1.0}', 1.0, NULL), \
         ($1, 'llm_judge', '{\"helpfulness\": 0.8}', 0.62, \
          '{\"criteria\": [{\"name\": \"helpfulness\", \"score\": 0.8, \"reason\": \"Answered, but vaguely.\", \"weight\": 0.5}]}')",
    )
    .bind(request_ok)
    .execute(pool)
    .await
    .expect("evaluations");

    sqlx::query(
        "INSERT INTO request_payloads (request_id, tenant_id, request_body, response_text, truncated, expires_at) \
         VALUES ($1, $2, '{\"messages\":[{\"role\":\"user\",\"content\":\"héllo — ünïcode\"}]}', 'Hi there.', FALSE, NOW() + INTERVAL '7 days')",
    )
    .bind(request_ok)
    .bind(TENANT)
    .execute(pool)
    .await
    .expect("payload");

    let decision: Uuid = sqlx::query_scalar(
        "INSERT INTO decisions (rollout_id, action, reason, previous_weight, new_weight, triggered_by, metrics_snapshot) \
         VALUES ($1, 'rollback', 'quality 0.62 < 0.70', 0.1, 0.0, 'controller', '{\"avg_judged_quality\": 0.62}') RETURNING id",
    )
    .bind(rollout)
    .fetch_one(pool)
    .await
    .expect("decision");

    sqlx::query(
        "INSERT INTO routing_rules (tenant_id, name, priority, enabled, condition, action) VALUES \
         ($1, 'short-to-haiku', 100, TRUE, \
          '{\"field\": \"input_tokens\", \"op\": \"lt\", \"value\": \"500\"}', \
          '{\"provider\": \"anthropic\", \"model\": \"claude-haiku-4-5\"}')",
    )
    .bind(TENANT)
    .execute(pool)
    .await
    .expect("routing rule");

    let webhook: Uuid = sqlx::query_scalar(
        "INSERT INTO webhooks (tenant_id, url, secret_sealed) VALUES ($1, 'https://hooks.example.com/repath', 'sealed') RETURNING id",
    )
    .bind(TENANT)
    .fetch_one(pool)
    .await
    .expect("webhook");

    sqlx::query(
        "INSERT INTO webhook_deliveries (webhook_id, event, payload, status_code) VALUES ($1, 'rollout.rolled_back', '{}', 200)",
    )
    .bind(webhook)
    .execute(pool)
    .await
    .expect("delivery");

    sqlx::query(
        "INSERT INTO payments (tenant_id, provider_payment_id, plan, amount_minor, status) \
         VALUES ($1, 'pay_smoke', 'indie', 169900, 'captured')",
    )
    .bind(TENANT)
    .execute(pool)
    .await
    .expect("payment");

    Seeded {
        rollout,
        request_ok,
        request_throttled,
        request_failed,
        decision,
        webhook,
    }
}

async fn get(router: &axum::Router, uri: &str) -> (StatusCode, Value) {
    let res = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(uri)
                .header("authorization", format!("Bearer {OPERATOR_TOKEN}"))
                .header("x-repath-act-as-tenant", TENANT)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("request");
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 4 << 20)
        .await
        .unwrap();
    let body = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({ "raw": String::from_utf8_lossy(&bytes) }));
    (status, body)
}

#[tokio::test]
async fn every_dashboard_read_endpoint_serves_real_rows() {
    let Some(db) = TempDb::migrated().await else {
        eprintln!("skipping: DATABASE_URL not set");
        return;
    };
    // The operator path is how the dashboard reaches the gateway. Set once;
    // this binary has no other test that reads it.
    std::env::set_var("REPATH_API_TOKEN", OPERATOR_TOKEN);

    let s = seed(db.pool()).await;
    let state = repath_gateway::test_support::app_state_for_tests(db.pool().clone()).await;
    let router = repath_gateway::server::create_server(state);

    let r = s.rollout;
    let endpoints = [
        "/api/v1/rollouts".to_string(),
        format!("/api/v1/rollouts/{r}"),
        format!("/api/v1/rollouts/{r}/metrics"),
        format!("/api/v1/rollouts/{r}/steps"),
        format!("/api/v1/rollouts/{r}/decisions"),
        "/api/v1/requests".to_string(),
        "/api/v1/requests?status=error".to_string(),
        "/api/v1/requests?max_score=0.7&evaluator=llm_judge".to_string(),
        format!("/api/v1/requests/{}", s.request_ok),
        format!("/api/v1/requests/{}", s.request_throttled),
        format!("/api/v1/requests/{}", s.request_failed),
        format!("/api/v1/decisions/{}/requests", s.decision),
        "/api/v1/settings/providers".to_string(),
        "/api/v1/settings/failover".to_string(),
        "/api/v1/settings/webhooks".to_string(),
        format!("/api/v1/settings/webhooks/{}/deliveries", s.webhook),
        "/api/v1/settings/notifications".to_string(),
        "/api/v1/settings/gateway".to_string(),
        "/api/v1/routing/rules".to_string(),
        "/api/v1/system/health".to_string(),
        "/api/v1/system/providers".to_string(),
        format!("/api/v1/cloud/tenants/{TENANT}"),
        format!("/api/v1/cloud/tenants/{TENANT}/usage"),
        format!("/api/v1/cloud/tenants/{TENANT}/payments"),
        "/api/v1/cloud/tenants/by-email/smoke@example.com".to_string(),
    ];

    let mut failures = Vec::new();
    for uri in &endpoints {
        let (status, body) = get(&router, uri).await;
        if status.is_server_error() || status == StatusCode::UNAUTHORIZED {
            failures.push(format!("{status} {uri}\n    {body}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} endpoints failed on real rows:\n  {}",
        failures.len(),
        endpoints.len(),
        failures.join("\n  ")
    );
}

#[tokio::test]
async fn the_request_log_returns_what_was_stored() {
    let Some(db) = TempDb::migrated().await else {
        return;
    };
    std::env::set_var("REPATH_API_TOKEN", OPERATOR_TOKEN);
    let s = seed(db.pool()).await;
    let state = repath_gateway::test_support::app_state_for_tests(db.pool().clone()).await;
    let router = repath_gateway::server::create_server(state);

    // The list carries all three status classes, decoded correctly.
    let (status, body) = get(&router, "/api/v1/requests").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mut codes: Vec<i64> = body["requests"]
        .as_array()
        .expect("requests array")
        .iter()
        .map(|r| r["status_code"].as_i64().expect("status_code"))
        .collect();
    codes.sort_unstable();
    assert_eq!(codes, vec![200, 429, 500]);

    // The detail carries the prompt, the response, and the judge's reasoning
    // — the reason the request log exists.
    let (status, d) = get(&router, &format!("/api/v1/requests/{}", s.request_ok)).await;
    assert_eq!(status, StatusCode::OK, "{d}");
    assert_eq!(d["status_code"], 200);
    assert_eq!(d["cost_micro_usd"], 2250);
    assert!(d["request_body"].as_str().unwrap().contains("ünïcode"));
    assert_eq!(d["response_text"], "Hi there.");
    let judge = d["evaluations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["evaluator_type"] == "llm_judge")
        .expect("judge evaluation present");
    assert_eq!(
        judge["metadata"]["criteria"][0]["reason"],
        "Answered, but vaguely."
    );

    // The evidence view for a rollback lists the requests it judged.
    let (status, e) = get(
        &router,
        &format!("/api/v1/decisions/{}/requests", s.decision),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{e}");
    assert_eq!(e["decision"]["action"], "rollback");
}

#[tokio::test]
async fn another_tenant_sees_none_of_it() {
    let Some(db) = TempDb::migrated().await else {
        return;
    };
    std::env::set_var("REPATH_API_TOKEN", OPERATOR_TOKEN);
    let s = seed(db.pool()).await;
    sqlx::query("INSERT INTO tenants (id, name, email) VALUES ('ten_other', 'O', 'o@example.com')")
        .execute(db.pool())
        .await
        .unwrap();
    let state = repath_gateway::test_support::app_state_for_tests(db.pool().clone()).await;
    let router = repath_gateway::server::create_server(state);

    let as_other = |uri: String| {
        let router = router.clone();
        async move {
            let res = router
                .oneshot(
                    Request::builder()
                        .uri(uri)
                        .header("authorization", format!("Bearer {OPERATOR_TOKEN}"))
                        .header("x-repath-act-as-tenant", "ten_other")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let status = res.status();
            let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
                .await
                .unwrap();
            (
                status,
                serde_json::from_slice::<Value>(&bytes).unwrap_or(Value::Null),
            )
        }
    };

    let (status, list) = as_other("/api/v1/requests".into()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        list["requests"].as_array().unwrap().len(),
        0,
        "another tenant's log leaked"
    );

    // Someone else's prompt is a 404, never a 403 that confirms it exists.
    let (status, _) = as_other(format!("/api/v1/requests/{}", s.request_ok)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = as_other(format!("/api/v1/decisions/{}/requests", s.decision)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_rollout_routes_to_the_provider_it_names() {
    // Rollout creation never wrote versions.provider_url and the router read a
    // NULL as OpenAI, so every non-OpenAI rollout created through the API sent
    // its traffic to api.openai.com. Create one per provider through the real
    // endpoint and check where its versions point.
    let Some(db) = TempDb::migrated().await else {
        return;
    };
    std::env::set_var("REPATH_API_TOKEN", OPERATOR_TOKEN);
    sqlx::query("INSERT INTO tenants (id, name, email) VALUES ($1, 'S', 'route@example.com')")
        .bind(TENANT)
        .execute(db.pool())
        .await
        .unwrap();
    let state = repath_gateway::test_support::app_state_for_tests(db.pool().clone()).await;
    let router = repath_gateway::server::create_server(state);

    for (provider, model, expected) in [
        (
            "anthropic",
            "claude-sonnet-5-5",
            "https://api.anthropic.com/v1",
        ),
        (
            "gemini",
            "gemini-3.8-flash",
            "https://generativelanguage.googleapis.com/v1beta/openai",
        ),
        (
            "openrouter",
            "x-ai/grok-4.7",
            "https://openrouter.ai/api/v1",
        ),
        (
            "vercel",
            "openai/gpt-6-luna",
            "https://ai-gateway.vercel.sh/v1",
        ),
    ] {
        let body = json!({
            "apiVersion": "repath/v1", "kind": "Rollout",
            "metadata": { "name": format!("route-{provider}") },
            "spec": {
                "baseline":  { "provider": "openai", "model": "gpt-5.4-mini" },
                "candidate": { "provider": provider, "model": model },
                "strategy": { "type": "canary", "steps": [{ "weight": 100 }],
                              "rollback": { "trigger": {}, "action": "rollback" } }
            }
        });
        let res = router
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/rollouts")
                    .header("authorization", format!("Bearer {OPERATOR_TOKEN}"))
                    .header("x-repath-act-as-tenant", TENANT)
                    .header("content-type", "application/json")
                    .body(Body::from(body.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap();
        let status = res.status();
        let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
            .await
            .unwrap();
        assert_eq!(
            status,
            StatusCode::CREATED,
            "{}",
            String::from_utf8_lossy(&bytes)
        );
        let id: Uuid = serde_json::from_slice::<Value>(&bytes).unwrap()["id"]
            .as_str()
            .unwrap()
            .parse()
            .unwrap();

        let url: Option<String> = sqlx::query_scalar(
            "SELECT v.provider_url FROM rollouts r JOIN versions v ON v.id = r.candidate_version_id WHERE r.id = $1",
        )
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(
            url.as_deref(),
            Some(expected),
            "{provider} rollout must route to {expected}"
        );
    }
}

async fn post_as_operator(router: &axum::Router, uri: &str, body: Value) -> (StatusCode, Value) {
    let res = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .header("authorization", format!("Bearer {OPERATOR_TOKEN}"))
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .expect("request");
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    (
        status,
        serde_json::from_slice(&bytes).unwrap_or(Value::Null),
    )
}

/// Subscribe, cancel, subscribe again — what Billing does, against the real
/// schema. Pricing and the terms promise that cancelling keeps the plan to the
/// end of the paid period; this pins that the flag is recorded without
/// touching the plan, that only the account's current subscription can be
/// flagged, and that a new subscription clears it.
#[tokio::test]
async fn a_subscription_can_be_cancelled_at_period_end() {
    let Some(db) = TempDb::migrated().await else {
        eprintln!("skipping: DATABASE_URL not set");
        return;
    };
    std::env::set_var("REPATH_API_TOKEN", OPERATOR_TOKEN);
    sqlx::query("INSERT INTO tenants (id, name, email, plan) VALUES ('ten_smoke', 'Smoke', 'smoke@example.com', 'trial')")
        .execute(db.pool())
        .await
        .unwrap();
    let state = repath_gateway::test_support::app_state_for_tests(db.pool().clone()).await;
    let router = repath_gateway::server::create_server(state);
    let usage = format!("/api/v1/cloud/tenants/{TENANT}/usage");

    let (status, _) = post_as_operator(
        &router,
        &format!("/api/v1/cloud/tenants/{TENANT}/subscription"),
        json!({ "plan": "starter", "subscription_id": "sub_one", "subscription_status": "active",
                "current_period_end": "2030-01-01T00:00:00Z" }),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (_, u) = get(&router, &usage).await;
    assert_eq!(u["subscription_id"], "sub_one");
    assert_eq!(u["cancel_at_period_end"], false);

    // A subscription the account is not on cannot be flagged.
    let cancel = format!("/api/v1/cloud/tenants/{TENANT}/subscription/cancel");
    let (status, _) =
        post_as_operator(&router, &cancel, json!({ "subscription_id": "sub_other" })).await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let (status, body) =
        post_as_operator(&router, &cancel, json!({ "subscription_id": "sub_one" })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, u) = get(&router, &usage).await;
    assert_eq!(u["cancel_at_period_end"], true);
    assert_eq!(
        u["plan"], "starter",
        "cancelling must not take away the paid period"
    );
    assert_eq!(u["eval_quota_monthly"], 10_000);

    // Subscribing again starts clean.
    post_as_operator(
        &router,
        &format!("/api/v1/cloud/tenants/{TENANT}/subscription"),
        json!({ "plan": "pro", "subscription_id": "sub_two", "subscription_status": "active",
                "current_period_end": "2030-02-01T00:00:00Z" }),
    )
    .await;
    let (_, u) = get(&router, &usage).await;
    assert_eq!(u["subscription_id"], "sub_two");
    assert_eq!(u["cancel_at_period_end"], false);

    // A tenant cannot mark its own subscription; only the dashboard's
    // server-side route, after Razorpay accepted the cancellation, can.
    let res = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(&cancel)
                .header("authorization", format!("Bearer {OPERATOR_TOKEN}"))
                .header("x-repath-act-as-tenant", TENANT)
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({ "subscription_id": "sub_two" }).to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::FORBIDDEN);
}
