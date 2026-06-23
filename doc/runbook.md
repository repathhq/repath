# Repath Operational Runbook

Quick reference for on-call incidents. Fix first, understand later.

---

## 1. Controller is down / making no decisions

**Check logs:**
```bash
fly logs --app repath-controller --no-tail | grep ERROR
```

**Check last decision cycle:**
```sql
SELECT MAX(created_at) FROM decisions;
```
If this is stale by more than 2× `REPATH_CONTROLLER_DECISION_INTERVAL_SECONDS`, the controller is stuck.

**Restart:**
```bash
fly machine restart --app repath-controller
```

---

## 2. False rollback fired

**Identify:** Decision `reason` field contains `"quality 0.000"` (zero score, not a real regression).

**Root cause:** Evaluations had not yet been written to the DB when the controller ran its cycle. The controller saw no eval data and scored quality as 0.

**Recover** (replace `<id>` with the affected rollout UUID):
```sql
UPDATE rollouts
   SET state = 'canary',
       current_weight = 0.1,
       completed_at = NULL
 WHERE id = '<id>';

UPDATE rollout_steps
   SET status = 'active',
       started_at = NOW()
 WHERE rollout_id = '<id>'
   AND step_number = 1;
```
Then verify the controller picks up the rollout on its next cycle.

---

## 3. Gateway unreachable from dashboard

1. Check the env var on the Vercel deployment:
   - Vercel dashboard → repath-dashboard → Settings → Environment Variables → `REPATH_GATEWAY_URL`
   - Should be `https://repath-gateway.fly.dev`

2. Probe the gateway directly:
   ```bash
   curl https://repath-gateway.fly.dev/health
   ```

3. If the gateway itself is down:
   ```bash
   fly status --app repath-gateway
   fly logs --app repath-gateway --no-tail | tail -30
   fly machine restart --app repath-gateway
   ```

---

## 4. Evaluator falling behind

**Check Redis queue depth:**
```bash
redis-cli -u $REPATH_REDIS_URL XLEN repath:eval
```
Normal: < 1000. Concern: > 10 000. Crisis: growing unbounded.

**Check evaluator logs:**
```bash
fly logs --app repath-evaluator --no-tail | tail -50
```

**Scale up if needed:**
```bash
fly scale count 2 --app repath-evaluator
```
Scale back down once the queue drains.

---

## 5. Deploy procedure

**Always use the deploy script — never deploy services out of order.**

```bash
./scripts/deploy-cloud.sh
```

Deploy order is: **controller → gateway → evaluator**. Deploying gateway before controller risks decisions being made against stale routing logic.

**Rollback a single service:**
```bash
# List recent releases
fly releases --app repath-gateway

# Roll back to a specific image
fly deploy --image <prev-image> --app repath-gateway
```

Replace `repath-gateway` with `repath-controller` or `repath-evaluator` as needed.
