"use client";

import { cn, formatRelative, formatPercent } from "@/lib/utils";
import type { DecisionInfo } from "@/lib/api";
import { ArrowUp, ArrowDown, Check, PauseCircle, PlayCircle } from "lucide-react";

const actionConfig = {
  advance:  { icon: ArrowUp,      color: "text-[--color-success]", bg: "bg-[--color-success]/10" },
  promote:  { icon: Check,        color: "text-[--color-success]", bg: "bg-[--color-success]/10" },
  rollback: { icon: ArrowDown,    color: "text-[--color-danger]",  bg: "bg-[--color-danger]/10" },
  pause:    { icon: PauseCircle,  color: "text-[--color-text-secondary]", bg: "bg-[--color-border]/50" },
  resume:   { icon: PlayCircle,   color: "text-[--color-baseline]", bg: "bg-[--color-baseline]/10" },
};

export default function DecisionFeed({ decisions }: { decisions: DecisionInfo[] }) {
  if (decisions.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-[--color-text-muted]">
        No decisions yet
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {decisions.map((d) => {
        const cfg = actionConfig[d.action] ?? actionConfig.advance;
        const Icon = cfg.icon;
        const weightChange =
          d.previous_weight != null && d.new_weight != null
            ? `${formatPercent(d.previous_weight)} → ${formatPercent(d.new_weight)}`
            : null;

        return (
          <div
            key={d.id}
            className={cn(
              "flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors duration-100",
              d.action === "rollback" ? "bg-[--color-danger]/[0.04]" : "hover:bg-white/[0.02]"
            )}
          >
            <div className={cn("mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded", cfg.bg)}>
              <Icon className={cn("h-[14px] w-[14px]", cfg.color)} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={cn("text-[11px] font-bold uppercase tracking-wide", cfg.color)}>
                  {d.action}
                </span>
                {weightChange && (
                  <span className="text-[11px] text-[--color-text-muted] font-mono">{weightChange}</span>
                )}
                <span className="ml-auto text-[10px] text-[--color-text-muted] shrink-0">
                  {formatRelative(d.created_at)}
                </span>
              </div>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[--color-text-secondary] line-clamp-2">
                {d.reason}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
