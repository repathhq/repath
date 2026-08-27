-- Migration: routing rules, provider credentials, webhooks, notifications
-- =========================================================================
-- Backs four features the dashboard advertised but had no storage for. Until
-- now the Settings page showed forms for provider keys, webhooks and Slack
-- alerts whose "Save" buttons discarded the input and reported success.

-- ================================================================================================
-- 1. PROVIDER CREDENTIALS
-- ================================================================================================
-- Repath normally forwards the caller's own provider key straight through and
-- never stores it. Two features need a stored key instead:
--   * failover — calling Anthropic when OpenAI is down needs an Anthropic key
--   * routing rules — sending a request to a different provider than the
--     client addressed
--
-- Stored encrypted (AES-256-GCM, see crates/gateway/src/crypto.rs) because it
-- must be replayed upstream, unlike a Repath API key which is only compared
-- and is therefore hashed one-way.

CREATE TABLE IF NOT EXISTS tenant_provider_credentials (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    provider     VARCHAR(50) NOT NULL,
    key_sealed   TEXT NOT NULL,
    key_hint     VARCHAR(32) NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT tenant_provider_credentials_provider_check
        CHECK (provider IN ('openai', 'anthropic', 'gemini', 'openrouter')),
    UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_provider_creds_tenant
    ON tenant_provider_credentials(tenant_id);

COMMENT ON COLUMN tenant_provider_credentials.key_sealed IS
    'AES-256-GCM sealed provider key, base64 of nonce||ciphertext||tag.';
COMMENT ON COLUMN tenant_provider_credentials.key_hint IS
    'Masked tail (e.g. "****1234") so the UI can identify a key without revealing it.';

-- ================================================================================================
-- 2. ROUTING RULES
-- ================================================================================================
-- Conditional routing: send a request to a specific provider/model when it
-- matches a condition. Evaluated in `priority` order, lowest first, and the
-- first match wins — the same "first match wins" model as a firewall or a
-- load-balancer rule set, which is what people already expect.
--
-- Rules apply before rollout selection. A request captured by a rule is served
-- by that rule's target and is not part of any canary, which keeps the two
-- mechanisms from silently fighting over the same request.

CREATE TABLE IF NOT EXISTS routing_rules (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    priority    INTEGER NOT NULL DEFAULT 100,
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,

    -- {"field":"input_tokens","op":"lt","value":"500"}
    condition   JSONB NOT NULL,
    -- {"provider":"anthropic","model":"claude-3-5-haiku-20241022"}
    action      JSONB NOT NULL,

    -- Rolling counter so the UI can show whether a rule ever fires. A rule
    -- that never matches is usually a mistake the author wants to see.
    match_count BIGINT NOT NULL DEFAULT 0,
    last_matched_at TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT routing_rules_condition_is_object CHECK (jsonb_typeof(condition) = 'object'),
    CONSTRAINT routing_rules_action_is_object    CHECK (jsonb_typeof(action) = 'object'),
    CONSTRAINT routing_rules_priority_range      CHECK (priority BETWEEN 0 AND 10000),
    UNIQUE (tenant_id, name)
);

-- The hot path loads every enabled rule for a tenant in priority order.
CREATE INDEX IF NOT EXISTS idx_routing_rules_tenant_priority
    ON routing_rules(tenant_id, priority)
    WHERE enabled = TRUE;

COMMENT ON TABLE routing_rules IS
    'Conditional model routing. Evaluated in priority order; first match wins.';

-- ================================================================================================
-- 3. FAILOVER CHAIN
-- ================================================================================================
-- Migration 004 added tenants.fallback_providers as JSONB carrying an
-- encrypted key per entry. Keys now live in tenant_provider_credentials
-- instead, so an entry is just an ordered provider name:
--   [{"provider":"anthropic"},{"provider":"openrouter"}]
-- This keeps one place to rotate a key rather than two that can disagree.

COMMENT ON COLUMN tenants.fallback_providers IS
    'Ordered failover chain, e.g. [{"provider":"anthropic"},{"provider":"openrouter"}].
     Keys are resolved from tenant_provider_credentials. Empty means: retry once,
     then return the error.';

-- ================================================================================================
-- 4. WEBHOOKS
-- ================================================================================================

CREATE TABLE IF NOT EXISTS webhooks (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    url            TEXT NOT NULL,
    secret_sealed  TEXT NOT NULL,
    events         TEXT[] NOT NULL DEFAULT ARRAY['rollback','advance','promote','provider_outage'],
    enabled        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT webhooks_url_is_https
        CHECK (url LIKE 'https://%' OR url LIKE 'http://localhost%' OR url LIKE 'http://127.0.0.1%')
);

CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id) WHERE enabled = TRUE;

COMMENT ON CONSTRAINT webhooks_url_is_https ON webhooks IS
    'Payloads describe production deployments; refuse to send them in the clear.
     Plain-HTTP localhost is allowed so developers can test against a local listener.';

-- Delivery log: what was sent, whether it landed, and how often we retried.
-- Without this a failing endpoint is invisible to the customer.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    webhook_id    UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event         VARCHAR(50) NOT NULL,
    payload       JSONB NOT NULL,
    status_code   INTEGER,
    error         TEXT,
    attempts      INTEGER NOT NULL DEFAULT 0,
    delivered_at  TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
    ON webhook_deliveries(webhook_id, created_at DESC);

-- ================================================================================================
-- 5. NOTIFICATION SETTINGS
-- ================================================================================================

CREATE TABLE IF NOT EXISTS notification_settings (
    tenant_id          VARCHAR(64) PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    email_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    email_address      VARCHAR(255),
    slack_url_sealed   TEXT,
    slack_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
    events             TEXT[] NOT NULL DEFAULT ARRAY['rollback','provider_outage'],
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN notification_settings.events IS
    'Defaults to the two events that need a human: an automatic rollback and a
     provider outage. Advance and promote are routine and off by default.';

-- ================================================================================================
-- 6. GATEWAY SETTINGS PER TENANT
-- ================================================================================================
-- The Settings page exposed these as editable fields with no storage behind them.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS request_timeout_seconds INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN IF NOT EXISTS eval_sample_rate DOUBLE PRECISION NOT NULL DEFAULT 1.0;

ALTER TABLE tenants
    ADD CONSTRAINT tenants_request_timeout_range
        CHECK (request_timeout_seconds BETWEEN 5 AND 600);

ALTER TABLE tenants
    ADD CONSTRAINT tenants_eval_sample_rate_range
        CHECK (eval_sample_rate BETWEEN 0.0 AND 1.0);

COMMENT ON COLUMN tenants.eval_sample_rate IS
    'Fraction of requests sent for LLM-judge scoring. Lowering it is the main
     lever a tenant has to stay inside quota on high-volume traffic.';
