# Repath Build Status

**Last Updated**: 2026-06-18  
**Current Phase**: Foundation Complete → Gateway Implementation Next

---

## What's Been Built (Foundation Layer)

### ✅ Project Structure & Architecture

```
repath/
├── Cargo.toml                  ✅ Workspace configuration (release optimizations, LTO)
├── .env.example                ✅ Environment template
├── .gitignore                  ✅ Comprehensive ignore rules
├── docker-compose.yml          ✅ Full stack (postgres, redis, gateway, evaluator, dashboard)
├── migrations/
│   └── 001_initial_schema.sql  ✅ Complete database schema with:
│                                  - providers, versions, rollouts, rollout_steps
│                                  - requests, evaluations, decisions, alert_rules
│                                  - Indexes on all foreign keys + query patterns
│                                  - Views for active_rollouts, request_metrics
│                                  - Triggers for updated_at timestamps
│                                  - Check constraints for data integrity
└── crates/
    ├── common/                 ✅ Shared domain types
    │   ├── Cargo.toml          ✅ Dependencies: serde, uuid, chrono, thiserror, validator
    │   └── src/
    │       ├── lib.rs          ✅ Module exports
    │       ├── error.rs        ✅ Comprehensive error types with HTTP status codes
    │       ├── types.rs        ✅ All domain entities:
    │       │                      - Provider, Version, Rollout, Request, Evaluation, Decision
    │       │                      - RolloutPolicy, RolloutStrategy, RolloutStep
    │       │                      - Enums: RolloutState, StrategyType, EvaluatorType, etc.
    │       │                      - Config types: RolloutConfig, VersionSpec, etc.
    │       │                      - Full serde serialization + tests
    │       └── config.rs       ✅ Server configuration:
    │                              - ServerConfig with layered loading (file → env → CLI)
    │                              - All settings: server, database, redis, providers, evaluation
    │                              - Validation logic
    │                              - Tests for TOML parsing + env overrides
    └── gateway/
        └── Cargo.toml          ✅ Dependencies: axum, hyper, sqlx, redis, reqwest, tracing
```

### ✅ Code Quality Standards Established

1. **Error Handling Philosophy**
   - Zero `.unwrap()` in production paths
   - Every error includes context (operation, resource ID, source error)
   - HTTP status codes mapped correctly (4xx client, 5xx server)
   - Structured error types with `thiserror`

2. **Type Safety**
   - NewType pattern for domain primitives (IDs, scores, weights)
   - CHECK constraints in database match Rust type constraints
   - Exhaustive enum matching
   - Builder pattern for complex types

3. **Observability**
   - `tracing` for structured logging
   - OpenTelemetry + Prometheus for metrics
   - Request ID propagation
   - Decision audit trail

4. **Performance Considerations**
   - Release profile: LTO, codegen-units=1, strip=true
   - Connection pooling (sqlx)
   - Async all the way (Tokio)
   - Indexes on hot query paths

5. **Documentation Standards**
   - Module-level docs explain WHY (not just WHAT)
   - Function docs include examples for complex logic
   - Inline comments for non-obvious decisions
   - Architecture diagrams in README

---

## What Needs to Be Built Next

### Phase 2A: Gateway Core (Days 1-7)

**Priority**: Critical path blocker

#### Files to Create:

```
crates/gateway/src/
├── main.rs                     # Server entry point, graceful shutdown
├── config.rs                   # Load config from file/env
├── server.rs                   # Axum server setup, routes, middleware
├── proxy/
│   ├── mod.rs                  # Proxy module exports
│   ├── handler.rs              # HTTP request handler (routes to OpenAI)
│   ├── streaming.rs            # SSE streaming passthrough
│   ├── client.rs               # HTTP client pool (reqwest)
│   └── transform.rs            # Request/response transformation
├── router/
│   ├── mod.rs                  # Router module exports
│   ├── version_selector.rs    # Weighted random version selection
│   └── session.rs              # Sticky session tracking (V2)
├── recorder/
│   ├── mod.rs                  # Recorder module exports
│   ├── request_logger.rs      # Async request logging to Postgres
│   └── eval_queue.rs           # Push to Redis Stream for evaluation
├── db/
│   ├── mod.rs                  # Database module exports
│   ├── pool.rs                 # sqlx connection pool setup
│   ├── versions.rs             # Version CRUD operations
│   ├── rollouts.rs             # Rollout CRUD operations
│   └── requests.rs             # Request logging operations
└── observability/
    ├── mod.rs                  # Observability module exports
    ├── tracing.rs              # Tracing setup (stdout, OTLP)
    └── metrics.rs              # Prometheus metrics (requests, latency, errors)
```

#### Technical Requirements:

1. **OpenAI Proxy**
   - Accept POST `/v1/chat/completions`
   - Forward headers (Authorization, Content-Type, etc.)
   - Stream SSE responses without buffering
   - Handle errors from upstream (timeout, 4xx, 5xx)
   - Measure latency (start → response complete)

2. **Traffic Splitting**
   - Query active rollout from Postgres (cached 1s TTL)
   - If rollout exists: weighted random selection (baseline vs candidate)
   - If no rollout: pass through to default provider
   - Tag response with `X-Repath-Version-Id` header

3. **Request Recording**
   - After response completes, async write to `requests` table
   - Fields: id, rollout_id, version_id, model, latency_ms, status_code, tokens
   - Non-blocking (channel to background task)

4. **Evaluation Queue**
   - After recording, push to Redis Stream `repath:evaluations`
   - Payload: request_id, user_message, assistant_message, metadata
   - Sample rate: 100% during canary (configurable)

5. **Observability**
   - Metrics: request_count, request_duration_histogram, error_rate
   - Tracing: span per request with trace_id, version_id, latency
   - Health endpoint: `/health` (checks Postgres + Redis connectivity)

#### Success Criteria:

- [ ] `curl http://localhost:8080/v1/chat/completions` returns OpenAI response
- [ ] Streaming works: SSE chunks flow through without buffering
- [ ] Latency overhead < 5ms (measured with `wrk` benchmark)
- [ ] Request logged to Postgres with correct version_id
- [ ] Message pushed to Redis Stream for evaluation
- [ ] Metrics exposed on `:9090/metrics`
- [ ] No panics or crashes under load

---

### Phase 2B: Evaluation Engine (Days 8-14)

**Priority**: Required for quality-based decisions

#### Files to Create:

```
evaluators/
├── pyproject.toml              # Python dependencies (redis, sqlx, openai, sentence-transformers)
├── src/
│   ├── __init__.py
│   ├── worker.py               # Main worker loop (Redis consumer)
│   ├── evaluators/
│   │   ├── __init__.py
│   │   ├── programmatic.py     # Fast checks (not_empty, latency, regex)
│   │   ├── llm_judge.py        # LLM-as-judge (calls gpt-4o-mini)
│   │   ├── embedding.py        # Cosine similarity (V2)
│   │   └── human.py            # Human feedback (V2)
│   ├── scorer.py               # Composite score calculation
│   └── db.py                   # Postgres connection (write evaluations)
└── tests/
    └── test_programmatic.py
```

#### Technical Requirements:

1. **Programmatic Evaluator**
   - response_not_empty: `len(content) > 0`
   - min_response_length: `len(content) >= N`
   - no_refusal: doesn't contain "I cannot", "I'm sorry", "I can't"
   - latency_under_5s: `latency_ms < 5000`
   - valid_json: if expected JSON, `json.loads()` succeeds
   - no_pii: regex check for emails, phone numbers, SSNs

2. **LLM-as-Judge Evaluator**
   - Read criteria from rollout config
   - For each criterion: call gpt-4o-mini with scoring prompt
   - Parse score (1-5 scale)
   - Normalize to 0.0-1.0
   - Return weighted composite

3. **Scorer**
   - Combine programmatic (hard pass/fail) + LLM judge (soft score)
   - Formula: `if any_programmatic_failed: 0.0 else: llm_judge_score`
   - Write to `evaluations` table with breakdown

4. **Worker Loop**
   - Read from Redis Stream `repath:evaluations`
   - For each message: run evaluators, calculate score, write to Postgres
   - Handle: API errors, timeouts, rate limits (retry with backoff)
   - Metrics: evaluations_processed, eval_duration, eval_errors

#### Success Criteria:

- [ ] Worker consumes messages from Redis Stream
- [ ] Programmatic evaluator catches obvious failures (empty response, refusal)
- [ ] LLM judge returns sensible scores (0.0-1.0)
- [ ] Composite score written to `evaluations` table
- [ ] Worker handles API failures gracefully (no crashes)
- [ ] Throughput: > 100 evals/minute per worker

---

### Phase 2C: Rollout Controller (Days 15-21)

**Priority**: The "brain" that makes decisions

#### Files to Create:

```
crates/controller/
├── Cargo.toml
└── src/
    ├── lib.rs
    ├── state_machine.rs        # RolloutState transitions
    ├── decision_engine.rs      # Core decision logic
    ├── metrics_aggregator.rs   # Query + aggregate evaluation scores
    ├── gate_evaluator.rs       # Evaluate gate expressions
    └── actions.rs              # Execute decisions (update rollout weight)
```

#### Technical Requirements:

1. **State Machine**
   - Valid transitions: Created → Shadow → Canary → Promoted/RolledBack
   - Enforce invariants (can't advance from RolledBack)

2. **Decision Loop** (runs every N seconds)
   - Query active rollouts (state IN ('shadow', 'canary'))
   - For each rollout:
     - Aggregate evaluation scores (last M minutes, rolling window)
     - Calculate: avg quality, P95 latency, error rate, sample size
     - Compare against policy thresholds
     - Make decision: advance, rollback, or hold
   - Write decision to `decisions` table with reason

3. **Advance Logic**
   - If `quality_score >= advance_threshold`
   - AND `sample_size >= min_samples`
   - AND `time_at_current_step >= min_duration`
   - THEN: increase weight to next step (10% → 50% → 100%)

4. **Rollback Logic**
   - If `quality_score < rollback_threshold`
   - OR `error_rate > max_error_rate`
   - THEN: instant rollback (set weight = 0.0, state = 'rolled_back')

5. **Metrics Aggregator**
   ```sql
   SELECT version_id,
          AVG(overall_score) AS avg_quality,
          COUNT(*) AS sample_size
   FROM evaluations e
   JOIN requests r ON e.request_id = r.id
   WHERE r.created_at > NOW() - INTERVAL '10 minutes'
     AND r.rollout_id = $1
   GROUP BY r.version_id
   ```

#### Success Criteria:

- [ ] Controller runs decision loop every 30s
- [ ] Rollout advances when quality holds above threshold
- [ ] Rollout rolls back when quality drops below threshold
- [ ] Decisions logged with clear reasons
- [ ] Rollback takes effect within 1 second (gateway reads updated weight)
- [ ] No race conditions (proper locking on rollout updates)

---

### Phase 2D: CLI + Dashboard (Days 22-30)

**Priority**: User interface (can be built in parallel with Phase 2C)

#### CLI Files:

```
crates/cli/
├── Cargo.toml
└── src/
    ├── main.rs                 # CLI entry point (clap)
    ├── commands/
    │   ├── mod.rs
    │   ├── serve.rs            # Start gateway server
    │   ├── rollout.rs          # Rollout CRUD commands
    │   ├── eval.rs             # Evaluation commands (V2)
    │   └── config.rs           # Config validation
    └── output.rs               # Pretty printing (tables, colors)
```

#### Dashboard Files:

```
dashboard/
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx            # Overview: active rollouts
│   │   ├── rollouts/
│   │   │   ├── page.tsx        # List rollouts
│   │   │   └── [id]/page.tsx   # Rollout detail (quality graph, decisions)
│   │   └── settings/page.tsx
│   ├── components/
│   │   ├── rollout-card.tsx
│   │   ├── traffic-chart.tsx
│   │   ├── quality-graph.tsx
│   │   └── decision-timeline.tsx
│   └── lib/
│       ├── api.ts              # Fetch from gateway API
│       └── types.ts
└── public/
```

---

## Next Actions

### Immediate (Today)

1. **Build Gateway Proxy** (crates/gateway/src/proxy/)
   - Start with `proxy/handler.rs` (basic forwarding)
   - Add `proxy/streaming.rs` (SSE passthrough)
   - Test: curl through proxy returns OpenAI response

2. **Build Router** (crates/gateway/src/router/)
   - `version_selector.rs` (weighted random)
   - Test: 10% of requests go to candidate when weight=0.1

3. **Build Recorder** (crates/gateway/src/recorder/)
   - `request_logger.rs` (async write to Postgres)
   - `eval_queue.rs` (push to Redis)
   - Test: request appears in database + Redis Stream

### This Week

- Complete Phase 2A (Gateway Core)
- Start Phase 2B (Evaluation Engine)

### This Month

- Complete Phase 2B + 2C + 2D
- Run end-to-end demo
- Tag v0.1.0 MVP
- Launch on Hacker News

---

## Technical Debt to Address Later

1. **Security**
   - API key encryption at rest (currently placeholder)
   - TLS termination (currently HTTP only)
   - Rate limiting per user
   - CORS configuration

2. **Performance**
   - Connection pooling optimization (tune sqlx pool size)
   - Redis pipelining for batch operations
   - Caching layer for active rollouts (reduce Postgres queries)
   - Rewrite hot paths in Rust (if Python evaluator becomes bottleneck)

3. **Reliability**
   - Distributed tracing (add trace IDs to Redis messages)
   - Circuit breaker for upstream providers
   - Graceful degradation (if evaluator down, still proxy traffic)
   - Leader election for controller (only one controller should run)

4. **Observability**
   - Grafana dashboards
   - PagerDuty integration
   - Slack alerts
   - Audit log retention policy

---

## How to Continue Building

### If you're picking up this project:

1. **Read this file first** to understand what's done vs what's next
2. **Read context/PRODUCT_SPEC.md** for the full product vision
3. **Read context/MVP_BUILD_PLAN.md** for detailed implementation guidance
4. **Start with Phase 2A**: Gateway proxy is the foundation everything else builds on

### If you're starting a new AI coding session:

**Prompt template**:
```
I'm building Repath, an open-source AI deployment controller (progressive delivery for LLMs).

Context:
- Product spec: [paste context/PRODUCT_SPEC.md]
- Current status: [paste BUILD_STATUS.md]

I want to build: [specific component from Phase 2A/2B/2C]

Requirements:
- Production-grade Rust code (no unwrap, proper error handling)
- Staff engineer quality (what you'd see at Cloudflare/Vercel)
- Full observability (tracing, metrics)
- Comprehensive tests

Let's start with [first file to create].
```

---

## Dependencies to Install

### Rust Development

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install cargo tools
cargo install cargo-watch     # Auto-rebuild on file changes
cargo install cargo-expand    # View macro expansions
cargo install sqlx-cli        # Database migrations
```

### Python Development (Evaluators)

```bash
# Install Python 3.12+
pyenv install 3.12
pyenv local 3.12

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies (after pyproject.toml is created)
pip install -e ".[dev]"
```

### Database Setup

```bash
# Start Postgres + Redis
docker compose up postgres redis -d

# Run migrations
sqlx migrate run --database-url "postgres://repath:repath_dev_password@localhost:5432/repath"
```

---

**Status Summary**: Foundation is rock-solid. Gateway implementation is next. Let's build.
