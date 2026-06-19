import { ArrowUp, ArrowDown, Check } from "lucide-react";

interface DecisionInfo {
  id: string;
  action: "advance" | "rollback" | "promote" | "pause";
  reason: string;
  previous_weight: number | null;
  new_weight: number | null;
  created_at: string;
}

interface DecisionFeedProps {
  decisions: DecisionInfo[];
}

export function DecisionFeed({ decisions }: DecisionFeedProps) {
  const getActionIcon = (action: string) => {
    switch (action) {
      case "advance":
        return <ArrowUp size={14} />;
      case "rollback":
        return <ArrowDown size={14} />;
      case "promote":
        return <Check size={14} />;
      default:
        return null;
    }
  };

  const getActionLabel = (action: string) => {
    return action.toUpperCase();
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return "just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <div className="decision-feed">
      {decisions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "24px", color: "#4a4a58" }}>
          No decisions yet
        </div>
      ) : (
        decisions.map((decision) => (
          <div
            key={decision.id}
            className={`decision-item ${decision.action === "rollback" ? "rollback" : ""}`}
          >
            <div className={`decision-icon ${decision.action}`}>
              {getActionIcon(decision.action)}
            </div>
            <div className="decision-content">
              <div className={`decision-action ${decision.action}`}>
                {getActionLabel(decision.action)}
              </div>
              {decision.previous_weight !== null && decision.new_weight !== null && (
                <div className="decision-weight">
                  {decision.previous_weight}% → {decision.new_weight}%
                </div>
              )}
              <div className="decision-reason">{decision.reason}</div>
            </div>
            <div className="decision-time">{formatTime(decision.created_at)}</div>
          </div>
        ))
      )}
    </div>
  );
}
