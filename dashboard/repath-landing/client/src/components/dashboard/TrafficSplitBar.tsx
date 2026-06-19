interface TrafficSplitBarProps {
  baselineWeight: number; // 0-100
  candidateWeight: number; // 0-100
  animated?: boolean;
}

export function TrafficSplitBar({
  baselineWeight,
  candidateWeight,
  animated = true,
}: TrafficSplitBarProps) {
  const total = baselineWeight + candidateWeight || 100;
  const baselinePercent = (baselineWeight / total) * 100;
  const candidatePercent = (candidateWeight / total) * 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      <div className="traffic-split-bar">
        {baselinePercent > 0 && (
          <div
            className={`traffic-segment baseline ${animated ? "" : ""}`}
            style={{
              flex: baselinePercent,
              transition: animated ? "flex 700ms cubic-bezier(0.77, 0, 0.175, 1)" : "none",
            }}
          >
            {baselinePercent > 15 && `${Math.round(baselinePercent)}%`}
          </div>
        )}
        {candidatePercent > 0 && (
          <div
            className={`traffic-segment candidate ${animated ? "" : ""}`}
            style={{
              flex: candidatePercent,
              transition: animated ? "flex 700ms cubic-bezier(0.77, 0, 0.175, 1)" : "none",
            }}
          >
            {candidatePercent > 15 && `${Math.round(candidatePercent)}%`}
          </div>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px" }}>
        <div style={{ color: "#8b8b9a" }}>
          Baseline <span style={{ color: "#0ea5e9", fontWeight: 600 }}>{Math.round(baselinePercent)}%</span>
        </div>
        <div style={{ color: "#8b8b9a" }}>
          Candidate <span style={{ color: "#d97706", fontWeight: 600 }}>{Math.round(candidatePercent)}%</span>
        </div>
      </div>
    </div>
  );
}
