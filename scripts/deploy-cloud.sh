#!/usr/bin/env bash
set -euo pipefail

# Deploy order: controller first (stateless, decision logic), then gateway, then evaluator.
# If any step fails the script exits immediately.

log() { echo "[$(date -u +%H:%M:%S)] $*"; }
die() { echo "ERROR: $*" >&2; exit 1; }

check_fly_auth() {
  fly auth whoami >/dev/null 2>&1 || die "Not authenticated with fly. Run: fly auth login"
}

wait_for_healthy() {
  local app=$1 attempts=0 max=12
  log "Waiting for $app to reach healthy state..."
  while [[ $attempts -lt $max ]]; do
    if fly status --app "$app" 2>/dev/null | grep -q "started"; then
      log "$app is healthy"
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 10
  done
  die "$app did not reach healthy state after ${max} attempts"
}

check_fly_auth

log "=== Deploying Repath (production) ==="
log "Order: controller → gateway → evaluator"

# 1. Controller
log "Deploying controller..."
fly deploy --config fly.controller.toml --remote-only
wait_for_healthy repath-controller

# 2. Gateway
log "Deploying gateway..."
fly deploy --config fly.toml --remote-only
wait_for_healthy repath-gateway

# 3. Evaluator
log "Deploying evaluator..."
fly deploy --config fly.evaluator.toml --remote-only
wait_for_healthy repath-evaluator

log "=== Deploy complete ==="
