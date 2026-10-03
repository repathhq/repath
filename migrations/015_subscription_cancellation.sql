-- Migration: cancelling a subscription
--
-- Pricing and the terms promise "cancel any time from Billing; the plan stays
-- until the end of the period you paid for". Razorpay supports exactly that
-- (cancel_at_cycle_end), but while the cancellation is pending the
-- subscription still reports status 'active' — so subscription_status, which
-- the reconciler re-syncs from Razorpay every pass, cannot carry it.
--
-- This flag records that the customer asked to cancel, so Billing can say
-- "ends on <date>" instead of offering to cancel again. When the period ends
-- Razorpay moves the subscription to 'cancelled' and the reconciler removes
-- the plan as it does for any subscription that stops paying.

ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE;
