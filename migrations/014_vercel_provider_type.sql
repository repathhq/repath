-- Vercel AI Gateway as a provider.
--
-- OpenAI-compatible at https://ai-gateway.vercel.sh/v1 with vendor-prefixed
-- model ids ("openai/gpt-6-luna", "anthropic/claude-sonnet-5-5"). Like
-- OpenRouter, one key reaches every vendor — which is also why the judge runs
-- through it. Widens the constraint migration 008 set; touches no rows.
ALTER TABLE providers DROP CONSTRAINT IF EXISTS providers_provider_type_check;
ALTER TABLE providers ADD CONSTRAINT providers_provider_type_check
    CHECK (provider_type IN ('openai', 'anthropic', 'gemini', 'azure', 'openrouter', 'vercel'));
