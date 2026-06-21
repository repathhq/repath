"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Check, Copy, ArrowRight, ExternalLink, Terminal, Plug, Eye, Rocket } from "lucide-react";

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL ?? "https://gw.cloud.repath.dev";

const steps = [
  {
    num: "1",
    icon: Plug,
    title: "Your gateway URL",
    description: "This is your personal Repath endpoint. Point your app here instead of calling OpenAI directly.",
    code: `${GATEWAY_URL}/v1`,
    lang: "url",
  },
  {
    num: "2",
    icon: Terminal,
    title: "Change one line in your app",
    description: "Replace your OpenAI base URL. Everything else stays the same — models, API keys, streaming.",
    code: `from openai import OpenAI\n\nclient = OpenAI(\n    api_key="sk-...",  # Your OpenAI key (unchanged)\n    base_url="${GATEWAY_URL}/v1",\n    default_headers={\n        "X-Repath-Tenant-Id": "YOUR_TENANT_ID"\n    }\n)`,
    lang: "python",
  },
  {
    num: "3",
    icon: Eye,
    title: "Create your first rollout",
    description: "A rollout compares your current prompt (baseline) against a new version (candidate) and auto-advances or rolls back based on quality.",
    code: `# Install CLI\ncargo install --git https://github.com/repathhq/repath repath-cli\n\n# Or use the dashboard — Rollouts → New Rollout`,
    lang: "bash",
  },
  {
    num: "4",
    icon: Rocket,
    title: "Watch it work",
    description: "Open the dashboard to see live traffic split, quality scores, and rollout decisions in real time.",
    code: null,
    cta: { label: "Open Dashboard", href: "/rollouts" },
  },
];

export default function OnboardingPage() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const copy = (idx: number, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 h-14 flex items-center justify-between sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-icon.png" alt="Repath" width={26} height={26} className="rounded-lg" />
          <span className="text-[15px] font-bold text-gray-900">Repath</span>
        </Link>
        <Link
          href="/rollouts"
          className="text-[13px] text-gray-500 hover:text-gray-900 transition-colors font-medium"
        >
          Skip to Dashboard →
        </Link>
      </nav>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 sm:px-6 py-10 sm:py-16">
        {/* Header */}
        <div className="mb-10">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-[11.5px] font-semibold text-emerald-700">Trial active — 7 days remaining</span>
          </div>
          <h1 className="text-[28px] sm:text-[36px] font-bold text-gray-900 mb-2 tracking-tight">
            Welcome to Repath
          </h1>
          <p className="text-[15px] text-gray-500">
            You&apos;re 4 steps away from shipping AI safely. Takes about 5 minutes.
          </p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-0 mb-10">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center flex-1 last:flex-none">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-[12px] font-bold border-2 transition-all ${
                i === 0
                  ? "border-violet-600 bg-violet-600 text-white"
                  : "border-gray-200 text-gray-400 bg-white"
              }`}>
                {i + 1}
              </div>
              {i < steps.length - 1 && (
                <div className="flex-1 h-px bg-gray-200 mx-2" />
              )}
            </div>
          ))}
        </div>

        {/* Steps */}
        <div className="space-y-4">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div
                key={idx}
                className="rounded-xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden"
              >
                {/* Step header */}
                <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-50">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                    <Icon className="w-4 h-4 text-violet-600" strokeWidth={1.8} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-widest text-gray-400">Step {step.num}</span>
                    </div>
                    <h2 className="text-[14.5px] font-semibold text-gray-900 leading-tight">{step.title}</h2>
                  </div>
                </div>

                {/* Step body */}
                <div className="px-5 py-4">
                  <p className="text-[13.5px] text-gray-500 leading-relaxed mb-4">{step.description}</p>

                  {step.code && (
                    <div className="rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200 bg-white">
                        <span className="text-[10.5px] text-gray-400 font-mono uppercase tracking-widest">{step.lang}</span>
                        <button
                          onClick={() => copy(idx, step.code!)}
                          className="flex items-center gap-1.5 text-[11.5px] text-gray-500 hover:text-gray-900 transition-colors px-2 py-1 rounded hover:bg-gray-100"
                        >
                          {copiedIdx === idx ? (
                            <><Check className="w-3.5 h-3.5 text-emerald-500" /><span className="text-emerald-600">Copied</span></>
                          ) : (
                            <><Copy className="w-3.5 h-3.5" />Copy</>
                          )}
                        </button>
                      </div>
                      <pre className="p-4 text-[12.5px] text-gray-700 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap">
                        {step.code}
                      </pre>
                    </div>
                  )}

                  {step.cta && (
                    <Link
                      href={step.cta.href}
                      className="inline-flex items-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-5 py-2.5 text-[13.5px] font-semibold transition-all shadow-sm"
                    >
                      {step.cta.label}
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Resources */}
        <div className="mt-8 p-5 rounded-xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <h3 className="text-[13.5px] font-semibold text-gray-900 mb-3">Helpful resources</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
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
                className="flex items-center gap-2 text-[13px] text-gray-500 hover:text-violet-600 transition-colors py-1.5 group"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0 group-hover:text-violet-500" strokeWidth={1.8} />
                {label}
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
