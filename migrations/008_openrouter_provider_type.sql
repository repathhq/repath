-- Migration: allow 'openrouter' as a provider type
--
-- `tenant_provider_credentials` has accepted openrouter since 007, and the
-- Settings UI has always offered it as a key you can store — but the
-- `providers` table (which rollouts point their versions at) still only
-- permitted openai/anthropic/gemini/azure. Creating a rollout against
-- OpenRouter therefore fell through `upsert_provider`'s catch-all branch and
-- stored the literal string "openrouter" as the base URL, producing a
-- provider row that could never be called.
--
-- Adding the type here, plus the matching arm in upsert_provider, makes
-- OpenRouter usable as a rollout provider rather than only as a failover
-- target.

ALTER TABLE providers
    DROP CONSTRAINT IF EXISTS providers_provider_type_check;

ALTER TABLE providers
    ADD CONSTRAINT providers_provider_type_check
    CHECK (provider_type IN ('openai', 'anthropic', 'gemini', 'azure', 'openrouter'));

-- Repair any rows already written by the broken catch-all branch. These have
-- the provider name where a URL belongs, so nothing could ever call them.
UPDATE providers
   SET base_url      = 'https://openrouter.ai/api/v1',
       provider_type = 'openrouter',
       updated_at    = NOW()
 WHERE base_url = 'openrouter';
