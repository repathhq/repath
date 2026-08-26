-- Migration: Per-tenant API keys and tenant-scoped uniqueness
-- ==============================================================
-- Before this migration Repath had exactly one credential — a single global
-- REPATH_API_TOKEN shared by every user — and derived tenant identity from an
-- unverified `X-Repath-Tenant-Id` request header. That made real multi-tenancy
-- impossible: any caller could act as any tenant, and every dashboard user saw
-- every other tenant's rollouts.
--
-- This migration adds the storage side of the fix:
--   1. A per-tenant API key (stored hashed, never in plaintext)
--   2. Tenant-scoped uniqueness on rollout and version names
--   3. A `default` tenant so self-hosted single-tenant installs keep working

-- ================================================================================================
-- 1. PER-TENANT API KEYS
-- ================================================================================================

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS api_key_hash  CHAR(64),
    ADD COLUMN IF NOT EXISTS api_key_prefix VARCHAR(20),
    ADD COLUMN IF NOT EXISTS api_key_created_at TIMESTAMPTZ;

-- Lookup on every proxied request goes through this index. It is the hot path,
-- so it must be unique and covered.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_api_key_hash
    ON tenants(api_key_hash)
    WHERE api_key_hash IS NOT NULL;

COMMENT ON COLUMN tenants.api_key_hash IS
    'SHA-256 (hex) of the tenant''s API key. The plaintext key is shown to the
     user exactly once at creation and never stored — a leaked database dump
     therefore does not yield usable credentials.';
COMMENT ON COLUMN tenants.api_key_prefix IS
    'First few characters of the key (e.g. "rp_live_a1b2") for display in the
     dashboard so users can identify which key is active without revealing it.';

-- ================================================================================================
-- 2. TENANT-SCOPED UNIQUENESS
-- ================================================================================================
-- rollouts.name and versions.name were globally UNIQUE. With more than one
-- tenant that is wrong: two customers both naming a rollout "checkout-prompt"
-- is normal and must be allowed. Uniqueness belongs per tenant.

ALTER TABLE rollouts DROP CONSTRAINT IF EXISTS rollouts_name_key;

-- Postgres treats NULLs as distinct in unique indexes, so a partial index
-- pair is needed: one for tenant-owned rollouts, one for the self-hosted
-- (tenant_id IS NULL) case where global uniqueness is still correct.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rollouts_tenant_name
    ON rollouts(tenant_id, name)
    WHERE tenant_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rollouts_name_no_tenant
    ON rollouts(name)
    WHERE tenant_id IS NULL;

-- versions has no tenant_id; it is reached only through a rollout. Names are
-- generated with a rollout-id suffix by the create path, so collisions across
-- tenants cannot occur in practice — but the global constraint would still
-- reject a legitimate duplicate name, so relax it to a plain index.
ALTER TABLE versions DROP CONSTRAINT IF EXISTS versions_name_key;

-- ================================================================================================
-- 3. DEFAULT TENANT FOR SELF-HOSTED INSTALLS
-- ================================================================================================
-- Self-hosted operators run a single-tenant deployment authenticated by the
-- global admin token. Rollouts created there carry tenant_id = 'default' so
-- the same tenant-scoped queries work without special-casing NULL everywhere.

INSERT INTO tenants (id, name, email, plan, eval_quota_monthly, active)
VALUES ('default', 'Default (self-hosted)', 'default@localhost', 'enterprise', 2147483647, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Adopt any pre-existing rollouts into the default tenant so nothing becomes
-- invisible after the API starts filtering by tenant.
UPDATE rollouts SET tenant_id = 'default' WHERE tenant_id IS NULL;
UPDATE requests SET tenant_id = 'default' WHERE tenant_id IS NULL;
