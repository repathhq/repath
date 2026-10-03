/**
 * The models offered in the dashboard's pickers.
 *
 * One list, shared by every picker. The rollout and routing pages used to keep
 * their own copies; both drifted, and by October 2026 four of the six models
 * on "New rollout" had been retired by their providers — a new customer
 * picking one created a rollout that failed on its first request.
 *
 * Only models a provider is currently serving belong here. Checked against
 * each provider's pricing and deprecation pages on 2026-10-02; OpenRouter ids
 * come from its live catalog. Models with an announced shutdown are left out
 * even while they still work, so nobody starts a rollout on one.
 *
 * This list is a convenience, not a limit: every picker also takes a custom
 * model id, and the gateway passes any id through. A model launched tomorrow
 * is usable tomorrow, without waiting for this file.
 */

export type ProviderId = "openai" | "anthropic" | "gemini" | "openrouter" | "vercel";

export interface ModelOption {
  provider: ProviderId;
  model: string;
  /** Short hint shown beside the id. */
  note?: string;
}

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
  gemini: "Google Gemini",
  openrouter: "OpenRouter",
  vercel: "Vercel AI Gateway",
};

export const MODELS: ModelOption[] = [
  // OpenAI
  { provider: "openai", model: "gpt-6-astra", note: "flagship" },
  { provider: "openai", model: "gpt-6.1-sol" },
  { provider: "openai", model: "gpt-6-luna", note: "cheapest" },
  { provider: "openai", model: "gpt-5.6-terra" },
  { provider: "openai", model: "gpt-5.6-luna" },
  { provider: "openai", model: "gpt-5.5" },
  { provider: "openai", model: "gpt-5.4" },
  { provider: "openai", model: "gpt-5.4-mini" },
  { provider: "openai", model: "gpt-5-mini" },
  { provider: "openai", model: "gpt-4.1" },
  { provider: "openai", model: "gpt-4.1-mini" },
  { provider: "openai", model: "gpt-4o" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "o3", note: "reasoning" },
  { provider: "openai", model: "o4-mini", note: "reasoning" },
  // Anthropic
  { provider: "anthropic", model: "claude-opus-5-5", note: "flagship" },
  { provider: "anthropic", model: "claude-sonnet-5-5" },
  { provider: "anthropic", model: "claude-haiku-4-5", note: "fastest" },
  { provider: "anthropic", model: "claude-fable-5-1", note: "most capable" },
  { provider: "anthropic", model: "claude-opus-4-8" },
  { provider: "anthropic", model: "claude-sonnet-4-6" },
  // Google
  { provider: "gemini", model: "gemini-3.8-flash" },
  { provider: "gemini", model: "gemini-3.5-flash" },
  { provider: "gemini", model: "gemini-3.5-flash-lite", note: "cheapest" },
  { provider: "gemini", model: "gemini-3.1-pro-preview", note: "preview" },
  { provider: "gemini", model: "gemini-2.5-pro" },
  { provider: "gemini", model: "gemini-2.5-flash" },
  // OpenRouter — one key, many vendors
  { provider: "openrouter", model: "x-ai/grok-4.7" },
  { provider: "openrouter", model: "deepseek/deepseek-v4.1-flash" },
  { provider: "openrouter", model: "qwen/qwen3.8-max-0902" },
  { provider: "openrouter", model: "moonshotai/kimi-k3" },
  { provider: "openrouter", model: "mistralai/mistral-medium-3-5" },
  { provider: "openrouter", model: "meta-llama/llama-4-maverick" },
  // Vercel AI Gateway — one key, every vendor. Ids are Vercel's own spelling
  // from its live catalog: Anthropic versions take a dot ("claude-sonnet-5.5"),
  // xAI is "spacexai/". A hyphenated Claude id is corrected by the gateway.
  { provider: "vercel", model: "openai/gpt-6-luna", note: "cheapest" },
  { provider: "vercel", model: "openai/gpt-6.1-sol" },
  { provider: "vercel", model: "anthropic/claude-sonnet-5.5" },
  { provider: "vercel", model: "anthropic/claude-haiku-4.5", note: "fastest" },
  { provider: "vercel", model: "google/gemini-3.8-flash" },
  { provider: "vercel", model: "spacexai/grok-4.7" },
  { provider: "vercel", model: "deepseek/deepseek-v4.1-flash" },
  { provider: "vercel", model: "alibaba/qwen3.8-max-0902" },
  { provider: "vercel", model: "moonshotai/kimi-k3" },
];

/** A sensible starting point: current, cheap, and good enough to judge well. */
export const DEFAULT_MODEL: ModelOption = MODELS.find((m) => m.model === "gpt-5.4-mini")!;

/** Value used by the "Custom model…" option in pickers. */
export const CUSTOM = "__custom__";

export function key(m: { provider: string; model: string }): string {
  return `${m.provider}/${m.model}`;
}

/**
 * Split a picker value back into provider and model. The model keeps any
 * slashes of its own — OpenRouter ids are "vendor/model".
 */
export function parseKey(value: string): { provider: string; model: string } {
  const [provider, ...rest] = value.split("/");
  return { provider, model: rest.join("/") };
}

export function isListed(m: { provider: string; model: string }): boolean {
  return MODELS.some((o) => o.provider === m.provider && o.model === m.model);
}
