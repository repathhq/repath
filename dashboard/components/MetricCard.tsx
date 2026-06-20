import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface Props { label: string; baseline: ReactNode; candidate: ReactNode; className?: string; }

export default function MetricCard({ label, baseline, candidate, className }: Props) {
  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white p-4 shadow-sm", className)}>
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">{label}</p>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Baseline</p>
          <div className="text-[14px] font-mono font-semibold text-blue-700">{baseline}</div>
        </div>
        <div>
          <p className="text-[11px] text-gray-400 mb-1">Candidate</p>
          <div className="text-[14px] font-mono font-semibold text-amber-700">{candidate}</div>
        </div>
      </div>
    </div>
  );
}
