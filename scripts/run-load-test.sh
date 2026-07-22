#!/bin/bash
# Reads secrets from the environment instead of hardcoding them — set these
# in your shell (or a local, gitignored .env) before running.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${REPATH_GATEWAY_URL:?set REPATH_GATEWAY_URL, e.g. https://api.tryrepath.com}"
: "${REPATH_TENANT:?set REPATH_TENANT}"
: "${REPATH_API_TOKEN:?set REPATH_API_TOKEN}"
: "${OPENAI_API_KEY:?set OPENAI_API_KEY}"
: "${REPATH_DATABASE_URL:?set REPATH_DATABASE_URL}"

python3 scripts/load-test.py \
  --gateway "$REPATH_GATEWAY_URL" \
  --tenant  "$REPATH_TENANT" \
  --token   "$REPATH_API_TOKEN" \
  --openai  "$OPENAI_API_KEY" \
  --gemini  "${GEMINI_API_KEY:-}" \
  --db      "$REPATH_DATABASE_URL" \
  --duration "${LOAD_TEST_DURATION:-1800}"
