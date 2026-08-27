"use client";

/**
 * Model routing.
 *
 * Rules decide which model serves a request, before any rollout applies. They
 * are ordered and overlapping, so the two things this page has to make obvious
 * are *which rule wins* and *why* — hence the explicit priority column and the
 * built-in tester, rather than a plain list you have to reason about.
 */

import { useState } from "react";
import Link from "next/link";
import {
  api,
  type RoutingRule,
  type RuleCondition,
  type RuleField,
  type RuleOperator,
  type RuleTestResult,
} from "@/lib/api";
import {
  AlertCircle, ArrowRight, Beaker, Check, ChevronDown, Loader2,
  Plus, Power, Trash2, Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useResource } from "@/lib/hooks";

const MODELS = [
  { provider: "openai", model: "gpt-4o" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
  { provider: "anthropic", model: "claude-3-5-haiku-20241022" },
  { provider: "gemini", model: "gemini-1.5-pro" },
  { provider: "openrouter", model: "auto" },
];

/** Field labels written for the person, not the schema. */
const FIELDS: { value: RuleField; label: string; hint: string }[] = [
  { value: "input_tokens", label: "Prompt size", hint: "Estimated tokens in the request" },
  { value: "model", label: "Requested model", hint: "The model the client asked for" },
  { value: "content", label: "Message text", hint: "The combined message content" },
  { value: "path", label: "Endpoint", hint: "e.g. /v1/chat/completions" },
  { value: "header", label: "Request header", hint: "Route on your own metadata" },
];

const NUMERIC_OPS: { value: RuleOperator; label: string }[] = [
  { value: "lt", label: "is under" },
  { value: "lte", label: "is at most" },
  { value: "gt", label: "is over" },
  { value: "gte", label: "is at least" },
];

const TEXT_OPS: { value: RuleOperator; label: string }[] = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "starts_with", label: "starts with" },
  { value: "exists", label: "is present" },
];

const opsFor = (field: RuleField) => (field === "input_tokens" ? NUMERIC_OPS : TEXT_OPS);

const input =
  "w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all bg-white";
const label = "block text-[12px] font-medium text-gray-600 mb-1.5";

function describe(rule: RoutingRule): string {
  const f = FIELDS.find((x) => x.value === rule.condition.field)?.label ?? rule.condition.field;
  const o =
    opsFor(rule.condition.field).find((x) => x.value === rule.condition.op)?.label ??
    rule.condition.op;
  const subject = rule.condition.field === "header" ? `Header "${rule.condition.header}"` : f;
  const value = rule.condition.op === "exists" ? "" : ` ${rule.condition.value}`;
  return `${subject} ${o}${value}`;
}

export default function RoutingPage() {
  const { data, loading, error: loadError, refresh: load } = useResource(() =>
    api.routing.list()
  );
  const rules: RoutingRule[] = data?.rules ?? [];

  const [actionError, setActionError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const error = actionError ?? loadError?.message ?? null;
  const setError = setActionError;

  async function toggle(rule: RoutingRule) {
    setBusy(rule.id);
    try {
      await api.routing.update(rule.id, {
        name: rule.name,
        priority: rule.priority,
        enabled: !rule.enabled,
        condition: rule.condition,
        action: rule.action,
      });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update the rule.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(rule: RoutingRule) {
    setBusy(rule.id);
    try {
      await api.routing.remove(rule.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the rule.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 h-14 flex items-center justify-between sticky top-0 z-20">
        <h1 className="text-[16px] font-semibold text-gray-900">Model routing</h1>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="flex items-center gap-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 px-3 py-1.5 text-[12.5px] font-medium text-white transition-all shadow-sm"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          New rule
        </button>
      </div>

      <div className="p-6 sm:p-8 max-w-[1000px] mx-auto flex flex-col gap-6">
        <p className="text-[13.5px] text-gray-500 max-w-[65ch]">
          Rules decide which model serves a request. They are checked top to bottom and the first
          match wins. A request matched here skips your rollouts — so use rules for routing
          decisions, and <Link href="/rollouts" className="text-violet-600 hover:underline">rollouts</Link>{" "}
          for testing whether a change is better.
        </p>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        {showForm && (
          <RuleForm
            onCancel={() => setShowForm(false)}
            onSaved={async () => {
              setShowForm(false);
              await load();
            }}
          />
        )}

        {loading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => (
              <div key={i} className="h-[76px] rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-16 text-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-gray-200 shadow-sm">
              <Zap className="h-5 w-5 text-gray-400" strokeWidth={1.8} />
            </div>
            <h2 className="mb-2 text-[15px] font-semibold text-gray-900">No routing rules</h2>
            <p className="mb-6 max-w-[420px] text-[13px] text-gray-500">
              Every request goes to whichever model your client asks for. Add a rule to send short
              prompts to a cheaper model, or route by customer tier.
            </p>
            <button
              onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 text-[13px] font-medium transition-all shadow-sm"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Create your first rule
            </button>
          </div>
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
            {rules.map((rule, i) => (
              <div
                key={rule.id}
                className={cn(
                  "flex items-center gap-4 px-5 py-4",
                  i > 0 && "border-t border-gray-100",
                  !rule.enabled && "bg-gray-50/60"
                )}
              >
                <div className="w-10 shrink-0 text-center">
                  <div className="text-[11px] font-mono text-gray-400">#{rule.priority}</div>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "text-[14px] font-semibold truncate",
                        rule.enabled ? "text-gray-900" : "text-gray-400"
                      )}
                    >
                      {rule.name}
                    </span>
                    {!rule.enabled && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                        Off
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[12.5px] text-gray-500">
                    <span className="truncate">{describe(rule)}</span>
                    <ArrowRight className="h-3 w-3 shrink-0 text-gray-300" strokeWidth={2} />
                    <span className="font-mono text-[12px] text-violet-600 truncate">
                      {rule.action.model}
                    </span>
                  </div>
                </div>

                <div className="hidden sm:block text-right shrink-0">
                  <div className="text-[13px] font-semibold text-gray-700 tabular-nums">
                    {rule.match_count.toLocaleString()}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {rule.match_count === 0 ? "never fired" : "matches"}
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => toggle(rule)}
                    disabled={busy === rule.id}
                    title={rule.enabled ? "Disable" : "Enable"}
                    className={cn(
                      "p-2 rounded-lg border transition-colors disabled:opacity-40",
                      rule.enabled
                        ? "border-gray-200 text-emerald-600 hover:bg-gray-50"
                        : "border-gray-200 text-gray-400 hover:bg-gray-50"
                    )}
                  >
                    <Power className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  <button
                    onClick={() => remove(rule)}
                    disabled={busy === rule.id}
                    title="Delete"
                    className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {rules.length > 0 && <RuleTester />}
      </div>
    </div>
  );
}

/* ── Create form ─────────────────────────────────────────────────────────── */

function RuleForm({ onCancel, onSaved }: { onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [priority, setPriority] = useState(100);
  const [field, setField] = useState<RuleField>("input_tokens");
  const [op, setOp] = useState<RuleOperator>("lt");
  const [value, setValue] = useState("500");
  const [header, setHeader] = useState("");
  const [target, setTarget] = useState(MODELS[3]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Operators differ by field, so keep the selection valid when the field changes.
  function changeField(next: RuleField) {
    setField(next);
    const allowed = opsFor(next);
    if (!allowed.some((o) => o.value === op)) setOp(allowed[0].value);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    const condition: RuleCondition = {
      field,
      op,
      value: op === "exists" ? "" : value.trim(),
      ...(field === "header" ? { header: header.trim() } : {}),
    };

    try {
      await api.routing.create({
        name: name.trim(),
        priority,
        enabled: true,
        condition,
        action: { provider: target.provider, model: target.model },
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the rule.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={save}
      className="rounded-xl border border-violet-200 bg-violet-50/40 p-5 sm:p-6 flex flex-col gap-4"
    >
      <h2 className="text-[15px] font-semibold text-gray-900">New routing rule</h2>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
        <div>
          <label className={label}>Rule name</label>
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="cheap-for-short-prompts"
            autoFocus
          />
        </div>
        <div>
          <label className={label}>Priority</label>
          <input
            type="number"
            className={input}
            value={priority}
            onChange={(e) => setPriority(Number(e.target.value))}
            min={0}
            max={10000}
          />
          <p className="text-[11px] text-gray-400 mt-1">Lower runs first</p>
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-3">When</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={label}>Field</label>
            <select className={input} value={field} onChange={(e) => changeField(e.target.value as RuleField)}>
              {FIELDS.map((f) => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Condition</label>
            <select className={input} value={op} onChange={(e) => setOp(e.target.value as RuleOperator)}>
              {opsFor(field).map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>{op === "exists" ? "—" : "Value"}</label>
            <input
              className={input}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              disabled={op === "exists"}
              placeholder={field === "input_tokens" ? "500" : "value"}
            />
          </div>
        </div>

        {field === "header" && (
          <div className="mt-3">
            <label className={label}>Header name</label>
            <input
              className={input}
              value={header}
              onChange={(e) => setHeader(e.target.value)}
              placeholder="X-Customer-Tier"
            />
          </div>
        )}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-[12px] font-semibold uppercase tracking-wider text-gray-400 mb-3">Route to</p>
        <select
          className={input}
          value={`${target.provider}/${target.model}`}
          onChange={(e) => {
            const [provider, ...rest] = e.target.value.split("/");
            setTarget({ provider, model: rest.join("/") });
          }}
        >
          {MODELS.map((m) => (
            <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
              {m.provider} · {m.model}
            </option>
          ))}
        </select>
        <p className="text-[11.5px] text-gray-500 mt-2">
          Routing to a different provider needs that provider&apos;s API key saved in{" "}
          <Link href="/settings" className="text-violet-600 hover:underline">Settings</Link>.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-[13.5px] font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-sm disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
          {saving ? "Creating…" : "Create rule"}
        </button>
        <button type="button" onClick={onCancel} className="px-4 py-2.5 text-[13.5px] text-gray-600 hover:text-gray-900">
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Tester ──────────────────────────────────────────────────────────────── */

/**
 * Dry-run the rule set.
 *
 * Ordered, overlapping rules are genuinely hard to reason about by reading. It
 * is much cheaper to try a sample request here than to discover the ordering
 * was wrong from production traffic.
 */
function RuleTester() {
  const [open, setOpen] = useState(false);
  const [model, setModel] = useState("gpt-4o");
  const [content, setContent] = useState("How do I reset my password?");
  const [result, setResult] = useState<RuleTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setTesting(true);
    setError(null);
    try {
      setResult(await api.routing.test({ model, content }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not run the test.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2.5 px-5 py-4 text-left hover:bg-gray-50 transition-colors"
      >
        <Beaker className="h-4 w-4 text-gray-400" strokeWidth={1.8} />
        <span className="text-[14px] font-semibold text-gray-900">Test your rules</span>
        <span className="text-[12.5px] text-gray-500">See which rule a request would hit</span>
        <ChevronDown
          className={cn("h-4 w-4 text-gray-400 ml-auto transition-transform", open && "rotate-180")}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div className="border-t border-gray-100 p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-3">
            <div>
              <label className={label}>Requested model</label>
              <input className={input} value={model} onChange={(e) => setModel(e.target.value)} />
            </div>
            <div>
              <label className={label}>Message</label>
              <input className={input} value={content} onChange={(e) => setContent(e.target.value)} />
            </div>
          </div>

          <button
            onClick={run}
            disabled={testing}
            className="self-start flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
          >
            {testing && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            Run test
          </button>

          {error && <p className="text-[13px] text-red-600">{error}</p>}

          {result && (
            <div className="flex flex-col gap-3">
              <div
                className={cn(
                  "rounded-lg border px-4 py-3",
                  result.result.matched
                    ? "border-emerald-200 bg-emerald-50"
                    : "border-gray-200 bg-gray-50"
                )}
              >
                {result.result.matched ? (
                  <>
                    <p className="text-[13px] font-semibold text-emerald-800 flex items-center gap-1.5">
                      <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                      Routed by &ldquo;{result.result.rule}&rdquo;
                    </p>
                    <p className="text-[13px] text-emerald-700 mt-1 font-mono">
                      → {result.result.provider} · {result.result.model}
                    </p>
                  </>
                ) : (
                  <p className="text-[13px] text-gray-600">{result.result.explanation}</p>
                )}
                <p className="text-[11.5px] text-gray-500 mt-2">
                  Estimated prompt size: {result.estimated_input_tokens} tokens
                </p>
              </div>

              {result.rules.length > 0 && (
                <div className="rounded-lg border border-gray-200 overflow-hidden">
                  {result.rules.map((r, i) => (
                    <div
                      key={r.name}
                      className={cn(
                        "flex items-center gap-3 px-4 py-2.5 text-[13px]",
                        i > 0 && "border-t border-gray-100"
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          r.matches ? "bg-emerald-500" : "bg-gray-300"
                        )}
                      />
                      <span className="font-mono text-[11px] text-gray-400 w-8">#{r.priority}</span>
                      <span className={cn("flex-1 truncate", r.matches ? "text-gray-900" : "text-gray-400")}>
                        {r.name}
                      </span>
                      <span className={cn("text-[12px]", r.matches ? "text-emerald-600 font-medium" : "text-gray-400")}>
                        {r.matches ? "matches" : "no match"}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
