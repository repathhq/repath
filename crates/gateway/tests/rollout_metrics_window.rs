//! The rollout detail metrics must all describe the same period.
//!
//! # The bug this pins
//!
//! Every metric used `COALESCE(<last 10 minutes>, <all time>)`. That works for
//! `AVG()` and `PERCENTILE_CONT()`, which return NULL over an empty window and
//! so fall through to the all-time branch — but not for `COUNT(*)`, which
//! returns 0, is not NULL, and therefore never falls through.
//!
//! A rollout whose traffic was older than ten minutes displayed an all-time
//! quality score beside "Samples (10m): 0". The score looked authoritative and
//! was measured over a period the label denied. Each version also picked its
//! branch independently, so baseline and candidate could be averaged over
//! different periods and then compared to each other.
//!
//! These tests assert the two numbers agree, which is the property that was
//! actually violated. Skipped (not failed) when `DATABASE_URL` is unset.

use chrono::{Duration, Utc};
use sqlx::{PgPool, Row};
use uuid::Uuid;

struct TestDb {
    pool: PgPool,
    schema: String,
    admin_url: String,
}

impl TestDb {
    async fn new() -> Option<Self> {
        let database_url = std::env::var("DATABASE_URL").ok()?;
        let schema = format!("metwin_{}", Uuid::new_v4().simple());

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

        for ddl in [
            r#"CREATE TABLE providers (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL UNIQUE,
                base_url VARCHAR(500) NOT NULL,
                api_key_encrypted TEXT NOT NULL,
                provider_type VARCHAR(50) NOT NULL
            )"#,
            r#"CREATE TABLE versions (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL UNIQUE,
                provider_id UUID NOT NULL REFERENCES providers(id),
                model VARCHAR(255) NOT NULL,
                prompt_template TEXT,
                provider_url VARCHAR(500)
            )"#,
            r#"CREATE TABLE rollouts (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                name VARCHAR(255) NOT NULL UNIQUE,
                tenant_id VARCHAR(64),
                baseline_version_id UUID NOT NULL REFERENCES versions(id),
                candidate_version_id UUID NOT NULL REFERENCES versions(id),
                state VARCHAR(50) NOT NULL DEFAULT 'canary',
                current_weight DOUBLE PRECISION NOT NULL DEFAULT 0.1,
                policy JSONB NOT NULL DEFAULT '{}'::jsonb,
                strategy JSONB NOT NULL DEFAULT '{}'::jsonb,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                completed_at TIMESTAMPTZ
            )"#,
            r#"CREATE TABLE requests (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                rollout_id UUID REFERENCES rollouts(id),
                version_id UUID,
                model VARCHAR(255),
                latency_ms INTEGER,
                status_code INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"#,
            r#"CREATE TABLE evaluations (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                request_id UUID NOT NULL REFERENCES requests(id),
                evaluator_type VARCHAR(50) NOT NULL,
                overall_score DOUBLE PRECISION NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )"#,
        ] {
            sqlx::query(ddl).execute(&pool).await.expect("create table");
        }

        Some(Self {
            pool,
            schema,
            admin_url: database_url,
        })
    }

    /// A rollout with a baseline and candidate version. Returns the ids.
    async fn seed_rollout(&self) -> (Uuid, Uuid, Uuid) {
        let s = Uuid::new_v4().simple().to_string();
        let provider: Uuid = sqlx::query(
            "INSERT INTO providers (name, base_url, api_key_encrypted, provider_type) \
             VALUES ($1,'https://api.openai.com/v1','x','openai') RETURNING id",
        )
        .bind(format!("p-{s}"))
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .get("id");

        let mut ids = Vec::new();
        for role in ["baseline", "candidate"] {
            let v: Uuid = sqlx::query(
                "INSERT INTO versions (name, provider_id, model) \
                 VALUES ($1,$2,'gpt-4o-mini') RETURNING id",
            )
            .bind(format!("{role}-{s}"))
            .bind(provider)
            .fetch_one(&self.pool)
            .await
            .unwrap()
            .get("id");
            ids.push(v);
        }

        let rollout: Uuid = sqlx::query(
            "INSERT INTO rollouts (name, baseline_version_id, candidate_version_id) \
             VALUES ($1,$2,$3) RETURNING id",
        )
        .bind(format!("r-{s}"))
        .bind(ids[0])
        .bind(ids[1])
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .get("id");

        (rollout, ids[0], ids[1])
    }

    /// One request plus its evaluation, aged `minutes_ago`.
    async fn seed_request(&self, rollout: Uuid, version: Uuid, score: f64, minutes_ago: i64) {
        let at = Utc::now() - Duration::minutes(minutes_ago);
        let req: Uuid = sqlx::query(
            "INSERT INTO requests (rollout_id, version_id, model, latency_ms, status_code, created_at) \
             VALUES ($1,$2,'gpt-4o-mini',800,200,$3) RETURNING id",
        )
        .bind(rollout)
        .bind(version)
        .bind(at)
        .fetch_one(&self.pool)
        .await
        .unwrap()
        .get("id");

        sqlx::query(
            "INSERT INTO evaluations (request_id, evaluator_type, overall_score, created_at) \
             VALUES ($1,'llm_judge',$2,$3)",
        )
        .bind(req)
        .bind(score)
        .bind(at)
        .execute(&self.pool)
        .await
        .unwrap();
    }
}

impl Drop for TestDb {
    fn drop(&mut self) {
        let schema = self.schema.clone();
        let url = self.admin_url.clone();
        std::thread::spawn(move || {
            if let Ok(rt) = tokio::runtime::Runtime::new() {
                rt.block_on(async {
                    if let Ok(p) = PgPool::connect(&url).await {
                        let _ = sqlx::query(&format!("DROP SCHEMA IF EXISTS \"{schema}\" CASCADE"))
                            .execute(&p)
                            .await;
                    }
                });
            }
        })
        .join()
        .ok();
    }
}

/// The window-selection core of the detail query: one decision for the whole
/// rollout, applied to both the score and the count.
async fn metrics(db: &TestDb, rollout: Uuid) -> (String, Option<f64>, i64, Option<f64>, i64) {
    let row = sqlx::query(
        r#"
        SELECT
            CASE WHEN recent.n > 0 THEN '10m' ELSE 'all_time' END AS metrics_window,
            CASE WHEN recent.n > 0 THEN
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes')
            ELSE
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id)
            END AS q_base,
            CASE WHEN recent.n > 0 THEN
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes')
            ELSE
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.baseline_version_id)
            END AS n_base,
            CASE WHEN recent.n > 0 THEN
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes')
            ELSE
                (SELECT AVG(e.overall_score) FROM evaluations e
                 JOIN requests req ON e.request_id = req.id
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id)
            END AS q_cand,
            CASE WHEN recent.n > 0 THEN
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id
                   AND req.created_at > NOW() - INTERVAL '10 minutes')
            ELSE
                (SELECT COUNT(*) FROM requests req
                 WHERE req.rollout_id = r.id AND req.version_id = r.candidate_version_id)
            END AS n_cand
        FROM rollouts r
        LEFT JOIN LATERAL (
            SELECT COUNT(*) AS n FROM requests req
             WHERE req.rollout_id = r.id
               AND req.created_at > NOW() - INTERVAL '10 minutes'
        ) recent ON TRUE
        WHERE r.id = $1
        "#,
    )
    .bind(rollout)
    .fetch_one(&db.pool)
    .await
    .expect("metrics query");

    (
        row.get("metrics_window"),
        row.get("q_base"),
        row.get("n_base"),
        row.get("q_cand"),
        row.get("n_cand"),
    )
}

#[tokio::test]
async fn a_score_is_never_shown_beside_a_zero_sample_count() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let (rollout, base, cand) = db.seed_rollout().await;

    // All traffic is four hours old — outside the ten-minute window. This is
    // exactly the state that produced "0.988 / 1.000" beside "Samples: 0 / 0".
    for _ in 0..25 {
        db.seed_request(rollout, base, 0.988, 240).await;
    }
    for _ in 0..3 {
        db.seed_request(rollout, cand, 1.0, 240).await;
    }

    let (window, q_base, n_base, q_cand, n_cand) = metrics(&db, rollout).await;

    assert_eq!(
        window, "all_time",
        "no recent traffic, so fall back to all time"
    );
    assert_eq!(
        n_base, 25,
        "the count must follow the same window as the score"
    );
    assert_eq!(n_cand, 3);
    assert!(q_base.is_some() && q_cand.is_some());

    // The property that was actually broken.
    assert!(
        !(q_base.is_some() && n_base == 0),
        "a quality score must never appear next to zero samples"
    );
    assert!(!(q_cand.is_some() && n_cand == 0));
}

#[tokio::test]
async fn recent_traffic_uses_the_ten_minute_window() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let (rollout, base, cand) = db.seed_rollout().await;

    db.seed_request(rollout, base, 0.10, 240).await; // old, must be excluded
    db.seed_request(rollout, base, 0.90, 1).await; // recent
    db.seed_request(rollout, cand, 0.80, 2).await; // recent

    let (window, q_base, n_base, _q_cand, n_cand) = metrics(&db, rollout).await;

    assert_eq!(window, "10m");
    assert_eq!(n_base, 1, "only the recent baseline request counts");
    assert_eq!(n_cand, 1);
    assert!(
        (q_base.unwrap() - 0.90).abs() < 1e-9,
        "the stale 0.10 score must not drag the recent average down, got {q_base:?}"
    );
}

#[tokio::test]
async fn both_versions_are_measured_over_the_same_period() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let (rollout, base, cand) = db.seed_rollout().await;

    // Baseline has recent traffic; the candidate's is all old. Previously each
    // version chose its own COALESCE branch, so this compared the baseline's
    // last ten minutes against the candidate's entire history — two different
    // periods presented side by side as if they were comparable.
    db.seed_request(rollout, base, 0.95, 1).await;
    for _ in 0..10 {
        db.seed_request(rollout, cand, 0.20, 240).await;
    }

    let (window, _q_base, n_base, q_cand, n_cand) = metrics(&db, rollout).await;

    assert_eq!(
        window, "10m",
        "recent traffic exists, so the window applies"
    );
    assert_eq!(n_base, 1);
    assert_eq!(
        n_cand, 0,
        "the candidate genuinely has no traffic in this window"
    );
    assert!(
        q_cand.is_none(),
        "with no candidate samples in the window there is no candidate score to \
         show — reporting its all-time average here would compare two periods"
    );
}

#[tokio::test]
async fn a_rollout_with_no_traffic_at_all_reports_nothing() {
    let Some(db) = TestDb::new().await else {
        return;
    };
    let (rollout, _base, _cand) = db.seed_rollout().await;

    let (window, q_base, n_base, q_cand, n_cand) = metrics(&db, rollout).await;

    assert_eq!(window, "all_time");
    assert_eq!(n_base, 0);
    assert_eq!(n_cand, 0);
    assert!(
        q_base.is_none() && q_cand.is_none(),
        "a rollout that has never served a request must show no score, not 0.0 \
         — zero would read as 'measured, and terrible'"
    );
}
