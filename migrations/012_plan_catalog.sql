-- Every plan the code can write must be a plan the database accepts.
--
-- tenants_plan_check was written in migration 002 for the original four
-- plans and never widened, while the code since gained two more:
--
--   'indie'  the $20 plan. activate_subscription sets it after a successful
--            payment, so the CHECK rejected that UPDATE: the customer was
--            charged and stayed on their old plan.
--   'free'   where the billing reconciler moves a lapsed subscription, so it
--            can keep serving traffic rather than cutting someone off over a
--            failed card. The CHECK rejected that too, so lapsed tenants
--            kept their paid plan indefinitely.
--
-- No row can currently hold either value — the constraint saw to that — so
-- this only widens what is allowed and touches no data.
ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_plan_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_plan_check
    CHECK (plan IN ('free', 'trial', 'indie', 'starter', 'pro', 'enterprise'));

-- One account per person, regardless of how they type their address.
--
-- UNIQUE(email) is case-sensitive, so 'Alice@x.com' and 'alice@x.com' could
-- become two separate tenants, and login — an exact match — would find only
-- one of them. Every stored address was checked to be lowercase with no
-- case-insensitive duplicates before this was written; signup now normalises
-- before inserting, and this index makes it impossible to regress.
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_email_lower ON tenants (LOWER(email));
