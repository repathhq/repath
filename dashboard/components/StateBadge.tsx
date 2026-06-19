import { cn } from "@/lib/utils";
import type { RolloutSummary } from "@/lib/api";

const styles: Record<RolloutSummary["state"], string> = {
  canary:      "bg-[--color-candidate]/15 text-[--color-candidate] border-[--color-candidate]/30",
  shadow:      "bg-[--color-baseline]/15 text-[--color-baseline] border-[--color-baseline]/30",
  promoted:    "bg-[--color-success]/15 text-[--color-success] border-[--color-success]/30",
  rolled_back: "bg-[--color-danger]/15 text-[--color-danger] border-[--color-danger]/30",
  created:     "bg-[--color-border]/50 text-[--color-text-secondary] border-[--color-border]",
  paused:      "bg-[--color-border]/50 text-[--color-text-secondary] border-[--color-border]",
};

const labels: Record<RolloutSummary["state"], string> = {
  canary:      "Canary",
  shadow:      "Shadow",
  promoted:    "Promoted",
  rolled_back: "Rolled Back",
  created:     "Created",
  paused:      "Paused",
};

export default function StateBadge({
  state,
  className,
}: {
  state: RolloutSummary["state"];
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-0.5 text-[11px] font-semibold border",
        styles[state] ?? styles.created,
        className
      )}
    >
      {labels[state] ?? state}
    </span>
  );
}
