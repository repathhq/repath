interface VersionMetrics {
  quality: number;
  latency: number;
  errorRate: number;
  requestCount: number;
}

interface MetricsGridProps {
  baseline: VersionMetrics;
  candidate: VersionMetrics;
}

export function MetricsGrid({ baseline, candidate }: MetricsGridProps) {
  const metrics = [
    {
      label: "Quality Score",
      baselineValue: (baseline.quality * 100).toFixed(1),
      candidateValue: (candidate.quality * 100).toFixed(1),
    },
    {
      label: "P95 Latency",
      baselineValue: `${baseline.latency}ms`,
      candidateValue: `${candidate.latency}ms`,
    },
    {
      label: "Error Rate",
      baselineValue: `${baseline.errorRate.toFixed(2)}%`,
      candidateValue: `${candidate.errorRate.toFixed(2)}%`,
    },
    {
      label: "Sample Count",
      baselineValue: baseline.requestCount.toLocaleString(),
      candidateValue: candidate.requestCount.toLocaleString(),
    },
  ];

  return (
    <div className="metrics-grid">
      {metrics.map((metric) => (
        <div key={metric.label} className="metric-tile">
          <div className="metric-tile-label">{metric.label}</div>
          <div className="metric-tile-values">
            <div>
              <div style={{ fontSize: "11px", color: "#4a4a58", marginBottom: "4px" }}>Baseline</div>
              <div className="metric-value baseline">{metric.baselineValue}</div>
            </div>
            <div>
              <div style={{ fontSize: "11px", color: "#4a4a58", marginBottom: "4px" }}>Candidate</div>
              <div className="metric-value candidate">{metric.candidateValue}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
