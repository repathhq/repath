import { Zap } from "lucide-react";

type RolloutState = "created" | "shadow" | "canary" | "promoted" | "rolled_back" | "paused";

interface StateBadgeProps {
  state: RolloutState;
}

export function StateBadge({ state }: StateBadgeProps) {
  const stateConfig: Record<RolloutState, { label: string; className: string }> = {
    created: { label: "Created", className: "state-badge created" },
    shadow: { label: "Shadow", className: "state-badge shadow" },
    canary: { label: "Canary", className: "state-badge canary" },
    promoted: { label: "Promoted", className: "state-badge promoted" },
    rolled_back: { label: "Rolled Back", className: "state-badge rolled_back" },
    paused: { label: "Paused", className: "state-badge paused" },
  };

  const config = stateConfig[state];

  return <span className={config.className}>{config.label}</span>;
}
