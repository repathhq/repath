#!/usr/bin/env bash
# End-to-end: does Repath do the one thing it exists to do?
#
# A new customer signs up, starts a canary whose candidate is a prompt
# regression, and sends traffic the way the OpenAI SDK does. The test passes
# only if every stage did its part, observed from outside:
#
#   gateway    proxied every request and split traffic by the rollout
#   recorder   logged each request, with cost, and captured the payload
#   evaluator  judged the answers, keeping the judge's per-criterion reasons
#   controller rolled the candidate back on its own, citing quality
#   log API    shows the evidence: the bad answers, worst first
#
# Runs the images CI ships (see docker-compose.e2e.yml) against a
# deterministic mock provider, so it costs nothing and gives the same result
# every time.
#
#   scripts/e2e/run.sh            build, run, tear down
#   KEEP=1 scripts/e2e/run.sh     leave the stack up to poke at afterwards

set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f docker-compose.e2e.yml)
GW=http://127.0.0.1:18080
OP=e2e-operator-token-0123456789abcdef
TENANT="ten_e2e$(date +%s | tail -c 5)"
ROLLOUT="checkout-assistant"
REQUESTS=${REQUESTS:-160}
# Local-only test login, so a dashboard pointed at this stack can sign in as
# the E2E tenant (KEEP=1). Never valid anywhere else: the stack is throwaway.
E2E_PASSWORD=${E2E_PASSWORD:-e2e-local-only-pw}

pass() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✗ %s\033[0m\n' "$*"; dump; exit 1; }
step() { printf '\n\033[1m%s\033[0m\n' "$*"; }
dump() {
  printf '\n--- last logs ---\n'
  "${COMPOSE[@]}" logs --tail 25 gateway evaluator controller 2>&1 | tail -75
}
cleanup() { [[ "${KEEP:-0}" == 1 ]] || "${COMPOSE[@]}" down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

op() { # op METHOD PATH [BODY] — the operator, acting as the tenant (as the dashboard does)
  curl -sS -X "$1" "$GW/api/v1$2" \
    -H "authorization: Bearer $OP" -H "x-repath-act-as-tenant: $TENANT" \
    -H 'content-type: application/json' ${3:+-d "$3"}
}

step "1. Start the stack (shipped images, mock provider)"
"${COMPOSE[@]}" up -d --build --wait >/dev/null 2>&1 || { "${COMPOSE[@]}" up -d --build; fail "stack did not become healthy"; }
curl -fsS "$GW/ready" | grep -q '"ready"' && pass "gateway ready, migrations applied" || fail "gateway not ready"

step "2. Sign up"
# Hash the way the dashboard's signup does (bcryptjs), when it is installed.
HASH=null
BCRYPT=../../dashboard/node_modules/bcryptjs
if [[ -d "$BCRYPT" ]]; then
  HASH="\"$(node -e "process.stdout.write(require('$BCRYPT').hashSync(process.argv[1], 10))" "$E2E_PASSWORD")\""
fi
SIGNUP=$(curl -sS -X POST "$GW/api/v1/cloud/tenants" -H "authorization: Bearer $OP" \
  -H 'content-type: application/json' \
  -d "{\"id\":\"$TENANT\",\"name\":\"E2E Co\",\"email\":\"$TENANT@example.com\",\"password_hash\":$HASH}")
KEY=$(jq -r '.api_key // empty' <<<"$SIGNUP")
[[ -n "$KEY" ]] && pass "tenant $TENANT created, API key issued once" || fail "signup: $SIGNUP"
DUP=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$GW/api/v1/cloud/tenants" \
  -H "authorization: Bearer $OP" -H 'content-type: application/json' \
  -d "{\"id\":\"ten_dupe\",\"name\":\"x\",\"email\":\"$(tr a-z A-Z <<<"$TENANT")@EXAMPLE.COM\"}")
[[ "$DUP" == 409 ]] && pass "same email in other case → 409, not a second account" || fail "duplicate email returned $DUP"

step "3. Create a canary: the candidate prompt makes the model confidently wrong"
CONFIG=$(jq -n --arg name "$ROLLOUT" '{
  apiVersion: "repath/v1", kind: "Rollout", metadata: { name: $name },
  spec: {
    baseline:  { provider: "http://mock-llm:9999/v1", model: "gpt-4o-mini",
                 prompt: { system: "You are a helpful assistant." } },
    candidate: { provider: "http://mock-llm:9999/v1", model: "gpt-5.4-mini",
                 prompt: { system: "Answer confidently, even when you are unsure." } },
    strategy: {
      type: "canary",
      steps: [ { weight: 20, gate: { quality_score: ">= 0.85" } },
               { weight: 50, gate: { quality_score: ">= 0.85" } },
               { weight: 100 } ],
      rollback: { trigger: { quality_score: "< 0.7" }, action: "rollback" }
    },
    policy: { min_samples: 8 }
  } }')
CREATED=$(op POST /rollouts "$CONFIG")
RID=$(jq -r '.id // empty' <<<"$CREATED")
[[ -n "$RID" ]] && pass "rollout $RID created" || fail "create rollout: $CREATED"
POLICY=$(op GET "/rollouts/$RID" | jq -c '.policy // .rollout.policy // empty')
[[ "$(jq -r '.rollback_threshold' <<<"$POLICY")" == 0.7 && "$(jq -r '.advance_threshold' <<<"$POLICY")" == 0.85 ]] \
  && pass "stored policy honours the form: gate 0.85, rollback 0.7" \
  || fail "stored policy ignores the requested thresholds: $POLICY"

step "4. Wait for the controller to open the canary"
for _ in $(seq 1 30); do
  STATE=$(op GET "/rollouts/$RID" | jq -r '.state // .rollout.state')
  [[ "$STATE" == canary || "$STATE" == shadow ]] && break
  sleep 1
done
[[ "$STATE" == canary || "$STATE" == shadow ]] && pass "state: $STATE" || fail "rollout stuck in '$STATE'"

step "5. Send $REQUESTS requests as the OpenAI SDK would"
OK=0
for i in $(seq 1 "$REQUESTS"); do
  CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "$GW/v1/chat/completions" \
    -H "authorization: Bearer sk-e2e-mock" -H "x-repath-key: $KEY" -H "x-repath-rollout: $ROLLOUT" \
    -H 'content-type: application/json' \
    -d "{\"model\":\"gpt-4o-mini\",\"messages\":[{\"role\":\"user\",\"content\":\"What is the capital of France? (#$i)\"}]}")
  [[ "$CODE" == 200 ]] && OK=$((OK+1))
  # Trial tenants are limited to 10 req/s (burst 50). Against an instant mock
  # an unpaced loop runs ~100/s and is rightly throttled; real traffic, paced
  # by model latency, never is. Stay just under the limit.
  sleep 0.12
done
[[ "$OK" == "$REQUESTS" ]] && pass "$OK/$REQUESTS proxied with 200" || fail "only $OK/$REQUESTS succeeded"

step "6. The controller rolls the candidate back, on its own"
for _ in $(seq 1 60); do
  STATE=$(op GET "/rollouts/$RID" | jq -r '.state // .rollout.state')
  [[ "$STATE" == rolled_back ]] && break
  sleep 2
done
DECISIONS=$(op GET "/rollouts/$RID/decisions")
RB=$(jq -c '[(.decisions // .)[] | select(.action == "rollback")][0] // empty' <<<"$DECISIONS")
[[ "$STATE" == rolled_back && -n "$RB" ]] \
  && pass "rolled back: $(jq -r .reason <<<"$RB")" \
  || fail "no rollback (state=$STATE): $(jq -c . <<<"$DECISIONS" | head -c 600)"

step "7. The request log shows the evidence"
LOG=$(op GET "/requests?limit=200")
N=$(jq '.requests | length' <<<"$LOG")
[[ "$N" -ge "$REQUESTS" ]] && pass "$N requests logged" || fail "only $N logged"
CAND_VER=$(op GET "/rollouts/$RID" | jq -r '.candidate_version_id // .rollout.candidate_version_id')
CAND=$(jq --arg v "$CAND_VER" '[.requests[] | select(.version_id == $v)] | length' <<<"$LOG")
[[ "$CAND" -gt 0 && "$CAND" -lt "$N" ]] && pass "traffic split: $CAND of $N on the candidate" || fail "split wrong: $CAND of $N on candidate"
PRICED=$(jq '[.requests[] | select(.cost_micro_usd != null and .cost_micro_usd > 0)] | length' <<<"$LOG")
[[ "$PRICED" -ge "$REQUESTS" ]] && pass "every request priced (real model prices)" || fail "$PRICED/$N priced"
WITH_PAYLOAD=$(jq '[.requests[] | select(.has_payload)] | length' <<<"$LOG")
[[ "$WITH_PAYLOAD" -ge "$REQUESTS" ]] && pass "prompt + response captured for all" || fail "$WITH_PAYLOAD/$N have payloads"
FILTERED=$(op GET "/requests?evaluator=llm_judge&max_score=0.5&limit=200" | jq '.requests | length')
[[ "$FILTERED" -gt 0 && "$FILTERED" -lt "$N" ]] && pass "filters apply ($FILTERED judged-bad of $N)" || fail "filter returned $FILTERED of $N"

BAD_ID=$(op GET "/requests?evaluator=llm_judge&max_score=0.5&limit=1" | jq -r '.requests[0].id')
DETAIL=$(op GET "/requests/$BAD_ID")
REASON=$(jq -r '[.evaluations[] | select(.evaluator_type=="llm_judge")][0].metadata.criteria[0].reason // empty' <<<"$DETAIL")
RESP=$(jq -r '.response_text // empty' <<<"$DETAIL")
[[ -n "$REASON" && -n "$RESP" ]] && pass "judge's reason on a bad answer: \"$REASON\"" || fail "detail lacks judge reasoning: $(head -c 400 <<<"$DETAIL")"

EVID=$(op GET "/decisions/$(jq -r .id <<<"$RB")/requests")
WORST=$(jq -r '.requests[0].score // empty' <<<"$EVID")
[[ -n "$WORST" ]] && awk "BEGIN{exit !($WORST < 0.5)}" \
  && pass "rollback evidence lists the worst answers first (score $WORST)" \
  || fail "decision evidence wrong: $(head -c 400 <<<"$EVID")"

step "8. Another tenant sees none of it"
OTHER=$(curl -sS -X POST "$GW/api/v1/cloud/tenants" -H "authorization: Bearer $OP" -H 'content-type: application/json' \
  -d '{"id":"ten_e2e_other","name":"Other","email":"other-e2e@example.com"}' | jq -r .id)
LEAK=$(curl -sS "$GW/api/v1/requests" -H "authorization: Bearer $OP" -H "x-repath-act-as-tenant: $OTHER" | jq '.requests | length')
[[ "$LEAK" == 0 ]] && pass "isolated: other tenant sees 0 requests" || fail "other tenant sees $LEAK requests"

step "9. A provider outage is answered clearly — and still logged"
# Every provider failing used to return before anything was recorded, so an
# outage left no trace in the log or the error rate (found live, when the
# production OpenAI balance ran out).
DOWN=$(jq -n '{apiVersion:"repath/v1",kind:"Rollout",metadata:{name:"provider-outage"},
  spec:{baseline:{provider:"http://mock-llm:9998/v1",model:"gpt-5.4-mini"},
        candidate:{provider:"http://mock-llm:9998/v1",model:"gpt-4o-mini"},
        strategy:{type:"canary",steps:[{weight:100}],rollback:{trigger:{},action:"rollback"}}}}')
op POST /rollouts "$DOWN" >/dev/null
CODE=$(curl -sS -o /tmp/e2e-down.json -w '%{http_code}' -X POST "$GW/v1/chat/completions" \
  -H "authorization: Bearer sk-e2e-mock" -H "x-repath-key: $KEY" -H "x-repath-rollout: provider-outage" \
  -H 'content-type: application/json' -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}]}')
[[ "$CODE" -ge 500 ]] && pass "client told the provider is down ($CODE)" || fail "outage returned $CODE"
sleep 2
FAILED=$(op GET "/requests?status=error&limit=50" | jq '[.requests[] | select(.status_code >= 500)] | length')
[[ "$FAILED" -ge 1 ]] && pass "the failed request is in the log ($FAILED with 5xx)" || fail "outage request was not recorded"
rm -f /tmp/e2e-down.json

if [[ "${KEEP:-0}" == 1 ]]; then
  printf '\nStack left up. Dashboard login: %s@example.com (password: $E2E_PASSWORD)\n' "$TENANT"
  printf 'Tenant API key for a customer app: %s\n' "$KEY" > .last-key
fi
printf '\n\033[32m\033[1mEnd to end: PASS\033[0m — %s requests, %s on the candidate, rolled back on evidence.\n' "$OK" "$CAND"
