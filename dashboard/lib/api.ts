/**
 * API client for the Repath gateway management API.
 *
 * All functions are async and return typed data.
 * Errors throw with a descriptive message — callers use React error boundaries
 * or SWR's error handling.
 */

// All API calls go through the Next.js proxy at /api/gateway/*
// This keeps REPATH_API_TOKEN server-side — it never reaches the browser.
const PROXY = "/api/gateway";

async function fetchApi<T>(path: string): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `API error ${res.status}`);
  }
  return res.json();
}

// ── Types ──────────────────────────────────────────────────────────────────

export interface RolloutSummary {
  id: string;
  name: string;
  state: "created" | "shadow" | "canary" | "promoted" | "rolled_back" | "paused";
  current_weight: number;
  baseline_model: string;
  candidate_model: string;
  avg_quality_baseline: number | null;
  avg_quality_candidate: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface RolloutDetail extends RolloutSummary {
  baseline_version_id: string;
  candidate_version_id: string;
  baseline_prompt: string | null;
  candidate_prompt: string | null;
  policy: Record<string, unknown>;
  strategy: Record<string, unknown>;
  p95_latency_baseline: number | null;
  p95_latency_candidate: number | null;
  error_rate_baseline: number | null;
  error_rate_candidate: number | null;
  sample_count_baseline: number | null;
  sample_count_candidate: number | null;
  /** Evaluations scored by the LLM judge. 0 means the quality numbers above
   *  come only from programmatic checks, which score ~1.0 for any healthy
   *  response and cannot tell a better version from a worse one. */
  judged_sample_count: number | null;
  /** Period every metric above covers: "10m" when there was recent traffic,
   *  "all_time" when it fell back. The label must follow this — a score from
   *  all-time shown under "Samples (10m)" reads as measured from nothing. */
  metrics_window: "10m" | "all_time";
}

export interface MetricPoint {
  ts: string;
  version_id: string;
  role: "baseline" | "candidate";
  avg_quality: number;
  p95_latency_ms: number;
  error_rate: number;
  request_count: number;
}

export interface StepInfo {
  step_number: number;
  target_weight: number;
  gate_expression: string;
  status: "pending" | "active" | "passed" | "failed";
  pause_duration_seconds: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface DecisionInfo {
  id: string;
  action: "advance" | "rollback" | "promote" | "pause" | "resume";
  reason: string;
  previous_weight: number | null;
  new_weight: number | null;
  triggered_by: string;
  metrics_snapshot: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Shape accepted by POST /api/v1/rollouts.
 *
 * Mirrors the rollout YAML so the same config works from the dashboard, the
 * CLI and a raw API call. `apiVersion` and `kind` are carried for that parity
 * even though the endpoint could infer them.
 */
export interface RolloutConfigInput {
  apiVersion: "repath/v1";
  kind: "Rollout";
  metadata: { name: string; labels?: Record<string, string> };
  spec: {
    baseline: VersionInput;
    candidate: VersionInput;
    strategy: {
      type: "canary" | "shadow" | "blue_green";
      steps: Array<{
        weight: number;
        duration?: string;
        gate?: Record<string, string>;
      }>;
      rollback: { trigger: Record<string, string>; action: string };
    };
  };
}

export interface VersionInput {
  provider: string;
  model: string;
  prompt: { system?: string };
  parameters: { temperature?: number; max_tokens?: number };
}

export interface CreatedRollout {
  id: string;
  name: string;
  state: string;
  steps: number;
  message: string;
}

// ── Routing rules ──────────────────────────────────────────────────────────

export type RuleField = "input_tokens" | "model" | "path" | "content" | "header";
export type RuleOperator =
  | "eq" | "neq" | "lt" | "lte" | "gt" | "gte"
  | "contains" | "not_contains" | "starts_with" | "exists";

export interface RuleCondition {
  field: RuleField;
  op: RuleOperator;
  value: string;
  header?: string;
}

export interface RuleAction {
  provider: string;
  model: string;
}

export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  condition: RuleCondition;
  action: RuleAction;
  match_count: number;
  last_matched_at: string | null;
}

export interface RuleInput {
  name: string;
  priority: number;
  enabled: boolean;
  condition: RuleCondition;
  action: RuleAction;
}

export interface RuleTestResult {
  estimated_input_tokens: number;
  rules: Array<{
    name: string;
    priority: number;
    matches: boolean;
    would_route_to: RuleAction;
  }>;
  result:
    | { matched: true; rule: string; provider: string; model: string }
    | { matched: false; explanation: string };
}

// ── Providers & failover ───────────────────────────────────────────────────

export interface ProviderCredential {
  provider: string;
  key_hint: string;
  updated_at: string;
}

// ── Webhooks & notifications ───────────────────────────────────────────────

export interface Webhook {
  id: string;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
}

export interface WebhookDelivery {
  event: string;
  status_code: number | null;
  error: string | null;
  attempts: number;
  delivered: boolean;
  created_at: string;
}

export interface NotificationSettings {
  email_enabled: boolean;
  email_address: string | null;
  slack_enabled: boolean;
  slack_configured: boolean;
  events: string[];
}

export interface GatewaySettings {
  request_timeout_seconds: number;
  eval_sample_rate: number;
  /** Whether prompts and responses are stored for judged requests. */
  capture_payloads: boolean;
  /** Days payloads are kept, from the plan. Reported by the server so the UI
   *  states the real window rather than repeating a pricing-page number. */
  retention_days: number;
}

export interface SystemHealth {
  status: string;
  database: string;
  redis: string;
  gateway_version: string;
  active_rollouts: number;
}

// ── API calls ──────────────────────────────────────────────────────────────

async function postApi(path: string): Promise<{ message: string }> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `API error ${res.status}`);
  }
  return res.json();
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } })?.error?.message ?? `API error ${res.status}`
    );
  }
  return res.json();
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      (err as { error?: { message?: string } })?.error?.message ?? `API error ${res.status}`
    );
  }
  return res.json();
}

async function deleteApi(path: string): Promise<{ deleted: boolean }> {
  const res = await fetch(`${PROXY}${path}`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: { message?: string } })?.error?.message ?? `API error ${res.status}`);
  }
  return res.json();
}


// ── Request log ────────────────────────────────────────────────────────────

export interface LogRow {
  id: string;
  created_at: string;
  model: string;
  provider: string | null;
  latency_ms: number;
  status_code: number;
  input_tokens: number | null;
  output_tokens: number | null;
  /** Millionths of a dollar. `null` when the model is unpriced — render "—",
   *  never "$0.00", which would read as free. */
  cost_micro_usd: number | null;
  score: number | null;
  /** "llm_judge" scores measure quality; "programmatic" ones are health
   *  checks that return ~1.0 for anything that did not error. Showing them
   *  identically is how a broken judge looked like a perfect candidate. */
  evaluator_type: string | null;
  rollout_id: string | null;
  version_id: string | null;
  role: "baseline" | "candidate" | null;
  session_id: string | null;
  has_payload: boolean;
}

export interface EvaluationDetail {
  evaluator_type: string;
  overall_score: number;
  scores: Record<string, unknown>;
  /** Carries the judge's per-criterion reasoning. */
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface RequestDetail extends Omit<LogRow, "has_payload"> {
  error: string | null;
  rollout_name: string | null;
  system_prompt: string | null;
  request_body: string | null;
  response_text: string | null;
  truncated: boolean;
  payload_expires_at: string | null;
  evaluations: EvaluationDetail[];
}

export interface LogFilters {
  rollout_id?: string;
  version_id?: string;
  model?: string;
  provider?: string;
  status?: "success" | "error";
  max_score?: number;
  min_score?: number;
  evaluator?: string;
  limit?: number;
  before?: string;
}

export const api = {
  logs: {
    list: (f: LogFilters = {}) => {
      const q = new URLSearchParams();
      Object.entries(f).forEach(([k, v]) => {
        if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
      });
      const qs = q.toString();
      return fetchApi<{ requests: LogRow[]; next_before: string | null; has_more: boolean }>(
        `/requests${qs ? `?${qs}` : ""}`
      );
    },
    get: (id: string) => fetchApi<RequestDetail>(`/requests/${id}`),
    /** The requests behind a controller decision, worst-scoring first. */
    forDecision: (decisionId: string) =>
      fetchApi<{
        decision: { id: string; action: string; created_at: string; metrics_snapshot: Record<string, unknown> | null };
        requests: LogRow[];
        window_minutes: number;
        note: string;
      }>(`/decisions/${decisionId}/requests`),
  },
  rollouts: {
    list: () => fetchApi<{ rollouts: RolloutSummary[]; total: number }>("/rollouts"),
    get: (id: string) => fetchApi<RolloutDetail>(`/rollouts/${id}`),
    metrics: (id: string) => fetchApi<{ metrics: MetricPoint[] }>(`/rollouts/${id}/metrics`),
    steps: (id: string) => fetchApi<{ steps: StepInfo[] }>(`/rollouts/${id}/steps`),
    decisions: (id: string) => fetchApi<{ decisions: DecisionInfo[] }>(`/rollouts/${id}/decisions`),
    create: (config: RolloutConfigInput) =>
      postJson<CreatedRollout>("/rollouts", config),
    promote: (id: string) => postApi(`/rollouts/${id}/promote`),
    rollback: (id: string) => postApi(`/rollouts/${id}/rollback`),
    pause: (id: string) => postApi(`/rollouts/${id}/pause`),
    resume: (id: string) => postApi(`/rollouts/${id}/resume`),
    delete: (id: string) => deleteApi(`/rollouts/${id}`),
  },
  system: {
    health: () => fetchApi<SystemHealth>("/system/health"),
  },

  routing: {
    list: () => fetchApi<{ rules: RoutingRule[] }>("/routing/rules"),
    create: (rule: RuleInput) => postJson<{ id: string }>("/routing/rules", rule),
    update: (id: string, rule: RuleInput) => putJson<{ id: string }>(`/routing/rules/${id}`, rule),
    remove: (id: string) => deleteApi(`/routing/rules/${id}`),
    test: (sample: { model?: string; content?: string; headers?: Record<string, string> }) =>
      postJson<RuleTestResult>("/routing/test", sample),
  },

  providers: {
    list: () => fetchApi<{ providers: ProviderCredential[] }>("/settings/providers"),
    save: (provider: string, api_key: string) =>
      putJson<{ provider: string; key_hint: string }>("/settings/providers", { provider, api_key }),
    remove: (provider: string) => deleteApi(`/settings/providers/${provider}`),
  },

  failover: {
    get: () => fetchApi<{ chain: string[] }>("/settings/failover"),
    save: (chain: string[]) => putJson<{ chain: string[] }>("/settings/failover", { chain }),
  },

  webhooks: {
    list: () => fetchApi<{ webhooks: Webhook[] }>("/settings/webhooks"),
    create: (url: string, events: string[]) =>
      postJson<{ id: string; signing_secret: string }>("/settings/webhooks", { url, events }),
    remove: (id: string) => deleteApi(`/settings/webhooks/${id}`),
    deliveries: (id: string) =>
      fetchApi<{ deliveries: WebhookDelivery[] }>(`/settings/webhooks/${id}/deliveries`),
    test: (id: string) => postApi(`/settings/webhooks/${id}/test`),
  },

  notifications: {
    get: () => fetchApi<NotificationSettings>("/settings/notifications"),
    save: (settings: Partial<NotificationSettings> & { slack_webhook_url?: string }) =>
      putJson<{ message: string }>("/settings/notifications", settings),
  },

  gatewaySettings: {
    get: () => fetchApi<GatewaySettings>("/settings/gateway"),
    save: (settings: Partial<GatewaySettings>) =>
      putJson<{ message: string }>("/settings/gateway", settings),
  },
};
