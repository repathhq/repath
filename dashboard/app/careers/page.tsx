"use client";

import { ArrowRight, Card, MarketingShell, PageHero, SectionLabel } from "@/components/marketing/Marketing";

export default function CareersPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Careers"
        title="Help make AI safe to ship."
        lead="Repath is a small team. There are no open roles right now, but we always want to hear from people who care about reliability and developer experience."
      />

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "72px 40px 0" }}>
        <SectionLabel>How we work</SectionLabel>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {[
            ["Remote", "Work from anywhere. We judge output, not hours online."],
            ["Ownership", "A small team means you own whole systems, end to end."],
            ["Ship and measure", "We release often and let real traffic tell us what worked."],
          ].map(([h, d]) => (
            <Card key={h}>
              <h3 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px" }}>{h}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--fg3)", margin: 0 }}>{d}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "56px 40px 120px" }}>
        <Card style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px" }}>No open positions</h2>
            <p style={{ fontSize: 15, color: "var(--fg2)", margin: 0 }}>
              Send a note and what you have built. We read every one. Remote — India and worldwide.
            </p>
          </div>
          <a
            href="mailto:hello@tryrepath.com?subject=Working%20at%20Repath"
            className="lp-btn-ghost"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 44, padding: "0 20px", borderRadius: 11, border: "1px solid var(--line)", fontSize: 15, fontWeight: 550 }}
          >
            Write to us <ArrowRight />
          </a>
        </Card>
      </section>
    </MarketingShell>
  );
}
