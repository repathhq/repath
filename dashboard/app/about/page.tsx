"use client";

import Link from "next/link";
import { ArrowRight, Card, MarketingShell, PageHero, SectionLabel } from "@/components/marketing/Marketing";

export default function AboutPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="About"
        title="Shipping AI should be as safe as shipping code."
        lead="Repath is the deployment layer for AI. It routes a slice of real traffic to a new prompt or model, judges every answer, and rolls back on its own when quality drops — before most of your users ever see the change."
      />

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "80px 40px 0" }}>
        <div className="lp-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "start" }}>
          <div>
            <SectionLabel>The problem</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 17, lineHeight: 1.65, color: "var(--fg2)" }}>
              <p style={{ margin: 0 }}>
                Software teams stopped shipping changes to everyone at once years ago. Canary releases, feature flags
                and automatic rollback are standard for code.
              </p>
              <p style={{ margin: 0 }}>
                AI changes still go out all at once. A reworded prompt or a new model version reaches every user the
                moment it is deployed, and when it is worse, nothing errors — the answers are just wrong, politely.
                Teams find out from support tickets.
              </p>
            </div>
          </div>
          <div>
            <SectionLabel>What Repath does</SectionLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 16, fontSize: 17, lineHeight: 1.65, color: "var(--fg2)" }}>
              <p style={{ margin: 0 }}>
                It brings the same discipline to prompts and models. One line points your existing OpenAI-compatible
                client at Repath. From then on, every change can go out as a canary: a few percent of traffic first, a
                quality gate at each step, and a rollback the moment the judge says the new version is worse.
              </p>
              <p style={{ margin: 0 }}>
                Every decision comes with its evidence — the answers that moved the score, and the judge&apos;s reasons.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "96px 40px 0" }}>
        <SectionLabel>How we build it</SectionLabel>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {[
            ["Out of your way", "The gateway is written in Rust and sits in your request path, so it is built to add milliseconds, not seconds — and if it ever cannot serve, it says so rather than degrading your traffic."],
            ["Evidence over vibes", "A rollout advances on judged quality from real traffic, and never on a health check alone. Every decision is logged with the numbers that made it."],
            ["Yours to run", "Repath is source-available. Use the cloud, or run the whole stack inside your own network when data must not leave it."],
          ].map(([h, d]) => (
            <Card key={h}>
              <h3 style={{ fontSize: 17, fontWeight: 600, margin: "0 0 10px" }}>{h}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--fg3)", margin: 0 }}>{d}</p>
            </Card>
          ))}
        </div>
      </section>

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "96px 40px 120px", display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link
          href="/signup"
          className="lp-btn-primary"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px", borderRadius: 11, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 15, fontWeight: 550 }}
        >
          Start free <ArrowRight />
        </Link>
        <Link
          href="/contact"
          className="lp-btn-ghost"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px", borderRadius: 11, border: "1px solid var(--line)", fontSize: 15, fontWeight: 550 }}
        >
          Get in touch
        </Link>
      </section>
    </MarketingShell>
  );
}
