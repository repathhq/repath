"use client";

/**
 * Provider API keys and the failover chain.
 *
 * Keys are stored encrypted and never returned, so a saved key shows only a
 * masked hint. The failover chain is deliberately edited alongside them: a
 * chain entry without a key cannot be called, and the server rejects that
 * combination rather than silently skipping the provider at request time.
 */

import { useState } from "react";
import { api, type ProviderCredential } from "@/lib/api";
import { AlertCircle, Check, GripVertical, Loader2, Plus, Trash2, X } from "lucide-react";
import { useResource } from "@/lib/hooks";

const PROVIDERS = [
  { id: "openai", name: "OpenAI", placeholder: "sk-proj-…" },
  { id: "anthropic", name: "Anthropic", placeholder: "sk-ant-…" },
  { id: "gemini", name: "Google Gemini", placeholder: "AIza…" },
  { id: "openrouter", name: "OpenRouter", placeholder: "sk-or-v1-…" },
];

const input =
  "w-full max-w-sm px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 " +
  "placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white";

export default function ProviderKeys() {
  const { data, loading, error: loadError, refresh: load } = useResource(async () => {
    const [c, f] = await Promise.all([api.providers.list(), api.failover.get()]);
    return { creds: c.providers, chain: f.chain };
  });

  const creds: ProviderCredential[] = data?.creds ?? [];
  // The chain is edited optimistically, so it needs local state seeded from
  // the server and reconciled on every reload.
  const [chainOverride, setChainOverride] = useState<string[] | null>(null);
  const chain = chainOverride ?? data?.chain ?? [];

  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const error = actionError ?? loadError?.message ?? null;
  const setError = setActionError;

  function flash(message: string) {
    setOk(message);
    setError(null);
    setTimeout(() => setOk(null), 3000);
  }

  async function saveKey(provider: string) {
    const key = (drafts[provider] ?? "").trim();
    if (!key) return;
    setSaving(provider);
    setError(null);
    try {
      await api.providers.save(provider, key);
      setDrafts((d) => ({ ...d, [provider]: "" }));
      setChainOverride(null);
      await load();
      flash(`${provider} key saved.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that key.");
    } finally {
      setSaving(null);
    }
  }

  async function removeKey(provider: string) {
    setSaving(provider);
    try {
      await api.providers.remove(provider);
      setChainOverride(null);
      await load();
      flash(`${provider} key removed.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove that key.");
    } finally {
      setSaving(null);
    }
  }

  async function saveChain(next: string[]) {
    setChainOverride(next);
    setError(null);
    try {
      await api.failover.save(next);
      flash("Failover chain saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the failover chain.");
      // Drop the optimistic value so the UI shows what is actually stored.
      setChainOverride(null);
      await load();
    }
  }

  const stored = (p: string) => creds.find((c) => c.provider === p);
  const available = PROVIDERS.filter((p) => !chain.includes(p.id));

  if (loading) {
    return <div className="h-32 rounded-xl bg-gray-50 border border-gray-100 animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-8">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[13px] text-red-700">{error}</p>
        </div>
      )}
      {ok && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <Check className="h-3.5 w-3.5 text-emerald-500" strokeWidth={2.5} />
          <p className="text-[13px] text-emerald-700">{ok}</p>
        </div>
      )}

      <div>
        <p className="text-[13px] text-gray-500 mb-4 max-w-[62ch]">
          Repath forwards your own key straight through for normal traffic and never stores it.
          Keys saved here are only used when Repath calls a provider <em>on your behalf</em> — for
          failover, or when a routing rule sends a request somewhere else. They are encrypted at
          rest and never shown again.
        </p>

        <div className="flex flex-col gap-4">
          {PROVIDERS.map((p) => {
            const existing = stored(p.id);
            return (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center gap-3 py-3 border-b border-gray-50 last:border-0">
                <div className="sm:w-36 shrink-0">
                  <p className="text-[13px] font-medium text-gray-700">{p.name}</p>
                  {existing && (
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5">{existing.key_hint}</p>
                  )}
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="password"
                    className={input}
                    placeholder={existing ? "Enter a new key to replace" : p.placeholder}
                    value={drafts[p.id] ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveKey(p.id);
                    }}
                  />
                  <button
                    onClick={() => saveKey(p.id)}
                    disabled={!drafts[p.id]?.trim() || saving === p.id}
                    className="px-3 py-2 rounded-lg bg-violet-600 text-white text-[13px] font-medium hover:bg-violet-700 disabled:opacity-40 transition-colors"
                  >
                    {saving === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                  </button>
                  {existing && (
                    <button
                      onClick={() => removeKey(p.id)}
                      disabled={saving === p.id}
                      title="Remove key"
                      className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="text-[15px] font-semibold text-gray-900 mb-1">Failover chain</h3>
        <p className="text-[13px] text-gray-500 mb-4 max-w-[62ch]">
          When your primary provider returns a 5xx or rate-limits, Repath retries once and then
          works down this list. Each provider here needs a saved key above.
        </p>

        {chain.length === 0 ? (
          <p className="text-[13px] text-gray-400 mb-3">
            No failover configured — a failing provider returns the error to your app.
          </p>
        ) : (
          <div className="flex flex-col gap-2 mb-3 max-w-md">
            {chain.map((p, i) => (
              <div
                key={p}
                className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2.5"
              >
                <GripVertical className="h-4 w-4 text-gray-300" strokeWidth={1.8} />
                <span className="text-[11px] font-mono text-gray-400 w-4">{i + 1}</span>
                <span className="text-[13.5px] text-gray-800 flex-1">
                  {PROVIDERS.find((x) => x.id === p)?.name ?? p}
                </span>
                {!stored(p) && (
                  <span className="text-[11px] text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    no key
                  </span>
                )}
                <button
                  onClick={() => saveChain(chain.filter((x) => x !== p))}
                  title="Remove from chain"
                  className="p-1 rounded text-gray-400 hover:text-red-500 transition-colors"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>
            ))}
          </div>
        )}

        {available.length > 0 && (
          <div className="flex items-center gap-2">
            <select
              className="px-3 py-2 rounded-lg border border-gray-200 text-[13.5px] bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  void saveChain([...chain, e.target.value]);
                  e.target.value = "";
                }
              }}
            >
              <option value="" disabled>
                Add a provider…
              </option>
              {available.map((p) => (
                <option key={p.id} value={p.id} disabled={!stored(p.id)}>
                  {p.name}
                  {!stored(p.id) ? " — add a key first" : ""}
                </option>
              ))}
            </select>
            <Plus className="h-4 w-4 text-gray-300" strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  );
}
