"use client";

/**
 * Request log.
 *
 * Every judged request, with the prompt, the response, and — the part that
 * matters — the judge's per-criterion reasoning. That reasoning has been
 * written to `evaluations.metadata` since the first release and never shown
 * anywhere, so a customer could see a candidate scored 0.68 and had no way to
 * find out which answers were bad or why.
 *
 * The list is deliberately biased toward finding problems rather than
 * browsing traffic: the default sort is newest-first, but the filters that
 * matter are "worst scores" and "errors", because nobody opens a log when
 * things are fine.
 */

import { useCallback, useState } from "react";
import Link from "next/link";
import { api, type LogRow, type RequestDetail, type LogFilters } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import DashShell from "@/components/DashShell";
import { AlertTriangle, ChevronRight, Filter, Loader2, Search, X } from "lucide-react";

// ── Formatting ───────────────────────────────────────────────────────────

/** Cost in micro-dollars → a readable string, or "—" when unpriced. */
function formatCost(micro: number | null): string {
  // Not "$0.00": a model we have no price for is unknown, not free.
  if (micro === null || micro === undefined) return "—";
  const usd = micro / 1_000_000;
  if (usd === 0) return "$0";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  return `$${usd.toFixed(4)}`;
}

function formatScore(score: number | null): string {
  return score === null || score === undefined ? "—" : score.toFixed(3);
}

function relativeTime(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function scoreColor(score: number | null, judged: boolean): string {
  if (score === null) return "text-gray-400";
  // An unjudged score is a health check, not a quality measurement. Colouring
  // it green would repeat the mistake that let a dead judge look like a
  // perfect candidate.
  if (!judged) return "text-gray-500";
  if (score >= 0.9) return "text-emerald-600";
  if (score < 0.7) return "text-red-600";
  return "text-amber-600";
}

// ── Detail panel ─────────────────────────────────────────────────────────

/** Pull the judge's per-criterion reasoning out of `evaluations.metadata`. */
function criteriaFrom(meta: Record<string, unknown> | null): Array<{
  name: string;
  score: number;
  reason: string;
  weight?: number;
}> {
  if (!meta) return [];
  const raw = (meta as { criteria?: unknown }).criteria;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((c) => {
    if (typeof c !== "object" || c === null) return [];
    const o = c as Record<string, unknown>;
    if (typeof o.name !== "string") return [];
    return [
      {
        name: o.name,
        score: typeof o.score === "number" ? o.score : 0,
        reason: typeof o.reason === "string" ? o.reason : "",
        weight: typeof o.weight === "number" ? o.weight : undefined,
      },
    ];
  });
}

/** Render a stored request body readably, falling back to the raw string. */
function prettyBody(body: string | null): string {
  if (!body) return "";
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    // Not JSON — a provider or SDK we do not parse. Showing it raw beats
    // showing nothing.
    return body;
  }
}

function DetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading, error } = useResource<RequestDetail>(
    useCallback(() => api.logs.get(id), [id])
  );

  return (
    <aside
      className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[720px] flex-col border-l border-gray-200 bg-white shadow-2xl"
      role="dialog"
      aria-label="Request detail"
    >
      <header className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-[14px] font-semibold text-gray-900">Request</span>
          <code className="truncate font-mono text-[11.5px] text-gray-400">{id}</code>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
        >
          <X className="h-4 w-4" strokeWidth={2} />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && (
          <div className="flex items-center gap-2 py-10 text-[13px] text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
            {error.message}
          </div>
        )}

        {data && (
          <div className="flex flex-col gap-6">
            {/* Facts */}
            <div className="grid grid-cols-3 gap-x-6 gap-y-4 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <Fact label="Model" value={data.model} mono />
              <Fact label="Provider" value={data.provider ?? "—"} mono />
              <Fact
                label="Status"
                value={String(data.status_code)}
                mono
                tone={data.status_code >= 400 ? "bad" : undefined}
              />
              <Fact label="Latency" value={`${data.latency_ms} ms`} mono />
              <Fact
                label="Tokens"
                value={
                  data.input_tokens !== null || data.output_tokens !== null
                    ? `${data.input_tokens ?? "?"} → ${data.output_tokens ?? "?"}`
                    : "—"
                }
                mono
              />
              <Fact label="Cost" value={formatCost(data.cost_micro_usd)} mono />
              {data.rollout_name && (
                <Fact
                  label="Rollout"
                  value={data.rollout_name}
                  href={data.rollout_id ? `/rollouts/${data.rollout_id}` : undefined}
                />
              )}
              {data.role && <Fact label="Side" value={data.role} mono />}
              {data.session_id && <Fact label="Session" value={data.session_id} mono />}
            </div>

            {data.error && (
              <Section title="Error">
                <pre className="whitespace-pre-wrap rounded-lg border border-red-200 bg-red-50 p-3 font-mono text-[12px] text-red-800">
                  {data.error}
                </pre>
              </Section>
            )}

            {/* The judge's reasoning — the reason this page exists. */}
            {data.evaluations.map((ev, i) => {
              const criteria = criteriaFrom(ev.metadata);
              const judged = ev.evaluator_type === "llm_judge";
              return (
                <Section
                  key={i}
                  title={judged ? "Judge evaluation" : "Programmatic checks"}
                  aside={
                    <span className={`font-mono text-[13px] ${scoreColor(ev.overall_score, judged)}`}>
                      {ev.overall_score.toFixed(3)}
                    </span>
                  }
                >
                  {!judged && (
                    <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] leading-relaxed text-amber-800">
                      These are health checks — non-empty, no error, not a refusal. They score
                      about 1.0 for any working response and cannot tell a better answer from a
                      worse one. Only a judge evaluation measures quality.
                    </p>
                  )}
                  {criteria.length > 0 ? (
                    <div className="flex flex-col gap-2.5">
                      {criteria.map((c) => (
                        <div
                          key={c.name}
                          className="rounded-lg border border-gray-200 bg-white px-3.5 py-3"
                        >
                          <div className="mb-1 flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-medium capitalize text-gray-900">
                              {c.name}
                              {c.weight !== undefined && (
                                <span className="ml-1.5 font-mono text-[11px] text-gray-400">
                                  ×{c.weight}
                                </span>
                              )}
                            </span>
                            <span className={`font-mono text-[12.5px] ${scoreColor(c.score, true)}`}>
                              {c.score.toFixed(2)}
                            </span>
                          </div>
                          {c.reason && (
                            <p className="text-[12.5px] leading-relaxed text-gray-600">{c.reason}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <pre className="overflow-x-auto rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[11.5px] text-gray-600">
                      {JSON.stringify(ev.scores, null, 2)}
                    </pre>
                  )}
                </Section>
              );
            })}

            {data.system_prompt && (
              <Section title="System prompt">
                <pre className="whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[12px] leading-relaxed text-gray-700">
                  {data.system_prompt}
                </pre>
              </Section>
            )}

            <Section
              title="Request"
              aside={
                data.truncated ? (
                  <span className="font-mono text-[11px] text-amber-600">truncated</span>
                ) : undefined
              }
            >
              {data.request_body ? (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[12px] leading-relaxed text-gray-700">
                  {prettyBody(data.request_body)}
                </pre>
              ) : (
                <NoPayload expiresAt={data.payload_expires_at} />
              )}
            </Section>

            <Section title="Response">
              {data.response_text ? (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-[12px] leading-relaxed text-gray-700">
                  {data.response_text}
                </pre>
              ) : (
                <NoPayload expiresAt={data.payload_expires_at} />
              )}
            </Section>

            {data.payload_expires_at && (
              <p className="text-[11.5px] text-gray-400">
                Prompt and response are deleted{" "}
                {new Date(data.payload_expires_at).toLocaleDateString()}, per your plan&rsquo;s
                retention window.
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function NoPayload({ expiresAt }: { expiresAt: string | null }) {
  return (
    <p className="rounded-lg border border-dashed border-gray-200 px-3 py-4 text-center text-[12.5px] text-gray-400">
      {expiresAt
        ? "Deleted — past this plan's retention window."
        : "Not stored. Turn on payload capture in Settings → Gateway to see prompts and responses here."}
    </p>
  );
}

function Fact({
  label,
  value,
  mono,
  href,
  tone,
}: {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
  tone?: "bad";
}) {
  const body = (
    <span
      className={`${mono ? "font-mono" : ""} text-[13px] ${
        tone === "bad" ? "text-red-600" : "text-gray-900"
      } ${href ? "hover:underline" : ""}`}
    >
      {value}
    </span>
  );
  return (
    <div className="min-w-0">
      <div className="mb-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-400">
        {label}
      </div>
      <div className="truncate">{href ? <Link href={href}>{body}</Link> : body}</div>
    </div>
  );
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-[13px] font-semibold text-gray-900">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function LogsPage() {
  const [filters, setFilters] = useState<LogFilters>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const fetcher = useCallback(() => api.logs.list(filters), [filters]);
  const { data, loading, error, refresh } = useResource(fetcher);

  const rows: LogRow[] = data?.requests ?? [];
  const activeFilters = Object.values(filters).filter(
    (v) => v !== undefined && v !== ""
  ).length;

  const setFilter = (patch: Partial<LogFilters>) =>
    setFilters((f) => ({ ...f, ...patch }));

  return (
    <DashShell
      title="Requests"
      onRefresh={refresh}
      actions={
        <button className="dash-btn" onClick={() => setShowFilters((v) => !v)}>
          <Filter size={13} strokeWidth={1.8} />
          Filters
          {activeFilters > 0 && (
            <span
              className="dash-mono"
              style={{
                borderRadius: 999,
                background: "var(--accent-soft)",
                color: "var(--accent)",
                padding: "0 5px",
                fontSize: 10,
              }}
            >
              {activeFilters}
            </span>
          )}
        </button>
      }
    >

      {showFilters && (
        <div className="flex flex-wrap items-end gap-3 border-b border-gray-200 bg-gray-50/60 px-6 py-4">
          {/* The two that matter most, first: nobody opens a log when things
              are fine. */}
          <button
            onClick={() => setFilter({ max_score: filters.max_score ? undefined : 0.7 })}
            className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
              filters.max_score
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            }`}
          >
            Scored below 0.70
          </button>
          <button
            onClick={() => setFilter({ status: filters.status ? undefined : "error" })}
            className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
              filters.status
                ? "border-red-300 bg-red-50 text-red-700"
                : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            }`}
          >
            Errors only
          </button>
          <button
            onClick={() =>
              setFilter({ evaluator: filters.evaluator ? undefined : "llm_judge" })
            }
            className={`rounded-lg border px-3 py-1.5 text-[12px] transition-colors ${
              filters.evaluator
                ? "border-violet-300 bg-violet-50 text-violet-700"
                : "border-gray-200 bg-white text-gray-600 hover:text-gray-900"
            }`}
          >
            Judged only
          </button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              placeholder="model"
              value={filters.model ?? ""}
              onChange={(e) => setFilter({ model: e.target.value || undefined })}
              className="w-40 rounded-lg border border-gray-200 py-1.5 pl-8 pr-3 text-[12px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          {activeFilters > 0 && (
            <button
              onClick={() => setFilters({})}
              className="text-[12px] text-gray-500 underline hover:text-gray-900"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <div className="p-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={1.8} />
            <p className="text-[13px] text-red-700">{error.message}</p>
          </div>
        )}

        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-gray-200 text-left font-mono text-[10px] uppercase tracking-wider text-gray-400">
                <th className="px-4 py-2.5 font-normal">When</th>
                <th className="px-4 py-2.5 font-normal">Model</th>
                <th className="px-4 py-2.5 font-normal">Side</th>
                <th className="px-4 py-2.5 text-right font-normal">Score</th>
                <th className="px-4 py-2.5 text-right font-normal">Latency</th>
                <th className="px-4 py-2.5 text-right font-normal">Cost</th>
                <th className="px-4 py-2.5 text-right font-normal">Status</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-gray-400">
                    <Loader2 className="mx-auto h-4 w-4 animate-spin" />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center">
                    <p className="text-[13.5px] text-gray-500">No requests yet.</p>
                    <p className="mt-1 text-[12.5px] text-gray-400">
                      Send traffic through the gateway and every judged response appears here.
                    </p>
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const judged = r.evaluator_type === "llm_judge";
                return (
                  <tr
                    key={r.id}
                    onClick={() => setSelected(r.id)}
                    className="cursor-pointer border-b border-gray-100 transition-colors last:border-0 hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-500">
                      {relativeTime(r.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-[12px] text-gray-900">{r.model}</span>
                      {r.provider && (
                        <span className="ml-1.5 font-mono text-[11px] text-gray-400">
                          {r.provider}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {r.role ? (
                        <span
                          className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${
                            r.role === "candidate"
                              ? "bg-violet-50 text-violet-700"
                              : "bg-gray-100 text-gray-600"
                          }`}
                        >
                          {r.role}
                        </span>
                      ) : (
                        <span className="font-mono text-[11px] text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span className={`font-mono text-[12px] ${scoreColor(r.score, judged)}`}>
                        {formatScore(r.score)}
                      </span>
                      {r.score !== null && !judged && (
                        // Say so inline. A programmatic 1.000 sitting in a
                        // score column is exactly what made a dead judge look
                        // like a flawless candidate.
                        <span
                          className="ml-1 font-mono text-[10px] text-gray-400"
                          title="Health check, not a quality measurement"
                        >
                          check
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-gray-600">
                      {r.latency_ms}ms
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-[12px] text-gray-600">
                      {formatCost(r.cost_micro_usd)}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`font-mono text-[12px] ${
                          r.status_code >= 400 ? "text-red-600" : "text-gray-500"
                        }`}
                      >
                        {r.status_code}
                      </span>
                    </td>
                    <td className="pr-3 text-right">
                      <ChevronRight className="h-3.5 w-3.5 text-gray-300" strokeWidth={2} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {data?.has_more && (
          <div className="mt-4 text-center">
            <button
              onClick={() => setFilter({ before: data.next_before ?? undefined })}
              className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-[13px] text-gray-600 transition-all hover:text-gray-900"
            >
              Load older
            </button>
          </div>
        )}
      </div>

      {selected && <DetailPanel id={selected} onClose={() => setSelected(null)} />}
    </DashShell>
  );
}
