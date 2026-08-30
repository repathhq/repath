"use client";

/**
 * The requests behind a controller decision.
 *
 * This is the page no observability tool can build, because none of them make
 * the decision. A rollback reason reads "quality 0.68 < 0.70" — a claim.
 * This is the evidence: the responses from the controller's metric window,
 * worst-scoring first, each with the judge's reasoning one click away.
 *
 * Sorted by score rather than time on purpose. Newest-first would bury the
 * answers that caused the rollback under whatever happened to arrive last,
 * which is the opposite of what someone opening this page wants.
 */

import { use, useCallback, useState } from "react";
import DashShell from "@/components/DashShell";
import Link from "next/link";
import { api, type LogRow } from "@/lib/api";
import { useResource } from "@/lib/hooks";
import { AlertTriangle, ArrowLeft, ChevronRight, Loader2 } from "lucide-react";

function formatCost(micro: number | null): string {
  if (micro === null || micro === undefined) return "—";
  const usd = micro / 1_000_000;
  return usd < 0.01 ? `$${usd.toFixed(5)}` : `$${usd.toFixed(4)}`;
}

function scoreColor(score: number | null, judged: boolean): string {
  if (score === null) return "text-gray-400";
  if (!judged) return "text-gray-500";
  if (score >= 0.9) return "text-emerald-600";
  if (score < 0.7) return "text-red-600";
  return "text-amber-600";
}

/** Controller action → the badge tone the rest of the app already uses. */
const ACTION_TONE_KEY: Record<string, string> = {
  rollback: "rolled_back",
  advance: "promoted",
  promote: "promoted",
  pause: "paused",
  resume: "shadow",
};

export default function DecisionRequestsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const fetcher = useCallback(() => api.logs.forDecision(id), [id]);
  const { data, loading, error } = useResource(fetcher);
  const [selected, setSelected] = useState<string | null>(null);

  const rows: LogRow[] = data?.requests ?? [];
  const judged = rows.filter((r) => r.evaluator_type === "llm_judge");
  const worst = judged.filter((r) => (r.score ?? 1) < 0.7);

  return (
    <DashShell
      title="Evidence"
      back="/logs"
      badge={data ? { label: data.decision.action, tone: ACTION_TONE_KEY[data.decision.action] ?? "paused" } : undefined}
    >

      <div className="p-6">
        {loading && (
          <div className="flex items-center gap-2 py-12 text-[13px] text-gray-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" strokeWidth={1.8} />
            <p className="text-[13px] text-red-700">{error.message}</p>
          </div>
        )}

        {data && (
          <>
            <div className="mb-5 rounded-xl border border-gray-200 bg-gray-50/60 p-4">
              <p className="text-[13.5px] leading-relaxed text-gray-700">
                The controller looked at the {data.window_minutes} minutes before{" "}
                {new Date(data.decision.created_at).toLocaleString()} and decided to{" "}
                <span className="font-semibold">{data.decision.action}</span>.
                {worst.length > 0 && (
                  <>
                    {" "}
                    <span className="font-semibold text-red-700">
                      {worst.length} of {judged.length} judged
                    </span>{" "}
                    response{worst.length === 1 ? "" : "s"} scored below 0.70.
                  </>
                )}
              </p>
              <p className="mt-2 text-[11.5px] leading-relaxed text-gray-400">{data.note}</p>
            </div>

            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-12 text-center">
                <p className="text-[13.5px] text-gray-500">
                  No requests found in that window.
                </p>
                <p className="mt-1 text-[12.5px] text-gray-400">
                  They may have passed this plan&rsquo;s retention window, or payload capture was
                  off when this decision was made.
                </p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-gray-200 text-left font-mono text-[10px] uppercase tracking-wider text-gray-400">
                      <th className="px-4 py-2.5 text-right font-normal">Score</th>
                      <th className="px-4 py-2.5 font-normal">Side</th>
                      <th className="px-4 py-2.5 font-normal">Model</th>
                      <th className="px-4 py-2.5 text-right font-normal">Latency</th>
                      <th className="px-4 py-2.5 text-right font-normal">Cost</th>
                      <th className="px-4 py-2.5 text-right font-normal">Status</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const isJudged = r.evaluator_type === "llm_judge";
                      const below = isJudged && (r.score ?? 1) < 0.7;
                      return (
                        <tr
                          key={r.id}
                          onClick={() => setSelected(r.id)}
                          className={`cursor-pointer border-b border-gray-100 transition-colors last:border-0 ${
                            below ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-gray-50"
                          }`}
                        >
                          <td className="px-4 py-2.5 text-right">
                            <span className={`font-mono text-[12.5px] ${scoreColor(r.score, isJudged)}`}>
                              {r.score === null ? "—" : r.score.toFixed(3)}
                            </span>
                            {r.score !== null && !isJudged && (
                              <span
                                className="ml-1 font-mono text-[10px] text-gray-400"
                                title="Health check, not a quality measurement"
                              >
                                check
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5">
                            {r.role && (
                              <span
                                className={`rounded px-1.5 py-0.5 font-mono text-[10.5px] ${
                                  r.role === "candidate"
                                    ? "bg-violet-50 text-violet-700"
                                    : "bg-gray-100 text-gray-600"
                                }`}
                              >
                                {r.role}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 font-mono text-[12px] text-gray-700">
                            {r.model}
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
            )}

            {selected && (
              <p className="mt-4 text-[12.5px] text-gray-500">
                <Link href={`/logs?highlight=${selected}`} className="text-violet-600 hover:underline">
                  Open this request in the full log →
                </Link>
              </p>
            )}
          </>
        )}
      </div>
    </DashShell>
  );
}
