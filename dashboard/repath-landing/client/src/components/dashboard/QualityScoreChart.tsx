import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";

interface MetricPoint {
  ts: string;
  role: "baseline" | "candidate";
  avg_quality: number;
  p95_latency_ms: number;
  error_rate: number;
  request_count: number;
}

interface QualityScoreChartProps {
  metrics: MetricPoint[];
  rollbackThreshold?: number;
  advanceThreshold?: number;
  timeframe?: "15m" | "1h" | "6h";
  onTimeframeChange?: (timeframe: "15m" | "1h" | "6h") => void;
}

export function QualityScoreChart({
  metrics,
  rollbackThreshold = 0.7,
  advanceThreshold = 0.9,
  timeframe = "1h",
  onTimeframeChange,
}: QualityScoreChartProps) {
  // Group metrics by timestamp
  const chartData = metrics.reduce(
    (acc, metric) => {
      const existing = acc.find((m) => m.ts === metric.ts);
      if (existing) {
        if (metric.role === "baseline") {
          existing.baseline = metric.avg_quality;
        } else {
          existing.candidate = metric.avg_quality;
        }
      } else {
        acc.push({
          ts: metric.ts,
          baseline: metric.role === "baseline" ? metric.avg_quality : undefined,
          candidate: metric.role === "candidate" ? metric.avg_quality : undefined,
        });
      }
      return acc;
    },
    [] as Array<{ ts: string; baseline?: number; candidate?: number }>
  );

  return (
    <div className="quality-chart">
      <div className="chart-header">
        <div className="chart-title">Response Quality</div>
        <div className="chart-timeframe-selector">
          {(["15m", "1h", "6h"] as const).map((tf) => (
            <button
              key={tf}
              className={`timeframe-btn ${timeframe === tf ? "active" : ""}`}
              onClick={() => onTimeframeChange?.(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" vertical={false} />
          <XAxis
            dataKey="ts"
            stroke="#4a4a58"
            style={{ fontSize: "11px" }}
            tick={{ fill: "#4a4a58" }}
          />
          <YAxis
            domain={[0, 1]}
            stroke="#4a4a58"
            style={{ fontSize: "11px" }}
            tick={{ fill: "#4a4a58" }}
            label={{ value: "Score", angle: -90, position: "insideLeft" }}
          />
          <Tooltip
            contentStyle={{
              background: "#111113",
              border: "1px solid #1f1f23",
              borderRadius: "6px",
              color: "#f8f8f8",
            }}
            formatter={(value: number) => value?.toFixed(2)}
          />
          <ReferenceLine
            y={rollbackThreshold}
            stroke="#dc2626"
            strokeDasharray="5 5"
            label={{
              value: "Rollback",
              position: "right",
              fill: "#dc2626",
              fontSize: 11,
            }}
          />
          <ReferenceLine
            y={advanceThreshold}
            stroke="#16a34a"
            strokeDasharray="5 5"
            label={{
              value: "Advance",
              position: "right",
              fill: "#16a34a",
              fontSize: 11,
            }}
          />
          <Line
            type="monotone"
            dataKey="baseline"
            stroke="#0ea5e9"
            dot={false}
            isAnimationActive={false}
            name="Baseline"
          />
          <Line
            type="monotone"
            dataKey="candidate"
            stroke="#d97706"
            strokeDasharray="5 5"
            dot={false}
            isAnimationActive={false}
            name="Candidate"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
