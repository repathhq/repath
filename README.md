# Repath

[![Build](https://img.shields.io/github/actions/workflow/status/repathhq/repath/ci.yml?branch=main&label=build)](https://github.com/repathhq/repath/actions)
[![Tests](https://img.shields.io/github/actions/workflow/status/repathhq/repath/ci.yml?branch=main&label=tests)](https://github.com/repathhq/repath/actions)
[![License](https://img.shields.io/badge/license-BSL%201.1-blue)](LICENSE)
[![Stars](https://img.shields.io/github/stars/repathhq/repath?style=social)](https://github.com/repathhq/repath)

**Progressive delivery for AI.** Canary deployments, quality gates, and instant auto-rollback for LLM prompts and models. Never ship broken AI again.

![Repath - Ship AI Changes Without the Guesswork](https://img.shields.io/badge/Repath-Production%20Ready-success)

---

## The problem

Prompt and model changes break silently. You can't detect "did the new system prompt make responses 23% worse?" by watching error rates — a single GPT-4 update dropped accuracy from 97% to 2% with zero API errors. By the time users complain, the damage is done.

Feature flags stop at deployment. They don't evaluate whether the new behavior is actually better.

---

## How Repath works

Repath is a transparent proxy between your application and AI providers. Every request is routed, recorded, and evaluated. A controller makes automated advance or rollback decisions on a 30-second tick based on rolling quality scores.

```
                ┌────────────────────────────────────────────────────┐
                │                    YOUR APP                        │
                │    base_url = "http://localhost:8080/v1"           │
                └─────────────────────┬──────────────────────────────┘
                                      │
                                      ▼
                ┌────────────────────────────────────────────────────┐
                │            REPATH GATEWAY  (Rust / Axum)          │
                │                                                    │
                │   ┌──────────────────┐   ┌──────────────────────┐ │
                │   │  Traffic Router  │   │  Request Recorder    │ │
                │   │                  │   │  (async, non-block)  │ │
                │   │  90% → baseline  │   └──────────┬───────────┘ │
                │   │  10% → candidate │              │             │
                │   └────────┬─────────┘              │             │
                └────────────┼────────────────────────┼─────────────┘
                             │                        │
             ┌───────────────┴──────────┐             │
             ▼                          ▼             ▼
  ┌──────────────────┐    ┌──────────────────┐  ┌────────────────────┐
  │  OpenAI /        │    │  OpenAI /        │  │   Redis Stream     │
  │  Anthropic       │    │  Anthropic       │  │   eval-queue       │
  │  (baseline)      │    │  (candidate)     │  └─────────┬──────────┘
  └──────────────────┘    └──────────────────┘            │
                                                          ▼
                                              ┌────────────────────────┐
                                              │   Python Evaluator     │
                                              │                        │
                                              │  programmatic checks   │
                                              │  + gpt-4o-mini judge   │
                                              └──────────┬─────────────┘
                                                         │
                                                         ▼
                                              ┌────────────────────────┐
                                              │    PostgreSQL 16       │
                                              │  requests/evaluations  │
                                              │  decisions/rollouts    │
                                              └──────────┬─────────────┘
                                                         │
                                                         ▼
                                              ┌────────────────────────┐
                                              │   Rust Controller      │
                                              │   (every 30s)          │
                                              │                        │
                                              │  quality >= 0.8?       │
                                              │  → advance to 50%      │
                                              │                        │
                                              │  quality < 0.7?        │
                                              │  → instant rollback    │
                                              └────────────────────────┘
```

The gateway adds less than 2ms of overhead. Evaluation is fully asynchronous — it never touches the request path.

---

## Quick start

You need Docker and an OpenAI API key. This takes about 60 seconds.

```bash
git clone https://github.com/tryrepath/repath
cd repath
cp .env.example .env
# Edit .env: set OPENAI_API_KEY
docker compose up
```

In a second terminal, install the CLI and create your first rollout:

```bash
cargo install --path crates/cli

repath rollout create -f examples/demo-canary.yaml
repath rollout status demo-customer-support --watch
```

Open [http://localhost:3000](http://localhost:3000) for the live dashboard.

The demo rollout in `examples/demo-canary.yaml` runs a strong vs. weak system prompt side-by-side. The evaluator scores both using gpt-4o-mini as judge, and the controller rolls back the weaker prompt automatically.

To point your own app at Repath, change one line:

```python
# Before
client = OpenAI(api_key="sk-...")

# After — drop-in replacement
client = OpenAI(api_key="sk-...", base_url="http://localhost:8080/v1")
```

---

## Rollout config

A rollout describes a baseline, a candidate, a promotion strategy, and evaluation criteria. The controller enforces the gates automatically.

```yaml
apiVersion: repath/v1
kind: Rollout
metadata:
  name: demo-customer-support
  labels:
    team: ai-platform
    service: chatbot

spec:
  baseline:
    provider: openai
    model: gpt-4o-mini
    prompt:
      system: |
        You are a helpful customer support agent for a SaaS product.
        Always respond with specific, actionable steps.
        Keep responses under 150 words. Be professional and empathetic.
    parameters:
      temperature: 0.7
      max_tokens: 256

  candidate:
    provider: openai
    model: gpt-4o-mini
    prompt:
      system: "You are a support agent. Help users."
    parameters:
      temperature: 0.9
      max_tokens: 512

  strategy:
    type: canary
    steps:
      - weight: 10
        duration: 2m
        gate:
          quality_score: ">= 0.8"
          error_rate: "< 0.05"
      - weight: 50
        duration: 5m
        gate:
          quality_score: ">= 0.8"
      - weight: 100

    rollback:
      trigger:
        quality_score: "< 0.7"
        error_rate: "> 0.1"
      action: instant
      cooldown: 10m

  evaluation:
    - type: programmatic
      checks:
        - response_not_empty
        - no_refusal
        - latency_under_5s

    - type: llm_judge
      model: gpt-4o-mini
      sample_rate: 1.0
      criteria:
        - name: helpfulness
          prompt: "Rate 1-5: Does this response give specific, actionable help?"
          weight: 0.5
        - name: completeness
          prompt: "Rate 1-5: Does this response fully address the user's question?"
          weight: 0.3
        - name: clarity
          prompt: "Rate 1-5: Is this response clear and well-structured?"
          weight: 0.2

  routing:
    sticky_sessions: true
    session_key: "x-user-id"
```

---

## Comparison

| Capability | Repath | LaunchDarkly | LiteLLM | Langfuse |
|---|---|---|---|---|
| Transparent proxy (drop-in) | Yes | No | Yes | No |
| Canary traffic splitting | Yes | Yes (feature flags) | No | No |
| Shadow mode (zero user impact) | Yes | No | No | No |
| Automated quality evaluation | Yes | No | No | Partial (manual review) |
| LLM-as-judge scoring | Yes | No | No | Yes |
| Automated rollback on quality drop | Yes | No | No | No |
| Controller with configurable gates | Yes | No | No | No |
| <2ms proxy overhead | Yes | N/A | ~5ms | N/A |
| Self-hosted | Yes | No | Yes | Yes |
| Open source | Yes | No | Yes | Yes |

---

## Performance

| Metric | Target | Notes |
|---|---|---|
| Gateway overhead p50 | <1ms | Rust/Axum, async I/O |
| Gateway overhead p99 | <2ms | Lock-free config reads via `arc-swap` |
| Evaluation latency | Non-blocking | Via Redis Streams, never on the request path |
| Controller tick interval | 30s | Configurable via env |
| Throughput | >50,000 req/s | Single gateway instance |
| Memory (gateway) | <100MB | No GC, no runtime overhead |
| Sticky session consistency | 100% | Hash-based, no coordination needed |

---

## CLI reference

```bash
repath [command] [flags]
```

| Command | Description |
|---|---|
| `repath rollout create -f <file.yaml>` | Create a rollout from a YAML spec |
| `repath rollout list` | List all rollouts with current state and traffic weight |
| `repath rollout status <name>` | Detailed status: split, quality scores, step progress |
| `repath rollout status <name> --watch` | Live-updating status view |
| `repath rollout promote <name>` | Manually advance to the next step |
| `repath rollout rollback <name>` | Immediately roll back to baseline |
| `repath rollout pause <name>` | Pause controller decisions for this rollout |
| `repath rollout resume <name>` | Resume a paused rollout |
| `repath rollout history <name>` | Full decision audit log |

**Global flags:**

| Flag | Default | Description |
|---|---|---|
| `--database-url` | `$REPATH_DATABASE_URL` | PostgreSQL connection string |
| `--output` | `table` | Output format: `table`, `json`, `yaml` |

---

## Architecture

Four components with clear boundaries:

**Gateway** (`crates/gateway`) — Axum HTTP server. Receives requests, routes to baseline or candidate, records to PostgreSQL via an async channel, enqueues request/response pairs to Redis Streams. Zero blocking on the hot path. Uses `arc-swap` for lock-free rollout config reads at high throughput.

**Controller** (`crates/controller`) — State machine running every 30 seconds. Reads rolling quality scores from PostgreSQL, evaluates gate expressions, writes advance/rollback decisions to the `decisions` table. Compiled as both a library (used by the CLI for `promote`/`rollback`) and a standalone binary.

**Evaluators** (`evaluators/`) — Python async workers consuming from Redis Streams. Run programmatic checks (empty response, refusal detection, latency threshold) and send response pairs to gpt-4o-mini for multi-criteria scoring. Write results to `evaluations` in PostgreSQL.

**Dashboard** (`dashboard/`) — Next.js 16 + Tailwind + Recharts. Shows live traffic split, rolling quality graph, step progress, and decision timeline. Reads from the gateway REST API.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, project structure, and PR guidelines.

Open an issue before starting significant work. PRs that add features without tests will not be merged. The gateway and controller are performance-sensitive — include benchmarks for any changes that touch the hot path.

---

## License

Repath is licensed under the [Business Source License 1.1](LICENSE).

Free to use, modify, and self-host. The production use restriction converts to Apache 2.0 four years after each release. Contact us for a commercial license if you need one sooner.
