import { ArrowLeft, MoreVertical } from "lucide-react";
import { useLocation } from "wouter";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { StateBadge } from "@/components/dashboard/StateBadge";
import { TrafficSplitBar } from "@/components/dashboard/TrafficSplitBar";
import { QualityScoreChart } from "@/components/dashboard/QualityScoreChart";
import { MetricsGrid } from "@/components/dashboard/MetricsGrid";
import { StepTimeline } from "@/components/dashboard/StepTimeline";
import { DecisionFeed } from "@/components/dashboard/DecisionFeed";
import { LiveIndicator } from "@/components/dashboard/LiveIndicator";
import "../styles/dashboard.css";

export default function RolloutDetail() {
  const [, navigate] = useLocation();

  // Mock data
  const rollout = {
    id: "1",
    name: "GPT-4o → Mini Migration",
    state: "canary",
    baselineModel: "gpt-4o",
    candidateModel: "gpt-4o-mini",
    currentWeight: 20,
    targetWeight: 100,
  };

  const mockMetrics = [
    {
      ts: "12:00",
      role: "baseline" as const,
      avg_quality: 0.92,
      p95_latency_ms: 245,
      error_rate: 0.1,
      request_count: 1000,
    },
    {
      ts: "12:00",
      role: "candidate" as const,
      avg_quality: 0.88,
      p95_latency_ms: 180,
      error_rate: 0.2,
      request_count: 250,
    },
    {
      ts: "12:15",
      role: "baseline" as const,
      avg_quality: 0.91,
      p95_latency_ms: 250,
      error_rate: 0.12,
      request_count: 1050,
    },
    {
      ts: "12:15",
      role: "candidate" as const,
      avg_quality: 0.89,
      p95_latency_ms: 175,
      error_rate: 0.18,
      request_count: 280,
    },
  ];

  const mockSteps = [
    {
      step_number: 1,
      target_weight: 10,
      gate_expression: "quality_score >= 0.85",
      status: "passed" as const,
      started_at: "2026-06-19T04:00:00Z",
    },
    {
      step_number: 2,
      target_weight: 25,
      gate_expression: "quality_score >= 0.87",
      status: "active" as const,
      started_at: "2026-06-19T04:15:00Z",
    },
    {
      step_number: 3,
      target_weight: 50,
      gate_expression: "quality_score >= 0.90",
      status: "pending" as const,
      started_at: null,
    },
  ];

  const mockDecisions = [
    {
      id: "d1",
      action: "advance" as const,
      reason: "Quality score exceeded threshold for 15 minutes",
      previous_weight: 10,
      new_weight: 25,
      created_at: new Date(Date.now() - 10 * 60000).toISOString(),
    },
    {
      id: "d2",
      action: "advance" as const,
      reason: "P95 latency improved by 28%",
      previous_weight: 5,
      new_weight: 10,
      created_at: new Date(Date.now() - 25 * 60000).toISOString(),
    },
  ];

  return (
    <div className="dashboard-layout">
      <DashboardSidebar activeRolloutsCount={2} />

      <div className="dashboard-main">
        {/* Header */}
        <div
          style={{
            padding: "24px",
            borderBottom: "1px solid #1f1f23",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1 }}>
            <button
              onClick={() => navigate("/dashboard/rollouts")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#8b8b9a",
                padding: "4px",
              }}
            >
              <ArrowLeft size={20} />
            </button>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                <h1 style={{ fontSize: "24px", fontWeight: 600, color: "#f8f8f8", margin: 0 }}>
                  {rollout.name}
                </h1>
                <StateBadge state={rollout.state as any} />
              </div>
              <div style={{ fontSize: "11px", color: "#4a4a58", fontFamily: "monospace" }}>
                ID: {rollout.id}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <button className="action-btn success">Promote</button>
            <button className="action-btn danger">Rollback</button>
            <button
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#8b8b9a",
                padding: "8px",
              }}
            >
              <MoreVertical size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="dashboard-content">
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "24px" }}>
            {/* Left Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Traffic Split */}
              <div className="quality-chart">
                <div className="chart-title" style={{ marginBottom: "16px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    Traffic
                    <LiveIndicator active={rollout.state === "canary"} />
                  </div>
                </div>
                <TrafficSplitBar
                  baselineWeight={100 - rollout.currentWeight}
                  candidateWeight={rollout.currentWeight}
                  animated
                />
              </div>

              {/* Quality Score Chart */}
              <QualityScoreChart
                metrics={mockMetrics}
                rollbackThreshold={0.7}
                advanceThreshold={0.9}
              />

              {/* Metrics Grid */}
              <div className="quality-chart">
                <div className="chart-title" style={{ marginBottom: "16px" }}>
                  Metrics
                </div>
                <MetricsGrid
                  baseline={{ quality: 0.92, latency: 245, errorRate: 0.1, requestCount: 1000 }}
                  candidate={{ quality: 0.88, latency: 180, errorRate: 0.2, requestCount: 250 }}
                />
              </div>
            </div>

            {/* Right Column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              {/* Steps */}
              <div className="quality-chart">
                <div className="chart-title" style={{ marginBottom: "16px" }}>
                  Steps
                </div>
                <StepTimeline steps={mockSteps} />
              </div>

              {/* Decisions */}
              <div className="quality-chart">
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                  }}
                >
                  <div className="chart-title">Decisions</div>
                  <a
                    href="#"
                    style={{
                      fontSize: "12px",
                      color: "#7c3aed",
                      textDecoration: "none",
                      cursor: "pointer",
                    }}
                  >
                    View all
                  </a>
                </div>
                <DecisionFeed decisions={mockDecisions} />
              </div>

              {/* Versions */}
              <div className="quality-chart">
                <div className="chart-title" style={{ marginBottom: "16px" }}>
                  Versions
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  <div style={{ padding: "12px", background: "#161618", borderRadius: "6px" }}>
                    <div style={{ fontSize: "11px", color: "#4a4a58", marginBottom: "4px" }}>
                      BASELINE
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#f8f8f8" }}>
                      {rollout.baselineModel}
                    </div>
                  </div>
                  <div style={{ padding: "12px", background: "#161618", borderRadius: "6px" }}>
                    <div style={{ fontSize: "11px", color: "#4a4a58", marginBottom: "4px" }}>
                      CANDIDATE
                    </div>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#f8f8f8" }}>
                      {rollout.candidateModel}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
