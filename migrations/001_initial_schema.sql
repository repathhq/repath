-- Repath Initial Schema
-- =====================
-- This migration creates the core tables for the Repath progressive delivery system.
--
-- Design principles:
-- 1. Use UUIDs for all primary keys (distributed system friendly, no coordination needed)
-- 2. Include created_at/updated_at timestamps on all tables
-- 3. Use JSONB for flexible/extensible fields (parameters, metadata, scores)
-- 4. Index all foreign keys for join performance
-- 5. Use CHECK constraints for data integrity (weights, scores, enums)

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ================================================================================================
-- PROVIDERS
-- ================================================================================================

CREATE TABLE providers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    base_url VARCHAR(500) NOT NULL,
    api_key_encrypted TEXT NOT NULL,
    provider_type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT providers_provider_type_check
        CHECK (provider_type IN ('openai', 'anthropic', 'gemini', 'azure'))
);

CREATE INDEX idx_providers_name ON providers(name);
CREATE INDEX idx_providers_type ON providers(provider_type);

COMMENT ON TABLE providers IS 'AI provider configurations (OpenAI, Anthropic, etc.)';
COMMENT ON COLUMN providers.api_key_encrypted IS 'Encrypted API key (encrypted at rest with AES-256)';

-- ================================================================================================
-- VERSIONS
-- ================================================================================================

CREATE TABLE versions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    provider_id UUID NOT NULL REFERENCES providers(id) ON DELETE RESTRICT,
    model VARCHAR(255) NOT NULL,
    prompt_template TEXT,
    parameters JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT versions_parameters_is_object
        CHECK (jsonb_typeof(parameters) = 'object')
);

CREATE INDEX idx_versions_provider ON versions(provider_id);
CREATE INDEX idx_versions_name ON versions(name);
CREATE INDEX idx_versions_model ON versions(model);

COMMENT ON TABLE versions IS 'Immutable LLM configurations (model + prompt + parameters)';
COMMENT ON COLUMN versions.prompt_template IS 'System prompt template with optional variable substitution';
COMMENT ON COLUMN versions.parameters IS 'Generation parameters (temperature, max_tokens, etc.)';

-- ================================================================================================
-- ROLLOUTS
-- ================================================================================================

CREATE TABLE rollouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL UNIQUE,
    baseline_version_id UUID NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
    candidate_version_id UUID NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
    state VARCHAR(50) NOT NULL DEFAULT 'created',
    current_weight DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    policy JSONB NOT NULL,
    strategy JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,

    CONSTRAINT rollouts_different_versions
        CHECK (baseline_version_id != candidate_version_id),
    CONSTRAINT rollouts_state_check
        CHECK (state IN ('created', 'shadow', 'canary', 'promoted', 'rolled_back', 'paused')),
    CONSTRAINT rollouts_weight_range
        CHECK (current_weight >= 0.0 AND current_weight <= 1.0),
    CONSTRAINT rollouts_policy_is_object
        CHECK (jsonb_typeof(policy) = 'object'),
    CONSTRAINT rollouts_strategy_is_object
        CHECK (jsonb_typeof(strategy) = 'object')
);

CREATE INDEX idx_rollouts_state ON rollouts(state);
CREATE INDEX idx_rollouts_baseline_version ON rollouts(baseline_version_id);
CREATE INDEX idx_rollouts_candidate_version ON rollouts(candidate_version_id);
CREATE INDEX idx_rollouts_created_at ON rollouts(created_at DESC);
CREATE INDEX idx_rollouts_active ON rollouts(state)
    WHERE state IN ('shadow', 'canary');

COMMENT ON TABLE rollouts IS 'Progressive rollouts from baseline to candidate version';
COMMENT ON COLUMN rollouts.current_weight IS 'Percentage of traffic to candidate (0.0 = 0%, 1.0 = 100%)';
COMMENT ON COLUMN rollouts.policy IS 'Decision policy (thresholds, min_samples, confidence_level)';
COMMENT ON COLUMN rollouts.strategy IS 'Rollout strategy (steps, gates, durations)';

-- ================================================================================================
-- ROLLOUT STEPS
-- ================================================================================================

CREATE TABLE rollout_steps (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rollout_id UUID NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
    step_number INTEGER NOT NULL,
    target_weight DOUBLE PRECISION NOT NULL,
    gate_expression TEXT NOT NULL,
    pause_duration_seconds INTEGER,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,

    CONSTRAINT rollout_steps_unique_step
        UNIQUE (rollout_id, step_number),
    CONSTRAINT rollout_steps_weight_range
        CHECK (target_weight >= 0.0 AND target_weight <= 1.0),
    CONSTRAINT rollout_steps_status_check
        CHECK (status IN ('pending', 'active', 'passed', 'failed'))
);

CREATE INDEX idx_rollout_steps_rollout ON rollout_steps(rollout_id);
CREATE INDEX idx_rollout_steps_status ON rollout_steps(status);

COMMENT ON TABLE rollout_steps IS 'Individual steps in a rollout strategy';
COMMENT ON COLUMN rollout_steps.gate_expression IS 'Condition that must pass to advance (e.g., "quality_score >= 0.9")';

-- ================================================================================================
-- REQUESTS
-- ================================================================================================

CREATE TABLE requests (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rollout_id UUID REFERENCES rollouts(id) ON DELETE SET NULL,
    version_id UUID NOT NULL REFERENCES versions(id) ON DELETE RESTRICT,
    request_hash VARCHAR(64),
    model VARCHAR(255) NOT NULL,
    input_tokens INTEGER,
    output_tokens INTEGER,
    latency_ms INTEGER NOT NULL,
    status_code SMALLINT NOT NULL,
    error TEXT,
    session_id VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT requests_latency_positive
        CHECK (latency_ms >= 0),

    CONSTRAINT requests_tokens_positive
        CHECK (
            (input_tokens IS NULL OR input_tokens >= 0)
            AND
            (output_tokens IS NULL OR output_tokens >= 0)
        )
);

CREATE INDEX idx_requests_rollout ON requests(rollout_id);
CREATE INDEX idx_requests_version ON requests(version_id);
CREATE INDEX idx_requests_created_at ON requests(created_at DESC);
CREATE INDEX idx_requests_status_code ON requests(status_code);
CREATE INDEX idx_requests_session ON requests(session_id)
    WHERE session_id IS NOT NULL;
CREATE INDEX idx_requests_hash ON requests(request_hash)
    WHERE request_hash IS NOT NULL;

COMMENT ON TABLE requests IS 'Proxied API requests through Repath gateway';
COMMENT ON COLUMN requests.request_hash IS 'Hash of request content for matching shadow requests';
COMMENT ON COLUMN requests.latency_ms IS 'Total request duration from gateway receipt to response sent';

-- ================================================================================================
-- EVALUATIONS
-- ================================================================================================

CREATE TABLE evaluations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    evaluator_type VARCHAR(50) NOT NULL,
    scores JSONB NOT NULL,
    overall_score DOUBLE PRECISION NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT evaluations_evaluator_type_check
        CHECK (evaluator_type IN ('programmatic', 'embedding', 'llm_judge', 'human')),
    CONSTRAINT evaluations_overall_score_range
        CHECK (overall_score >= 0.0 AND overall_score <= 1.0),
    CONSTRAINT evaluations_scores_is_object
        CHECK (jsonb_typeof(scores) = 'object')
);

CREATE INDEX idx_evaluations_request ON evaluations(request_id);
CREATE INDEX idx_evaluations_type ON evaluations(evaluator_type);
CREATE INDEX idx_evaluations_score ON evaluations(overall_score);
CREATE INDEX idx_evaluations_created_at ON evaluations(created_at DESC);

-- Composite index for aggregating scores by version
CREATE INDEX idx_evaluations_version_score ON evaluations(overall_score, created_at DESC)
    INCLUDE (request_id);

COMMENT ON TABLE evaluations IS 'Quality evaluations for request/response pairs';
COMMENT ON COLUMN evaluations.scores IS 'Individual scores per criterion (e.g., {"accuracy": 0.9, "helpfulness": 0.85})';
COMMENT ON COLUMN evaluations.overall_score IS 'Weighted composite score (0.0 - 1.0)';

-- ================================================================================================
-- DECISIONS
-- ================================================================================================

CREATE TABLE decisions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rollout_id UUID NOT NULL REFERENCES rollouts(id) ON DELETE CASCADE,
    action VARCHAR(50) NOT NULL,
    reason TEXT NOT NULL,
    previous_weight DOUBLE PRECISION,
    new_weight DOUBLE PRECISION,
    triggered_by VARCHAR(50) NOT NULL,
    metrics_snapshot JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT decisions_action_check
        CHECK (action IN ('advance', 'rollback', 'pause', 'resume', 'promote')),
    CONSTRAINT decisions_triggered_by_check
        CHECK (triggered_by IN ('controller', 'manual', 'schedule')),
    CONSTRAINT decisions_weight_range
        CHECK ((previous_weight IS NULL OR (previous_weight >= 0.0 AND previous_weight <= 1.0))
               AND (new_weight IS NULL OR (new_weight >= 0.0 AND new_weight <= 1.0)))
);

CREATE INDEX idx_decisions_rollout ON decisions(rollout_id);
CREATE INDEX idx_decisions_action ON decisions(action);
CREATE INDEX idx_decisions_created_at ON decisions(created_at DESC);

COMMENT ON TABLE decisions IS 'Audit log of controller decisions and manual actions';
COMMENT ON COLUMN decisions.reason IS 'Human-readable explanation of why this decision was made';
COMMENT ON COLUMN decisions.metrics_snapshot IS 'Snapshot of quality/latency/error metrics at decision time';

-- ================================================================================================
-- ALERT RULES
-- ================================================================================================

CREATE TABLE alert_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    rollout_id UUID REFERENCES rollouts(id) ON DELETE CASCADE,
    condition TEXT NOT NULL,
    channel VARCHAR(50) NOT NULL,
    channel_config JSONB NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT alert_rules_channel_check
        CHECK (channel IN ('slack', 'pagerduty', 'webhook', 'email')),
    CONSTRAINT alert_rules_channel_config_is_object
        CHECK (jsonb_typeof(channel_config) = 'object')
);

CREATE INDEX idx_alert_rules_rollout ON alert_rules(rollout_id);
CREATE INDEX idx_alert_rules_enabled ON alert_rules(enabled)
    WHERE enabled = TRUE;

COMMENT ON TABLE alert_rules IS 'Alert configurations for rollout events';
COMMENT ON COLUMN alert_rules.condition IS 'Expression to evaluate (e.g., "quality_score < 0.7")';
COMMENT ON COLUMN alert_rules.channel_config IS 'Channel-specific config (webhook URL, Slack channel, etc.)';

-- ================================================================================================
-- FUNCTIONS & TRIGGERS
-- ================================================================================================

-- Automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_providers_updated_at
    BEFORE UPDATE ON providers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_rollouts_updated_at
    BEFORE UPDATE ON rollouts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_alert_rules_updated_at
    BEFORE UPDATE ON alert_rules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ================================================================================================
-- VIEWS
-- ================================================================================================

-- View for active rollouts with version details
CREATE VIEW active_rollouts AS
SELECT
    r.id,
    r.name,
    r.state,
    r.current_weight,
    r.created_at,
    r.updated_at,
    bv.name AS baseline_version_name,
    bv.model AS baseline_model,
    cv.name AS candidate_version_name,
    cv.model AS candidate_model
FROM rollouts r
JOIN versions bv ON r.baseline_version_id = bv.id
JOIN versions cv ON r.candidate_version_id = cv.id
WHERE r.state IN ('shadow', 'canary');

COMMENT ON VIEW active_rollouts IS 'Currently active rollouts with version details';

-- View for request metrics grouped by version
CREATE VIEW request_metrics_by_version AS
SELECT
    r.version_id,
    v.name AS version_name,
    COUNT(*) AS total_requests,
    AVG(r.latency_ms)::INTEGER AS avg_latency_ms,
    PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY r.latency_ms)::INTEGER AS p95_latency_ms,
    PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY r.latency_ms)::INTEGER AS p99_latency_ms,
    SUM(CASE WHEN r.status_code >= 400 THEN 1 ELSE 0 END) AS error_count,
    SUM(CASE WHEN r.status_code >= 400 THEN 1 ELSE 0 END)::FLOAT / COUNT(*)::FLOAT AS error_rate,
    SUM(COALESCE(r.input_tokens, 0)) AS total_input_tokens,
    SUM(COALESCE(r.output_tokens, 0)) AS total_output_tokens
FROM requests r
JOIN versions v ON r.version_id = v.id
WHERE r.created_at > NOW() - INTERVAL '1 hour'
GROUP BY r.version_id, v.name;

COMMENT ON VIEW request_metrics_by_version IS 'Request metrics aggregated by version (last 1 hour)';

-- ================================================================================================
-- SEED DATA (Development)
-- ================================================================================================

-- Only insert seed data if in development environment
DO $$
BEGIN
    IF current_database() LIKE '%dev%' OR current_database() = 'repath' THEN
        -- Insert a default OpenAI provider (with placeholder key)
        INSERT INTO providers (name, base_url, api_key_encrypted, provider_type)
        VALUES (
            'openai',
            'https://api.openai.com/v1',
            'PLACEHOLDER_REPLACE_WITH_REAL_KEY',
            'openai'
        ) ON CONFLICT (name) DO NOTHING;

        RAISE NOTICE 'Development seed data inserted. Replace placeholder API keys!';
    END IF;
END $$;
