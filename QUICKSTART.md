# Repath Quick Start

**Goal**: Get a working OpenAI proxy running in < 30 minutes

---

## Prerequisites

```bash
# Check you have these installed:
docker --version        # Docker 20+
docker-compose --version # Docker Compose 2+
rustc --version         # Rust 1.75+ (if not: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh)
psql --version          # PostgreSQL client (optional, for debugging)
```

---

## Step 1: Environment Setup (2 minutes)

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your OpenAI API key
# Change this line:
#   OPENAI_API_KEY=sk-your-openai-key-here
# To:
#   OPENAI_API_KEY=sk-YOUR_ACTUAL_KEY_HERE

# macOS/Linux:
nano .env
# Windows:
notepad .env
```

---

## Step 2: Start Infrastructure (3 minutes)

```bash
# Start Postgres + Redis
docker compose up postgres redis -d

# Wait for health checks to pass
docker compose ps

# Should show:
# NAME                 STATUS
# repath-postgres      Up (healthy)
# repath-redis         Up (healthy)

# Run database migrations
docker exec -i repath-postgres psql -U repath -d repath < migrations/001_initial_schema.sql

# Verify tables exist
docker exec repath-postgres psql -U repath -d repath -c "\dt"
# Should list: providers, versions, rollouts, requests, evaluations, decisions, etc.
```

---

## Step 3: Build Gateway (5 minutes)

```bash
# Build the gateway binary
cd crates/gateway
cargo build --release

# This will take 3-5 minutes (first time only)
# Subsequent builds: < 30 seconds

# Binary will be at: ../../target/release/repath-gateway
```

---

## Step 4: Start Gateway (1 minute)

```bash
# From project root:
./target/release/repath-gateway

# You should see:
# INFO  repath_gateway: Starting Repath Gateway
# INFO  repath_gateway: Listening on 0.0.0.0:8080
# INFO  repath_gateway: Metrics on 0.0.0.0:9090
# INFO  repath_gateway: Database connected (10 connections in pool)
# INFO  repath_gateway: Redis connected
```

---

## Step 5: Test the Proxy (2 minutes)

### Health Check

```bash
curl http://localhost:8080/health

# Should return:
# {"status":"ok","database":"connected","redis":"connected"}
```

### Proxy Request (Non-Streaming)

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Say hello!"}
    ],
    "max_tokens": 50
  }'

# Should return OpenAI response:
# {
#   "id": "chatcmpl-...",
#   "object": "chat.completion",
#   "choices": [...]
# }
```

### Proxy Request (Streaming)

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "Count to 5"}
    ],
    "stream": true
  }'

# Should stream SSE chunks:
# data: {"id":"chatcmpl-...","choices":[{"delta":{"content":"1"}}]}
# data: {"id":"chatcmpl-...","choices":[{"delta":{"content":" 2"}}]}
# ...
```

---

## Step 6: Verify Observability (1 minute)

### Check Metrics

```bash
curl http://localhost:9090/metrics | grep repath

# Should show Prometheus metrics:
# repath_requests_total{version_id="..."} 1
# repath_request_duration_seconds_bucket{le="0.005"} 1
# repath_errors_total 0
```

### Check Database (Request Logged)

```bash
docker exec repath-postgres psql -U repath -d repath -c "SELECT id, model, status_code, latency_ms FROM requests ORDER BY created_at DESC LIMIT 1;"

# Should show your test request:
#                   id                  |    model     | status_code | latency_ms
# --------------------------------------+--------------+-------------+------------
#  a1b2c3d4-...                         | gpt-4o-mini  |         200 |        847
```

### Check Redis (Evaluation Queue)

```bash
docker exec repath-redis redis-cli XLEN repath:evaluations

# Should show: (integer) 1
# (One message in the eval queue)

docker exec repath-redis redis-cli XREAD COUNT 1 STREAMS repath:evaluations 0

# Should show the queued evaluation job (JSON payload)
```

---

## Step 7: Point Your App at Repath (1 minute)

### Python (OpenAI SDK)

```python
from openai import OpenAI

# Before:
# client = OpenAI(api_key="sk-...")

# After:
client = OpenAI(
    api_key="sk-...",
    base_url="http://localhost:8080/v1"
)

# All other code stays the same
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}]
)
print(response.choices[0].message.content)
```

### TypeScript (Vercel AI SDK)

```typescript
import { createOpenAI } from '@ai-sdk/openai';

const openai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY!,
  baseURL: 'http://localhost:8080/v1',
});

const result = await generateText({
  model: openai('gpt-4o-mini'),
  prompt: 'Hello!',
});
```

---

## Troubleshooting

### "Connection refused" on port 8080

```bash
# Check gateway is running:
ps aux | grep repath-gateway

# Check logs:
tail -f logs/repath-gateway.log

# Restart:
pkill repath-gateway
./target/release/repath-gateway
```

### "Database connection failed"

```bash
# Check Postgres is running:
docker compose ps postgres

# Check connection:
docker exec repath-postgres psql -U repath -d repath -c "SELECT 1;"

# Restart Postgres:
docker compose restart postgres
```

### "Redis connection failed"

```bash
# Check Redis is running:
docker compose ps redis

# Check connection:
docker exec repath-redis redis-cli PING
# Should return: PONG

# Restart Redis:
docker compose restart redis
```

### "OpenAI API error: invalid API key"

```bash
# Verify your API key is set:
grep OPENAI_API_KEY .env

# Test directly (bypass Repath):
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"

# Should return list of models (not 401 error)
```

### Requests not appearing in database

```bash
# Check gateway logs for errors:
tail -f logs/repath-gateway.log | grep ERROR

# Check database connection:
docker exec repath-postgres psql -U repath -d repath -c "\conninfo"

# Check table exists:
docker exec repath-postgres psql -U repath -d repath -c "\dt requests"
```

---

## Next Steps

Once the basic proxy is working:

1. **Create a Rollout** (see examples/demo-canary.yaml)
2. **Start Evaluation Worker** (see evaluators/README.md)
3. **Watch the Dashboard** (http://localhost:3000)

See BUILD_STATUS.md for the full development roadmap.

---

## Development Commands

```bash
# Auto-rebuild on file changes
cargo watch -x "run --bin repath-gateway"

# Run tests
cargo test

# Check for issues
cargo clippy

# Format code
cargo fmt

# View macro expansions
cargo expand

# Database migrations
sqlx migrate run
sqlx migrate revert

# Production build
cargo build --release --bin repath-gateway
```

---

## Stopping Everything

```bash
# Stop gateway
pkill repath-gateway

# Stop Postgres + Redis
docker compose down

# Remove volumes (deletes all data)
docker compose down -v
```

---

**You're now running a production-grade AI proxy!** 🎉

Next: Build the canary deployment logic → See Phase 2A in BUILD_STATUS.md
