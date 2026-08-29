-- Migration: password reset
--
-- Until now a forgotten password was a permanent lockout: there was no reset
-- route, no link on the login page, and no operator tooling to fix it. That is
-- unacceptable once real money is being charged, so this table backs a
-- self-service flow.
--
-- Only the SHA-256 of the token is stored. A leaked database dump therefore
-- does not hand out working reset links — the same reasoning as tenant API
-- keys, which are also stored hashed and shown once.

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- SHA-256 hex of the token handed to the user. Never the token itself.
    token_hash  CHAR(64) NOT NULL UNIQUE,
    expires_at  TIMESTAMPTZ NOT NULL,
    -- Set when redeemed. Kept rather than deleted so a second click on the
    -- same link can say "already used" instead of "invalid", and so a burst
    -- of redemptions is visible after the fact.
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reset_tokens_tenant
    ON password_reset_tokens(tenant_id);

-- Redemption looks the token up by hash and checks it is live, so the index
-- carries the expiry to keep that a single index-only probe.
CREATE INDEX IF NOT EXISTS idx_reset_tokens_live
    ON password_reset_tokens(token_hash, expires_at)
    WHERE used_at IS NULL;

COMMENT ON COLUMN password_reset_tokens.token_hash IS
    'SHA-256 hex of the emailed token. The plaintext is never stored.';
