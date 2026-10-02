-- Every version routes to its own provider.
--
-- versions.provider_url is denormalised for the router's hot path. Migration
-- 002 filled it for the versions that existed then; rollout creation never
-- wrote it afterwards, and the router turned a NULL into OpenAI. Every rollout
-- created since that naming Anthropic, Gemini or OpenRouter sent its traffic
-- to api.openai.com and failed. Rollout creation now writes the column and the
-- router falls back to the provider row; this repairs the rows written before.
UPDATE versions v
   SET provider_url = p.base_url
  FROM providers p
 WHERE v.provider_id = p.id
   AND v.provider_url IS NULL;
