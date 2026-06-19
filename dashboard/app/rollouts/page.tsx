"use client";

import Link from "next/link";
import { useRollouts, useSystemHealth } from "@/lib/hooks";
import StateBadge from "@/components/StateBadge";
import { cn, formatPercent, formatRelative, formatScore, scoreColor } from "@/lib/utils";
import { AlertCircle, ChevronRight, GitBranch, RefreshCw } from "lucide-react";

export default function RolloutsPage() {
  const { data, loading, error, refresh } = useRollouts();
  const { data: health } = useSystemHealth();

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between border-b border-[--color-border] pb-6">
        <h1 className="text-[24px] font-semibold text-[--color-text]">Rollouts</h1>
        <div className="flex items-center gap-3">
          {health && (
            <div className="flex items-center gap-2 text-[12px] text-[--color-text-secondary]">
              <span className={cn(
                "h-1.5 w-1.5 rounded-full",
                health.status === "ok" ? "bg-[--color-success]" : "bg-[--color-candidate]"
              )} />
              {health.active_rollouts} active
            </div>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-md border border-[--color-border] bg-[--color-surface] px-3 py-1.5 text-[12px] text-[--color-text-secondary] hover:text-[--color-text] hover:border-[--color-border-hover] transition-all duration-150"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            Refresh
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-5 flex items-center gap-3 rounded-lg border border-[--color-danger]/30 bg-[--color-danger]/[0.06] px-4 py-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-[--color-danger]" strokeWidth={1.8} />
          <div className="text-[13px]">
            <span className="font-semibold text-[--color-danger]">Cannot reach gateway</span>
            <span className="ml-1.5 text-[--color-text-secondary]">{error.message}</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && (!data?.rollouts?.length) && (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-[--color-border] bg-[--color-surface] py-20 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[--color-surface-2]">
            <GitBranch className="h-5 w-5 text-[--color-text-muted]" strokeWidth={1.8} />
          </div>
          <h2 className="mb-2 text-[15px] font-semibold text-[--color-text]">No rollouts yet</h2>
          <p className="mb-4 max-w-[320px] text-[13px] text-[--color-text-secondary]">
            Create your first rollout to progressively deploy AI model changes with automatic quality gates.
          </p>
          <code className="rounded-md bg-[--color-surface-2] border border-[--color-border] px-4 py-2 text-[12px] font-mono text-[--color-text-secondary]">
            repath rollout create -f rollout.yaml
          </code>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[64px] rounded-lg border border-[--color-border] bg-[--color-surface] animate-pulse" />
          ))}
        </div>
      )}

      {/* Rollout list */}
      {!loading && data?.rollouts && data.rollouts.length > 0 && (
        <div className="space-y-3">
          {data.rollouts.map((r) => (
            <Link
              key={r.id}
              href={`/rollouts/${r.id}`}
              className="group flex items-center gap-4 rounded-lg border border-[--color-border] bg-[--color-surface] p-4 hover:border-[--color-border-hover] hover:bg-[--color-surface]/80 transition-all duration-150 cursor-pointer"
            >
              {/* State + Info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3 mb-1">
                  <StateBadge state={r.state} />
                  <span className="text-[14px] font-semibold text-[--color-text] truncate">
                    {r.name}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-[--color-text-muted]">
                  <span className="font-mono text-[--color-baseline]">{r.baseline_model}</span>
                  <span>→</span>
                  <span className="font-mono text-[--color-candidate]">{r.candidate_model}</span>
                </div>
              </div>

              {/* Traffic mini-bar */}
              <div className="w-[80px] shrink-0">
                <div className="flex h-[6px] w-full overflow-hidden rounded-full bg-[--color-surface-2]">
                  <div
                    className="bg-[--color-baseline]/50 transition-all duration-700"
                    style={{ flex: (1 - r.current_weight) }}
                  />
                  <div
                    className="bg-[--color-candidate]/50 transition-all duration-700"
                    style={{ flex: r.current_weight }}
                  />
                </div>
              </div>

              {/* Quality scores */}
              <div className="hidden md:flex gap-2 text-[12px] font-mono min-w-[80px]">
                <span className="text-[--color-baseline]">{formatScore(r.avg_quality_baseline)}</span>
                <span className="text-[--color-text-muted]">→</span>
                <span className="text-[--color-candidate]">{formatScore(r.avg_quality_candidate)}</span>
              </div>

              {/* Time + Chevron */}
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[12px] text-[--color-text-muted]">{formatRelative(r.created_at)}</span>
                <ChevronRight className="h-[18px] w-[18px] text-[--color-text-muted] group-hover:text-[--color-text-secondary] transition-colors" strokeWidth={1.8} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Footer */}
      {data && data.rollouts.length > 0 && (
        <p className="mt-4 text-center text-[11px] text-[--color-text-muted]">
          {data.total} rollout{data.total !== 1 ? "s" : ""} total
        </p>
      )}
    </div>
  );
}
