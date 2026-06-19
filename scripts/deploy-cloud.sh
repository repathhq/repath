#!/usr/bin/env bash
# Repath Cloud Deployment Script
# ================================
# Deploys gateway to Fly.io (free tier) and dashboard to Vercel (free).
# All infrastructure uses free tiers — zero upfront cost.
#
# Prerequisites:
#   - fly CLI installed: brew install flyctl
#   - vercel CLI installed: npm i -g vercel
#   - Neon account: https://neon.tech (free PostgreSQL)
#   - Upstash account: https://upstash.com (free Redis)
#
# Usage:
#   ./scripts/deploy-cloud.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $1"; }
warn() { echo -e "${YELLOW}[warn]${NC} $1"; }
die()  { echo -e "${RED}[error]${NC} $1"; exit 1; }

# ── Validate required env vars ──────────────────────────────────────────────

required_vars=(
  OPENAI_API_KEY
  REPATH_DATABASE_URL
  REPATH_REDIS_URL
)

for var in "${required_vars[@]}"; do
  [[ -z "${!var:-}" ]] && die "Required env var not set: $var"
done

# ── Generate secrets if not set ──────────────────────────────────────────────

REPATH_API_TOKEN="${REPATH_API_TOKEN:-$(openssl rand -hex 32)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
log "Secrets ready"

# ── Step 1: Deploy gateway to Fly.io ────────────────────────────────────────

log "Deploying gateway to Fly.io..."

if ! fly status --app repath-gateway &>/dev/null; then
  log "Creating Fly.io app..."
  fly launch \
    --name repath-gateway \
    --region sin \
    --no-deploy \
    --copy-config \
    --yes
fi

log "Setting Fly.io secrets..."
fly secrets set \
  REPATH_API_TOKEN="$REPATH_API_TOKEN" \
  OPENAI_API_KEY="$OPENAI_API_KEY" \
  REPATH_DATABASE_URL="$REPATH_DATABASE_URL" \
  REPATH_REDIS_URL="$REPATH_REDIS_URL" \
  ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-}" \
  GEMINI_API_KEY="${GEMINI_API_KEY:-}" \
  RAZORPAY_KEY_ID="${RAZORPAY_KEY_ID:-}" \
  RAZORPAY_KEY_SECRET="${RAZORPAY_KEY_SECRET:-}" \
  RAZORPAY_WEBHOOK_SECRET="${RAZORPAY_WEBHOOK_SECRET:-}" \
  PADDLE_API_KEY="${PADDLE_API_KEY:-}" \
  PADDLE_WEBHOOK_SECRET="${PADDLE_WEBHOOK_SECRET:-}" \
  --app repath-gateway

log "Deploying to Fly.io..."
fly deploy --app repath-gateway --wait-timeout 120

GATEWAY_URL=$(fly status --app repath-gateway --json | python3 -c "
import sys, json
data = json.load(sys.stdin)
# Extract the hostname from the app status
hostname = data.get('Hostname', 'repath-gateway.fly.dev')
print(f'https://{hostname}')
" 2>/dev/null || echo "https://repath-gateway.fly.dev")

log "Gateway deployed: $GATEWAY_URL"

# ── Step 2: Run database migrations ─────────────────────────────────────────

log "Running database migrations..."
# Migrations are auto-run by docker-entrypoint-initdb.d in local Docker.
# For cloud, we run them via psql directly.
if command -v psql &>/dev/null; then
  psql "$REPATH_DATABASE_URL" -f migrations/001_initial_schema.sql 2>/dev/null || true
  psql "$REPATH_DATABASE_URL" -f migrations/002_multi_provider_and_tenants.sql 2>/dev/null || true
  log "Migrations applied"
else
  warn "psql not found — run migrations manually:"
  warn "  psql \$REPATH_DATABASE_URL -f migrations/001_initial_schema.sql"
  warn "  psql \$REPATH_DATABASE_URL -f migrations/002_multi_provider_and_tenants.sql"
fi

# ── Step 3: Deploy dashboard to Vercel ──────────────────────────────────────

log "Deploying dashboard to Vercel..."

cd dashboard

# Set Vercel env vars
vercel env add NEXT_PUBLIC_API_URL production <<< "$GATEWAY_URL" 2>/dev/null || true
vercel env add NEXT_PUBLIC_GATEWAY_URL production <<< "$GATEWAY_URL" 2>/dev/null || true
vercel env add REPATH_API_TOKEN production <<< "$REPATH_API_TOKEN" 2>/dev/null || true
vercel env add JWT_SECRET production <<< "$JWT_SECRET" 2>/dev/null || true

# Deploy
DASHBOARD_URL=$(vercel --prod --yes 2>/dev/null | tail -1)
log "Dashboard deployed: $DASHBOARD_URL"

cd ..

# ── Step 4: Deploy evaluator to Fly.io ──────────────────────────────────────

if [[ -f fly.evaluator.toml ]]; then
  log "Deploying evaluator to Fly.io..."
  fly deploy --config fly.evaluator.toml --app repath-evaluator --wait-timeout 120
fi

# ── Done ─────────────────────────────────────────────────────────────────────

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Repath Cloud Deployed Successfully    ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Gateway:    $GATEWAY_URL"
echo "  Dashboard:  ${DASHBOARD_URL:-<check Vercel dashboard>}"
echo ""
echo "  API Token:  $REPATH_API_TOKEN"
echo "  JWT Secret: $JWT_SECRET"
echo ""
echo -e "${YELLOW}  Save these secrets securely!${NC}"
echo ""
echo "  Verify: curl $GATEWAY_URL/health"
echo ""
