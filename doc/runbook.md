# Repath Operational Runbook

Quick reference for on-call incidents. Fix first, understand later.

All services run as Docker containers on a single EC2 host (`ap-south-1`).
There is no SSH access — connect via SSM Session Manager (no key needed):
```bash
aws ssm start-session --target <instance-id>
```

---

## 1. Controller is down / making no decisions

**Check logs:**
```bash
docker logs repath-controller --tail 100 | grep ERROR
```

**Check last decision cycle:**
```sql
SELECT MAX(created_at) FROM decisions;
```
If this is stale by more than 2× `REPATH_CONTROLLER_DECISION_INTERVAL_SECONDS`, the controller is stuck.

**Restart:**
```bash
docker compose -f /opt/repath/docker-compose.prod.yml restart controller
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

1. Check the env var on the Amplify deployment:
   - Amplify console → repath-dashboard → Environment variables → `NEXT_PUBLIC_GATEWAY_URL`
   - Should be `https://api.tryrepath.com`

2. Probe the gateway directly:
   ```bash
   curl https://api.tryrepath.com/health
   ```

3. If the gateway itself is down:
   ```bash
   aws ssm start-session --target <instance-id>
   docker ps -a
   docker logs repath-gateway --tail 100
   docker compose -f /opt/repath/docker-compose.prod.yml restart gateway
   ```

4. If Caddy (TLS termination) is the problem instead of the gateway container:
   ```bash
   systemctl status caddy
   journalctl -u caddy --no-pager | tail -50
   ```

---

## 4. Evaluator falling behind

**Check Redis queue depth:**
```bash
docker exec repath-redis redis-cli XLEN repath:eval
```
Normal: < 1000. Concern: > 10 000. Crisis: growing unbounded.

**Check evaluator logs:**
```bash
docker logs repath-evaluator --tail 100
```

**Scale up if needed** (run a second evaluator container manually — the compose file only defines one by default):
```bash
docker compose -f /opt/repath/docker-compose.prod.yml up -d --scale evaluator=2
```
Scale back down once the queue drains.

---

## 5. Deploy procedure

Deploys happen automatically via GitHub Actions on push to `main` (see
`.github/workflows/ci.yml`), which builds images, pushes to ECR, and runs
`scripts/deploy-aws.sh` on the host via SSM.

**Manual redeploy** (from the EC2 host, or via SSM `send-command`):
```bash
curl -fsSL https://raw.githubusercontent.com/repathhq/repath/main/scripts/deploy-aws.sh | bash
```

**Rollback a single service** — redeploy with a specific previous image tag
(tags are the git commit SHA; find one with `docker images` or in ECR):
```bash
IMAGE_TAG=<previous-sha> curl -fsSL https://raw.githubusercontent.com/repathhq/repath/main/scripts/deploy-aws.sh | bash
```

---

## 6. Secrets

All production secrets live in AWS SSM Parameter Store under `/repath/prod/*`
(SecureString). Rotate a value with:
```bash
aws ssm put-parameter --name /repath/prod/OPENAI_API_KEY --type SecureString --value '<new-value>' --overwrite
```
Then redeploy (step 5) so the running containers pick it up — SSM values are
read once at deploy time into `.env`, not polled live.
