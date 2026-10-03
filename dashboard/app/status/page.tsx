"use client";

/**
 * Public status page.
 *
 * Reports what it actually observes, via /api/status. A hardcoded "All
 * systems operational" would be worse than no status page: during a real
 * outage it would confidently say everything was fine. Refreshes itself, so
 * a tab left open during an incident tells the truth when you look back.
 */

import { useCallback, useEffect, useState } from "react";
import { Card, MarketingShell, PageHero } from "@/components/marketing/Marketing";

type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

interface StatusPayload {
  headline: string;
  overall: ServiceStatus;
  services: { name: string; status: ServiceStatus; detail: string }[];
  checked_at: string;
}

const LOOK: Record<ServiceStatus, { color: string; soft: string; line: string; label: string }> = {
  operational: { color: "var(--adv)", soft: "var(--adv-soft)", line: "var(--adv-line)", label: "Operational" },
  degraded: { color: "oklch(0.62 0.14 75)", soft: "oklch(0.62 0.14 75 / 0.1)", line: "oklch(0.62 0.14 75 / 0.3)", label: "Degraded" },
  down: { color: "var(--roll)", soft: "var(--roll-soft)", line: "var(--roll-line)", label: "Down" },
  unknown: { color: "var(--fg3)", soft: "var(--hover)", line: "var(--line)", label: "Unknown" },
};

export default function StatusPage() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/status", { cache: "no-store" });
      setData(await r.json());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // The first load is kicked off from a timer rather than synchronously,
    // keeping state updates out of the effect body.
    const first = setTimeout(load, 0);
    const every = setInterval(load, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [load]);

  const overall: ServiceStatus = failed ? "unknown" : (data?.overall ?? "unknown");
  const look = LOOK[overall];

  return (
    <MarketingShell>
      <PageHero eyebrow="Status" title={failed ? "Cannot reach the status check" : (data?.headline ?? "Checking…")} narrow>
        <div
          className="lp-mono"
          style={{
            marginTop: 22,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            borderRadius: 999,
            border: `1px solid ${look.line}`,
            background: look.soft,
            color: look.color,
            fontSize: 12,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: look.color,
              animation: overall === "operational" ? "lp-pulse 2.4s ease-in-out infinite" : undefined,
            }}
          />
          {data ? `Checked ${new Date(data.checked_at).toLocaleTimeString()} · refreshes every 30 s` : "Checking…"}
        </div>
      </PageHero>

      <section className="lp-pad" style={{ maxWidth: 860, margin: "0 auto", padding: "48px 40px 120px" }}>
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {(data?.services ?? []).map((s, i) => {
            const l = LOOK[s.status];
            return (
              <div
                key={s.name}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 16,
                  padding: "18px 24px",
                  borderTop: i ? "1px solid var(--line2)" : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: l.color }} />
                  <span style={{ fontSize: 15, fontWeight: 550 }}>{s.name}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span className="lp-mono" style={{ fontSize: 12, color: "var(--fg4)" }}>
                    {s.detail}
                  </span>
                  <span
                    className="lp-mono"
                    style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6, border: `1px solid ${l.line}`, background: l.soft, color: l.color }}
                  >
                    {l.label}
                  </span>
                </div>
              </div>
            );
          })}
          {!data && !failed && <div style={{ padding: "18px 24px", fontSize: 15, color: "var(--fg3)" }}>Checking services…</div>}
          {failed && (
            <div style={{ padding: "18px 24px", fontSize: 15, color: "var(--fg2)" }}>
              This page could not reach its own status check. If the dashboard is also unreachable, email
              hello@tryrepath.com.
            </div>
          )}
        </Card>
        <p style={{ fontSize: 14, color: "var(--fg3)", margin: "18px 0 0" }}>
          Every check runs live against production when this page loads; nothing here is typed by hand.
        </p>
      </section>
    </MarketingShell>
  );
}
