-- Migration: Provider failover configuration
-- =============================================
-- Adds per-tenant fallback provider chain.
-- When the primary provider is down, Repath tries these in order.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS fallback_providers JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN tenants.fallback_providers IS
    'Ordered list of fallback providers. Each entry: {url, name, api_key_encrypted}.
     Example: [{"url":"https://openrouter.ai/api/v1","name":"openrouter"}]
     Empty array means: retry once, then fail (no cross-provider failover).';

-- Provider incident log — records every failover event
CREATE TABLE IF NOT EXISTS provider_incidents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id VARCHAR(64) REFERENCES tenants(id) ON DELETE CASCADE,
    primary_provider VARCHAR(255) NOT NULL,
    fallback_provider VARCHAR(255),
    reason TEXT NOT NULL,
    request_id UUID,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_provider_incidents_tenant ON provider_incidents(tenant_id, created_at DESC);
CREATE INDEX idx_provider_incidents_provider ON provider_incidents(primary_provider, created_at DESC);

COMMENT ON TABLE provider_incidents IS
    'Log of every provider failover event — shown in customer dashboard as incident history';
