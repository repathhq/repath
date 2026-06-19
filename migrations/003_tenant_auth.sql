-- Migration: Tenant authentication
-- ===================================
-- Adds password_hash to tenants for cloud email/password auth.
-- Self-hosted installations don't use this (auth is managed by the operator).

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Index for login-by-email lookup
CREATE INDEX IF NOT EXISTS idx_tenants_email_hash
    ON tenants(email)
    WHERE password_hash IS NOT NULL;

COMMENT ON COLUMN tenants.password_hash IS
    'bcrypt hash of the tenant owner password (cloud auth only)';

-- Add a GET-by-email endpoint helper view
CREATE OR REPLACE VIEW tenant_auth AS
SELECT id, name, email, plan, password_hash, trial_ends_at, active
FROM tenants
WHERE password_hash IS NOT NULL;

COMMENT ON VIEW tenant_auth IS
    'Cloud auth view — only tenants with a password_hash set';
