//! Integration tests for the Repath rollout controller.
//!
//! These tests run against a real PostgreSQL database and exercise the full
//! stack from store queries through aggregation to policy evaluation.
//!
//! # Running
//!
//! ```
//! DATABASE_URL=postgres://... cargo test -p repath-controller --test integration_test
//! ```
//!
//! Tests are skipped (not failed) when `DATABASE_URL` is unset so CI passes
//! without a database sidecar unless one is explicitly provisioned.
//!
//! # Isolation
//!
//! Each test gets a fresh PostgreSQL schema (`test_<uuid>`) created at the
//! start and dropped on `Drop`. All table references are schema-qualified via
//! `SET search_path`, so tests run in parallel without ever touching each
//! other's rows.

use repath_common::types::RolloutPolicy;
use repath_controller::{
    metrics_aggregator::{self, AggregationResult, RolloutMetrics, VersionSnapshot},
    policy::{self, PolicyVerdict},
    store,
};
use serde_json::json;
use sqlx::{PgPool, Row};
use uuid::Uuid;

// ================================================================================================
// Test database infrastructure
// ================================================================================================

/// A test-scoped PostgreSQL schema.
///
/// Created in `new()`, dropped on `Drop`. The `PgPool` has its `search_path`
/// fixed to this schema so every query in the test sees an isolated copy of
/// all tables.
struct TestDb {
    pool: PgPool,
    schema: String,
    secondary_pool: Option<PgPool>,
}

impl TestDb {
    async fn new() -> Self {
        let database_url = std::env::var("DATABASE_URL")
            .expect("TestDb::new called without DATABASE_URL — callers must check first");

        let schema = format!("test_{}", Uuid::new_v4().simple());

        // Root pool (no schema) to create the schema itself.
        let root_pool = PgPool::connect(&database_url)
            .await
            .expect("connect to PostgreSQL");

        sqlx::query(&format!("CREATE SCHEMA \"{}\"", schema))
            .execute(&root_pool)
            .await
            .expect("create test schema");

        root_pool.close().await;

        // Re-connect with search_path fixed to our schema.
        // Use PgConnectOptions so we don't need to manipulate the URL string
        // (which may already contain query params like ?sslmode=require).
        let mut opts: sqlx::postgres::PgConnectOptions = database_url
            .parse()
            .expect("parse DATABASE_URL as PgConnectOptions");
        opts = opts.options([("search_path", schema.as_str())]);
        let pool = PgPool::connect_with(opts)
            .await
            .expect("connect with schema search_path");

        Self::run_migrations(&pool).await;

        TestDb {
            pool,
            schema,
            secondary_pool: None,
        }
    }

    /// Open a second independent pool on the same schema.
    /// Used by concurrency tests that need two separate connections.
    async fn secondary(&mut self) -> &PgPool {
        if self.secondary_pool.is_none() {
            let database_url = std::env::var("DATABASE_URL").unwrap();
            let mut opts: sqlx::postgres::PgConnectOptions =
                database_url.parse().expect("parse DATABASE_URL");
            opts = opts.options([("search_path", self.schema.as_str())]);
            let pool = PgPool::connect_with(opts).await.expect("secondary pool");
            self.secondary_pool = Some(pool);
        }
        self.secondary_pool.as_ref().unwrap()
    }

    fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Run the migration DDL inside the test schema.
    ///
    /// We recreate tables rather than using sqlx migrate so that each test
    /// schema is fully self-contained without requiring file-system migration
    /// discovery at runtime.
    async fn run_migrations(pool: &PgPool) {
        // uuid-ossp may already exist in the public schema — that is fine.
        let _ = sqlx::query("CREATE EXTENSION IF NOT EXISTS \"uuid-ossp\"")
            .execute(pool)
            .await;

        sqlx::query(
            r#"
            CREATE TABLE providers (
                id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name              VARCHAR(255) NOT NULL UNIQUE,
                base_url          VARCHAR(500) NOT NULL,
                api_key_encrypted TEXT NOT NULL,
                provider_type     VARCHAR(50) NOT NULL,
                created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT providers_provider_type_check
                    CHECK (provider_type IN ('openai', 'anthropic', 'gemini', 'azure'))
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create providers");

        sqlx::query(
            r#"
            CREATE TABLE versions (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name            VARCHAR(255) NOT NULL UNIQUE,
                provider_id     UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
                model           VARCHAR(255) NOT NULL,
                prompt_template TEXT,
                parameters      JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT versions_parameters_is_object
                    CHECK (jsonb_typeof(parameters) = 'object')
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create versions");

        sqlx::query(
            r#"
            CREATE TABLE rollouts (
                id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name                 VARCHAR(255) NOT NULL UNIQUE,
                baseline_version_id  UUID NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
                candidate_version_id UUID NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
                state                VARCHAR(50)       NOT NULL DEFAULT 'created',
                current_weight       DOUBLE PRECISION  NOT NULL DEFAULT 0.0,
                policy               JSONB NOT NULL,
                strategy             JSONB NOT NULL,
                created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at         TIMESTAMPTZ,
                CONSTRAINT rollouts_different_versions
                    CHECK (baseline_version_id != candidate_version_id),
                CONSTRAINT rollouts_state_check
                    CHECK (state IN ('created', 'shadow', 'canary', 'promoted', 'rolled_back', 'paused')),
                CONSTRAINT rollouts_weight_range
                    CHECK (current_weight >= 0.0 AND current_weight <= 1.0),
                CONSTRAINT rollouts_policy_is_object
                    CHECK (jsonb_typeof(policy) = 'object'),
                CONSTRAINT rollouts_strategy_is_object
                    CHECK (jsonb_typeof(strategy) = 'object')
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create rollouts");

        sqlx::query(
            r#"
            CREATE TABLE rollout_steps (
                id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rollout_id             UUID NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
                step_number            INTEGER NOT NULL,
                target_weight          DOUBLE PRECISION NOT NULL,
                gate_expression        TEXT NOT NULL,
                pause_duration_seconds INTEGER,
                status                 VARCHAR(50) NOT NULL DEFAULT 'pending',
                started_at             TIMESTAMPTZ,
                completed_at           TIMESTAMPTZ,
                CONSTRAINT rollout_steps_unique_step
                    UNIQUE (rollout_id, step_number),
                CONSTRAINT rollout_steps_weight_range
                    CHECK (target_weight >= 0.0 AND target_weight <= 1.0),
                CONSTRAINT rollout_steps_status_check
                    CHECK (status IN ('pending', 'active', 'passed', 'failed'))
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create rollout_steps");

        sqlx::query(
            r#"
            CREATE TABLE requests (
                id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rollout_id    UUID REFERENCES rollouts(id) ON DELETE SET NULL,
                version_id    UUID NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
                request_hash  VARCHAR(64),
                model         VARCHAR(255) NOT NULL,
                input_tokens  INTEGER,
                output_tokens INTEGER,
                latency_ms    INTEGER NOT NULL,
                status_code   SMALLINT NOT NULL,
                error         TEXT,
                session_id    VARCHAR(255),
                metadata      JSONB,
                created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT requests_latency_positive
                    CHECK (latency_ms >= 0),
                CONSTRAINT requests_tokens_positive
                    CHECK (
                        (input_tokens IS NULL OR input_tokens >= 0)
                        AND (output_tokens IS NULL OR output_tokens >= 0)
                    )
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create requests");

        sqlx::query(
            r#"
            CREATE TABLE evaluations (
                id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                request_id     UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
                evaluator_type VARCHAR(50) NOT NULL,
                scores         JSONB NOT NULL,
                overall_score  DOUBLE PRECISION NOT NULL,
                metadata       JSONB,
                created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT evaluations_evaluator_type_check
                    CHECK (evaluator_type IN ('programmatic', 'embedding', 'llm_judge', 'human')),
                CONSTRAINT evaluations_overall_score_range
                    CHECK (overall_score >= 0.0 AND overall_score <= 1.0),
                CONSTRAINT evaluations_scores_is_object
                    CHECK (jsonb_typeof(scores) = 'object')
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create evaluations");

        sqlx::query(
            r#"
            CREATE TABLE decisions (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rollout_id       UUID NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
                action           VARCHAR(50) NOT NULL,
                reason           TEXT NOT NULL,
                previous_weight  DOUBLE PRECISION,
                new_weight       DOUBLE PRECISION,
                triggered_by     VARCHAR(50) NOT NULL,
                metrics_snapshot JSONB,
                created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT decisions_action_check
                    CHECK (action IN ('advance', 'rollback', 'pause', 'resume', 'promote')),
                CONSTRAINT decisions_triggered_by_check
                    CHECK (triggered_by IN ('controller', 'manual', 'schedule')),
                CONSTRAINT decisions_weight_range
                    CHECK (
                        (previous_weight IS NULL OR (previous_weight >= 0.0 AND previous_weight <= 1.0))
                        AND (new_weight IS NULL OR (new_weight >= 0.0 AND new_weight <= 1.0))
                    )
            )
            "#,
        )
        .execute(pool)
        .await
        .expect("create decisions");
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        let schema = self.schema.clone();
        let database_url = match std::env::var("DATABASE_URL") {
            Ok(u) => u,
            Err(_) => return,
        };
        // Spawn a blocking thread to drive schema cleanup even during a panic.
        std::thread::spawn(move || {
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .unwrap();
            rt.block_on(async move {
                if let Ok(pool) = PgPool::connect(&database_url).await {
                    let _ = sqlx::query(&format!("DROP SCHEMA \"{}\" CASCADE", schema))
                        .execute(&pool)
                        .await;
                    pool.close().await;
                }
            });
        })
        .join()
        .ok();
    }
}

// ================================================================================================
// Fixture helpers
// ================================================================================================

/// Standard policy used across most tests.
fn standard_policy() -> RolloutPolicy {
    RolloutPolicy {
        advance_threshold: 0.90,
        rollback_threshold: 0.65,
        min_samples: 5,
        confidence_level: 0.95,
        max_latency_increase: 2.0,
        max_error_rate: 0.10,
    }
}

/// Insert: provider → two versions → rollout (given state/weight) → 3 steps.
///
/// Returns `(rollout_id, baseline_version_id, candidate_version_id)`.
async fn insert_rollout(
    pool: &PgPool,
    name: &str,
    policy: &RolloutPolicy,
    state: &str,
    current_weight: f64,
) -> (Uuid, Uuid, Uuid) {
    let provider_id: Uuid = sqlx::query(
        r#"
        INSERT INTO providers (name, base_url, api_key_encrypted, provider_type)
        VALUES ($1, 'https://api.openai.com/v1', 'placeholder', 'openai')
        RETURNING id
        "#,
    )
    .bind(format!("{name}-provider"))
    .fetch_one(pool)
    .await
    .expect("insert provider")
    .get("id");

    let baseline_id: Uuid = sqlx::query(
        r#"INSERT INTO versions (name, provider_id, model) VALUES ($1, $2, 'gpt-4o') RETURNING id"#,
    )
    .bind(format!("{name}-baseline"))
    .bind(provider_id)
    .fetch_one(pool)
    .await
    .expect("insert baseline version")
    .get("id");

    let candidate_id: Uuid = sqlx::query(
        r#"INSERT INTO versions (name, provider_id, model) VALUES ($1, $2, 'gpt-4o-mini') RETURNING id"#,
    )
    .bind(format!("{name}-candidate"))
    .bind(provider_id)
    .fetch_one(pool)
    .await
    .expect("insert candidate version")
    .get("id");

    let policy_json = serde_json::to_value(policy).expect("serialize policy");
    let strategy_json = json!({
        "strategy_type": "canary",
        "steps": [
            {"step_number": 1, "target_weight": 0.10, "gate_expression": "quality_score >= 0.9"},
            {"step_number": 2, "target_weight": 0.25, "gate_expression": "quality_score >= 0.9"},
            {"step_number": 3, "target_weight": 1.0,  "gate_expression": "quality_score >= 0.9"}
        ]
    });

    let rollout_id: Uuid = sqlx::query(
        r#"
        INSERT INTO rollouts
            (name, baseline_version_id, candidate_version_id, state, current_weight, policy, strategy)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
        "#,
    )
    .bind(name)
    .bind(baseline_id)
    .bind(candidate_id)
    .bind(state)
    .bind(current_weight)
    .bind(&policy_json)
    .bind(&strategy_json)
    .fetch_one(pool)
    .await
    .expect("insert rollout")
    .get("id");

    for (step_number, target_weight) in [(1i32, 0.10f64), (2, 0.25), (3, 1.0)] {
        sqlx::query(
            r#"
            INSERT INTO rollout_steps (rollout_id, step_number, target_weight, gate_expression, status)
            VALUES ($1, $2, $3, 'quality_score >= 0.9', 'pending')
            "#,
        )
        .bind(rollout_id)
        .bind(step_number)
        .bind(target_weight)
        .execute(pool)
        .await
        .expect("insert rollout step");
    }

    (rollout_id, baseline_id, candidate_id)
}

/// Flip step 1 to `active` directly (bypasses `start_rollout`).
async fn activate_step_1(pool: &PgPool, rollout_id: Uuid) {
    sqlx::query(
        r#"
        UPDATE rollout_steps
        SET status = 'active', started_at = NOW()
        WHERE rollout_id = $1 AND step_number = 1
        "#,
    )
    .bind(rollout_id)
    .execute(pool)
    .await
    .expect("activate step 1");
}

/// Insert a request + evaluation row.
async fn insert_request_with_eval(
    pool: &PgPool,
    rollout_id: Uuid,
    version_id: Uuid,
    score: f64,
    latency_ms: i32,
) {
    let request_id: Uuid = sqlx::query(
        r#"
        INSERT INTO requests (rollout_id, version_id, model, latency_ms, status_code)
        VALUES ($1, $2, 'gpt-4o', $3, 200)
        RETURNING id
        "#,
    )
    .bind(rollout_id)
    .bind(version_id)
    .bind(latency_ms)
    .fetch_one(pool)
    .await
    .expect("insert request")
    .get("id");

    sqlx::query(
        r#"
        INSERT INTO evaluations (request_id, evaluator_type, scores, overall_score)
        VALUES ($1, 'programmatic', $2, $3)
        "#,
    )
    .bind(request_id)
    .bind(json!({"quality": score}))
    .bind(score)
    .execute(pool)
    .await
    .expect("insert evaluation");
}

/// Insert a request with NO evaluation row — the key fixture for the
/// COALESCE regression test.
async fn insert_request_no_eval(
    pool: &PgPool,
    rollout_id: Uuid,
    version_id: Uuid,
    latency_ms: i32,
) {
    sqlx::query(
        r#"
        INSERT INTO requests (rollout_id, version_id, model, latency_ms, status_code)
        VALUES ($1, $2, 'gpt-4o', $3, 200)
        "#,
    )
    .bind(rollout_id)
    .bind(version_id)
    .bind(latency_ms)
    .execute(pool)
    .await
    .expect("insert request without eval");
}

// ================================================================================================
// Tests
// ================================================================================================

/// A healthy candidate (quality 0.95) produces metrics above threshold and the
/// policy returns `PolicyVerdict::Advance`.
#[tokio::test]
async fn test_healthy_candidate_advances() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();
    let policy = standard_policy();

    let (rollout_id, baseline_id, candidate_id) =
        insert_rollout(pool, "healthy-canary", &policy, "canary", 0.10).await;
    activate_step_1(pool, rollout_id).await;

    for _ in 0..10 {
        insert_request_with_eval(pool, rollout_id, baseline_id, 0.92, 300).await;
    }
    for _ in 0..10 {
        insert_request_with_eval(pool, rollout_id, candidate_id, 0.95, 280).await;
    }

    let metrics_rows = store::aggregate_version_metrics(pool, rollout_id, 10)
        .await
        .expect("aggregate_version_metrics");

    let cand = metrics_rows
        .iter()
        .find(|m| m.version_id == candidate_id)
        .expect("candidate metrics row must exist");

    assert!(
        (cand.avg_quality - 0.95).abs() < 0.01,
        "expected avg_quality ≈ 0.95, got {}",
        cand.avg_quality
    );
    assert_eq!(cand.sample_count, 10, "expected 10 evaluated samples");

    let base = metrics_rows
        .iter()
        .find(|m| m.version_id == baseline_id)
        .expect("baseline metrics row must exist");

    let rollout_metrics = RolloutMetrics {
        rollout_id,
        baseline: VersionSnapshot {
            version_id: baseline_id,
            avg_quality: base.avg_quality,
            p95_latency_ms: base.p95_latency_ms.max(0) as u32,
            error_rate: base.error_rate,
            sample_count: base.sample_count.max(0) as u32,
        },
        candidate: VersionSnapshot {
            version_id: candidate_id,
            avg_quality: cand.avg_quality,
            p95_latency_ms: cand.p95_latency_ms.max(0) as u32,
            error_rate: cand.error_rate,
            sample_count: cand.sample_count.max(0) as u32,
        },
    };

    let verdict = policy::evaluate(&rollout_metrics, &policy, 0.10, 0.25, false, 9999, 0);

    assert!(
        matches!(verdict, PolicyVerdict::Advance { .. }),
        "expected Advance verdict, got {verdict:?}"
    );
}

/// A degraded candidate (quality 0.50, below rollback threshold 0.65) must
/// return `PolicyVerdict::Rollback`.
#[tokio::test]
async fn test_rollback_threshold_triggers_rollback() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();
    let policy = standard_policy();

    let (rollout_id, baseline_id, candidate_id) =
        insert_rollout(pool, "degraded-canary", &policy, "canary", 0.10).await;
    activate_step_1(pool, rollout_id).await;

    for _ in 0..10 {
        insert_request_with_eval(pool, rollout_id, baseline_id, 0.92, 300).await;
    }
    for _ in 0..10 {
        insert_request_with_eval(pool, rollout_id, candidate_id, 0.50, 280).await;
    }

    let metrics_rows = store::aggregate_version_metrics(pool, rollout_id, 10)
        .await
        .expect("aggregate_version_metrics");

    let cand = metrics_rows
        .iter()
        .find(|m| m.version_id == candidate_id)
        .expect("candidate metrics");
    let base = metrics_rows
        .iter()
        .find(|m| m.version_id == baseline_id)
        .expect("baseline metrics");

    let rollout_metrics = RolloutMetrics {
        rollout_id,
        baseline: VersionSnapshot {
            version_id: baseline_id,
            avg_quality: base.avg_quality,
            p95_latency_ms: base.p95_latency_ms.max(0) as u32,
            error_rate: base.error_rate,
            sample_count: base.sample_count.max(0) as u32,
        },
        candidate: VersionSnapshot {
            version_id: candidate_id,
            avg_quality: cand.avg_quality,
            p95_latency_ms: cand.p95_latency_ms.max(0) as u32,
            error_rate: cand.error_rate,
            sample_count: cand.sample_count.max(0) as u32,
        },
    };

    let verdict = policy::evaluate(&rollout_metrics, &policy, 0.10, 0.25, false, 9999, 0);

    assert!(
        matches!(verdict, PolicyVerdict::Rollback { .. }),
        "expected Rollback for quality=0.50, got {verdict:?}"
    );
}

/// **Regression test for the COALESCE(0.0) bug.**
///
/// When requests exist but have no evaluation rows, the *broken* query would
/// COALESCE a NULL `avg_quality` to 0.0 and return a row with `sample_count`
/// equal to the request count — causing the policy to see quality=0.0 and
/// roll back a perfectly healthy rollout.
///
/// The fixed query uses `INNER JOIN evaluations` + `HAVING COUNT(e.id) > 0`
/// so unevaluated requests produce *no row at all*. The controller then sees
/// `CandidateNoData` or `InsufficientData` and holds instead of rolling back.
#[tokio::test]
async fn test_unevaluated_requests_do_not_trigger_rollback() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();
    let policy = standard_policy();

    let (rollout_id, _baseline_id, candidate_id) =
        insert_rollout(pool, "no-evals-canary", &policy, "canary", 0.10).await;
    activate_step_1(pool, rollout_id).await;

    // 10 candidate requests — no evaluations at all
    for _ in 0..10 {
        insert_request_no_eval(pool, rollout_id, candidate_id, 250).await;
    }

    let metrics_rows = store::aggregate_version_metrics(pool, rollout_id, 10)
        .await
        .expect("aggregate_version_metrics");

    let candidate_row = metrics_rows.iter().find(|m| m.version_id == candidate_id);

    // Either no row (INNER JOIN eliminated them all — correct) or a row with
    // sample_count == 0.  Either is safe: the controller will return
    // InsufficientData or CandidateNoData, not a false rollback.
    match candidate_row {
        None => {
            // Correct: INNER JOIN produced no rows because evaluations is empty.
        }
        Some(row) => {
            assert_eq!(
                row.sample_count, 0,
                "unevaluated requests must not inflate sample_count — \
                 COALESCE(0.0) bug detected (sample_count={})",
                row.sample_count
            );
        }
    }
}

/// `apply_advance` updates `current_weight` to the new value and marks the
/// active step as `passed`.
#[tokio::test]
async fn test_apply_advance_updates_state_and_steps() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();
    let policy = standard_policy();

    let (rollout_id, _, _) = insert_rollout(pool, "advance-test", &policy, "canary", 0.10).await;
    activate_step_1(pool, rollout_id).await;

    let applied = store::apply_advance(
        pool,
        rollout_id,
        0.25,
        "canary",
        "gates passed in test",
        0.10,
        json!({}),
    )
    .await
    .expect("apply_advance");

    assert!(
        applied,
        "apply_advance must return true on first application"
    );

    let row = sqlx::query("SELECT current_weight, state FROM rollouts WHERE id = $1")
        .bind(rollout_id)
        .fetch_one(pool)
        .await
        .expect("fetch rollout");

    let weight: f64 = row.get("current_weight");
    let state: String = row.get("state");

    assert!(
        (weight - 0.25).abs() < 1e-9,
        "current_weight should be 0.25, got {weight}"
    );
    assert_eq!(state, "canary");

    let step_status: String =
        sqlx::query("SELECT status FROM rollout_steps WHERE rollout_id = $1 AND step_number = 1")
            .bind(rollout_id)
            .fetch_one(pool)
            .await
            .expect("fetch step 1")
            .get("status");

    assert_eq!(
        step_status, "passed",
        "step 1 should be 'passed' after advance"
    );
}

/// `apply_rollback` must set `state = 'rolled_back'` and mark every
/// pending/active step as `failed`.
#[tokio::test]
async fn test_apply_rollback_marks_all_steps_failed() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();
    let policy = standard_policy();

    let (rollout_id, _, _) =
        insert_rollout(pool, "rollback-all-steps", &policy, "canary", 0.10).await;
    activate_step_1(pool, rollout_id).await;

    let applied = store::apply_rollback(pool, rollout_id, "test rollback", 0.10, json!({}))
        .await
        .expect("apply_rollback");

    assert!(applied, "apply_rollback must return true on first call");

    let state: String = sqlx::query("SELECT state FROM rollouts WHERE id = $1")
        .bind(rollout_id)
        .fetch_one(pool)
        .await
        .expect("fetch rollout")
        .get("state");

    assert_eq!(state, "rolled_back");

    let non_failed: i64 = sqlx::query(
        r#"
        SELECT COUNT(*) AS n
        FROM rollout_steps
        WHERE rollout_id = $1
          AND status NOT IN ('failed', 'passed')
        "#,
    )
    .bind(rollout_id)
    .fetch_one(pool)
    .await
    .expect("count non-failed steps")
    .get::<i64, _>("n");

    assert_eq!(
        non_failed, 0,
        "all steps should be 'failed' after rollback, but {non_failed} have another status"
    );
}

/// Two concurrent `apply_rollback` calls must result in exactly one success
/// (`true`) and one no-op (`false`). This validates the optimistic locking
/// on `WHERE state IN ('canary','shadow')`.
#[tokio::test]
async fn test_optimistic_locking_prevents_double_rollback() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let mut db = TestDb::new().await;
    let policy = standard_policy();

    let (rollout_id, _, _) =
        insert_rollout(db.pool(), "double-rollback", &policy, "canary", 0.10).await;
    activate_step_1(db.pool(), rollout_id).await;

    // Ensure secondary pool is open before we move db
    let _ = db.secondary().await;

    let pool_a = db.pool.clone();
    let pool_b = db.secondary_pool.as_ref().unwrap().clone();

    let (res_a, res_b) = tokio::join!(
        store::apply_rollback(
            &pool_a,
            rollout_id,
            "concurrent rollback A",
            0.10,
            json!({})
        ),
        store::apply_rollback(
            &pool_b,
            rollout_id,
            "concurrent rollback B",
            0.10,
            json!({})
        ),
    );

    let applied_a = res_a.expect("apply_rollback A");
    let applied_b = res_b.expect("apply_rollback B");

    assert!(applied_a || applied_b, "at least one rollback must succeed");
    assert_ne!(
        applied_a, applied_b,
        "exactly one rollback should apply (A={applied_a}, B={applied_b})"
    );
}

/// `start_rollout` transitions a `created` rollout to `canary`, activates
/// step 1, sets `current_weight` to step 1's `target_weight`, and writes a
/// decision row.
#[tokio::test]
async fn test_start_rollout_transitions_created_to_canary() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();
    let policy = standard_policy();

    let (rollout_id, _, _) =
        insert_rollout(pool, "start-rollout-test", &policy, "created", 0.0).await;
    // Steps inserted as 'pending' — let start_rollout activate step 1.

    let started = store::start_rollout(pool, rollout_id)
        .await
        .expect("start_rollout");

    assert!(
        started,
        "start_rollout must return true for a 'created' rollout"
    );

    let row = sqlx::query("SELECT state, current_weight FROM rollouts WHERE id = $1")
        .bind(rollout_id)
        .fetch_one(pool)
        .await
        .expect("fetch rollout after start");

    let state: String = row.get("state");
    let weight: f64 = row.get("current_weight");

    assert_eq!(
        state, "canary",
        "state should be 'canary' after start_rollout"
    );
    assert!(
        weight > 0.0,
        "current_weight should be > 0 after start_rollout, got {weight}"
    );

    let step_status: String =
        sqlx::query("SELECT status FROM rollout_steps WHERE rollout_id = $1 AND step_number = 1")
            .bind(rollout_id)
            .fetch_one(pool)
            .await
            .expect("fetch step 1")
            .get("status");

    assert_eq!(
        step_status, "active",
        "step 1 should be 'active' after start_rollout"
    );

    let decision_count: i64 =
        sqlx::query("SELECT COUNT(*) AS n FROM decisions WHERE rollout_id = $1")
            .bind(rollout_id)
            .fetch_one(pool)
            .await
            .expect("count decisions")
            .get::<i64, _>("n");

    assert!(
        decision_count >= 1,
        "at least one decision row should exist after start_rollout"
    );
}

/// `metrics_aggregator::aggregate` returns `InsufficientData { have: 3, need: 10 }`
/// when only 3 out of 10 required candidate samples are present.
#[tokio::test]
async fn test_policy_holds_when_min_samples_not_met() {
    if std::env::var("DATABASE_URL").is_err() {
        return;
    }
    let db = TestDb::new().await;
    let pool = db.pool();

    let policy = RolloutPolicy {
        min_samples: 10,
        advance_threshold: 0.90,
        rollback_threshold: 0.65,
        confidence_level: 0.95,
        max_latency_increase: 2.0,
        max_error_rate: 0.10,
    };

    let (rollout_id, baseline_id, candidate_id) =
        insert_rollout(pool, "min-samples-test", &policy, "canary", 0.10).await;
    activate_step_1(pool, rollout_id).await;

    // Only 3 candidate evals; need 10
    for _ in 0..3 {
        insert_request_with_eval(pool, rollout_id, candidate_id, 0.95, 200).await;
    }
    // Sufficient baseline evals so baseline is not the bottleneck
    for _ in 0..20 {
        insert_request_with_eval(pool, rollout_id, baseline_id, 0.92, 300).await;
    }

    let result = metrics_aggregator::aggregate(
        pool,
        rollout_id,
        baseline_id,
        candidate_id,
        policy.min_samples,
    )
    .await
    .expect("aggregate");

    match result {
        AggregationResult::InsufficientData { have, need } => {
            assert_eq!(have, 3, "should report having 3 samples");
            assert_eq!(need, 10, "should report needing 10 samples");
        }
        other => panic!("expected InsufficientData {{ have: 3, need: 10 }}, got {other:?}"),
    }
}
