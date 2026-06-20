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

export const api = {
  rollouts: {
    list: () => fetchApi<{ rollouts: RolloutSummary[]; total: number }>("/rollouts"),
    get: (id: string) => fetchApi<RolloutDetail>(`/rollouts/${id}`),
    metrics: (id: string) => fetchApi<{ metrics: MetricPoint[] }>(`/rollouts/${id}/metrics`),
    steps: (id: string) => fetchApi<{ steps: StepInfo[] }>(`/rollouts/${id}/steps`),
    decisions: (id: string) => fetchApi<{ decisions: DecisionInfo[] }>(`/rollouts/${id}/decisions`),
    promote: (id: string) => postApi(`/rollouts/${id}/promote`),
    rollback: (id: string) => postApi(`/rollouts/${id}/rollback`),
  },
  system: {
    health: () => fetchApi<SystemHealth>("/system/health"),
  },
};
