-- Migration: Multi-Provider Support + Multi-Tenant
-- ===================================================
-- Adds:
--   1. provider_url column on versions (denormalized for zero-join hot path reads)
--   2. tenant_id column on rollouts (multi-tenant cloud isolation)
--   3. tenants table (customer accounts)
--   4. Anthropic + Gemini provider seed rows
--   5. Evaluation usage metering table (for billing)

-- ================================================================================================
-- TENANTS
-- ================================================================================================

CREATE TABLE tenants (
    id VARCHAR(64) PRIMARY KEY,           -- e.g. "ten_abc123"
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    plan VARCHAR(50) NOT NULL DEFAULT 'trial',
    trial_ends_at TIMESTAMPTZ,
    eval_quota_monthly INTEGER NOT NULL DEFAULT 10000,
    evals_used_this_month INTEGER NOT NULL DEFAULT 0,
    quota_reset_at TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', NOW()) + INTERVAL '1 month',
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenants_plan_check
        CHECK (plan IN ('trial', 'starter', 'pro', 'enterprise'))
);

CREATE INDEX idx_tenants_email ON tenants(email);
CREATE INDEX idx_tenants_active ON tenants(active) WHERE active = TRUE;

COMMENT ON TABLE tenants IS 'Cloud customer accounts — each tenant gets isolated gateway routing';
COMMENT ON COLUMN tenants.id IS 'Short tenant ID used in gateway URLs and request headers';
COMMENT ON COLUMN tenants.eval_quota_monthly IS 'Max LLM judge evaluations per month (billing limit)';

CREATE TRIGGER update_tenants_updated_at
    BEFORE UPDATE ON tenants
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================================================
-- ADD provider_url to versions (denormalized for hot-path efficiency)
-- ================================================================================================

ALTER TABLE versions
    ADD COLUMN IF NOT EXISTS provider_url VARCHAR(500);

-- Back-fill from the joined providers table
UPDATE versions v
SET provider_url = p.base_url
FROM providers p
WHERE v.provider_id = p.id
  AND v.provider_url IS NULL;

COMMENT ON COLUMN versions.provider_url IS
    'Denormalized provider base URL — avoids a join on every request routing query';

-- ================================================================================================
-- ADD tenant_id to rollouts
-- ================================================================================================

ALTER TABLE rollouts
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rollouts_tenant ON rollouts(tenant_id);

COMMENT ON COLUMN rollouts.tenant_id IS
    'Owning tenant — NULL means self-hosted (single-tenant mode)';

-- Also scope the active rollout query to the current tenant in cloud mode.
-- The gateway already filters by tenant_id via COALESCE(r.tenant_id, ''default'').

-- ================================================================================================
-- ADD tenant_id to requests (for per-tenant usage metering and isolation)
-- ================================================================================================

ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_requests_tenant ON requests(tenant_id);

-- ================================================================================================
-- EVALUATION USAGE METERING (for billing)
-- ================================================================================================

CREATE TABLE IF NOT EXISTS eval_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    month DATE NOT NULL,                  -- first day of month, e.g. 2026-06-01
    evals_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, month)
);

CREATE INDEX idx_eval_usage_tenant_month ON eval_usage(tenant_id, month DESC);

COMMENT ON TABLE eval_usage IS 'Monthly evaluation counts per tenant — drives billing limits';

-- ================================================================================================
-- NEW PROVIDERS: Anthropic + Gemini
-- ================================================================================================

INSERT INTO providers (name, base_url, api_key_encrypted, provider_type)
VALUES
    ('anthropic', 'https://api.anthropic.com/v1', 'PLACEHOLDER_SET_ANTHROPIC_KEY', 'anthropic'),
    ('gemini',    'https://generativelanguage.googleapis.com/v1beta/openai', 'PLACEHOLDER_SET_GEMINI_KEY', 'gemini')
ON CONFLICT (name) DO UPDATE SET
    base_url = EXCLUDED.base_url;

COMMENT ON TABLE providers IS
    'AI provider configurations. Supports: openai, anthropic, gemini, azure';

-- ================================================================================================
-- DEFAULT TENANT for self-hosted mode
-- ================================================================================================

INSERT INTO tenants (id, name, email, plan, eval_quota_monthly)
VALUES ('default', 'Self-Hosted', 'self-hosted@localhost', 'enterprise', 2147483647)
ON CONFLICT (id) DO NOTHING;
