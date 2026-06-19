import { cn, formatPercent } from "@/lib/utils";
import type { StepInfo } from "@/lib/api";
import { Check, X, Loader2, Circle } from "lucide-react";

const stepConfig = {
  passed:  { icon: Check,    cls: "text-[--color-success] bg-[--color-success]/10 border-[--color-success]/30" },
  failed:  { icon: X,        cls: "text-[--color-danger] bg-[--color-danger]/10 border-[--color-danger]/30" },
  active:  { icon: Loader2,  cls: "text-[--color-candidate] bg-[--color-candidate]/10 border-[--color-candidate]/30 animate-spin" },
  pending: { icon: Circle,   cls: "text-[--color-text-muted] bg-[--color-surface-2] border-[--color-border]" },
};

export default function StepTimeline({ steps }: { steps: StepInfo[] }) {
  return (
    <div className="relative space-y-0">
      {steps.map((step, i) => {
        const cfg = stepConfig[step.status] ?? stepConfig.pending;
        const Icon = cfg.icon;
        const isLast = i === steps.length - 1;

        return (
          <div key={step.step_number} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded border",
                cfg.cls
              )}>
                <Icon className="h-3 w-3" strokeWidth={2} />
              </div>
              {!isLast && <div className="w-px flex-1 bg-[--color-border] mt-1 mb-1" />}
            </div>

            <div className={cn("flex-1 pb-4", isLast && "pb-0")}>
              <div className="flex items-center gap-2 pt-0.5">
                <span className="text-[13px] font-semibold text-[--color-text]">
                  Step {step.step_number} — {formatPercent(step.target_weight)}
                </span>
                <span className={cn(
                  "text-[10px] font-semibold uppercase tracking-wide",
                  step.status === "passed" && "text-[--color-success]",
                  step.status === "failed" && "text-[--color-danger]",
                  step.status === "active" && "text-[--color-candidate]",
                  step.status === "pending" && "text-[--color-text-muted]",
                )}>
                  {step.status}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-[--color-text-muted] font-mono">{step.gate_expression}</p>
              {step.pause_duration_seconds && (
                <p className="mt-0.5 text-[11px] text-[--color-text-muted]">
                  Hold: {step.pause_duration_seconds}s
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
