"use client";

/**
 * Slack notifications.
 *
 * Email is deliberately absent: the delivery side does not exist, so offering
 * the toggle would take a subscription for rollback alerts and drop it.
 *
 * Defaults to the two events that actually need a person — an automatic
 * rollback and a provider outage. Advance and promote are the system working
 * as intended, and subscribing to them by default would train people to ignore
 * the channel.
 */

import { useState } from "react";
import { api, type NotificationSettings } from "@/lib/api";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useResource } from "@/lib/hooks";

const EVENTS = [
  { id: "rollback", label: "Automatic rollback", hint: "Quality dropped and traffic was reverted", recommended: true },
  { id: "provider_outage", label: "Provider outage", hint: "A provider failed and traffic failed over", recommended: true },
  { id: "advance", label: "Traffic advanced", hint: "A rollout moved to its next step", recommended: false },
  { id: "promote", label: "Rollout promoted", hint: "A candidate reached 100%", recommended: false },
];

const input =
  "w-full max-w-sm px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 " +
  "placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white";

export default function Notifications() {
  const { data, error: loadError, refresh: load } = useResource(() =>
    api.notifications.get()
  );

  // The form is editable, so a local draft overlays the server value. Deriving
  // it this way — rather than mirroring `data` into state inside an effect —
  // means there is no render-then-sync cascade and no stale-draft window.
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const settings = draft ?? data;
  const setSettings = setDraft;

  const [slackUrl, setSlackUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const error = actionError ?? loadError?.message ?? null;
  const setError = setActionError;

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      await api.notifications.save({
        // Preserved as-is: the UI no longer edits these, and a save must not
        // silently clear a value the user set before the control was hidden.
        email_enabled: settings.email_enabled,
        email_address: settings.email_address,
        slack_enabled: settings.slack_enabled,
        events: settings.events,
        // Omitted entirely when untouched, so an existing URL is preserved.
        ...(slackUrl.trim() ? { slack_webhook_url: slackUrl.trim() } : {}),
      });
      setSlackUrl("");
      // Drop the draft so the reloaded server value shows through.
      setDraft(null);
      await load();
      setOk(true);
      setTimeout(() => setOk(false), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  if (!settings) {
    return <div className="h-32 rounded-xl bg-gray-50 border border-gray-100 animate-pulse" />;
  }

  const toggleEvent = (id: string, on: boolean) =>
    setSettings((s) =>
      s ? { ...s, events: on ? [...s.events, id] : s.events.filter((e) => e !== id) } : s
    );

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
          <p className="text-[13px] text-red-700">{error}</p>
        </div>
      )}

      <div>
        <h3 className="text-[14px] font-semibold text-gray-900 mb-3">Tell me about</h3>
        <div className="flex flex-col gap-2.5">
          {EVENTS.map((e) => (
            <label key={e.id} className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-violet-600"
                checked={settings.events.includes(e.id)}
                onChange={(ev) => toggleEvent(e.id, ev.target.checked)}
              />
              <span>
                <span className="text-[13.5px] text-gray-800">{e.label}</span>
                {e.recommended && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider font-semibold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded">
                    recommended
                  </span>
                )}
                <span className="block text-[12px] text-gray-500">{e.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* Email delivery is not built yet — dispatch_event only sends webhooks
          and Slack, and there is no SES/SMTP integration anywhere. The control
          is hidden rather than shown-and-disabled because the failure it used
          to produce was the dangerous kind: it accepted the subscription,
          reported success, and then silently never delivered a rollback
          alert. Restore this block in the same commit that adds a sender. */}

      <div>
        <h3 className="text-[14px] font-semibold text-gray-900 mb-3">Slack</h3>
        <label className="flex items-center gap-2.5 cursor-pointer mb-3">
          <input
            type="checkbox"
            className="accent-violet-600"
            checked={settings.slack_enabled}
            onChange={(e) => setSettings({ ...settings, slack_enabled: e.target.checked })}
          />
          <span className="text-[13.5px] text-gray-800">Post to a Slack channel</span>
        </label>
        <input
          className={input}
          placeholder={
            settings.slack_configured
              ? "A URL is saved — enter a new one to replace it"
              : "https://hooks.slack.com/services/…"
          }
          value={slackUrl}
          onChange={(e) => setSlackUrl(e.target.value)}
          disabled={!settings.slack_enabled}
        />
        <p className="text-[11.5px] text-gray-500 mt-1.5">
          Create an incoming webhook in Slack, then paste its URL here. It is stored encrypted.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white text-[13px] font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-sm disabled:opacity-50"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
          Save preferences
        </button>
        {ok && (
          <span className="flex items-center gap-1.5 text-[13px] text-emerald-600">
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Saved
          </span>
        )}
      </div>
    </div>
  );
}
