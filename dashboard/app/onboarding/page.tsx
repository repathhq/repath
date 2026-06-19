"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Check, Copy, ArrowRight, ExternalLink } from "lucide-react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gw.cloud.repath.dev";

export default function OnboardingPage() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copy = (idx: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  const steps = [
    {
      num: "1",
      title: "Your gateway URL",
      description: "This is your personal Repath endpoint. Point your app here instead of calling OpenAI directly.",
      code: `${GATEWAY_URL}/v1`,
      lang: "url",
    },
    {
      num: "2",
      title: "Change one line in your app",
      description: "Replace your OpenAI base URL. Everything else stays the same — models, API keys, streaming.",
      code: `from openai import OpenAI\n\nclient = OpenAI(\n    api_key="sk-...",  # Your OpenAI key (unchanged)\n    base_url="${GATEWAY_URL}/v1",\n    default_headers={\n        "X-Repath-Tenant-Id": "YOUR_TENANT_ID"  # from your dashboard\n    }\n)`,
      lang: "python",
    },
    {
      num: "3",
      title: "Create your first rollout",
      description: "A rollout compares your current prompt (baseline) against a new version (candidate) and auto-advances or rolls back based on quality.",
      code: `# Install CLI\ncargo install --git https://github.com/repathhq/repath repath-cli\n\n# Or use the dashboard — Rollouts → New Rollout`,
      lang: "bash",
    },
    {
      num: "4",
      title: "Watch it work",
      description: "Open the dashboard to see live traffic split, quality scores, and rollout decisions in real time.",
      code: null,
      cta: {
        label: "Open Dashboard",
        href: "/rollouts",
      },
    },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col">
      {/* Nav */}
      <nav className="border-b border-white/[0.06] bg-[#09090b]/90 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Image src="/logo-icon.png" alt="Repath" width={28} height={28} className="rounded-lg" />
          <span className="text-[18px] font-bold text-white">Repath</span>
        </div>
        <Link
          href="/rollouts"
          className="text-[13px] text-zinc-400 hover:text-white transition-colors"
        >
          Skip to Dashboard →
        </Link>
      </nav>

      <div className="flex-1 max-w-3xl mx-auto w-full px-6 py-16">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[--color-success]/10 border border-[--color-success]/20 mb-4">
            <Check className="w-3.5 h-3.5 text-[--color-success]" />
            <span className="text-[12px] font-medium text-[--color-success]">Trial active — 7 days remaining</span>
          </div>
          <h1 className="text-[32px] md:text-[40px] font-bold text-white mb-3">
            Welcome to Repath
          </h1>
          <p className="text-[16px] text-zinc-400">
            You&apos;re 4 steps away from shipping AI safely. Takes about 5 minutes.
          </p>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-2 mb-12">
          {steps.map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold border-2 ${
                i === 0
                  ? "border-[--color-accent] bg-[--color-accent]/10 text-[--color-accent]"
                  : "border-white/[0.10] text-zinc-600"
              }`}>
                {i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className="w-12 h-px bg-white/[0.06]" />
              )}
            </div>
          ))}
        </div>

        {/* Steps */}
        <div className="space-y-8">
          {steps.map((step, idx) => (
            <div
              key={idx}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-7"
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-7 h-7 rounded-full bg-[--color-accent] flex items-center justify-center text-white font-bold text-[13px]">
                  {step.num}
                </div>
                <h2 className="text-[17px] font-semibold text-white">{step.title}</h2>
              </div>
              <p className="text-[14px] text-zinc-400 leading-relaxed mb-5">{step.description}</p>

              {step.code && (
                <div className="rounded-xl border border-white/[0.08] bg-zinc-900/80 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                    <span className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider">{step.lang}</span>
                    <button
                      onClick={() => copy(idx, step.code!)}
                      className="text-zinc-500 hover:text-white transition-colors p-1"
                    >
                      {copiedIdx === idx
                        ? <Check className="w-4 h-4 text-[--color-success]" />
                        : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <pre className="p-4 text-[13px] text-zinc-300 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
                    {step.code}
                  </pre>
                </div>
              )}

              {step.cta && (
                <Link
                  href={step.cta.href}
                  className="inline-flex items-center gap-2 rounded-xl bg-[--color-accent] hover:bg-[#6d28d9] text-white px-6 py-3 text-[14px] font-semibold transition-all shadow-lg shadow-[--color-accent]/25"
                >
                  {step.cta.label}
                  <ArrowRight className="w-4 h-4" />
                </Link>
              )}
            </div>
          ))}
        </div>

        {/* Resources */}
        <div className="mt-10 p-6 rounded-xl border border-white/[0.06] bg-white/[0.02]">
          <h3 className="text-[15px] font-semibold text-white mb-4">Helpful resources</h3>
          <div className="space-y-3">
            {[
              { label: "Example rollout YAML", href: "https://github.com/repathhq/repath/blob/main/examples/demo-canary.yaml" },
              { label: "CLI reference", href: "https://github.com/repathhq/repath/blob/main/README.md#cli-reference" },
              { label: "Anthropic / Gemini setup", href: "https://github.com/repathhq/repath/blob/main/README.md" },
              { label: "Ask a question", href: "https://github.com/repathhq/repath/discussions" },
            ].map(({ label, href }, i) => (
              <a
                key={i}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-[14px] text-zinc-400 hover:text-white transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
