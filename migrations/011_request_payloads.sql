-- Migration: request payload capture and enforced retention
--
-- # What this adds
--
-- The prompt and the response already travel from the gateway to the
-- evaluator through Redis — the judge needs them to score anything. Nothing
-- ever persisted them, so the most useful thing in the whole system was
-- computed and thrown away: a customer could see that a candidate scored
-- 0.68 but never *which* answers were bad, or why.
--
-- The judge's per-criterion reasoning is already stored in
-- `evaluations.metadata`. Pairing it with the text it was reasoning about is
-- what turns a score into an explanation.
--
-- # Why a separate table
--
-- Payloads are large and have a different lifetime from the metrics beside
-- them. Keeping them out of `requests` means:
--
--   * retention deletion is one bounded DELETE against a purpose-built index
--     rather than an UPDATE rewriting every wide row;
--   * `requests` stays narrow, so the aggregate queries the controller runs
--     on every tick keep scanning a small table;
--   * a tenant who turns capture off simply has no rows here, rather than a
--     table full of NULL columns.
--
-- # Retention
--
-- The pricing page has always advertised 7-day (indie/starter) and 90-day
-- (pro) retention. Nothing enforced it — the claim was marketing copy with no
-- mechanism behind it. `expires_at` is written at insert from the tenant's
-- plan, and the controller sweeps expired rows. Storing the deadline on the
-- row rather than deriving it at delete time means a plan change never
-- retroactively extends the promise made about data already captured.

-- Retention window per plan, in days.
--
-- A function rather than a constant in three languages: the gateway writes
-- expires_at with it, the controller sweeps by it, and the pricing page sells
-- it. Those drifting apart is how "7-day retention" quietly becomes "forever".
-- The numbers match dashboard/lib/plans.ts and the pricing page.
CREATE OR REPLACE FUNCTION retention_days(plan TEXT)
RETURNS INTEGER
LANGUAGE SQL IMMUTABLE
AS $$
    SELECT CASE plan
        WHEN 'pro'        THEN 90
        WHEN 'enterprise' THEN 90
        WHEN 'starter'    THEN 7
        WHEN 'indie'      THEN 7
        WHEN 'trial'      THEN 7
        -- Anything unrecognised, including a lapsed 'free' account, gets the
        -- shortest window. Erring long would keep end-user text for someone
        -- who is no longer paying for us to hold it.
        ELSE 1
    END
$$;

CREATE TABLE IF NOT EXISTS request_payloads (
    request_id  UUID PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    tenant_id   VARCHAR(64) NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    -- The request body as sent upstream, and the assembled response text.
    -- Both are stored as given; truncation happens in the gateway, which
    -- knows the configured cap, rather than being re-litigated here.
    request_body  TEXT,
    response_text TEXT,

    -- Set when either side was cut to the size cap, so the UI can say
    -- "truncated" instead of silently showing a clipped prompt as if it
    -- were the whole thing.
    truncated   BOOLEAN NOT NULL DEFAULT FALSE,

    -- When this row becomes deletable. NOT NULL: a payload with no deadline
    -- is a payload nobody deletes.
    expires_at  TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The retention sweep is `DELETE ... WHERE expires_at < NOW()`, so it wants
-- exactly this index and nothing else.
CREATE INDEX IF NOT EXISTS idx_payloads_expiry
    ON request_payloads(expires_at);

CREATE INDEX IF NOT EXISTS idx_payloads_tenant
    ON request_payloads(tenant_id, created_at DESC);

-- Per-tenant opt-out. Defaults to true because the plans are sold on the
-- retention window, so capture is the behaviour customers are paying for;
-- anyone who cannot have end-user text stored turns it off and gets metrics
-- and scores without payloads.
ALTER TABLE tenants
    ADD COLUMN IF NOT EXISTS capture_payloads BOOLEAN NOT NULL DEFAULT TRUE;

-- Cost, so the log can answer "what did this request cost" without the UI
-- inventing per-model arithmetic. Written by the recorder from the token
-- counts the provider reports.
ALTER TABLE requests
    ADD COLUMN IF NOT EXISTS cost_micro_usd BIGINT,
    -- Which provider actually served it, after routing rules and failover.
    -- Previously only the model was recorded, so a request served by an
    -- OpenRouter fallback was indistinguishable from a direct OpenAI call.
    ADD COLUMN IF NOT EXISTS provider VARCHAR(50);

-- The log lists a tenant's requests newest-first, usually filtered to one
-- rollout. Without this it is a sequential scan of every request ever made.
CREATE INDEX IF NOT EXISTS idx_requests_tenant_created
    ON requests(tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_requests_rollout_created
    ON requests(rollout_id, created_at DESC)
    WHERE rollout_id IS NOT NULL;

COMMENT ON TABLE request_payloads IS
    'Prompt and response text for judged requests. Deleted by the controller once expires_at passes, per the plan''s advertised retention window.';
COMMENT ON COLUMN requests.cost_micro_usd IS
    'Cost in millionths of a USD. Integer to avoid float drift when summed across millions of rows.';
COMMENT ON COLUMN tenants.capture_payloads IS
    'When false, no prompt or response text is stored for this tenant — metrics and scores still are.';
