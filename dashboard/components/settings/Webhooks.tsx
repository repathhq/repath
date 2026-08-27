"use client";

/**
 * Webhook management.
 *
 * The delivery log is the point of this panel. A webhook that quietly stops
 * arriving is one of the worst integration failures to debug, because nothing
 * on either side reports it — so every attempt and its status code is shown
 * here, and a test delivery can be fired without waiting for a real rollback.
 */

import { useState } from "react";
import { api, type Webhook, type WebhookDelivery } from "@/lib/api";
import { AlertCircle, Check, ChevronDown, Loader2, Plus, Send, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/hooks";

const ALL_EVENTS = [
  { id: "rollback", label: "Rollback", hint: "The controller returned traffic to the baseline" },
  { id: "advance", label: "Advance", hint: "Traffic moved to the next weight step" },
  { id: "promote", label: "Promote", hint: "The candidate reached 100%" },
  { id: "provider_outage", label: "Provider outage", hint: "A provider failed and traffic failed over" },
];

const input =
  "w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white";

export default function Webhooks() {
  const { data, loading, error: loadError, refresh: load } = useResource(() =>
    api.webhooks.list()
  );
  const hooks: Webhook[] = data?.webhooks ?? [];

  const [actionError, setActionError] = useState<string | null>(null);
  const error = actionError ?? loadError?.message ?? null;
  const setError = setActionError;

  const [creating, setCreating] = useState(false);
  const [url, setUrl] = useState("");
  const [events, setEvents] = useState<string[]>(["rollback", "provider_outage"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const res = await api.webhooks.create(url.trim(), events);
      setNewSecret(res.signing_secret);
      setUrl("");
      setCreating(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the webhook.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string) {
    setBusy(id);
    try {
      await api.webhooks.remove(id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the webhook.");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return <div className="h-32 rounded-xl bg-gray-50 border border-gray-100 animate-pulse" />;
  }

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[13px] text-gray-500 max-w-[62ch]">
        Repath POSTs to your endpoint when a rollout changes state. Every request carries an{" "}
        <code className="text-[12px] bg-gray-100 px-1 rounded">X-Repath-Signature</code> header —
        an HMAC-SHA256 of the body under your signing secret. Verify it before trusting a payload.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[13px] text-red-700">{error}</p>
        </div>
      )}

      {newSecret && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-[13px] font-semibold text-amber-800 mb-2">
            Signing secret — copy it now
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-[12.5px] font-mono bg-white border border-amber-200 rounded px-2 py-1.5 truncate">
              {newSecret}
            </code>
            <button
              onClick={() => navigator.clipboard.writeText(newSecret)}
              className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-[12.5px] font-medium hover:bg-amber-700"
            >
              Copy
            </button>
          </div>
          <p className="text-[12px] text-amber-700 mt-2">
            This is shown once and cannot be recovered.{" "}
            <button onClick={() => setNewSecret(null)} className="underline">
              Dismiss
            </button>
          </p>
        </div>
      )}

      {hooks.map((h) => (
        <WebhookRow key={h.id} hook={h} busy={busy === h.id} onDelete={() => remove(h.id)} />
      ))}

      {creating ? (
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4 flex flex-col gap-3">
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-1.5">Endpoint URL</label>
            <input
              className={input}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://your-app.com/webhooks/repath"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-gray-600 mb-2">Send on</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_EVENTS.map((e) => (
                <label key={e.id} className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-violet-600"
                    checked={events.includes(e.id)}
                    onChange={(ev) =>
                      setEvents((prev) =>
                        ev.target.checked ? [...prev, e.id] : prev.filter((x) => x !== e.id)
                      )
                    }
                  />
                  <span>
                    <span className="text-[13px] text-gray-800">{e.label}</span>
                    <span className="block text-[11.5px] text-gray-500">{e.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={create}
              disabled={!url.trim() || events.length === 0 || busy === "create"}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-600 text-white text-[13px] font-semibold hover:bg-violet-700 disabled:opacity-40"
            >
              {busy === "create" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Add webhook
            </button>
            <button onClick={() => setCreating(false)} className="px-3 py-2 text-[13px] text-gray-600 hover:text-gray-900">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="self-start flex items-center gap-1.5 text-[13px] text-violet-600 hover:text-violet-700 font-medium"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} /> Add a webhook
        </button>
      )}
    </div>
  );
}

function WebhookRow({
  hook,
  busy,
  onDelete,
}: {
  hook: Webhook;
  busy: boolean;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[] | null>(null);
  const [testing, setTesting] = useState(false);

  async function loadDeliveries() {
    try {
      setDeliveries((await api.webhooks.deliveries(hook.id)).deliveries);
    } catch {
      setDeliveries([]);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      await api.webhooks.test(hook.id);
      // The delivery is dispatched asynchronously; give it a beat to land.
      setTimeout(() => {
        void loadDeliveries();
        setTesting(false);
      }, 2500);
    } catch {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-mono text-gray-800 truncate">{hook.url}</p>
          <p className="text-[11.5px] text-gray-500 mt-0.5">{hook.events.join(" · ")}</p>
        </div>
        <button
          onClick={sendTest}
          disabled={testing}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 text-[12.5px] text-gray-600 hover:text-gray-900 hover:border-gray-300 disabled:opacity-50"
        >
          {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" strokeWidth={1.8} />}
          Test
        </button>
        <button
          onClick={() => {
            setOpen((v) => !v);
            if (!deliveries) void loadDeliveries();
          }}
          className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700"
          title="Delivery history"
        >
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} strokeWidth={2} />
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 disabled:opacity-40"
          title="Delete"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      {open && (
        <div className="border-t border-gray-100 bg-gray-50/60">
          {deliveries === null ? (
            <p className="px-4 py-3 text-[12.5px] text-gray-400">Loading…</p>
          ) : deliveries.length === 0 ? (
            <p className="px-4 py-3 text-[12.5px] text-gray-500">
              Nothing delivered yet. Send a test to check your endpoint.
            </p>
          ) : (
            deliveries.map((d, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-center gap-3 px-4 py-2 text-[12.5px]",
                  i > 0 && "border-t border-gray-100"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full shrink-0",
                    d.delivered ? "bg-emerald-500" : "bg-red-500"
                  )}
                />
                <span className="font-mono text-gray-600 w-28 shrink-0">{d.event}</span>
                <span className="text-gray-500 tabular-nums w-12 shrink-0">
                  {d.status_code ?? "—"}
                </span>
                <span className="text-gray-400 shrink-0">
                  {d.attempts} {d.attempts === 1 ? "try" : "tries"}
                </span>
                <span className="text-gray-500 truncate flex-1">
                  {d.delivered ? "delivered" : d.error ?? "failed"}
                </span>
                <span className="text-gray-400 shrink-0 hidden sm:block">
                  {new Date(d.created_at).toLocaleString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
