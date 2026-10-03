"use client";

/**
 * The application shell: rail, header, and the theme the two share.
 *
 * One component rather than a layout per section, because every dashboard
 * route previously had its own near-identical `layout.tsx` and `/logs` was
 * added without one — so it rendered with no navigation at all. A single
 * shell makes that class of omission impossible.
 *
 * Theme follows `data-lp-theme` on <html>, the same attribute the marketing
 * pages use, so a visitor who picks dark on the landing page stays in dark
 * when they sign in. Written before first paint by the script in layout.tsx.
 */

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  CreditCard,
  GitBranch,
  HelpCircle,
  Menu,
  RefreshCw,
  ScrollText,
  Settings as SettingsIcon,
  X,
  Zap,
} from "lucide-react";
import { useSystemHealth } from "@/lib/hooks";
import { useTheme } from "@/lib/theme";
import "../app/dashboard.css";

const NAV_MAIN = [
  { href: "/rollouts", label: "Rollouts", icon: GitBranch },
  // Beside Rollouts, not filed at the bottom: the log exists to explain what
  // a rollout did, so it belongs next to the thing it explains.
  { href: "/logs", label: "Requests", icon: ScrollText },
  { href: "/routing", label: "Routing", icon: Zap },
];

const NAV_ACCOUNT = [
  { href: "/billing", label: "Billing", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function DashShell({
  children,
  title,
  crumb,
  actions,
  badge,
  onRefresh,
  back,
}: {
  children: React.ReactNode;
  title: string;
  crumb?: string;
  actions?: React.ReactNode;
  badge?: { label: string; tone: string };
  onRefresh?: () => void;
  back?: string;
}) {
  const pathname = usePathname();
  const [theme, setTheme] = useTheme();
  const [railOpen, setRailOpen] = useState(false);

  const { data: health } = useSystemHealth();
  const healthy = health?.status === "ok";
  const activeRollouts = health?.active_rollouts ?? 0;

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div className="dash" style={{ display: "flex", minHeight: "100vh" }}>
      {/* Mobile rail toggle. The canvas assumed 1440px; the app is used on
          phones, so the rail has to be reachable there. */}
      <button
        onClick={() => setRailOpen((v) => !v)}
        aria-label={railOpen ? "Close navigation" : "Open navigation"}
        className="dash-btn"
        style={{
          position: "fixed",
          top: 13,
          left: 12,
          zIndex: 70,
          width: 30,
          padding: 0,
          justifyContent: "center",
          background: "var(--surface)",
        }}
        data-mobile-only
      >
        {railOpen ? <X size={15} /> : <Menu size={15} />}
      </button>

      {/* Positioning lives in the stylesheet, not here: an inline
          `position` would outrank the mobile media query that switches the
          rail to `fixed`, leaving a 252px gap where the hidden rail used to
          be. */}
      <aside className="dash-rail" data-open={railOpen}>
        <div
          style={{
            height: 56,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "0 18px",
            borderBottom: "1px solid var(--line2)",
          }}
        >
          <Image src="/repath-mark.png" alt="" width={24} height={24} style={{ objectFit: "contain" }} />
          <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-0.03em" }}>Repath</span>
          <span
            className="dash-mono"
            style={{
              marginLeft: "auto",
              fontSize: 9.5,
              letterSpacing: "0.12em",
              padding: "3px 6px",
              borderRadius: 5,
              border: "1px solid var(--accent-line)",
              background: "var(--accent-soft)",
              color: "var(--accent)",
            }}
          >
            BETA
          </span>
        </div>

        <nav
          style={{
            flex: "1 0 auto",
            minHeight: 0,
            padding: "18px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div className="dash-navlabel">Deployments</div>
          {NAV_MAIN.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setRailOpen(false)}>
              <span className="dash-navitem" data-active={isActive(n.href)}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <n.icon size={16} strokeWidth={1.9} />
                </span>
                <span style={{ flex: 1 }}>{n.label}</span>
                {isActive(n.href) && (
                  <span
                    style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }}
                  />
                )}
              </span>
            </Link>
          ))}

          <div className="dash-navlabel" style={{ paddingTop: 22 }}>
            Account
          </div>
          {NAV_ACCOUNT.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setRailOpen(false)}>
              <span className="dash-navitem" data-active={isActive(n.href)}>
                <span
                  style={{
                    width: 18,
                    height: 18,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <n.icon size={16} strokeWidth={1.9} />
                </span>
                <span style={{ flex: 1 }}>{n.label}</span>
                {isActive(n.href) && (
                  <span
                    style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent)" }}
                  />
                )}
              </span>
            </Link>
          ))}
        </nav>

        <div
          style={{
            flexShrink: 0,
            padding: "14px 18px",
            borderTop: "1px solid var(--line2)",
            display: "flex",
            flexDirection: "column",
            gap: 12,
          }}
        >
          {/* Reports what the health endpoint actually says. The design's
              rail read "All systems normal" unconditionally; during an
              outage that is worse than showing nothing. */}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: healthy ? "var(--adv)" : "var(--roll)",
                animation: healthy ? "dash-pulse 2.4s ease-in-out infinite" : undefined,
              }}
            />
            <span style={{ fontSize: 12, color: healthy ? "var(--adv)" : "var(--roll)" }}>
              {health ? (healthy ? "All systems normal" : "Degraded") : "Checking…"}
            </span>
          </div>

          <div
            role="group"
            aria-label="Colour theme"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 3,
              padding: 3,
              borderRadius: 9,
              border: "1px solid var(--line2)",
              background: "var(--hover)",
            }}
          >
            <button
              className="dash-theme-pill"
              data-active={theme === "light"}
              aria-pressed={theme === "light"}
              onClick={() => setTheme("light")}
            >
              LIGHT
            </button>
            <button
              className="dash-theme-pill"
              data-active={theme === "dark"}
              aria-pressed={theme === "dark"}
              onClick={() => setTheme("dark")}
            >
              DARK
            </button>
          </div>

          <Link
            href="/docs"
            className="dash-navitem"
            style={{ padding: "7px 8px", fontSize: 12.5 }}
          >
            <HelpCircle size={15} strokeWidth={1.9} />
            <span style={{ flex: 1 }}>Docs &amp; support</span>
          </Link>
        </div>
      </aside>

      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header className="dash-header">
          {back && (
            <Link
              href={back}
              aria-label="Back"
              className="dash-btn"
              style={{ width: 28, height: 28, padding: 0, justifyContent: "center" }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="m12 19-7-7 7-7" />
                <path d="M19 12H5" />
              </svg>
            </Link>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            {crumb && (
              <span
                className="dash-mono"
                style={{ fontSize: 11, color: "var(--fg4)", letterSpacing: "0.04em" }}
              >
                {crumb}
              </span>
            )}
            <span
              style={{
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: "-0.02em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {title}
            </span>
            {badge && (
              <span className="dash-badge" data-tone={badge.tone}>
                {badge.label}
              </span>
            )}
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {activeRollouts > 0 && (
              <div
                className="dash-mono"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  height: 30,
                  padding: "0 11px",
                  borderRadius: 8,
                  border: "1px solid var(--line2)",
                  fontSize: 11,
                  color: "var(--fg2)",
                }}
              >
                <span
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: "var(--adv)",
                    animation: "dash-pulse 2.4s ease-in-out infinite",
                  }}
                />
                {activeRollouts} active
              </div>
            )}
            {onRefresh && (
              <button className="dash-btn" onClick={onRefresh}>
                <RefreshCw size={13} strokeWidth={2} />
                Refresh
              </button>
            )}
            {actions}
          </div>
        </header>

        <div style={{ flex: 1, overflowY: "auto" }}>{children}</div>
      </main>

      {/* Dim the page behind an open mobile rail, and give tapping outside
          the obvious way to dismiss it. */}
      {railOpen && (
        <div
          onClick={() => setRailOpen(false)}
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 55,
            background: "rgba(0,0,0,0.35)",
          }}
        />
      )}
    </div>
  );
}
