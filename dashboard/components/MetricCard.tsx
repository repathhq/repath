import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props {
  label: string;
  baseline: ReactNode;
  candidate: ReactNode;
  className?: string;
}

export default function MetricCard({ label, baseline, candidate, className }: Props) {
  return (
    <div className={cn("rounded-lg border border-[--color-border] bg-[--color-surface] p-4", className)}>
      <p className="mb-3 text-[11px] font-medium uppercase tracking-[0.05em] text-[--color-text-muted]">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-[--color-text-muted] mb-1">Baseline</p>
          <div className="text-[14px] font-mono font-semibold text-[--color-baseline]">{baseline}</div>
        </div>
        <div>
          <p className="text-[11px] text-[--color-text-muted] mb-1">Candidate</p>
          <div className="text-[14px] font-mono font-semibold text-[--color-candidate]">{candidate}</div>
        </div>
      </div>
    </div>
  );
}
