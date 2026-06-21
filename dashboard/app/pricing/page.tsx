"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, ArrowRight, Zap } from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

const plans = [
  {
    name: "Starter",
    price: { inr: "₹4,099", usd: "$49" },
    period: "/ month",
    description: "For small teams shipping AI to production.",
    highlight: false,
    features: [
      "10,000 LLM evaluations/month",
      "3 active rollouts",
      "OpenAI + Anthropic + Gemini",
      "Auto-rollback",
      "7-day data retention",
      "Email alerts",
      "Dashboard + CLI",
      "Community support",
    ],
    cta: "Start 1-week trial",
    ctaHref: "/signup?plan=starter",
  },
  {
    name: "Pro",
    price: { inr: "₹12,499", usd: "$149" },
    period: "/ month",
    description: "For teams with heavy AI traffic.",
    highlight: true,
    features: [
      "100,000 LLM evaluations/month",
      "Unlimited rollouts",
      "All providers (+ Azure)",
      "Auto-rollback",
      "90-day data retention",
      "Slack + webhook alerts",
      "Dashboard + CLI",
      "Custom eval criteria",
      "Priority support",
    ],
    cta: "Start 1-week trial",
    ctaHref: "/signup?plan=pro",
  },
  {
    name: "Enterprise",
    price: { inr: "Custom", usd: "Custom" },
    period: "",
    description: "Dedicated infrastructure + SLA.",
    highlight: false,
    features: [
      "Unlimited evaluations",
      "Dedicated infrastructure",
      "SSO / SAML",
      "Team RBAC",
      "1-year data retention",
      "On-call support",
      "Custom SLA (99.9%+)",
      "Compliance docs (SOC 2, etc.)",
    ],
    cta: "Contact us",
    ctaHref: "mailto:hello@tryrepath.com?subject=Enterprise enquiry",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col">
      {/* Nav */}
      <nav className="border-b border-white/[0.06] bg-[#09090b]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <Image src="/repath.png" alt="Repath" width={28} height={28} className="rounded-lg" />
            <span className="text-[18px] font-bold text-white">Repath</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/" className="text-[14px] text-zinc-400 hover:text-white transition-colors">Home</Link>
            <a
              href="https://github.com/repathhq/repath"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2 text-[13px] text-white transition-all"
            >
              <GithubIcon className="w-4 h-4" />
              GitHub
            </a>
          </div>
        </div>
      </nav>

      {/* Header */}
      <section className="pt-20 pb-16 text-center px-6">
        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[--color-accent]/30 bg-[--color-accent]/[0.06] mb-6">
          <Zap className="w-3.5 h-3.5 text-[--color-accent]" />
          <span className="text-[13px] font-medium text-[--color-accent]">1 week free — no credit card required</span>
        </div>
        <h1 className="text-[40px] md:text-[56px] font-bold text-white mb-4 tracking-tight">
          Simple, honest pricing
        </h1>
        <p className="text-[17px] text-zinc-400 max-w-2xl mx-auto">
          Pay for what you use. Cancel anytime. Prices shown in USD and INR.
        </p>
      </section>

      {/* Plans */}
      <section className="pb-24 px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div
              key={plan.name}
              className={`rounded-2xl border p-8 flex flex-col ${
                plan.highlight
                  ? "border-[--color-accent] bg-[--color-accent]/[0.04]"
                  : "border-white/[0.08] bg-white/[0.02]"
              }`}
            >
              {plan.highlight && (
                <div className="mb-4">
                  <span className="px-3 py-1 rounded-full bg-[--color-accent] text-white text-[11px] font-bold">
                    MOST POPULAR
                  </span>
                </div>
              )}
              <div className="mb-6">
                <h2 className="text-[20px] font-bold text-white mb-2">{plan.name}</h2>
                <p className="text-[14px] text-zinc-400 mb-4">{plan.description}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-[40px] font-bold text-white">{plan.price.usd}</span>
                  <span className="text-zinc-500 text-[15px]">{plan.period}</span>
                </div>
                <div className="text-[13px] text-zinc-500 mt-1">
                  {plan.price.inr !== "Custom" ? `${plan.price.inr}${plan.period} for India` : "Contact for pricing"}
                </div>
              </div>

              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map((f, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-[14px]">
                    <Check className="w-4 h-4 text-[--color-success] shrink-0 mt-0.5" />
                    <span className="text-zinc-300">{f}</span>
                  </li>
                ))}
              </ul>

              <a
                href={plan.ctaHref}
                className={`w-full inline-flex items-center justify-center gap-2 rounded-xl py-3.5 text-[14px] font-semibold transition-all ${
                  plan.highlight
                    ? "bg-[--color-accent] hover:bg-[#6d28d9] text-white shadow-lg shadow-[--color-accent]/25"
                    : "bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-white"
                }`}
              >
                {plan.cta}
                {plan.name !== "Enterprise" && <ArrowRight className="w-4 h-4" />}
              </a>
            </div>
          ))}
        </div>

        {/* Self-hosted note */}
        <div className="max-w-6xl mx-auto mt-8">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
            <p className="text-[15px] text-white font-medium mb-1">
              Want to self-host for free?
            </p>
            <p className="text-[14px] text-zinc-400 mb-4">
              Repath is open source. Run it on your own infrastructure with Docker Compose — forever free.
            </p>
            <a
              href="https://github.com/repathhq/repath"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[14px] text-[--color-accent] hover:underline"
            >
              <GithubIcon className="w-4 h-4" />
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-20 border-t border-white/[0.06] px-6">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-[28px] font-bold text-white text-center mb-12">FAQ</h2>
          <div className="space-y-8">
            {[
              {
                q: "What counts as an evaluation?",
                a: "Every time the LLM judge scores a response — one evaluation. Programmatic checks (response length, latency) are free and unlimited.",
              },
              {
                q: "What happens when I hit my eval limit?",
                a: "Programmatic checks continue running. LLM-judge scoring pauses until the next month. Your app is never affected — the gateway still routes and proxies traffic normally.",
              },
              {
                q: "Do you see my prompts and responses?",
                a: "In cloud mode, yes — we need to evaluate them. All data is encrypted in transit and at rest. We never train models on your data. For privacy-critical workloads, use self-hosted.",
              },
              {
                q: "How does the 1-week trial work?",
                a: "Sign up, get full Pro access for 7 days — no credit card needed. When the trial ends, the gateway pauses (your app auto-bypasses to call providers directly). No surprise charges.",
              },
              {
                q: "Which payment methods are accepted?",
                a: "India: UPI, credit/debit cards, net banking, wallets via Razorpay. International: credit/debit cards, PayPal via Paddle.",
              },
              {
                q: "Can I cancel anytime?",
                a: "Yes. Cancel any time from the dashboard. Your plan stays active until the end of the billing period.",
              },
            ].map(({ q, a }, i) => (
              <div key={i} className="border-b border-white/[0.06] pb-8 last:border-0">
                <h3 className="text-[16px] font-semibold text-white mb-2">{q}</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-8 mt-auto">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Image src="/repath.png" alt="Repath" width={20} height={20} className="rounded" />
            <span className="text-[14px] font-semibold text-white">Repath</span>
            <span className="text-zinc-600 text-[13px]">© 2026</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Home</Link>
            <a href="https://github.com/repathhq/repath" target="_blank" rel="noopener noreferrer" className="text-[13px] text-zinc-500 hover:text-white transition-colors">GitHub</a>
            <a href="mailto:hello@tryrepath.com" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
