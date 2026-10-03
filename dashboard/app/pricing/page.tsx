"use client";

/**
 * Pricing.
 *
 * Every line here is something the product does. Plans differ only in what
 * the code actually varies by plan — judged evaluations (plan_quota),
 * request-log retention (retention_days), and the rate-limit backstop
 * (limit_for_plan) — and the prices are the amounts checkout charges
 * (lib/plans.ts). Earlier copy sold per-plan rollout limits, custom judge
 * criteria, Azure, SSO and SOC 2, none of which existed, and promised a
 * "full Pro" trial and PayPal billing that were not true either.
 */

import Link from "next/link";
import { PLANS as CATALOG, type PlanId } from "@/lib/plans";
import { ArrowRight, Card, Check, MarketingShell, PageHero, SectionLabel } from "@/components/marketing/Marketing";

type Plan = {
  id: PlanId;
  blurb: string;
  featured?: boolean;
};

const PLANS: Plan[] = [
  { id: "indie", blurb: "One product, a few prompts in flight." },
  { id: "starter", blurb: "A team shipping AI features every week." },
  { id: "pro", blurb: "AI in the critical path, at volume.", featured: true },
];

const INCLUDED: Array<[string, string]> = [
  ["Canary rollouts", "Shift traffic to a new prompt or model in steps, with a quality gate on each."],
  ["LLM judge", "Every sampled response scored on helpfulness, accuracy and clarity, with reasons."],
  ["Automatic rollback", "Quality drops below your threshold, the candidate goes to 0% — no pager needed."],
  ["Request log", "Prompt, response, cost and the judge's verdict for each request, with filters."],
  ["Five providers", "OpenAI, Anthropic, Gemini, OpenRouter and the Vercel AI Gateway."],
  ["Failover & routing", "Fall back across providers on errors; route requests by rules you define."],
  ["Alerts", "Email, Slack and signed webhooks when a rollout rolls back or a provider fails."],
  ["Dashboard & CLI", "Create and watch rollouts from the browser or from your terminal."],
];

const FAQ: Array<[string, string]> = [
  [
    "What counts as an evaluation?",
    "One response scored by the LLM judge. Health checks — empty answers, errors, refusals, latency — run on every request at no charge and never count.",
  ],
  [
    "Do you charge for my model usage?",
    "No. You bring your own provider keys and pay your provider directly; Repath never resells or marks up tokens. Judging runs on our key and is covered by your plan.",
  ],
  [
    "What happens when I reach my evaluation limit?",
    "Judging pauses until next month or an upgrade. Your requests keep flowing, health checks keep running, and nothing in your app changes.",
  ],
  [
    "How does the free trial work?",
    "Seven days with every feature and 1,000 judged evaluations. No card needed. When it ends, your traffic still flows through Repath — rollouts just stop routing until you choose a plan, so your app never breaks.",
  ],
  [
    "Do you store my prompts and responses?",
    "Yes, for the request log and for judging: 7 days on Indie and Starter, 90 on Pro, then deleted automatically. You can turn capture off in Settings. Judging runs through the Vercel AI Gateway. If data must never leave your network, self-host Repath.",
  ],
  [
    "How do I pay?",
    "Cards, UPI and net banking through Razorpay, billed monthly in INR. Dollar prices are shown for reference.",
  ],
  [
    "Can I cancel?",
    "Any time, from Billing. Your plan stays active until the end of the period you have paid for, and you are not charged again.",
  ],
];

function PlanCard({ plan: { id, blurb, featured } }: { plan: Plan }) {
  const plan = { ...CATALOG[id], blurb, featured };
  return (
    <div
      style={{
        position: "relative",
        border: `1px solid ${plan.featured ? "var(--accent-line)" : "var(--line2)"}`,
        borderRadius: 20,
        background: plan.featured ? "var(--panel-grad)" : "var(--card)",
        boxShadow: plan.featured ? "var(--shadow)" : undefined,
        padding: 30,
        display: "flex",
        flexDirection: "column",
        gap: 22,
      }}
    >
      {plan.featured && (
        <span
          className="lp-mono"
          style={{
            position: "absolute",
            top: -11,
            left: 30,
            fontSize: 10,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            padding: "4px 9px",
            borderRadius: 6,
            border: "1px solid var(--accent-line)",
            background: "var(--bg)",
            color: "var(--accent)",
          }}
        >
          Most teams
        </span>
      )}
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px" }}>{plan.name}</h2>
        <p style={{ fontSize: 14, color: "var(--fg3)", margin: 0 }}>{plan.blurb}</p>
      </div>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: "-0.04em" }}>{plan.usd}</span>
          <span style={{ fontSize: 14, color: "var(--fg3)" }}>/ month</span>
        </div>
        <p className="lp-mono" style={{ fontSize: 11, color: "var(--fg4)", margin: "4px 0 0" }}>
          {plan.inr} billed monthly in INR
        </p>
      </div>
      <div style={{ borderTop: "1px solid var(--line2)", paddingTop: 20, display: "flex", flexDirection: "column", gap: 11 }}>
        <div style={{ display: "flex", gap: 10, fontSize: 15 }}>
          <Check color="var(--accent)" />
          <span>
            <strong style={{ fontWeight: 600 }}>{plan.evaluations.toLocaleString("en-US")}</strong> judged evaluations / month
          </span>
        </div>
        {plan.facts.map((f) => (
          <div key={f} style={{ display: "flex", gap: 10, fontSize: 15, color: "var(--fg2)" }}>
            <Check />
            <span>{f}</span>
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, fontSize: 15, color: "var(--fg2)" }}>
          <Check />
          <span>Everything below</span>
        </div>
      </div>
      <Link
        href={`/signup?plan=${plan.id}`}
        className={plan.featured ? "lp-btn-primary" : "lp-btn-ghost"}
        style={{
          marginTop: "auto",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          height: 46,
          borderRadius: 11,
          fontSize: 15,
          fontWeight: 550,
          ...(plan.featured
            ? { background: "var(--btn-bg)", color: "var(--btn-fg)" }
            : { border: "1px solid var(--line)", color: "var(--fg)" }),
        }}
      >
        Start free trial <ArrowRight />
      </Link>
    </div>
  );
}

export default function PricingPage() {
  return (
    <MarketingShell>
      <PageHero
        eyebrow="Pricing"
        title="Pay for judged responses, not seats."
        lead="Every plan includes the whole product. Plans differ in how many responses we judge each month and how long the request log keeps them."
      >
        <div
          className="lp-mono"
          style={{
            marginTop: 28,
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "9px 14px",
            borderRadius: 999,
            border: "1px solid var(--adv-line)",
            background: "var(--adv-soft)",
            color: "var(--adv)",
            fontSize: 12,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--adv)" }} />
          7-day free trial · 1,000 judged evaluations · no card
        </div>
      </PageHero>

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "56px 40px 0" }}>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {PLANS.map((p) => (
            <PlanCard key={p.id} plan={p} />
          ))}
        </div>

        <Card style={{ marginTop: 20, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Enterprise</h2>
            <p style={{ fontSize: 15, color: "var(--fg2)", margin: 0, maxWidth: "62ch" }}>
              Higher evaluation volume, custom retention, invoiced billing, and help running Repath inside your own
              infrastructure.
            </p>
          </div>
          <Link
            href="/contact"
            className="lp-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 44,
              padding: "0 20px",
              borderRadius: 11,
              border: "1px solid var(--line)",
              fontSize: 15,
              fontWeight: 550,
            }}
          >
            Talk to us <ArrowRight />
          </Link>
        </Card>
      </section>

      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "104px 40px 0" }}>
        <SectionLabel>In every plan</SectionLabel>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, background: "var(--line2)", border: "1px solid var(--line2)", borderRadius: 18, overflow: "hidden" }}>
          {INCLUDED.map(([h, d]) => (
            <div key={h} style={{ background: "var(--bg)", padding: "24px 22px" }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 8px" }}>{h}</h3>
              <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--fg3)", margin: 0 }}>{d}</p>
            </div>
          ))}
        </div>
        <p style={{ fontSize: 14, color: "var(--fg3)", margin: "18px 0 0" }}>
          Prefer to run it yourself? Repath is source-available —{" "}
          <a className="lp-doclink" href="https://github.com/repathhq/repath">self-host it from GitHub</a>.
        </p>
      </section>

      <section className="lp-pad" style={{ maxWidth: 860, margin: "0 auto", padding: "104px 40px 120px" }}>
        <SectionLabel>Questions</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {FAQ.map(([q, a]) => (
            <div key={q} style={{ padding: "22px 0", borderBottom: "1px solid var(--line2)" }}>
              <h3 style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 8px" }}>{q}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--fg2)", margin: 0 }}>{a}</p>
            </div>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
