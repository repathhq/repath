"use client";

import Link from "next/link";
import { useRollouts, useSystemHealth } from "@/lib/hooks";
import StateBadge from "@/components/StateBadge";
import { cn, formatRelative, formatScore } from "@/lib/utils";
import { AlertCircle, ChevronRight, GitBranch, RefreshCw } from "lucide-react";

export default function RolloutsPage() {
  const { data, loading, error, refresh } = useRollouts();
  const { data: health } = useSystemHealth();

  return (
    <div>
      {/* Page header — sticky */}
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 h-14 flex items-center justify-between sticky top-0 z-20">
        <div>
          <h1 className="text-[16px] font-semibold text-gray-900">Rollouts</h1>
        </div>
        <div className="flex items-center gap-2.5">
          {health && (
            <div className="flex items-center gap-1.5 text-[12px] text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
              <span className={cn("h-1.5 w-1.5 rounded-full",
                health.status === "ok" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
              )} />
              {health.active_rollouts} active
            </div>
          )}
          <button
            onClick={refresh}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12.5px] text-gray-600 hover:text-gray-900 hover:border-gray-300 transition-all shadow-sm"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            Refresh
          </button>
        </div>
      </div>
      <div className="p-6 sm:p-8 max-w-[1100px] mx-auto">

      {/* Error state */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-semibold text-red-700">Cannot reach gateway</p>
              <p className="text-[12px] text-red-600 mt-0.5">
                Make sure <code className="font-mono bg-red-100 px-1 rounded">NEXT_PUBLIC_API_URL</code> and <code className="font-mono bg-red-100 px-1 rounded">REPATH_API_TOKEN</code> are set.
              </p>
              {error.message && <p className="text-[11px] text-red-400 mt-1 font-mono">{error.message}</p>}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && (!data?.rollouts?.length) && (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 py-20 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white border border-gray-200 shadow-sm">
            <GitBranch className="h-5 w-5 text-gray-400" strokeWidth={1.8} />
          </div>
          <h2 className="mb-2 text-[15px] font-semibold text-gray-900">No rollouts yet</h2>
          <p className="mb-6 max-w-[360px] text-[13px] text-gray-500">
            Point your app at Repath, then create a rollout to progressively deploy AI changes with automatic quality gates.
          </p>
          <a href="/onboarding" className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 text-[13px] font-medium transition-all shadow-sm">
            View setup guide
          </a>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[68px] rounded-xl border border-gray-100 bg-gray-50 animate-pulse" />
          ))}
        </div>
      )}

      {/* Rollout list */}
      {!loading && data?.rollouts && data.rollouts.length > 0 && (
        <div className="space-y-2">
          {data.rollouts.map((r) => (
            <Link
              key={r.id}
              href={`/rollouts/${r.id}`}
              className="group flex items-center gap-4 rounded-xl border border-gray-200 bg-white p-4 hover:border-violet-200 hover:shadow-sm transition-all duration-150 cursor-pointer shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2.5 mb-1.5">
                  <StateBadge state={r.state} />
                  <span className="text-[14px] font-semibold text-gray-900 truncate">{r.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[12px] text-gray-400">
                  <span className="font-mono text-blue-600">{r.baseline_model}</span>
                  <span className="text-gray-300">→</span>
                  <span className="font-mono text-amber-600">{r.candidate_model}</span>
                </div>
              </div>

              {/* Traffic mini-bar */}
              <div className="w-[72px] shrink-0">
                <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div className="bg-blue-200 transition-all duration-700" style={{ flex: (1 - r.current_weight) }} />
                  <div className="bg-amber-300 transition-all duration-700" style={{ flex: r.current_weight }} />
                </div>
              </div>

              {/* Quality scores */}
              <div className="hidden md:flex gap-1.5 text-[12px] font-mono min-w-[90px] items-center">
                <span className="text-blue-600">{formatScore(r.avg_quality_baseline)}</span>
                <span className="text-gray-300">→</span>
                <span className="text-amber-600">{formatScore(r.avg_quality_candidate)}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[12px] text-gray-400">{formatRelative(r.created_at)}</span>
                <ChevronRight className="h-[16px] w-[16px] text-gray-300 group-hover:text-gray-500 transition-colors" strokeWidth={2} />
              </div>
            </Link>
          ))}
        </div>
      )}

      {data && (data.rollouts?.length ?? 0) > 0 && (
        <p className="mt-5 text-center text-[11px] text-gray-400">
          {data.total} rollout{data.total !== 1 ? "s" : ""} total
        </p>
      )}
      </div>
    </div>
  );
}
