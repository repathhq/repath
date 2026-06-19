import { LayoutGrid, GitBranch, BarChart3, Settings, AlertCircle } from "lucide-react";
import { Link, useLocation } from "wouter";

interface DashboardSidebarProps {
  activeRolloutsCount?: number;
}

export function DashboardSidebar({ activeRolloutsCount = 0 }: DashboardSidebarProps) {
  const [location] = useLocation();

  const navItems = [
    { href: "/dashboard", label: "Overview", icon: LayoutGrid },
    { href: "/dashboard/rollouts", label: "Rollouts", icon: GitBranch, badge: activeRolloutsCount },
    { href: "/dashboard/evaluations", label: "Evaluations", icon: BarChart3 },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="dashboard-sidebar">
      {/* Logo */}
      <div style={{ padding: "16px", borderBottom: "1px solid #1f1f23" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <div
            style={{
              width: "20px",
              height: "20px",
              background: "#7c3aed",
              borderRadius: "4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "10px",
              fontWeight: "bold",
              color: "white",
            }}
          >
            ⚡
          </div>
          <span style={{ fontWeight: 600, color: "#f8f8f8", fontSize: "14px" }}>Repath</span>
        </div>
        <div
          style={{
            fontSize: "10px",
            color: "#4a4a58",
            fontWeight: 500,
            letterSpacing: "0.5px",
          }}
        >
          v0.1
        </div>
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, padding: "12px 0", overflow: "auto" }}>
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location === item.href || location.startsWith(item.href + "/");

          return (
            <Link key={item.href} href={item.href}>
              <a
                className={`sidebar-nav-item ${isActive ? "active" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  padding: "12px 16px",
                  color: isActive ? "#7c3aed" : "#8b8b9a",
                  textDecoration: "none",
                  fontSize: "14px",
                  transition: "all 150ms ease-out",
                  borderLeft: isActive ? "2px solid #7c3aed" : "2px solid transparent",
                  backgroundColor: isActive ? "rgba(124, 58, 237, 0.08)" : "transparent",
                }}
              >
                <Icon size={18} />
                <span style={{ flex: 1 }}>{item.label}</span>
                {item.badge && item.badge > 0 && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      minWidth: "20px",
                      height: "20px",
                      background: "#7c3aed",
                      color: "white",
                      borderRadius: "999px",
                      fontSize: "11px",
                      fontWeight: 600,
                    }}
                  >
                    {item.badge}
                  </span>
                )}
              </a>
            </Link>
          );
        })}
      </nav>

      {/* System Status */}
      <div
        style={{
          padding: "16px",
          borderTop: "1px solid #1f1f23",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "12px",
          color: "#16a34a",
        }}
      >
        <div
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "#16a34a",
            animation: "pulse 2s infinite",
          }}
        />
        <span>All systems normal</span>
      </div>
    </div>
  );
}
