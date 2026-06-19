# Contributing to Repath

Thanks for your interest. This document covers how to get a working development environment, how the project is structured, and what we expect in a pull request.

---

## Before you start

Open an issue before writing significant code. We want to discuss the approach first — this saves you from finishing a large PR that we can't merge because of a design conflict. Bug fixes and small improvements can go straight to a PR.

---

## Development setup

You need Rust 1.75+, Python 3.11+, Node.js 20+, Docker, and Cargo.

### 1. Clone and configure

```bash
git clone https://github.com/tryrepath/repath
cd repath
cp .env.example .env
# Set OPENAI_API_KEY in .env
```

### 2. Start infrastructure

```bash
docker compose up postgres redis
```

This starts PostgreSQL on port 5433 and Redis on 6379. The schema is applied automatically from `migrations/` on first start.

### 3. Build the Rust workspace

```bash
cargo build
```

All four crates build together: `repath-common`, `repath-gateway`, `repath-controller`, `repath-cli`.

### 4. Run the gateway

```bash
cargo run --bin repath-gateway
# Gateway listens on :8080, metrics on :9090
```

### 5. Run the evaluator workers

```bash
cd evaluators
pip install -e ".[dev]"
repath-evaluator
```

### 6. Run the dashboard

```bash
cd dashboard
npm install
npm run dev
# Dashboard at http://localhost:3000
```

---

## Running tests

### Rust unit tests

```bash
cargo test
```

### Rust tests for a specific crate

```bash
cargo test -p repath-gateway
cargo test -p repath-controller
```

### Python evaluator tests

```bash
cd evaluators
pytest
```

### Integration test (requires running stack)

The integration test sends real requests through the full pipeline and validates the output in PostgreSQL. It requires a running gateway, PostgreSQL, Redis, and a live rollout.

```bash
# With the full stack running:
docker compose up
repath rollout create -f examples/demo-canary.yaml

# Run the test
pip install httpx psycopg2-binary
python tests/integration_test.py
```

The test validates:
- Gateway proxy correctness (real OpenAI responses)
- Traffic split accuracy (±10% of target weight)
- Sticky session consistency (same user ID → same version)
- Evaluation pipeline (scores written to PostgreSQL within 60s)
- Controller decision logic (advance/rollback decisions visible)
- All management API endpoints (HTTP 200)
- SSE streaming passthrough

---

## Project structure

```
repath/
├── crates/
│   ├── common/          # Shared types: domain models, error types, config
│   ├── gateway/         # Axum HTTP server — proxy, routing, recording
│   ├── controller/      # State machine — quality evaluation, decisions
│   └── cli/             # repath CLI (clap) — wraps controller library
├── evaluators/          # Python async workers — programmatic + LLM judge
│   ├── src/repath_evaluators/
│   └── tests/
├── dashboard/           # Next.js 16 — live traffic and quality dashboard
├── migrations/          # PostgreSQL schema (applied in order)
├── examples/            # demo-canary.yaml, simulate_traffic.py
└── tests/               # integration_test.py
```

### Where to find what

| You want to change... | Look in |
|---|---|
| How requests are routed (canary %, sticky sessions) | `crates/gateway/src/router.rs` |
| How responses are recorded to PostgreSQL | `crates/gateway/src/recorder.rs` |
| How Redis Streams are written | `crates/gateway/src/queue.rs` |
| Controller decision logic (advance/rollback) | `crates/controller/src/engine.rs` |
| Gate expression evaluation | `crates/controller/src/policy.rs` |
| Domain types (Rollout, Version, Decision) | `crates/common/src/models/` |
| Programmatic evaluator checks | `evaluators/src/repath_evaluators/checks.py` |
| LLM judge scoring | `evaluators/src/repath_evaluators/judge.py` |
| Dashboard API calls | `dashboard/app/` |
| Database schema | `migrations/001_initial_schema.sql` |

---

## Code standards

### Rust

- No `unwrap()` or `expect()` in production code paths. Use `?` and structured error types from `repath-common`.
- Every public function that can fail returns `Result<T, RepathError>` or a crate-local error type that converts into it.
- Use `tracing::instrument` on non-trivial async functions. Include enough fields to diagnose failures from logs alone.
- The gateway hot path (request routing, Redis enqueue) must not block. No synchronous I/O, no `std::sync::Mutex` held across await points.
- Format with `rustfmt` before committing (`cargo fmt`). Lint with `cargo clippy -- -D warnings`.

### Python

- Format with `ruff format`. Lint with `ruff check`.
- Type-annotate all function signatures.
- Async throughout — the evaluator worker is `asyncio`-based. No `time.sleep()`.
- Handle OpenAI API errors with retry logic (the project uses `tenacity`). Don't let a transient API failure drop evaluations silently.

### TypeScript / Next.js

- No `any`. Use the types generated from the gateway's API responses.
- Format with the project's ESLint config (`npm run lint`).

---

## Pull request guidelines

**What we accept:**
- Bug fixes with a regression test
- Performance improvements with before/after benchmarks (for gateway/controller changes)
- New evaluation check types (programmatic or judge criteria)
- New CLI subcommands
- Dashboard improvements
- Documentation corrections

**What we do not accept without prior discussion:**
- New external dependencies (especially in the gateway — binary size and supply chain matter)
- Changes to the database schema without a migration and a rollback plan
- Breaking changes to the YAML rollout spec format
- Anything that adds latency to the gateway hot path without a compelling reason

**PR checklist:**
- [ ] Tests pass: `cargo test` and `pytest`
- [ ] Lint passes: `cargo clippy -- -D warnings` and `ruff check evaluators/`
- [ ] New behavior has test coverage
- [ ] Benchmarks included for hot-path changes
- [ ] `CHANGELOG.md` updated if the change is user-visible

**Commit messages:**

Use the imperative mood, present tense. Keep the subject under 72 characters. Reference the issue number if one exists.

```
Add quality score percentile breakdown to rollout status

Closes #42
```

---

## Architecture decisions

A few choices that are intentional and not up for debate:

**`arc-swap` for rollout config in the gateway.** At high request rates, `Arc<RwLock<_>>` serializes readers behind every write. We use `arc-swap` so reads are lock-free atomic pointer swaps. The controller writes a new config snapshot every 30 seconds; readers always see a consistent view with no contention.

**Redis Streams for evaluation queue.** Evaluation is async and must not add latency to responses. Redis Streams give us durable, ordered delivery with consumer groups for horizontal scaling of the Python workers, without the operational complexity of Kafka.

**Python for evaluators, Rust for everything else.** The OpenAI Python SDK is the reference implementation and gets new features first. The evaluator workers are I/O-bound (waiting on the judge API), so Python's async is sufficient. The gateway and controller are CPU-bound and latency-sensitive — Rust.

**PostgreSQL for all persistent state.** The schema is append-heavy (`requests`, `evaluations`, `decisions`) with infrequent updates (`rollouts`). PostgreSQL's JSONB columns handle the variable scoring structure without losing queryability.

---

## Getting help

Open a GitHub issue for bugs and feature requests. For questions about the codebase, open a discussion. For security issues, see `SECURITY.md`.
