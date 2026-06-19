import { Plus, Search } from "lucide-react";
import { useLocation } from "wouter";
import { DashboardSidebar } from "@/components/dashboard/DashboardSidebar";
import { StateBadge } from "@/components/dashboard/StateBadge";
import { TrafficSplitBar } from "@/components/dashboard/TrafficSplitBar";
import "../styles/dashboard.css";

export default function RolloutsList() {
  const [, navigate] = useLocation();

  const mockRollouts = [
    {
      id: "1",
      name: "GPT-4o → Mini Migration",
      state: "canary",
      baselineModel: "gpt-4o",
      candidateModel: "gpt-4o-mini",
      currentWeight: 20,
      quality: "92% → 88%",
      latency: "245ms → 180ms",
      createdAt: "2 hours ago",
    },
    {
      id: "2",
      name: "Claude Sonnet Evaluation",
      state: "shadow",
      baselineModel: "gpt-4o",
      candidateModel: "claude-sonnet",
      currentWeight: 0,
      quality: "92% → 90%",
      latency: "245ms → 320ms",
      createdAt: "1 hour ago",
    },
    {
      id: "3",
      name: "System Prompt Optimization",
      state: "promoted",
      baselineModel: "gpt-4o",
      candidateModel: "gpt-4o",
      currentWeight: 100,
      quality: "92% → 94%",
      latency: "245ms → 240ms",
      createdAt: "30 minutes ago",
    },
    {
      id: "4",
      name: "Llama 3.1 Comparison",
      state: "rolled_back",
      baselineModel: "gpt-4o",
      candidateModel: "llama-3.1",
      currentWeight: 0,
      quality: "92% → 78%",
      latency: "245ms → 150ms",
      createdAt: "15 minutes ago",
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
            Rollouts
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
          {/* Search Bar */}
          <div
            style={{
              display: "flex",
              gap: "12px",
              marginBottom: "24px",
              position: "relative",
            }}
          >
            <Search
              size={18}
              style={{
                position: "absolute",
                left: "12px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "#4a4a58",
              }}
            />
            <input
              type="text"
              placeholder="Search rollouts..."
              style={{
                flex: 1,
                padding: "10px 12px 10px 40px",
                background: "#111113",
                border: "1px solid #1f1f23",
                borderRadius: "6px",
                color: "#f8f8f8",
                fontSize: "14px",
              }}
            />
          </div>

          {/* Table */}
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>State</th>
                <th>Models</th>
                <th>Traffic</th>
                <th>Quality</th>
                <th>Latency</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {mockRollouts.map((rollout) => (
                <tr
                  key={rollout.id}
                  onClick={() => navigate(`/dashboard/rollouts/${rollout.id}`)}
                  style={{ cursor: "pointer" }}
                >
                  <td style={{ fontWeight: 500 }}>{rollout.name}</td>
                  <td>
                    <StateBadge state={rollout.state as any} />
                  </td>
                  <td className="mono">
                    {rollout.baselineModel} → {rollout.candidateModel}
                  </td>
                  <td>
                    <div style={{ width: "80px" }}>
                      <TrafficSplitBar
                        baselineWeight={100 - rollout.currentWeight}
                        candidateWeight={rollout.currentWeight}
                        animated={false}
                      />
                    </div>
                  </td>
                  <td className="mono">{rollout.quality}</td>
                  <td className="mono">{rollout.latency}</td>
                  <td style={{ color: "#4a4a58", fontSize: "13px" }}>{rollout.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
