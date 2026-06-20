import { cn, formatPercent } from "@/lib/utils";
import type { StepInfo } from "@/lib/api";
import { Check, X, Loader2, Circle } from "lucide-react";

const stepConfig = {
  passed:  { icon: Check,   cls: "text-emerald-700 bg-emerald-50 border-emerald-300" },
  failed:  { icon: X,       cls: "text-red-700 bg-red-50 border-red-300" },
  active:  { icon: Loader2, cls: "text-amber-700 bg-amber-50 border-amber-300" },
  pending: { icon: Circle,  cls: "text-gray-400 bg-gray-50 border-gray-200" },
};

export default function StepTimeline({ steps }: { steps: StepInfo[] }) {
  return (
    <div className="relative space-y-0">
      {steps.map((step, i) => {
        const cfg = stepConfig[step.status] ?? stepConfig.pending;
        const Icon = cfg.icon;
        const isLast = i === steps.length - 1;
        const spinClass = step.status === "active" ? "animate-spin" : "";

        return (
          <div key={step.step_number} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn("flex h-6 w-6 shrink-0 items-center justify-center rounded border", cfg.cls)}>
                <Icon className={cn("h-3 w-3", spinClass)} strokeWidth={2} />
              </div>
              {!isLast && <div className="w-px flex-1 bg-gray-200 mt-1 mb-1" />}
            </div>
            <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[13px] font-semibold text-gray-900">
                  Step {step.step_number} — {formatPercent(step.target_weight)}
                </span>
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  step.status === "passed" && "text-emerald-600",
                  step.status === "failed" && "text-red-600",
                  step.status === "active" && "text-amber-600",
                  step.status === "pending" && "text-gray-400",
                )}>{step.status}</span>
              </div>
              <p className="mt-1 text-[11px] text-gray-400 font-mono">{step.gate_expression}</p>
              {step.pause_duration_seconds && (
                <p className="mt-0.5 text-[11px] text-gray-400">Hold: {step.pause_duration_seconds}s</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
