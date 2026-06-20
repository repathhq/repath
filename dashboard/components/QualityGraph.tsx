"use client";

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from "recharts";
import type { MetricPoint } from "@/lib/api";

interface Props { metrics: MetricPoint[]; rollbackThreshold?: number; advanceThreshold?: number; }
interface ChartEntry { time: string; baseline?: number; candidate?: number; }

function buildChartData(metrics: MetricPoint[]): ChartEntry[] {
  const map = new Map<string, ChartEntry>();
  for (const m of metrics) {
    const time = new Date(m.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    const entry = map.get(time) ?? { time };
    if (m.role === "baseline") entry.baseline = +m.avg_quality.toFixed(3);
    else entry.candidate = +m.avg_quality.toFixed(3);
    map.set(time, entry);
  }
  return Array.from(map.values());
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; color: string; value?: number }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-[12px] shadow-lg">
      <p className="mb-2 font-medium text-gray-700">{label}</p>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: p.color }} />
          <span className="text-gray-500 capitalize">{p.dataKey}</span>
          <span className="ml-auto font-mono font-semibold" style={{ color: p.color }}>
            {p.value?.toFixed(3) ?? "—"}
          </span>
        </div>
      ))}
    </div>
  );
};

export default function QualityGraph({ metrics, rollbackThreshold = 0.7, advanceThreshold = 0.9 }: Props) {
  const data = buildChartData(metrics);

  if (data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-[13px] text-gray-400">
        No evaluation data yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: -28, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
        <XAxis dataKey="time" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
        <YAxis domain={[0, 1]} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} tickFormatter={(v) => v.toFixed(1)} />
        <Tooltip content={<CustomTooltip />} />
        <ReferenceLine y={rollbackThreshold} stroke="#ef4444" strokeDasharray="5 5"
          label={{ value: "Rollback", fill: "#ef4444", fontSize: 11, position: "right" }} />
        <ReferenceLine y={advanceThreshold} stroke="#16a34a" strokeDasharray="5 5"
          label={{ value: "Advance", fill: "#16a34a", fontSize: 11, position: "right" }} />
        <Line type="monotone" dataKey="baseline" stroke="#1d4ed8" strokeWidth={2} dot={false}
          activeDot={{ r: 3, fill: "#1d4ed8", strokeWidth: 0 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="candidate" stroke="#b45309" strokeWidth={2} strokeDasharray="5 5" dot={false}
          activeDot={{ r: 3, fill: "#b45309", strokeWidth: 0 }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
