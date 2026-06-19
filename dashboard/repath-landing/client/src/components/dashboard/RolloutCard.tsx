import { ChevronRight } from "lucide-react";
import { StateBadge } from "./StateBadge";
import { TrafficSplitBar } from "./TrafficSplitBar";
// Type definition for Rollout
type Rollout = {
  id: string;
  userId: number;
  name: string;
  state: string;
  baselineModel: string;
  candidateModel: string;
  baselineSystemPrompt?: string | null;
  candidateSystemPrompt?: string | null;
  currentWeight: number;
  targetWeight: number;
  rollbackThreshold: number;
  advanceThreshold: number;
  createdAt: Date;
  updatedAt: Date;
};

interface RolloutCardProps {
  rollout: Partial<Rollout>;
  baselineQuality?: number;
  candidateQuality?: number;
  onClick?: () => void;
}

export function RolloutCard({
  rollout,
  baselineQuality = 0.92,
  candidateQuality = 0.88,
  onClick,
}: RolloutCardProps) {
  const timeAgo = "2m ago";

  return (
    <div
      className="rollout-card"
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : "default" }}
    >
      <div className="rollout-card-left">
        <StateBadge state={rollout.state as any} />
        <div className="rollout-card-info">
          <div className="rollout-card-name">{rollout.name}</div>
          <div className="rollout-card-models">
            {rollout.baselineModel} → {rollout.candidateModel}
          </div>
        </div>
      </div>

      <div className="rollout-card-right">
        <div style={{ width: "80px" }}>
          <TrafficSplitBar
            baselineWeight={rollout.currentWeight || 0}
            candidateWeight={100 - (rollout.currentWeight || 0)}
            animated
          />
        </div>

        <div
          style={{
            display: "flex",
            gap: "8px",
            fontSize: "12px",
            fontFamily: '"SF Mono", Monaco, monospace',
            minWidth: "80px",
          }}
        >
          <div style={{ color: "#0ea5e9" }}>{(baselineQuality * 100).toFixed(0)}%</div>
          <div style={{ color: "#8b8b9a" }}>→</div>
          <div style={{ color: "#d97706" }}>{(candidateQuality * 100).toFixed(0)}%</div>
        </div>

        <div style={{ color: "#4a4a58", fontSize: "12px", minWidth: "50px", textAlign: "right" }}>
          {timeAgo}
        </div>

        <ChevronRight size={18} style={{ color: "#4a4a58" }} />
      </div>
    </div>
  );
}
