"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { MetricPoint } from "@/lib/api";

interface Props {
  metrics: MetricPoint[];
  rollbackThreshold?: number;
  advanceThreshold?: number;
}

interface ChartEntry {
  time: string;
  baseline?: number;
  candidate?: number;
}

function buildChartData(metrics: MetricPoint[]): ChartEntry[] {
  const map = new Map<string, ChartEntry>();
  for (const m of metrics) {
    const time = new Date(m.ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const entry = map.get(time) ?? { time };
    if (m.role === "baseline") entry.baseline = +m.avg_quality.toFixed(3);
    else entry.candidate = +m.avg_quality.toFixed(3);
    map.set(time, entry);
  }
  return Array.from(map.values());
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-[--color-border] bg-[--color-surface] p-3 text-[12px] shadow-lg">
      <p className="mb-2 font-medium text-[--color-text]">{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span
            className="inline-block h-2 w-2 rounded-sm"
            style={{ backgroundColor: p.color }}
          />
          <span className="text-[--color-text-secondary] capitalize">{p.dataKey}</span>
          <span className="ml-auto font-mono font-semibold" style={{ color: p.color }}>
            {p.value?.toFixed(3) ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function QualityGraph({
  metrics,
  rollbackThreshold = 0.7,
  advanceThreshold = 0.9,
}: Props) {
  const data = buildChartData(metrics);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-lg border border-dashed border-[--color-border] bg-[--color-surface] text-[13px] text-[--color-text-muted]">
        No evaluation data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -28, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#1f1f23" vertical={false} />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 11, fill: "#4a4a58" }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fontSize: 11, fill: "#4a4a58" }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => v.toFixed(1)}
        />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine
          y={rollbackThreshold}
          stroke="#dc2626"
          strokeDasharray="5 5"
          label={{ value: "Rollback", fill: "#dc2626", fontSize: 11, position: "right" }}
        />
        <ReferenceLine
          y={advanceThreshold}
          stroke="#16a34a"
          strokeDasharray="5 5"
          label={{ value: "Advance", fill: "#16a34a", fontSize: 11, position: "right" }}
        />
        <Line
          type="monotone"
          dataKey="baseline"
          stroke="#0ea5e9"
          strokeWidth={1.5}
          dot={false}
          activeDot={{ r: 3, fill: "#0ea5e9", strokeWidth: 0 }}
          isAnimationActive={false}
        />
        <Line
          type="monotone"
          dataKey="candidate"
          stroke="#d97706"
          strokeWidth={1.5}
          strokeDasharray="5 5"
          dot={false}
          activeDot={{ r: 3, fill: "#d97706", strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
