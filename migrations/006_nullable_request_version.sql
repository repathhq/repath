-- Migration: allow requests with no version
-- ============================================
-- `requests.version_id` was NOT NULL with a foreign key to `versions`. But a
-- request only has a version when an active rollout routed it — anything
-- proxied straight through (no rollout, a paused rollout, or a tenant whose
-- trial has lapsed) has no version by definition.
--
-- The gateway passed a nil UUID as a sentinel in that case, which violated the
-- foreign key, so every such insert failed. The failure was swallowed by the
-- fire-and-forget recorder, so pass-through traffic was silently never
-- recorded — and since that is the majority of traffic for most tenants, both
-- usage metering and per-tenant billing data were effectively empty.
--
-- NULL is the honest representation: this request was not part of a rollout.

ALTER TABLE requests ALTER COLUMN version_id DROP NOT NULL;

COMMENT ON COLUMN requests.version_id IS
    'The version that served this request, or NULL when it was proxied without
     an active rollout. Joins that compare baseline/candidate performance must
     therefore use an inner join or an explicit IS NOT NULL filter.';

-- Clean up any nil-UUID rows written before the foreign key was in place.
UPDATE requests
   SET version_id = NULL
 WHERE version_id = '00000000-0000-0000-0000-000000000000';
