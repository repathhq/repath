"use client";

import { cn, formatRelative, formatPercent } from "@/lib/utils";
import type { DecisionInfo } from "@/lib/api";
import { ArrowUp, ArrowDown, Check, PauseCircle, PlayCircle } from "lucide-react";

const actionConfig = {
  advance:  { icon: ArrowUp,     color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  promote:  { icon: Check,       color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  rollback: { icon: ArrowDown,   color: "text-red-700",     bg: "bg-red-50 border-red-200" },
  pause:    { icon: PauseCircle, color: "text-gray-500",    bg: "bg-gray-100 border-gray-200" },
  resume:   { icon: PlayCircle,  color: "text-blue-700",    bg: "bg-blue-50 border-blue-200" },
};

export default function DecisionFeed({ decisions }: { decisions: DecisionInfo[] }) {
  if (decisions.length === 0) {
    return <p className="py-6 text-center text-[13px] text-gray-400">No decisions yet</p>;
  }

  return (
    <div className="space-y-1">
      {decisions.map((d) => {
        const cfg = actionConfig[d.action] ?? actionConfig.advance;
        const Icon = cfg.icon;
        const weightChange = d.previous_weight != null && d.new_weight != null
          ? `${formatPercent(d.previous_weight)} → ${formatPercent(d.new_weight)}` : null;

        return (
          <div key={d.id} className={cn(
            "flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors",
            d.action === "rollback" ? "bg-red-50" : "hover:bg-gray-50"
          )}>
            <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border", cfg.bg)}>
              <Icon className={cn("h-[13px] w-[13px]", cfg.color)} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[11px] font-bold uppercase tracking-wide", cfg.color)}>{d.action}</span>
                {weightChange && <span className="text-[11px] text-gray-400 font-mono">{weightChange}</span>}
                <span className="ml-auto text-[10px] text-gray-400 shrink-0">{formatRelative(d.created_at)}</span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-gray-500 line-clamp-2">{d.reason}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
