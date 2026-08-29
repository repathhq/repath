-- Migration: real subscriptions
--
-- Until now "upgrading" set plan, quota, trial_ends_at = NULL and active =
-- true, and stored no period end of any kind. There was no renewal job, no
-- expiry column, and no code path that ever downgraded a tenant. One payment
-- bought the plan permanently: monthly recurring revenue was, as implemented,
-- one-time revenue.
--
-- Checkout also used Razorpay one-time Orders rather than Subscriptions, so
-- nothing was ever charged a second time even in principle.
--
-- These columns let a plan have an end, so a lapsed subscription can be
-- detected and downgraded. `subscription_id` is the Razorpay subscription this
-- tenant is billed through; the reconciler polls it because this deployment
-- has no Razorpay webhook configured, and polling survives missed webhooks
-- anyway.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS subscription_id     VARCHAR(64),
    ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(32),
    -- When the currently paid-for period runs out. NULL means "no expiry
    -- tracked" — trials (which use trial_ends_at) and legacy one-time
    -- purchases made before this migration, which are deliberately left
    -- alone rather than retroactively cut off.
    ADD COLUMN IF NOT EXISTS current_period_end  TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_synced_at      TIMESTAMPTZ;

-- One Razorpay subscription belongs to exactly one tenant. A duplicate would
-- mean two accounts billing off one mandate.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_subscription_id
    ON tenants(subscription_id)
    WHERE subscription_id IS NOT NULL;

-- The reconciler sweeps tenants whose period has ended; this keeps that a
-- range scan rather than a full table scan as the tenant count grows.
CREATE INDEX IF NOT EXISTS idx_tenants_period_end
    ON tenants(current_period_end)
    WHERE current_period_end IS NOT NULL;

-- Payment history, so Billing can show what was actually charged and finance
-- teams can be given something. Previously nothing recorded a payment at all:
-- the payment id was logged and discarded.
CREATE TABLE IF NOT EXISTS payments (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    -- Razorpay payment id. Unique so a replayed webhook or a double-submitted
    -- checkout cannot record the same charge twice.
    provider_payment_id VARCHAR(64) NOT NULL UNIQUE,
    provider          VARCHAR(32)  NOT NULL DEFAULT 'razorpay',
    subscription_id   VARCHAR(64),
    plan              VARCHAR(32)  NOT NULL,
    -- Stored in the smallest currency unit (paise for INR), matching what the
    -- provider reports. Keeping the provider's own integer avoids rounding
    -- drift between what we show and what was charged.
    amount_minor      BIGINT       NOT NULL,
    currency          VARCHAR(8)   NOT NULL DEFAULT 'INR',
    status            VARCHAR(32)  NOT NULL,
    created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_tenant
    ON payments(tenant_id, created_at DESC);

COMMENT ON COLUMN tenants.current_period_end IS
    'End of the paid period. NULL means no expiry is tracked (trial, or a legacy one-time purchase).';
COMMENT ON COLUMN payments.amount_minor IS
    'Amount in the smallest currency unit, e.g. paise. Provider''s own integer, never a float.';
