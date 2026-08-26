//! Tenant isolation tests.
//!
//! These exist because Repath shipped a version in which every logged-in user
//! could read — and promote or roll back — every other user's rollouts. The
//! management API used one shared token for all customers and no query filtered
//! by tenant, and the proxy took tenant identity from an unverified request
//! header that anyone could set.
//!
//! Each test below corresponds to one way that could be exploited. **Do not
//! delete or weaken these tests.** If one starts failing, tenant data is
//! exposed and the build must not ship.
//!
//! # Running
//!
//! ```
//! DATABASE_URL=postgres://... cargo test -p repath-gateway --test tenant_isolation
//! ```
//!
//! Skipped (not failed) when `DATABASE_URL` is unset, so a machine with no
//! database still gets a green build.
//!
//! # Isolation between tests
//!
//! Every test runs in its own PostgreSQL schema, created up front and dropped
//! afterwards, so they can run in parallel without seeing each other's rows.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use repath_gateway::tenant::{self, AuthContext, TenantInfo};
use serde_json::Value;
use sqlx::{PgPool, Row};
use std::sync::Arc;
use tower::ServiceExt; // for `oneshot`
use uuid::Uuid;

// ── Test harness ────────────────────────────────────────────────────────────

struct TestDb {
    pool: PgPool,
    schema: String,
    admin_url: String,
}

impl TestDb {
    async fn new() -> Self {
        let database_url = std::env::var("DATABASE_URL").expect("DATABASE_URL must be set");
        let schema = format!("iso_{}", Uuid::new_v4().simple());

        let root = PgPool::connect(&database_url).await.expect("connect");
        sqlx::query(&format!("CREATE SCHEMA \"{schema}\""))
            .execute(&root)
            .await
            .expect("create schema");
        root.close().await;

        let mut opts: sqlx::postgres::PgConnectOptions =
            database_url.parse().expect("parse DATABASE_URL");
        opts = opts.options([("search_path", schema.as_str())]);
        let pool = PgPool::connect_with(opts).await.expect("connect to schema");

        create_schema(&pool).await;

        TestDb {
            pool,
            schema,
            admin_url: database_url,
        }
    }
}

impl TestDb {
    fn pool(&self) -> &PgPool {
        &self.pool
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        // Blocking cleanup in Drop: spawn a short-lived runtime because Drop
        // cannot be async. Failures are ignored — a leaked test schema is
        // untidy but harmless.
        let url = self.admin_url.clone();
        let schema = self.schema.clone();
        std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Runtime::new() {
                rt.block_on(async {
                    if let Ok(pool) = PgPool::connect(&url).await {
                        let _ = sqlx::query(&format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE"))
                            .execute(&pool)
                            .await;
                    }
                });
            }
        })
        .join()
        .ok();
    }
}

/// Minimal schema: only what the isolation path touches.
async fn create_schema(pool: &PgPool) {
    // gen_random_uuid() is built into PostgreSQL 13+, so no extension is
    // needed. uuid_generate_v4() would live in `public`, which this schema's
    // search_path deliberately excludes.
    for ddl in [
        r#"CREATE TABLE tenants (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            plan VARCHAR(50) NOT NULL DEFAULT 'trial',
            trial_ends_at TIMESTAMPTZ,
            eval_quota_monthly INTEGER NOT NULL DEFAULT 10000,
            evals_used_this_month INTEGER NOT NULL DEFAULT 0,
            quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()) + INTERVAL '1 month',
            active BOOLEAN NOT NULL DEFAULT TRUE,
            api_key_hash CHAR(64),
            api_key_prefix VARCHAR(20),
            api_key_created_at TIMESTAMPTZ,
            password_hash TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
        r#"CREATE TABLE providers (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL UNIQUE,
            base_url VARCHAR(500) NOT NULL,
            api_key_encrypted TEXT NOT NULL,
            provider_type VARCHAR(50) NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
        r#"CREATE TABLE versions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            provider_id UUID NOT NULL REFERENCES providers(id),
            model VARCHAR(255) NOT NULL,
            prompt_template TEXT,
            provider_url VARCHAR(500),
            parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
        r#"CREATE TABLE rollouts (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            name VARCHAR(255) NOT NULL,
            tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE SET NULL,
            baseline_version_id UUID NOT NULL REFERENCES versions(id),
            candidate_version_id UUID NOT NULL REFERENCES versions(id),
            state VARCHAR(50) NOT NULL DEFAULT 'created',
            current_weight DOUBLE PRECISION NOT NULL DEFAULT 0.0,
            policy JSONB NOT NULL DEFAULT '{}'::jsonb,
            strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ
        )"#,
        r#"CREATE UNIQUE INDEX idx_rollouts_tenant_name
             ON rollouts(tenant_id, name) WHERE tenant_id IS NOT NULL"#,
        r#"CREATE TABLE rollout_steps (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            rollout_id UUID NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
            step_number INTEGER NOT NULL,
            target_weight DOUBLE PRECISION NOT NULL,
            gate_expression TEXT,
            pause_duration_seconds INTEGER,
            status VARCHAR(50) NOT NULL DEFAULT 'pending',
            started_at TIMESTAMPTZ,
            completed_at TIMESTAMPTZ
        )"#,
        r#"CREATE TABLE requests (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            rollout_id UUID REFERENCES rollouts(id) ON DELETE SET NULL,
            -- Nullable: a request proxied without an active rollout has no
            -- version. See migration 006.
            version_id UUID REFERENCES versions(id),
            tenant_id VARCHAR(64),
            model VARCHAR(255) NOT NULL,
            input_tokens INTEGER,
            output_tokens INTEGER,
            latency_ms INTEGER NOT NULL,
            status_code SMALLINT NOT NULL,
            error TEXT,
            session_id VARCHAR(255),
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
        r#"CREATE TABLE evaluations (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
            evaluator_type VARCHAR(50) NOT NULL,
            scores JSONB NOT NULL,
            overall_score DOUBLE PRECISION NOT NULL,
            metadata JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
        r#"CREATE TABLE decisions (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            rollout_id UUID NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
            action VARCHAR(50) NOT NULL,
            reason TEXT,
            previous_weight DOUBLE PRECISION,
            new_weight DOUBLE PRECISION,
            triggered_by VARCHAR(50),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )"#,
    ] {
        sqlx::query(ddl).execute(pool).await.expect("create table");
    }
}

/// Insert a tenant with a freshly minted API key. Returns (tenant_id, raw_key).
async fn seed_tenant(pool: &PgPool, id: &str) -> (String, String) {
    let key = tenant::generate_key();
    sqlx::query(
        "INSERT INTO tenants (id, name, email, plan, active, api_key_hash, api_key_prefix)
         VALUES ($1, $1, $2, 'pro', TRUE, $3, $4)",
    )
    .bind(id)
    .bind(format!("{id}@example.com"))
    .bind(&key.hash)
    .bind(&key.prefix)
    .execute(pool)
    .await
    .expect("seed tenant");

    (id.to_string(), key.raw)
}

/// Create a rollout owned by `tenant_id`. Returns its UUID.
async fn seed_rollout(pool: &PgPool, tenant_id: &str, name: &str) -> Uuid {
    let provider: Uuid = sqlx::query(
        "INSERT INTO providers (name, base_url, api_key_encrypted, provider_type)
         VALUES ($1, 'https://api.openai.com/v1', 'x', 'openai')
         ON CONFLICT (name) DO UPDATE SET updated_at = NOW() RETURNING id",
    )
    .bind(format!("openai-{tenant_id}"))
    .fetch_one(pool)
    .await
    .expect("provider")
    .get("id");

    let mut versions = Vec::new();
    for label in ["baseline", "candidate"] {
        let id: Uuid = sqlx::query(
            "INSERT INTO versions (name, provider_id, model, prompt_template)
             VALUES ($1, $2, 'gpt-4o-mini', $3) RETURNING id",
        )
        .bind(format!("{name}-{label}-{}", Uuid::new_v4().simple()))
        .bind(provider)
        .bind(format!("SECRET PROMPT OF {tenant_id}"))
        .fetch_one(pool)
        .await
        .expect("version")
        .get("id");
        versions.push(id);
    }

    sqlx::query(
        "INSERT INTO rollouts (name, tenant_id, baseline_version_id, candidate_version_id, state, current_weight)
         VALUES ($1, $2, $3, $4, 'canary', 0.1) RETURNING id",
    )
    .bind(name)
    .bind(tenant_id)
    .bind(versions[0])
    .bind(versions[1])
    .fetch_one(pool)
    .await
    .expect("rollout")
    .get("id")
}

/// Build an `AuthContext` for a tenant id, as the middleware would.
fn ctx(tenant_id: &str) -> AuthContext {
    AuthContext::Tenant(Arc::new(TenantInfo {
        id: tenant_id.to_string(),
        plan: "pro".into(),
        active: true,
        trial_ends_at: None,
        eval_quota_monthly: 10_000,
        evals_used_this_month: 0,
    }))
}

/// Build a router with auth pre-resolved to `auth`, bypassing the middleware so
/// each test targets the handler's scoping rather than key parsing.
async fn router_as(db: &TestDb, auth: AuthContext) -> axum::Router {
    use repath_gateway::api;

    let state = test_state(db).await;
    axum::Router::new()
        .merge(api::api_router_for_tests())
        .layer(axum::Extension(auth))
        .with_state(state)
}

async fn test_state(db: &TestDb) -> repath_gateway::AppState {
    repath_gateway::test_support::app_state_for_tests(db.pool.clone()).await
}

async fn get(router: axum::Router, uri: &str) -> (StatusCode, Value) {
    let res = router
        .oneshot(Request::builder().uri(uri).body(Body::empty()).unwrap())
        .await
        .expect("request");
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

async fn post(router: axum::Router, uri: &str) -> (StatusCode, Value) {
    let res = router
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(uri)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("request");
    let status = res.status();
    let bytes = axum::body::to_bytes(res.into_body(), 1 << 20)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, body)
}

fn skip_without_db() -> bool {
    if std::env::var("DATABASE_URL").is_err() {
        eprintln!("SKIP: DATABASE_URL not set");
        return true;
    }
    false
}

// ── The tests ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn listing_shows_only_your_own_rollouts() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    seed_rollout(db.pool(), &a, "alpha-rollout").await;
    seed_rollout(db.pool(), &b, "beta-rollout").await;

    let (status, body) = get(router_as(&db, ctx(&a)).await, "/rollouts").await;
    assert_eq!(status, StatusCode::OK);

    let names: Vec<&str> = body["rollouts"]
        .as_array()
        .expect("rollouts array")
        .iter()
        .map(|r| r["name"].as_str().unwrap())
        .collect();

    assert_eq!(
        names,
        vec!["alpha-rollout"],
        "tenant A must see exactly its own rollouts, got {names:?}"
    );
}

#[tokio::test]
async fn cannot_read_another_tenants_rollout_by_id() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    let victim = seed_rollout(db.pool(), &b, "beta-rollout").await;

    let (status, _) = get(
        router_as(&db, ctx(&a)).await,
        &format!("/rollouts/{victim}"),
    )
    .await;

    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "reading another tenant's rollout must 404, not succeed"
    );
}

#[tokio::test]
async fn cross_tenant_read_returns_404_not_403() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    let victim = seed_rollout(db.pool(), &b, "beta-rollout").await;

    let (existing, _) = get(
        router_as(&db, ctx(&a)).await,
        &format!("/rollouts/{victim}"),
    )
    .await;
    let (missing, _) = get(
        router_as(&db, ctx(&a)).await,
        &format!("/rollouts/{}", Uuid::new_v4()),
    )
    .await;

    // Identical responses: an attacker cannot distinguish "exists but is
    // someone else's" from "does not exist" and so cannot enumerate ids.
    assert_eq!(existing, StatusCode::NOT_FOUND);
    assert_eq!(missing, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cannot_read_another_tenants_rollout_by_name() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    seed_rollout(db.pool(), &b, "beta-rollout").await;

    // Name lookups are the easier attack — names are guessable.
    let (status, _) = get(router_as(&db, ctx(&a)).await, "/rollouts/beta-rollout").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn cannot_promote_another_tenants_rollout() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    let victim = seed_rollout(db.pool(), &b, "beta-rollout").await;

    let (status, _) = post(
        router_as(&db, ctx(&a)).await,
        &format!("/rollouts/{victim}/promote"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    // And the victim rollout is untouched.
    let state: String = sqlx::query("SELECT state FROM rollouts WHERE id = $1")
        .bind(victim)
        .fetch_one(db.pool())
        .await
        .unwrap()
        .get("state");
    assert_eq!(state, "canary", "another tenant must not change our state");
}

#[tokio::test]
async fn cannot_rollback_another_tenants_rollout() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    let victim = seed_rollout(db.pool(), &b, "beta-rollout").await;

    let (status, _) = post(
        router_as(&db, ctx(&a)).await,
        &format!("/rollouts/{victim}/rollback"),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let weight: f64 = sqlx::query("SELECT current_weight FROM rollouts WHERE id = $1")
        .bind(victim)
        .fetch_one(db.pool())
        .await
        .unwrap()
        .get("current_weight");
    assert!(
        (weight - 0.1).abs() < f64::EPSILON,
        "another tenant must not move our traffic weight"
    );
}

#[tokio::test]
async fn cannot_delete_another_tenants_rollout() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    let victim = seed_rollout(db.pool(), &b, "beta-rollout").await;

    let res = router_as(&db, ctx(&a))
        .await
        .oneshot(
            Request::builder()
                .method("DELETE")
                .uri(format!("/rollouts/{victim}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);

    let still_there: i64 = sqlx::query("SELECT COUNT(*) AS n FROM rollouts WHERE id = $1")
        .bind(victim)
        .fetch_one(db.pool())
        .await
        .unwrap()
        .get("n");
    assert_eq!(still_there, 1, "rollout must survive a cross-tenant delete");
}

#[tokio::test]
async fn cannot_read_another_tenants_decisions_or_steps() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    let victim = seed_rollout(db.pool(), &b, "beta-rollout").await;

    for suffix in ["steps", "decisions", "metrics"] {
        let (status, _) = get(
            router_as(&db, ctx(&a)).await,
            &format!("/rollouts/{victim}/{suffix}"),
        )
        .await;
        assert_eq!(
            status,
            StatusCode::NOT_FOUND,
            "sub-resource '{suffix}' leaked across tenants"
        );
    }
}

#[tokio::test]
async fn admin_context_sees_every_tenant() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;
    seed_rollout(db.pool(), &a, "alpha-rollout").await;
    seed_rollout(db.pool(), &b, "beta-rollout").await;

    let (status, body) = get(router_as(&db, AuthContext::Admin).await, "/rollouts").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body["rollouts"].as_array().unwrap().len(),
        2,
        "the operator token is intentionally unscoped"
    );
}

#[tokio::test]
async fn two_tenants_may_reuse_the_same_rollout_name() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, _) = seed_tenant(db.pool(), "ten_alpha").await;
    let (b, _) = seed_tenant(db.pool(), "ten_beta").await;

    // Both call it "checkout-prompt" — normal, and must be allowed now that
    // uniqueness is scoped per tenant rather than global.
    seed_rollout(db.pool(), &a, "checkout-prompt").await;
    seed_rollout(db.pool(), &b, "checkout-prompt").await;

    // Each still resolves to its own.
    let (status_a, body_a) = get(router_as(&db, ctx(&a)).await, "/rollouts/checkout-prompt").await;
    assert_eq!(status_a, StatusCode::OK);
    let baseline_prompt = body_a["baseline_prompt"].as_str().unwrap_or_default();
    assert!(
        baseline_prompt.contains("ten_alpha"),
        "tenant A resolved to the wrong rollout: {baseline_prompt}"
    );
}

#[tokio::test]
async fn api_key_resolves_only_its_own_tenant() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (a, key_a) = seed_tenant(db.pool(), "ten_alpha").await;
    let (_b, key_b) = seed_tenant(db.pool(), "ten_beta").await;

    let cache = arc_swap::ArcSwap::from_pointee(tenant::TenantCache::empty());

    let resolved_a = tenant::resolve_key(db.pool(), &cache, &key_a)
        .await
        .expect("key A resolves");
    assert_eq!(resolved_a.id, a);

    let resolved_b = tenant::resolve_key(db.pool(), &cache, &key_b)
        .await
        .expect("key B resolves");
    assert_ne!(resolved_b.id, a, "key B must not resolve to tenant A");
}

#[tokio::test]
async fn invalid_and_tampered_keys_resolve_to_nothing() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (_a, key_a) = seed_tenant(db.pool(), "ten_alpha").await;
    let cache = arc_swap::ArcSwap::from_pointee(tenant::TenantCache::empty());

    for bogus in [
        "rp_live_totally_made_up".to_string(),
        String::new(),
        "ten_alpha".to_string(), // the tenant id itself is not a key
        key_a[..key_a.len() - 1].to_string(), // truncated
        format!("{key_a}x"),     // extended
    ] {
        assert!(
            tenant::resolve_key(db.pool(), &cache, &bogus)
                .await
                .is_none(),
            "key '{bogus}' must not authenticate"
        );
    }
}

// ── Router wiring ───────────────────────────────────────────────────────────

/// Build the real production router, middleware and all.
///
/// The tests above deliberately inject a pre-resolved `AuthContext` and skip
/// the auth layer, so they cannot catch a mistake in how that layer is
/// attached. A misplaced `route_layer` once made the gateway panic on startup
/// with every unit and integration test green — this exercises the same call
/// `main` makes.
#[tokio::test]
async fn production_router_builds() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let state = test_state(&db).await;

    let router = repath_gateway::server::create_server(state);

    // Health is unauthenticated, so a 200 here proves the router assembled
    // and can actually serve.
    let res = router
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("health request");
    assert_eq!(res.status(), StatusCode::OK);
}

/// In cloud mode a proxy request with no key must be rejected outright.
#[tokio::test]
async fn proxy_requires_a_key_in_cloud_mode() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let state = test_state(&db).await;

    // SAFETY: single-threaded test process for env mutation; the value is
    // restored below so neighbouring tests are unaffected.
    std::env::set_var("REPATH_CLOUD_MODE", "true");

    let router = repath_gateway::server::create_server(state);
    let res = router
        .oneshot(
            Request::builder()
                .uri("/v1/chat/completions")
                .method("POST")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("proxy request");

    std::env::remove_var("REPATH_CLOUD_MODE");

    assert_eq!(
        res.status(),
        StatusCode::UNAUTHORIZED,
        "an unauthenticated proxy call must not reach the handler in cloud mode"
    );
}

/// An invalid key must be rejected regardless of mode.
#[tokio::test]
async fn proxy_rejects_an_invalid_key() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let state = test_state(&db).await;

    let router = repath_gateway::server::create_server(state);
    let res = router
        .oneshot(
            Request::builder()
                .uri("/v1/chat/completions")
                .method("POST")
                .header("x-repath-key", "rp_live_not_a_real_key")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .expect("proxy request");

    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
}

// ── Usage metering ──────────────────────────────────────────────────────────

/// A request proxied without an active rollout must still be recorded.
///
/// `requests.version_id` was NOT NULL with a foreign key, and the gateway wrote
/// a nil-UUID sentinel when no rollout applied. The recorder skipped those rows
/// rather than fail the insert, so pass-through traffic — the majority of most
/// tenants' traffic — was never metered and nothing ever reported it.
#[tokio::test]
async fn requests_without_a_rollout_are_still_recorded() {
    if skip_without_db() {
        return;
    }
    let db = TestDb::new().await;
    let (tenant, _) = seed_tenant(db.pool(), "ten_alpha").await;

    // Mirrors exactly what the recorder writes for a pass-through request.
    sqlx::query(
        "INSERT INTO requests (rollout_id, version_id, tenant_id, model, latency_ms, status_code)
         VALUES (NULL, NULL, $1, 'gpt-4o-mini', 42, 200)",
    )
    .bind(&tenant)
    .execute(db.pool())
    .await
    .expect("a request with no rollout and no version must insert");

    let n: i64 = sqlx::query("SELECT COUNT(*) AS n FROM requests WHERE tenant_id = $1")
        .bind(&tenant)
        .fetch_one(db.pool())
        .await
        .unwrap()
        .get("n");

    assert_eq!(n, 1, "pass-through traffic must be metered to its tenant");
}
