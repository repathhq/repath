"use client";

import { use, useState } from "react";
import Link from "next/link";
import {
  useRollout, useRolloutMetrics, useRolloutSteps, useRolloutDecisions
} from "@/lib/hooks";
import { api } from "@/lib/api";
import StateBadge from "@/components/StateBadge";
import QualityGraph from "@/components/QualityGraph";
import TrafficBar from "@/components/TrafficBar";
import MetricCard from "@/components/MetricCard";
import DecisionFeed from "@/components/DecisionFeed";
import StepTimeline from "@/components/StepTimeline";
import {
  cn, formatPercent, formatScore, formatLatency, formatRelative, scoreColor
} from "@/lib/utils";
import { ArrowLeft, RefreshCw, AlertTriangle, CheckCircle, RotateCcw } from "lucide-react";

export default function RolloutDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const rollout    = useRollout(id);
  const metrics    = useRolloutMetrics(id);
  const steps      = useRolloutSteps(id);
  const decisions  = useRolloutDecisions(id);

  const [actionLoading, setActionLoading] = useState<"promote" | "rollback" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleAction = async (action: "promote" | "rollback") => {
    if (!confirm(`Are you sure you want to ${action} this rollout?`)) return;
    setActionLoading(action);
    setActionError(null);
    try {
      await (action === "promote" ? api.rollouts.promote(id) : api.rollouts.rollback(id));
      rollout.refresh();
      decisions.refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  };

  const r = rollout.data;

  if (rollout.loading) {
    return (
      <div className="p-6 space-y-4 max-w-[1100px] mx-auto">
        <div className="h-8 w-48 rounded-md bg-white animate-pulse" />
        <div className="h-28 rounded-lg bg-white animate-pulse" />
        <div className="h-52 rounded-lg bg-white animate-pulse" />
      </div>
    );
  }

  if (rollout.error || !r) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <AlertTriangle className="h-8 w-8 text-gray-400" strokeWidth={1.5} />
        <p className="text-[13px] text-gray-500">
          {rollout.error?.message ?? "Rollout not found"}
        </p>
        <Link href="/rollouts" className="text-[13px] text-violet-600 hover:underline">
          ← Back to rollouts
        </Link>
      </div>
    );
  }

  const rollbackThreshold = (r.policy as any)?.rollback_threshold ?? 0.7;
  const advanceThreshold = (r.policy as any)?.advance_threshold ?? 0.9;

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between border-b border-gray-200 pb-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.history.back()}
            className="text-gray-400 hover:text-gray-500 transition-colors p-1"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-[24px] font-semibold text-gray-900">{r.name}</h1>
              <StateBadge state={r.state} />
            </div>
            <div className="text-[11px] text-gray-400 font-mono">ID: {r.id}</div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(r.state === "canary" || r.state === "shadow") && (
            <>
              <button
                onClick={() => handleAction("promote")}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[12px] font-medium text-emerald-700 hover:bg-emerald-100 transition-all duration-150 disabled:opacity-40"
              >
                <CheckCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                {actionLoading === "promote" ? "Promoting…" : "Promote"}
              </button>
              <button
                onClick={() => handleAction("rollback")}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-700 hover:bg-red-100 transition-all duration-150 disabled:opacity-40"
              >
                <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.8} />
                {actionLoading === "rollback" ? "Rolling back…" : "Rollback"}
              </button>
            </>
          )}
          <button
            onClick={() => { rollout.refresh(); metrics.refresh(); decisions.refresh(); }}
            className="flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-[12px] text-gray-500 hover:text-gray-900 transition-all duration-150"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} /> Refresh
          </button>
        </div>
      </div>

      {actionError && (
        <p className="text-[12px] text-red-700">{actionError}</p>
      )}

      {/* Rollback alert */}
      {r.state === "rolled_back" && (
        <div className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-red-700 shrink-0" strokeWidth={1.8} />
          <div>
            <p className="text-[13px] font-semibold text-red-700">Rolled back to baseline</p>
            <p className="text-[12px] text-gray-500 mt-0.5">
              Candidate traffic stopped. Check decision history for details.
            </p>
          </div>
        </div>
      )}

      {/* 2-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Traffic Split */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-[14px] font-semibold text-gray-900">Traffic</h2>
              {(r.state === "canary" || r.state === "shadow") && (
                <span className="flex items-center gap-1.5 text-[11px] text-emerald-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-[--color-success] animate-pulse" />
                  Live
                </span>
              )}
            </div>
            <TrafficBar weight={r.current_weight} />
          </section>

          {/* Quality Graph */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-4">Response Quality</h2>
            <QualityGraph
              metrics={metrics.data?.metrics ?? []}
              rollbackThreshold={rollbackThreshold}
              advanceThreshold={advanceThreshold}
            />
          </section>

          {/* Metrics grid */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-4">Metrics</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <MetricCard
                label="Quality Score"
                baseline={
                  <span className={scoreColor(r.avg_quality_baseline)}>
                    {formatScore(r.avg_quality_baseline)}
                  </span>
                }
                candidate={
                  <span className={scoreColor(r.avg_quality_candidate)}>
                    {formatScore(r.avg_quality_candidate)}
                  </span>
                }
              />
              <MetricCard
                label="P95 Latency"
                baseline={formatLatency(r.p95_latency_baseline)}
                candidate={formatLatency(r.p95_latency_candidate)}
              />
              <MetricCard
                label="Samples (10m)"
                baseline={r.sample_count_baseline?.toLocaleString() ?? "—"}
                candidate={r.sample_count_candidate?.toLocaleString() ?? "—"}
              />
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Steps */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-4">Steps</h2>
            {steps.data ? (
              <StepTimeline steps={steps.data.steps} />
            ) : (
              <div className="h-24 animate-pulse rounded-md bg-gray-50" />
            )}
          </section>

          {/* Decisions */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Decisions</h2>
            {decisions.data ? (
              <DecisionFeed decisions={decisions.data.decisions.slice(0, 8)} />
            ) : (
              <div className="h-24 animate-pulse rounded-md bg-gray-50" />
            )}
          </section>

          {/* Versions */}
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <h2 className="text-[14px] font-semibold text-gray-900 mb-3">Versions</h2>
            <div className="space-y-3">
              {[
                { role: "Baseline", model: r.baseline_model, prompt: r.baseline_prompt, color: "text-blue-700" },
                { role: "Candidate", model: r.candidate_model, prompt: r.candidate_prompt, color: "text-amber-700" },
              ].map((v) => (
                <div key={v.role} className="rounded-md bg-gray-50 p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn("text-[11px] font-semibold uppercase tracking-wide", v.color)}>
                      {v.role}
                    </span>
                  </div>
                  <p className="text-[13px] font-semibold text-gray-900">{v.model}</p>
                  {v.prompt && (
                    <p className="mt-1 text-[11px] text-gray-400 font-mono leading-relaxed line-clamp-3">
                      {v.prompt}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
