"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import {
  Search, ChevronRight, GitBranch, Zap, Shield, BarChart2,
  RefreshCw, Cloud, Code2, Terminal, BookOpen, Copy, Check,
  AlertTriangle, Info, CheckCircle2
} from "lucide-react";

/* ── Copy button ─────────────────────────────────────────────────────── */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="absolute top-3 right-3 p-1.5 rounded-md bg-gray-700 hover:bg-gray-600 transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5 text-gray-300" />}
    </button>
  );
}

/* ── Code block ──────────────────────────────────────────────────────── */
function Code({ lang, children }: { lang?: string; children: string }) {
  return (
    <div className="relative rounded-xl bg-gray-900 overflow-hidden my-4">
      {lang && <div className="px-4 py-2 border-b border-gray-800 text-[11px] text-gray-400 font-mono uppercase tracking-wider">{lang}</div>}
      <pre className="p-4 text-[13px] text-gray-200 font-mono leading-relaxed overflow-x-auto whitespace-pre">{children.trim()}</pre>
      <CopyButton text={children.trim()} />
    </div>
  );
}

/* ── Note / Warning / Tip boxes ─────────────────────────────────────── */
function Note({ type = "info", children }: { type?: "info"|"warning"|"success"; children: React.ReactNode }) {
  const styles = {
    info:    { bg: "bg-blue-50 border-blue-200",   icon: Info,          ic: "text-blue-500",   tx: "text-blue-800" },
    warning: { bg: "bg-amber-50 border-amber-200", icon: AlertTriangle, ic: "text-amber-500",  tx: "text-amber-800" },
    success: { bg: "bg-emerald-50 border-emerald-200", icon: CheckCircle2, ic: "text-emerald-500", tx: "text-emerald-800" },
  }[type];
  const Icon = styles.icon;
  return (
    <div className={`flex gap-3 p-4 rounded-xl border ${styles.bg} my-4`}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${styles.ic}`} strokeWidth={2} />
      <div className={`text-[14px] leading-relaxed ${styles.tx}`}>{children}</div>
    </div>
  );
}

/* ── Section heading ─────────────────────────────────────────────────── */
function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return <h2 id={id} className="text-[24px] font-bold text-gray-900 mt-12 mb-4 pt-4 scroll-mt-20">{children}</h2>;
}
function H3({ id, children }: { id?: string; children: React.ReactNode }) {
  return <h3 id={id} className="text-[17px] font-semibold text-gray-900 mt-8 mb-3 scroll-mt-20">{children}</h3>;
}

/* ── Sidebar nav items ───────────────────────────────────────────────── */
const navSections = [
  { label: "Getting Started", items: [
    { label: "Introduction", href: "#intro" },
    { label: "Quick start", href: "#quickstart" },
    { label: "Integration", href: "#integrate" },
    { label: "Core concepts", href: "#concepts" },
  ]},
  { label: "Canary Deployments", items: [
    { label: "Creating a rollout", href: "#create" },
    { label: "Traffic splitting", href: "#traffic" },
    { label: "Quality gates", href: "#gates" },
    { label: "Shadow mode", href: "#shadow" },
  ]},
  { label: "LLM-as-Judge", items: [
    { label: "How it works", href: "#eval" },
    { label: "Writing criteria", href: "#criteria" },
    { label: "Judge models", href: "#judge-models" },
    { label: "Composite scoring", href: "#scoring" },
  ]},
  { label: "Auto-Rollback", items: [
    { label: "How rollback works", href: "#rollback-how" },
    { label: "Configuration", href: "#rollback-config" },
    { label: "Audit trail", href: "#audit" },
  ]},
  { label: "Provider Failover", items: [
    { label: "Supported providers", href: "#providers" },
    { label: "Failover config", href: "#failover-config" },
    { label: "Circuit breaker", href: "#circuit" },
  ]},
  { label: "API Reference", items: [
    { label: "Authentication", href: "#auth" },
    { label: "Rollouts API", href: "#rollouts-api" },
    { label: "Decisions API", href: "#decisions-api" },
    { label: "Webhooks", href: "#webhooks" },
  ]},
];

/* ── Main page ───────────────────────────────────────────────────────── */
export default function DocsPage() {
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string|null>(null);

  const allItems = navSections.flatMap(s => s.items);
  const searchResults = query.trim()
    ? allItems.filter(i => i.label.toLowerCase().includes(query.toLowerCase()))
    : [];

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* ── Nav ── */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40 shadow-sm">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/repath.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
          <span className="ml-1 text-[13px] text-gray-400 font-normal">/ Docs</span>
        </Link>
        <div className="flex items-center gap-4">
          <div className="relative hidden md:block">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text" placeholder="Search docs..."
              value={query} onChange={e => setQuery(e.target.value)}
              className="pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent w-64"
            />
            {searchResults.length > 0 && (
              <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-200 rounded-xl shadow-lg z-50 overflow-hidden">
                {searchResults.map(r => (
                  <a key={r.href} href={r.href} onClick={() => setQuery("")}
                    className="block px-4 py-2.5 text-[14px] text-gray-700 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                    {r.label}
                  </a>
                ))}
              </div>
            )}
          </div>
          <Link href="/login" className="text-[14px] text-gray-500 hover:text-gray-900">Sign in</Link>
          <Link href="/signup" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800">Start free trial</Link>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto flex">
        {/* ── Sidebar ── */}
        <aside className="hidden lg:block w-64 shrink-0 sticky top-[65px] h-[calc(100vh-65px)] overflow-y-auto border-r border-gray-100 py-8 px-4">
          {navSections.map(s => (
            <div key={s.label} className="mb-6">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest px-3 mb-2">{s.label}</p>
              <ul className="space-y-0.5">
                {s.items.map(item => (
                  <li key={item.href}>
                    <a href={item.href}
                      onClick={() => setActiveSection(item.href)}
                      className={`block px-3 py-2 rounded-lg text-[14px] transition-colors ${activeSection === item.href ? "bg-violet-50 text-violet-700 font-medium" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"}`}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        {/* ── Content ── */}
        <main className="flex-1 px-8 py-12 max-w-3xl">

          {/* ════ GETTING STARTED ════ */}
          <H2 id="intro">Introduction</H2>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            Repath is a transparent proxy that sits between your application and any LLM provider. It enables <strong>progressive delivery for AI</strong> — the same canary deployment patterns used for traditional software, but adapted for the non-deterministic world of LLMs.
          </p>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            When you change a prompt or switch model versions, Repath routes a small percentage of traffic to the new version, evaluates response quality with an AI judge, and automatically promotes or rolls back based on your thresholds — before users notice anything is wrong.
          </p>
          <Note type="success">
            <strong>Key insight:</strong> AI models break silently. HTTP error rates don&apos;t catch quality regressions. A prompt change that drops helpfulness from 0.91 to 0.62 produces zero API errors. Repath catches it.
          </Note>

          <H3>How it works</H3>
          <ol className="list-decimal list-inside space-y-2 text-[14px] text-gray-600 ml-2">
            <li><strong>Point your app at Repath</strong> — change one line (your base URL)</li>
            <li><strong>Create a rollout</strong> — define baseline vs candidate version, traffic split, and quality thresholds</li>
            <li><strong>Repath splits traffic</strong> — routes X% to candidate, rest to baseline</li>
            <li><strong>LLM Judge scores responses</strong> — evaluates every response async (~120ms), zero latency added</li>
            <li><strong>Controller decides</strong> — every 30 seconds, checks rolling scores. Quality holds → advance. Quality drops → rollback</li>
          </ol>

          {/* ────────────────────────────────────────── */}
          <H2 id="quickstart">Quick Start</H2>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            Get Repath running in under 5 minutes. You need an account and an OpenAI API key.
          </p>

          <H3>1. Sign up and get your gateway URL</H3>
          <p className="text-[14px] text-gray-600 mb-2">
            After signing up at <Link href="/signup" className="text-violet-600 hover:underline">tryrepath.com/signup</Link>, your dashboard shows your unique gateway URL:
          </p>
          <Code lang="text">{`https://gw.cloud.tryrepath.com/v1`}</Code>

          <H3>2. Change one line in your app</H3>
          <Code lang="python">{`from openai import OpenAI

# Before
client = OpenAI(api_key="sk-...")

# After — that's the entire integration
client = OpenAI(
    api_key="sk-...",
    base_url="https://gw.cloud.tryrepath.com/v1",
    default_headers={"X-Repath-Tenant-Id": "ten_YOUR_ID"}
)`}</Code>
          <Code lang="typescript">{`import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: "https://gw.cloud.tryrepath.com/v1",
  defaultHeaders: { "X-Repath-Tenant-Id": "ten_YOUR_ID" },
});`}</Code>
          <Note type="info">
            Repath is a fully OpenAI-compatible proxy. Streaming, function calling, embeddings — everything works unchanged. Only the base URL changes.
          </Note>

          <H3>3. Create your first rollout</H3>
          <p className="text-[14px] text-gray-600 mb-2">Go to your dashboard → Rollouts → New Rollout, or use the CLI:</p>
          <Code lang="yaml">{`# rollout.yaml
apiVersion: repath/v1
kind: Rollout
metadata:
  name: my-first-canary

spec:
  baseline:
    provider: openai
    model: gpt-4o-mini
    prompt:
      system: "You are a helpful customer support agent."

  candidate:
    provider: openai
    model: gpt-4o-mini
    prompt:
      system: "You are a precise, empathetic support agent. Always confirm you understood the issue before answering."

  strategy:
    type: canary
    steps:
      - weight: 0.05   # 5% to candidate
        duration: 5m
        gate: { quality_score: ">= 0.80" }
      - weight: 0.25
        duration: 10m
        gate: { quality_score: ">= 0.82" }
      - weight: 1.0     # 100% promote

    rollback:
      trigger: { quality_score: "< 0.70" }
      action: instant

  evaluation:
    - type: llm_judge
      model: gpt-4o-mini
      criteria:
        - name: helpfulness
          prompt: "Rate 1-5: Does the response give actionable help?"
          weight: 0.6
        - name: clarity
          prompt: "Rate 1-5: Is the response clear and well-structured?"
          weight: 0.4`}</Code>

          {/* ────────────────────────────────────────── */}
          <H2 id="integrate">Integration</H2>

          <H3>Supported providers</H3>
          <div className="overflow-x-auto my-4">
            <table className="w-full text-[14px] border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Provider</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Base URL to use</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Notes</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["OpenAI", "https://gw.cloud.tryrepath.com/v1", "Drop-in replacement"],
                  ["Anthropic", "https://gw.cloud.tryrepath.com/v1", "Request translation automatic"],
                  ["Google Gemini", "https://gw.cloud.tryrepath.com/v1", "Via OpenAI-compat endpoint"],
                  ["OpenRouter", "https://gw.cloud.tryrepath.com/v1", "Auto-failover hub"],
                  ["Any OpenAI-compat", "https://gw.cloud.tryrepath.com/v1", "Works with any compatible API"],
                ].map(([p, u, n]) => (
                  <tr key={p} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 border border-gray-200 font-medium text-gray-800">{p}</td>
                    <td className="px-4 py-2.5 border border-gray-200 font-mono text-[12px] text-violet-600">{u}</td>
                    <td className="px-4 py-2.5 border border-gray-200 text-gray-500">{n}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H3>Specifying which model to use</H3>
          <p className="text-[14px] text-gray-600 mb-2">
            Pass the model in the request body as normal. For Anthropic, use the Claude model name — Repath auto-translates the request format:
          </p>
          <Code lang="python">{`# OpenAI model
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}]
)

# Anthropic model — same syntax, Repath translates
response = client.chat.completions.create(
    model="claude-3-5-sonnet-20241022",
    messages=[{"role": "user", "content": "Hello"}]
)`}</Code>

          {/* ════ CORE CONCEPTS ════ */}
          <H2 id="concepts">Core Concepts</H2>
          <div className="grid md:grid-cols-2 gap-4 my-4">
            {[
              { term: "Rollout", def: "A controlled experiment comparing a baseline version against a candidate version. Has a lifecycle: created → canary → promoted (or rolled_back)." },
              { term: "Version", def: "A specific combination of model + prompt + parameters. Immutable — each change creates a new version." },
              { term: "Evaluation", def: "A quality score for a single response. Computed by the LLM judge (async) or programmatic checks." },
              { term: "Quality gate", def: "A threshold that traffic must pass before advancing. E.g. `quality_score >= 0.85` to move from 25% to 50%." },
              { term: "Decision", def: "An action taken by the controller: advance, rollback, pause, or promote. Every decision is logged." },
              { term: "Tenant", def: "Your account. In cloud mode, each tenant gets isolated routing, storage, and billing." },
            ].map(({ term, def }) => (
              <div key={term} className="rounded-xl border border-gray-200 p-4">
                <p className="font-semibold text-gray-900 text-[14px] mb-1">{term}</p>
                <p className="text-[13px] text-gray-500 leading-relaxed">{def}</p>
              </div>
            ))}
          </div>

          {/* ════ CANARY DEPLOYMENTS ════ */}
          <H2 id="create">Creating a Rollout</H2>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            A rollout has three required fields: <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[13px] font-mono text-violet-700">baseline</code>, <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[13px] font-mono text-violet-700">candidate</code>, and <code className="bg-gray-100 px-1.5 py-0.5 rounded text-[13px] font-mono text-violet-700">strategy</code>.
          </p>
          <Code lang="yaml">{`spec:
  baseline:
    provider: openai          # openai | anthropic | gemini
    model: gpt-4o-mini
    prompt:
      system: "Current system prompt"
    parameters:
      temperature: 0.7
      max_tokens: 512

  candidate:
    provider: openai
    model: gpt-4o             # Testing a bigger model
    prompt:
      system: "Improved system prompt"
    parameters:
      temperature: 0.5
      max_tokens: 512`}</Code>

          <H2 id="traffic">Traffic Splitting</H2>
          <H3>Weights</H3>
          <p className="text-[14px] text-gray-600 mb-2">
            Traffic weight is a float from 0.0 to 1.0. A weight of 0.10 routes 10% of requests to the candidate.
          </p>
          <H3>Sticky sessions</H3>
          <p className="text-[14px] text-gray-600 mb-2">
            Pass <code className="bg-gray-100 px-1 rounded font-mono text-[13px]">X-User-Id</code> or <code className="bg-gray-100 px-1 rounded font-mono text-[13px]">X-Session-Id</code> in your requests. Repath uses consistent hashing so the same user always sees the same version during a rollout — no jarring switches mid-conversation.
          </p>
          <Code lang="python">{`response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[...],
    extra_headers={"X-User-Id": "user_abc123"}  # Sticky routing
)`}</Code>

          <H2 id="gates">Quality Gates</H2>
          <p className="text-[14px] text-gray-600 mb-2">
            Each step in a rollout has a gate that must pass before traffic advances. Gates are evaluated every 30 seconds against the rolling 10-minute average.
          </p>
          <Code lang="yaml">{`strategy:
  steps:
    - weight: 0.05
      duration: 5m
      gate:
        quality_score: ">= 0.80"   # Must score ≥ 0.80 avg over last 10m
        error_rate: "< 0.05"       # Less than 5% errors

    - weight: 0.25
      duration: 10m
      gate:
        quality_score: ">= 0.82"

    - weight: 1.0                  # Final step — no gate needed

  rollback:
    trigger:
      quality_score: "< 0.70"      # Instant rollback if below this
    action: instant                # instant | gradual
    cooldown: 10m                  # Wait 10m before trying again`}</Code>
          <Note type="warning">
            <strong>Minimum samples:</strong> The controller requires at least 10 evaluated responses before making any advance/rollback decision. This prevents false positives from tiny sample sizes.
          </Note>

          <H2 id="shadow">Shadow Mode</H2>
          <p className="text-[14px] text-gray-600 mb-4">
            Shadow mode runs the candidate <em>in parallel</em> without serving its responses to users. All requests go to baseline (users see nothing different), but the candidate also processes every request for evaluation purposes.
          </p>
          <p className="text-[14px] text-gray-600 mb-2">Use shadow mode when:</p>
          <ul className="list-disc list-inside space-y-1 text-[14px] text-gray-600 ml-2 mb-4">
            <li>You want to evaluate a new prompt with zero risk before any canary exposure</li>
            <li>Your model is expensive — you need to validate cost before scaling</li>
            <li>You&apos;re testing a significantly different prompt that might confuse users if they see it</li>
          </ul>
          <Code lang="yaml">{`strategy:
  type: shadow   # shadow mode — no user impact
  duration: 30m
  gate:
    quality_score: ">= 0.85"
  # After shadow completes successfully, can be manually promoted to canary`}</Code>

          {/* ════ LLM-AS-JUDGE ════ */}
          <H2 id="eval">LLM-as-Judge: How It Works</H2>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            After every proxied request, Repath enqueues the request/response pair to a Redis Stream. Python evaluation workers consume from this stream and score the response using an LLM judge. This is fully asynchronous — evaluation never blocks or slows your actual requests.
          </p>
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-5 font-mono text-[12px] text-gray-600 my-4 leading-relaxed">
            <span className="text-violet-600">Your App</span> → <span className="text-gray-400">request</span> → <span className="text-indigo-600">Repath Gateway</span> → <span className="text-gray-400">response (immediate)</span> → <span className="text-violet-600">Your App</span><br/>
            <span className="text-gray-300 ml-20">↓ async (non-blocking)</span><br/>
            <span className="text-gray-300 ml-20">Redis Stream → Evaluator → LLM Judge → Score → DB</span>
          </div>
          <p className="text-[14px] text-gray-500">Evaluation latency: ~120ms. User-visible latency added: 0ms.</p>

          <H2 id="criteria">Writing Evaluation Criteria</H2>
          <p className="text-[14px] text-gray-600 mb-2">
            Criteria are plain-English prompts sent to the judge model. The judge rates each criterion 1–5, which is normalized to 0–1.
          </p>
          <Code lang="yaml">{`evaluation:
  - type: llm_judge
    model: gpt-4o-mini    # Fast and cheap — ideal for judging
    sample_rate: 1.0       # Score 100% of responses (or set 0.5 for 50%)
    criteria:
      - name: helpfulness
        prompt: "Rate 1-5: Does this response give specific, actionable help?"
        weight: 0.5

      - name: accuracy
        prompt: "Rate 1-5: Is the information factually correct and complete?"
        weight: 0.3

      - name: tone
        prompt: "Rate 1-5: Is the tone professional and appropriate?"
        weight: 0.2`}</Code>
          <Note type="info">
            <strong>Cost tip:</strong> gpt-4o-mini costs ~$0.14 per 1,000 evaluations. For 10,000 requests/day at 100% sample rate, evaluation costs ~$1.40/day.
          </Note>

          <H2 id="judge-models">Supported Judge Models</H2>
          <div className="overflow-x-auto my-4">
            <table className="w-full text-[14px] border-collapse">
              <thead><tr className="bg-gray-50">
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Model</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Quality</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Cost / 1K evals</th>
                <th className="text-left px-4 py-2.5 font-semibold text-gray-700 border border-gray-200">Recommended for</th>
              </tr></thead>
              <tbody>
                {[
                  ["gpt-4o-mini", "Good", "~$0.14", "Default — best cost/quality"],
                  ["gpt-4o", "Excellent", "~$2.00", "High-stakes rollouts"],
                  ["claude-3-5-haiku", "Good", "~$0.20", "Anthropic-only stacks"],
                  ["claude-3-5-sonnet", "Excellent", "~$3.00", "Complex evaluation criteria"],
                  ["gemini-1.5-flash", "Good", "~$0.10", "Budget evaluation"],
                ].map(r => (
                  <tr key={r[0]} className="hover:bg-gray-50">
                    {r.map((cell, i) => <td key={i} className={`px-4 py-2.5 border border-gray-200 ${i===0?"font-mono text-[13px] text-violet-600":"text-gray-600"}`}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <H2 id="scoring">Composite Scoring</H2>
          <p className="text-[14px] text-gray-600 mb-2">
            The overall quality score is a weighted average of all criteria scores:
          </p>
          <Code lang="text">{`composite_score = Σ (criterion_score × weight)

Example:
  helpfulness: 0.85 × 0.5 = 0.425
  accuracy:    0.92 × 0.3 = 0.276
  tone:        0.78 × 0.2 = 0.156
  ─────────────────────────────────
  composite:               0.857 → PASS (threshold: 0.80)`}</Code>

          {/* ════ AUTO-ROLLBACK ════ */}
          <H2 id="rollback-how">Auto-Rollback: How It Works</H2>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            The Repath controller runs on a 30-second tick. On each tick, it queries the rolling 10-minute average quality score for the candidate version. If the score falls below the rollback threshold, it immediately sets candidate weight to 0%, writes a rollback decision to the audit log, and updates the routing config.
          </p>
          <p className="text-[14px] text-gray-600 mb-2">Timeline after a quality drop:</p>
          <ol className="list-decimal list-inside space-y-1.5 text-[14px] text-gray-600 ml-2 mb-4">
            <li>Bad response evaluated by judge (~120ms after response)</li>
            <li>Score written to PostgreSQL</li>
            <li>Controller tick runs (max 30s wait)</li>
            <li>Rolling average computed, threshold exceeded</li>
            <li>Rollback decision written, config updated</li>
            <li>Gateway reads new config (within 5s via cache refresh)</li>
            <li>100% traffic back to baseline</li>
          </ol>
          <p className="text-[13px] text-gray-400">Total time from quality drop to full rollback: typically 35–60 seconds.</p>

          <H2 id="rollback-config">Rollback Configuration</H2>
          <Code lang="yaml">{`rollback:
  trigger:
    quality_score: "< 0.70"    # Rollback when avg drops below 0.70
    error_rate: "> 0.10"       # Or when error rate > 10%
  action: instant              # instant | gradual (gradual: stepwise reduction)
  cooldown: 10m                # Don't attempt canary again for 10 minutes
  notify:
    slack: "#ai-deployments"   # Slack webhook (optional)
    email: "team@company.com"  # Email alert (optional)`}</Code>

          <H2 id="audit">Audit Trail</H2>
          <p className="text-[14px] text-gray-600 mb-4">
            Every advance and rollback decision is stored in the <code className="bg-gray-100 px-1 rounded font-mono text-[13px]">decisions</code> table with the exact scores that triggered it. View via the dashboard or API:
          </p>
          <Code lang="bash">{`# Get decision history for a rollout
curl -H "Authorization: Bearer $REPATH_API_TOKEN" \\
  https://gw.cloud.tryrepath.com/api/v1/rollouts/MY_ROLLOUT_ID/decisions`}</Code>
          <Code lang="json">{`{
  "decisions": [
    {
      "id": "dec_01abc",
      "action": "rollback",
      "reason": "Quality score 0.61 dropped below threshold 0.70",
      "previous_weight": 0.25,
      "new_weight": 0.0,
      "triggered_by": "controller",
      "metrics_snapshot": {
        "avg_quality_candidate": 0.61,
        "avg_quality_baseline": 0.91,
        "sample_count": 847
      },
      "created_at": "2026-06-20T03:47:22Z"
    }
  ]
}`}</Code>

          {/* ════ PROVIDER FAILOVER ════ */}
          <H2 id="providers">Provider Failover</H2>
          <p className="text-[15px] text-gray-600 leading-relaxed mb-4">
            When a provider returns 5xx errors or times out, Repath automatically retries once (after 300ms) then switches to the next provider in your fallback chain. Your app never sees the outage.
          </p>
          <Note type="success">
            <strong>Zero downtime guarantee:</strong> If all configured providers fail, Repath returns <code>X-Repath-Bypass: true</code> so your SDK can call the provider directly. Repath is never a single point of failure.
          </Note>

          <H2 id="failover-config">Failover Configuration</H2>
          <Code lang="yaml">{`providers:
  primary:
    provider: openai
    model: gpt-4o-mini

  fallback:
    - provider: anthropic
      model: claude-3-5-haiku-20241022
    - provider: openrouter              # Catches everything else
      api_key_env: OPENROUTER_API_KEY`}</Code>
          <p className="text-[14px] text-gray-600 mt-3">
            Or set <code className="bg-gray-100 px-1 rounded font-mono text-[13px]">OPENROUTER_API_KEY</code> in your environment — Repath automatically adds OpenRouter as a last-resort fallback for any provider outage.
          </p>

          <H2 id="circuit">Circuit Breaker</H2>
          <p className="text-[14px] text-gray-600 mb-4">
            The circuit breaker tracks error rates per provider per tenant. After 3 consecutive failures, it opens the circuit — all requests for that tenant bypass to the next provider in the chain. After a 5-second cooldown, one probe request is allowed through. If it succeeds, the circuit closes.
          </p>
          <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 font-mono text-[12px] text-gray-600 leading-relaxed">
            Closed (normal) → 3 failures → Open (bypass) → 5s → Half-Open (probe) → success → Closed
          </div>

          {/* ════ API REFERENCE ════ */}
          <H2 id="auth">API Authentication</H2>
          <p className="text-[14px] text-gray-600 mb-2">
            All management API endpoints require a Bearer token. Get yours from the dashboard under Settings → API Token.
          </p>
          <Code lang="bash">{`curl -H "Authorization: Bearer $REPATH_API_TOKEN" \\
  https://gw.cloud.tryrepath.com/api/v1/system/health`}</Code>
          <Note type="warning">
            The proxy endpoint (<code>/v1/*</code>) does NOT require the API token — it uses your LLM provider key passed through from the request.
          </Note>

          <H2 id="rollouts-api">Rollouts API</H2>
          <div className="space-y-4 my-4">
            {[
              { method: "GET", path: "/api/v1/rollouts", desc: "List all rollouts" },
              { method: "GET", path: "/api/v1/rollouts/:id", desc: "Get rollout detail + metrics" },
              { method: "GET", path: "/api/v1/rollouts/:id/metrics", desc: "Time-series quality data (last 60 min)" },
              { method: "GET", path: "/api/v1/rollouts/:id/steps", desc: "Step list with status" },
              { method: "POST", path: "/api/v1/rollouts/:id/promote", desc: "Manually promote to 100%" },
              { method: "POST", path: "/api/v1/rollouts/:id/rollback", desc: "Immediately roll back to baseline" },
            ].map(e => (
              <div key={e.path} className="flex items-start gap-3 p-3 rounded-lg border border-gray-100 hover:bg-gray-50">
                <span className={`shrink-0 px-2 py-0.5 rounded text-[11px] font-bold ${e.method === "GET" ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"}`}>{e.method}</span>
                <code className="text-[13px] font-mono text-violet-600 shrink-0">{e.path}</code>
                <span className="text-[13px] text-gray-500">{e.desc}</span>
              </div>
            ))}
          </div>

          <H2 id="decisions-api">Decisions API</H2>
          <Code lang="bash">{`# Get audit log
GET /api/v1/rollouts/:id/decisions

# Response
{
  "decisions": [{
    "id": "dec_01abc",
    "action": "advance | rollback | promote | pause",
    "reason": "Human-readable explanation",
    "previous_weight": 0.10,
    "new_weight": 0.25,
    "triggered_by": "controller | manual",
    "metrics_snapshot": { ... },
    "created_at": "2026-06-20T03:47:22Z"
  }]
}`}</Code>

          <H2 id="webhooks">Webhooks</H2>
          <p className="text-[14px] text-gray-600 mb-2">
            Repath can POST to your endpoint on rollout events. Configure in your rollout YAML or dashboard:
          </p>
          <Code lang="yaml">{`notify:
  webhook: "https://your-app.com/webhooks/repath"
  events:
    - rollback        # Quality dropped, rolled back
    - promote         # Successfully promoted to 100%
    - advance         # Advanced to next step`}</Code>
          <p className="text-[14px] text-gray-600 mt-3 mb-2">Webhook payload:</p>
          <Code lang="json">{`{
  "event": "rollback",
  "rollout_id": "rol_abc123",
  "rollout_name": "my-canary",
  "action": "rollback",
  "reason": "Quality score 0.61 < threshold 0.70",
  "timestamp": "2026-06-20T03:47:22Z",
  "metrics": {
    "avg_quality_candidate": 0.61,
    "avg_quality_baseline": 0.91
  }
}`}</Code>
          <Note type="info">
            Webhook payloads are signed with HMAC-SHA256. Verify the <code>X-Repath-Signature</code> header against your webhook secret to ensure authenticity.
          </Note>

          {/* ── Footer ── */}
          <div className="mt-16 pt-8 border-t border-gray-100 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[13px] text-gray-400">Last updated: June 2026 · Repath v0.1.0</p>
            <div className="flex gap-4">
              <a href="mailto:hello@tryrepath.com" className="text-[13px] text-violet-600 hover:underline">Get help</a>
              <a href="https://github.com/repathhq/repath/discussions" target="_blank" rel="noopener noreferrer" className="text-[13px] text-violet-600 hover:underline">GitHub Discussions</a>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
