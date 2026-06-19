import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { StatCard } from "@/components/dashboard/StatCard";
import { RolloutCard } from "@/components/dashboard/RolloutCard";
import { Plus } from "lucide-react";
import { useLocation } from "wouter";
import "../styles/dashboard.css";

export default function Dashboard() {
  const [, navigate] = useLocation();

  // Mock data - replace with tRPC calls
  const stats = [
    { label: "Active Rollouts", value: 3, subtitle: "in canary or shadow", accentColor: "violet" as const },
    { label: "Rollbacks Today", value: 0, subtitle: "0 incidents", accentColor: "green" as const, trend: "down" as const },
    { label: "Avg Quality Score", value: "0.91", subtitle: "↑ 2% from baseline", accentColor: "green" as const },
    { label: "Requests (24h)", value: "2.4M", subtitle: "↑ 12% from yesterday", accentColor: "violet" as const },
  ];

  const mockRollouts = [
    {
      id: "1",
      name: "GPT-4o → Mini Migration",
      state: "canary",
      baselineModel: "gpt-4o",
      candidateModel: "gpt-4o-mini",
      currentWeight: 20,
      targetWeight: 100,
      rollbackThreshold: 70,
      advanceThreshold: 90,
      userId: 1,
      baselineSystemPrompt: null,
      candidateSystemPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "2",
      name: "Claude Sonnet Evaluation",
      state: "shadow",
      baselineModel: "gpt-4o",
      candidateModel: "claude-sonnet",
      currentWeight: 0,
      targetWeight: 100,
      rollbackThreshold: 70,
      advanceThreshold: 90,
      userId: 1,
      baselineSystemPrompt: null,
      candidateSystemPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: "3",
      name: "System Prompt Optimization",
      state: "promoted",
      baselineModel: "gpt-4o",
      candidateModel: "gpt-4o",
      currentWeight: 100,
      targetWeight: 100,
      rollbackThreshold: 70,
      advanceThreshold: 90,
      userId: 1,
      baselineSystemPrompt: null,
      candidateSystemPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
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
            alignItems: "center",
          }}
        >
          <h1 style={{ fontSize: "24px", fontWeight: 600, color: "#f8f8f8", margin: 0 }}>
            Overview
          </h1>
          <button
            className="action-btn primary"
            onClick={() => navigate("/dashboard/rollouts/new")}
          >
            <Plus size={16} />
            New Rollout
          </button>
        </div>

        {/* Content */}
        <div className="dashboard-content">
          {/* Stats Row */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: "16px",
              marginBottom: "32px",
            }}
          >
            {stats.map((stat) => (
              <StatCard
                key={stat.label}
                label={stat.label}
                value={stat.value}
                subtitle={stat.subtitle}
                accentColor={stat.accentColor}
                trend={stat.trend}
              />
            ))}
          </div>

          {/* Active Rollouts Section */}
          <div style={{ marginBottom: "32px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "16px",
              }}
            >
              <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f8f8f8", margin: 0 }}>
                Active
              </h2>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: "24px",
                  height: "24px",
                  background: "rgba(124, 58, 237, 0.15)",
                  color: "#7c3aed",
                  borderRadius: "999px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {mockRollouts.filter((r) => r.state !== "promoted").length}
              </span>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {mockRollouts
                .filter((r) => r.state !== "promoted")
                .map((rollout) => (
                  <RolloutCard
                    key={rollout.id}
                    rollout={rollout}
                    baselineQuality={0.92}
                    candidateQuality={0.88}
                    onClick={() => navigate(`/dashboard/rollouts/${rollout.id}`)}
                  />
                ))}
            </div>
          </div>

          {/* Recent Activity Section */}
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: 600, color: "#f8f8f8", margin: "0 0 16px 0" }}>
              Recent Activity
            </h2>
            <div
              style={{
                background: "#111113",
                border: "1px solid #1f1f23",
                borderRadius: "8px",
                padding: "24px",
                textAlign: "center",
                color: "#8b8b9a",
              }}
            >
              <p style={{ margin: 0 }}>Activity feed coming soon</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
