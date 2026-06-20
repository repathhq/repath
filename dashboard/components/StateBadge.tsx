import { cn } from "@/lib/utils";
import type { RolloutSummary } from "@/lib/api";

const styles: Record<RolloutSummary["state"], string> = {
  canary:      "bg-amber-50 text-amber-700 border-amber-200",
  shadow:      "bg-blue-50 text-blue-700 border-blue-200",
  promoted:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  rolled_back: "bg-red-50 text-red-700 border-red-200",
  created:     "bg-gray-100 text-gray-600 border-gray-200",
  paused:      "bg-gray-100 text-gray-500 border-gray-200",
};

const labels: Record<RolloutSummary["state"], string> = {
  canary:      "Canary",
  shadow:      "Shadow",
  promoted:    "Promoted",
  rolled_back: "Rolled Back",
  created:     "Created",
  paused:      "Paused",
};

export default function StateBadge({ state, className }: { state: RolloutSummary["state"]; className?: string }) {
  return (
    <span className={cn(
      "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold border tracking-wide",
      styles[state] ?? styles.created,
      className
    )}>
      {labels[state] ?? state}
    </span>
  );
}
