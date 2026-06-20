"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useEffect, useRef } from "react";
import {
  ArrowRight, Check, Shield, Zap, Eye, GitBranch,
  ChevronRight, TrendingUp, AlertTriangle, RotateCcw,
  Activity
} from "lucide-react";

// ── Animated traffic flow ─────────────────────────────────────────────────────

function TrafficFlow() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(p => p + 1), 60);
    return () => clearInterval(t);
  }, []);

  // Animate dots along SVG paths
  const dots = Array.from({ length: 8 }, (_, i) => ({
    id: i,
    progress: ((tick * 0.8 + i * 45) % 360) / 360,
    isCanary: i % 5 === 0, // 1 in 5 = ~20% canary
  }));

  return (
    <div className="relative w-full h-[260px] select-none">
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 700 260" preserveAspectRatio="xMidYMid meet">
        {/* Glow defs */}
        <defs>
          <filter id="glow-purple">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-blue">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Lines: App → Gateway */}
        <path d="M 90 130 C 160 130, 200 130, 290 130" stroke="rgba(124,58,237,0.25)" strokeWidth="1.5" fill="none" strokeDasharray="5 3"/>
        {/* Gateway → Baseline */}
        <path d="M 370 130 C 430 130, 470 80, 560 80"  stroke="rgba(14,165,233,0.25)"  strokeWidth="1.5" fill="none" strokeDasharray="5 3"/>
        {/* Gateway → Candidate */}
        <path d="M 370 130 C 430 130, 470 180, 560 180" stroke="rgba(217,119,6,0.25)"   strokeWidth="1.5" fill="none" strokeDasharray="5 3"/>

        {/* Animated traffic dots */}
        {dots.map(dot => {
          const isInbound = dot.progress < 0.38;
          const isBaseline = !dot.isCanary && dot.progress >= 0.38;
          const isCanarySeg = dot.isCanary && dot.progress >= 0.38;

          let cx = 0, cy = 0;
          if (isInbound) {
            const t = dot.progress / 0.38;
            cx = 90 + t * 200; cy = 130;
          } else if (isBaseline) {
            const t = (dot.progress - 0.38) / 0.62;
            cx = 370 + t * 190;
            cy = 130 + (t * -50);
          } else {
            const t = (dot.progress - 0.38) / 0.62;
            cx = 370 + t * 190;
            cy = 130 + (t * 50);
          }

          return (
            <circle
              key={dot.id}
              cx={cx} cy={cy} r={dot.isCanary ? 3.5 : 4}
              fill={isInbound ? "#7c3aed" : isBaseline ? "#0ea5e9" : "#d97706"}
              opacity={0.9}
              filter={`url(#glow-${isInbound ? "purple" : "blue"})`}
            />
          );
        })}

        {/* Node: Your App */}
        <rect x="10" y="105" width="75" height="50" rx="10" fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
        <text x="47" y="128" textAnchor="middle" fill="#a1a1aa" fontSize="9" fontFamily="monospace">YOUR</text>
        <text x="47" y="142" textAnchor="middle" fill="#a1a1aa" fontSize="9" fontFamily="monospace">APP</text>

        {/* Node: Repath Gateway (center, glowing) */}
        <rect x="290" y="98" width="80" height="64" rx="12" fill="rgba(124,58,237,0.12)" stroke="rgba(124,58,237,0.4)" strokeWidth="1.5"/>
        <rect x="290" y="98" width="80" height="64" rx="12" fill="none" stroke="rgba(124,58,237,0.15)" strokeWidth="8"/>
        <text x="330" y="122" textAnchor="middle" fill="#a78bfa" fontSize="8" fontFamily="monospace" fontWeight="bold">REPATH</text>
        <text x="330" y="136" textAnchor="middle" fill="#a78bfa" fontSize="8" fontFamily="monospace" fontWeight="bold">GATEWAY</text>
        <text x="330" y="152" textAnchor="middle" fill="rgba(124,58,237,0.6)" fontSize="7" fontFamily="monospace">routes + scores</text>

        {/* Node: Baseline */}
        <rect x="562" y="55" width="78" height="50" rx="10" fill="rgba(14,165,233,0.08)" stroke="rgba(14,165,233,0.3)" strokeWidth="1"/>
        <text x="601" y="77" textAnchor="middle" fill="#38bdf8" fontSize="9" fontFamily="monospace" fontWeight="bold">BASELINE</text>
        <text x="601" y="91" textAnchor="middle" fill="rgba(14,165,233,0.5)" fontSize="8" fontFamily="monospace">~80% traffic</text>

        {/* Node: Candidate */}
        <rect x="562" y="155" width="78" height="50" rx="10" fill="rgba(217,119,6,0.08)" stroke="rgba(217,119,6,0.3)" strokeWidth="1"/>
        <text x="601" y="177" textAnchor="middle" fill="#fbbf24" fontSize="9" fontFamily="monospace" fontWeight="bold">CANDIDATE</text>
        <text x="601" y="191" textAnchor="middle" fill="rgba(217,119,6,0.5)" fontSize="8" fontFamily="monospace">~20% traffic</text>

        {/* Labels */}
        <text x="185" y="120" textAnchor="middle" fill="rgba(124,58,237,0.6)" fontSize="8" fontFamily="monospace">all requests</text>
        <text x="460" y="70"  textAnchor="middle" fill="rgba(14,165,233,0.6)"  fontSize="8" fontFamily="monospace">current prompt</text>
        <text x="460" y="205" textAnchor="middle" fill="rgba(217,119,6,0.6)"   fontSize="8" fontFamily="monospace">new prompt (canary)</text>

        {/* Evaluator arrow from gateway down */}
        <path d="M 330 162 L 330 220" stroke="rgba(167,139,250,0.2)" strokeWidth="1" strokeDasharray="4 3"/>
        <rect x="270" y="220" width="120" height="30" rx="8" fill="rgba(124,58,237,0.06)" stroke="rgba(124,58,237,0.2)" strokeWidth="1"/>
        <text x="330" y="239" textAnchor="middle" fill="rgba(167,139,250,0.7)" fontSize="8" fontFamily="monospace">LLM Judge → auto-rollback</text>
      </svg>
    </div>
  );
}

// ── Animated quality score bars ───────────────────────────────────────────────

function QualityBars() {
  const scores = [0.92, 0.89, 0.91, 0.93, 0.88, 0.85, 0.72, 0.65];
  return (
    <div className="relative h-[100px] flex items-end gap-1.5 px-2">
      {scores.map((score, idx) => {
        const bad = score < 0.70;
        const warn = score >= 0.70 && score < 0.80;
        return (
          <div key={idx} className="flex-1 flex flex-col items-center gap-1">
            <span className={`text-[9px] font-mono ${bad ? "text-red-400" : warn ? "text-yellow-400" : "text-emerald-400"}`}>
              {score.toFixed(2)}
            </span>
            <div
              className={`w-full rounded-t transition-all ${bad ? "bg-red-500" : warn ? "bg-yellow-500" : "bg-emerald-500"}`}
              style={{ height: `${score * 65}px` }}
            />
          </div>
        );
      })}
      {/* Threshold line */}
      <div className="absolute left-2 right-2 border-t border-dashed border-red-500/40" style={{ bottom: "46px" }}>
        <span className="absolute right-0 -top-4 text-[9px] text-red-400/70">rollback threshold</span>
      </div>
      {/* Rollback badge */}
      <div className="absolute bottom-0 right-2 flex items-center gap-1 px-2 py-1 rounded bg-red-500/10 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-ping" />
        <span className="text-[9px] text-red-400 font-medium">Auto-rollback triggered</span>
      </div>
    </div>
  );
}

// ── Rollout progress bar ──────────────────────────────────────────────────────

function RolloutProgress() {
  const steps = [
    { label: "5%",   status: "done"    },
    { label: "25%",  status: "done"    },
    { label: "50%",  status: "active"  },
    { label: "100%", status: "pending" },
  ];
  return (
    <div className="relative flex items-center justify-between px-4 py-3">
      <div className="absolute left-10 right-10 top-1/2 -translate-y-1/2 h-[2px] bg-white/[0.06]">
        <div className="h-full w-[55%] bg-gradient-to-r from-emerald-500 to-violet-500 rounded-full">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-violet-400 animate-ping" />
        </div>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="relative flex flex-col items-center gap-2 z-10">
          <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
            s.status === "done"    ? "bg-emerald-500/20 border-emerald-500 text-emerald-400" :
            s.status === "active"  ? "bg-violet-500/20 border-violet-400 text-violet-300 animate-pulse" :
            "bg-zinc-900 border-zinc-700 text-zinc-600"
          }`}>{s.label}</div>
          <span className={`text-[10px] font-medium ${
            s.status === "done" ? "text-emerald-400" :
            s.status === "active" ? "text-violet-400" : "text-zinc-600"
          }`}>{s.status === "done" ? "✓ passed" : s.status === "active" ? "live" : "pending"}</span>
        </div>
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LandingPage() {
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const plans = [
    {
      name: "Starter",
      price: "$49",
      inr: "₹4,099",
      period: "/month",
      evals: "10,000 evals/mo",
      highlight: false,
      features: [
        "3 active rollouts",
        "OpenAI + Anthropic + Gemini",
        "Auto-rollback",
        "7-day data retention",
        "Email alerts",
        "Dashboard + API",
      ],
      cta: "Start free trial",
      href: "/signup?plan=starter",
    },
    {
      name: "Pro",
      price: "$149",
      inr: "₹12,499",
      period: "/month",
      evals: "100,000 evals/mo",
      highlight: true,
      features: [
        "Unlimited rollouts",
        "All providers + OpenRouter fallback",
        "Auto-rollback",
        "90-day data retention",
        "Slack + webhook alerts",
        "Custom eval criteria",
        "Priority support",
      ],
      cta: "Start free trial",
      href: "/signup?plan=pro",
    },
    {
      name: "Enterprise",
      price: "Custom",
      inr: "Custom",
      period: "",
      evals: "Unlimited evals",
      highlight: false,
      features: [
        "Dedicated infrastructure",
        "SSO / SAML",
        "Team RBAC",
        "1-year data retention",
        "On-call support",
        "Custom SLA",
      ],
      cta: "Contact us",
      href: "mailto:hello@tryrepath.com?subject=Enterprise",
    },
  ];

  return (
    <div className="min-h-screen bg-[#09090b] text-white">

      {/* ── Nav ─────────────────────────────────────────────────── */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${navScrolled ? "bg-[#09090b]/95 border-b border-white/[0.06] backdrop-blur-md" : ""}`}>
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <Image src="/logo-icon.png" alt="Repath" width={30} height={30} className="rounded-lg" />
            <span className="text-[19px] font-bold tracking-tight">Repath</span>
          </Link>
          <div className="hidden md:flex items-center gap-8">
            {[["#features","Features"],["#how","How It Works"],["#pricing","Pricing"]].map(([href, label]) => (
              <a key={href} href={href} className="text-[14px] text-zinc-400 hover:text-white transition-colors">{label}</a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="text-[14px] text-zinc-400 hover:text-white transition-colors hidden sm:block">Sign in</Link>
            <Link href="/signup" className="inline-flex items-center gap-1.5 bg-violet-600 hover:bg-violet-500 text-white px-5 py-2.5 rounded-lg text-[14px] font-semibold transition-all shadow-lg shadow-violet-600/20 hover:shadow-violet-500/30">
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <section className="relative pt-32 pb-20 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[500px] bg-violet-600/[0.06] rounded-full blur-[140px]" />
          <div className="absolute top-1/3 left-[15%] w-[400px] h-[400px] bg-blue-600/[0.04] rounded-full blur-[120px]" />
          <div className="absolute top-1/3 right-[15%] w-[400px] h-[400px] bg-amber-600/[0.03] rounded-full blur-[120px]" />
          {/* Dot grid */}
          <div className="absolute inset-0" style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)",
            backgroundSize: "32px 32px"
          }}/>
        </div>

        <div className="relative max-w-5xl mx-auto px-6 text-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-violet-600/10 border border-violet-500/20 mb-8">
            <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse" />
            <span className="text-[13px] font-medium text-violet-300">AI-native progressive delivery · 7-day free trial</span>
          </div>

          {/* H1 */}
          <h1 className="text-[52px] md:text-[72px] lg:text-[82px] font-bold leading-[1.0] tracking-tight mb-7">
            Ship AI changes
            <br />
            <span className="bg-gradient-to-r from-violet-400 via-violet-300 to-indigo-400 bg-clip-text text-transparent">
              without the risk.
            </span>
          </h1>

          <p className="text-[18px] md:text-[21px] text-zinc-400 max-w-3xl mx-auto mb-10 leading-relaxed">
            Canary deployments for LLM prompts and models. Repath splits traffic, scores every response with an AI judge, and <span className="text-white font-medium">rolls back automatically</span> before your users notice.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link href="/signup" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-9 py-4 rounded-xl text-[16px] font-bold transition-all shadow-2xl shadow-violet-600/30 hover:shadow-violet-500/40 hover:-translate-y-0.5">
              Start free trial
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link href="#pricing" className="inline-flex items-center gap-2 bg-white/[0.05] hover:bg-white/[0.08] border border-white/[0.08] text-white px-9 py-4 rounded-xl text-[16px] font-medium transition-all hover:-translate-y-0.5">
              See pricing
            </Link>
          </div>

          {/* Social proof strip */}
          <div className="flex flex-wrap items-center justify-center gap-6 text-[13px] text-zinc-500 mb-16">
            {[
              "No credit card to start",
              "7-day free trial",
              "Cancel anytime",
              "UPI & cards accepted",
            ].map((t, i) => (
              <span key={i} className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-violet-400" />{t}
              </span>
            ))}
          </div>

          {/* Traffic Flow Animation */}
          <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] backdrop-blur p-6 md:p-8 max-w-3xl mx-auto">
            <div className="flex items-center gap-2 mb-1">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                <div className="w-3 h-3 rounded-full bg-[#28c840]" />
              </div>
              <span className="text-[11px] text-zinc-500 font-mono ml-2">live traffic routing</span>
              <span className="ml-auto flex items-center gap-1 text-[11px] text-emerald-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                live
              </span>
            </div>
            <TrafficFlow />
          </div>
        </div>
      </section>

      {/* ── Problem ─────────────────────────────────────────────── */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-[38px] md:text-[50px] font-bold mb-4">
              AI models break <span className="text-red-400">silently.</span>
            </h2>
            <p className="text-[17px] text-zinc-400 max-w-2xl mx-auto">
              Zero HTTP errors. Zero exceptions. Just worse outputs your users silently abandon — and you don't know for days.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            {[
              { icon: Activity,      title: "Provider updates break you",       body: "OpenAI pushes model updates silently. Your prompt that scored 0.93 yesterday scores 0.61 today." },
              { icon: AlertTriangle, title: "Weeks before you find out",         body: "Without quality scoring, regressions hide until users complain. By then, churn has already happened." },
              { icon: TrendingUp,    title: "Feature flags don't work for AI", body: "Flags control deployment, not quality. They can't answer: 'is the new version actually better?'" },
            ].map(({ icon: Icon, title, body }, i) => (
              <div key={i} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-7 hover:border-red-500/20 transition-all">
                <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center mb-4">
                  <Icon className="w-5 h-5 text-red-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-[16px] font-semibold mb-2">{title}</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Quality drop visualization */}
          <div className="max-w-xl mx-auto rounded-xl border border-white/[0.06] bg-white/[0.02] p-6">
            <p className="text-[13px] text-zinc-400 text-center mb-4">Quality score over time — Repath catches the drop instantly</p>
            <QualityBars />
          </div>
        </div>
      </section>

      {/* ── How it works ────────────────────────────────────────── */}
      <section id="how" className="py-24 border-t border-white/[0.05] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-[38px] md:text-[50px] font-bold mb-4">How it works</h2>
            <p className="text-[17px] text-zinc-400 max-w-xl mx-auto">Three steps. Automatic. No code changes beyond one line.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-14">
            {[
              { n: "01", icon: GitBranch,  color: "blue",   title: "Split traffic",     body: "Point your app at Repath instead of OpenAI directly. We route a small % to your new prompt or model — users see nothing different." },
              { n: "02", icon: Eye,        color: "violet", title: "Score every response", body: "An LLM judge evaluates every response against your quality criteria. Async — never adds latency." },
              { n: "03", icon: RotateCcw,  color: "green",  title: "Auto-advance or rollback", body: "Quality holding? Traffic advances to 100%. Quality drops? Rollback in under 500ms, before your users notice." },
            ].map(({ n, icon: Icon, color, title, body }) => (
              <div key={n} className={`rounded-2xl border p-8 hover:bg-white/[0.03] transition-all ${
                color === "blue"   ? "border-blue-500/20 hover:border-blue-500/30" :
                color === "violet" ? "border-violet-500/20 hover:border-violet-500/30" :
                "border-emerald-500/20 hover:border-emerald-500/30"
              } bg-white/[0.02]`}>
                <div className="flex items-center gap-4 mb-5">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${
                    color === "blue" ? "bg-blue-500/10" : color === "violet" ? "bg-violet-500/10" : "bg-emerald-500/10"
                  }`}>
                    <Icon className={`w-5 h-5 ${
                      color === "blue" ? "text-blue-400" : color === "violet" ? "text-violet-400" : "text-emerald-400"
                    }`} strokeWidth={1.5} />
                  </div>
                  <span className={`text-[36px] font-bold opacity-20 ${
                    color === "blue" ? "text-blue-400" : color === "violet" ? "text-violet-400" : "text-emerald-400"
                  }`}>{n}</span>
                </div>
                <h3 className="text-[18px] font-semibold mb-3">{title}</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Rollout progress widget */}
          <div className="max-w-2xl mx-auto rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06]">
              <p className="text-[13px] font-semibold text-white">Rollout: new-support-prompt</p>
              <p className="text-[11px] text-zinc-500 mt-0.5">Quality gate: score ≥ 0.85 to advance</p>
            </div>
            <div className="p-6">
              <RolloutProgress />
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────── */}
      <section id="features" className="py-24 border-t border-white/[0.05]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="text-[38px] md:text-[50px] font-bold mb-4">Everything you need</h2>
            <p className="text-[17px] text-zinc-400 max-w-xl mx-auto">Built specifically for AI deployment safety. Not feature flags with an AI sticker.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: GitBranch, title: "Canary deployments",        body: "5% → 25% → 50% → 100% with configurable quality gates at each step." },
              { icon: Eye,       title: "LLM-as-judge evaluation",   body: "Define criteria in plain English. Scores every response asynchronously — never slows your app." },
              { icon: Shield,    title: "Auto-rollback in <500ms",   body: "Score drops below threshold? Back to baseline instantly. No manual intervention, no on-call alerts." },
              { icon: Zap,       title: "Provider failover",          body: "OpenAI down? We retry, then silently switch to Anthropic or OpenRouter. Your app keeps running." },
              { icon: Activity,  title: "Provider health tracking",  body: "Live error rates per provider. Know about outages before your users do." },
              { icon: TrendingUp, title: "Full audit trail",          body: "Every advance and rollback logged with exact scores. Complete visibility into every decision." },
            ].map(({ icon: Icon, title, body }, i) => (
              <div key={i} className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 hover:border-violet-500/25 hover:bg-violet-600/[0.02] transition-all">
                <div className="w-9 h-9 rounded-lg bg-violet-500/10 group-hover:bg-violet-500/15 flex items-center justify-center mb-4 transition-colors">
                  <Icon className="w-4.5 h-4.5 text-violet-400" strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-semibold mb-2">{title}</h3>
                <p className="text-[13px] text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────────────── */}
      <section id="pricing" className="py-24 border-t border-white/[0.05] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-5">
            <h2 className="text-[38px] md:text-[50px] font-bold mb-4">Simple pricing</h2>
            <p className="text-[17px] text-zinc-400 max-w-xl mx-auto">7-day free trial on every plan. No credit card required to start.</p>
          </div>

          {/* INR note */}
          <p className="text-center text-[13px] text-zinc-500 mb-12">
            🇮🇳 Indian customers: pay in INR via UPI, cards, net banking — powered by Razorpay
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <div key={plan.name} className={`rounded-2xl border flex flex-col p-8 transition-all ${
                plan.highlight
                  ? "border-violet-500/50 bg-violet-600/[0.05] shadow-xl shadow-violet-600/10"
                  : "border-white/[0.08] bg-white/[0.02] hover:border-white/[0.12]"
              }`}>
                {plan.highlight && (
                  <span className="mb-4 self-start px-3 py-1 rounded-full bg-violet-500 text-white text-[11px] font-bold">MOST POPULAR</span>
                )}
                <h3 className="text-[20px] font-bold mb-1">{plan.name}</h3>
                <div className="mb-1">
                  <span className="text-[40px] font-bold">{plan.price}</span>
                  <span className="text-zinc-500 text-[15px]">{plan.period}</span>
                </div>
                {plan.inr !== "Custom" && (
                  <p className="text-[13px] text-zinc-500 mb-1">{plan.inr}{plan.period} in India</p>
                )}
                <p className="text-[13px] text-violet-400 font-medium mb-6">{plan.evals}</p>

                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-[14px]">
                      <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="text-zinc-300">{f}</span>
                    </li>
                  ))}
                </ul>

                <Link href={plan.href} className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-[14px] font-bold transition-all ${
                  plan.highlight
                    ? "bg-violet-600 hover:bg-violet-500 text-white shadow-lg shadow-violet-600/25 hover:-translate-y-0.5"
                    : plan.name === "Enterprise"
                    ? "border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] text-white"
                    : "border border-violet-500/40 text-violet-300 hover:bg-violet-600/10 hover:border-violet-500/70"
                }`}>
                  {plan.cta}
                  {plan.name !== "Enterprise" && <ArrowRight className="w-4 h-4" />}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-[13px] text-zinc-500 mt-8">
            All plans include provider failover, auto-rollback, and real-time dashboard. Cancel anytime.
          </p>
        </div>
      </section>

      {/* ── Final CTA ────────────────────────────────────────────── */}
      <section className="py-24 border-t border-white/[0.05]">
        <div className="max-w-3xl mx-auto px-6 text-center">
          <div className="mb-8 inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-violet-600/10 border border-violet-500/20">
            <Image src="/logo-icon.png" alt="Repath" width={40} height={40} className="rounded-xl" />
          </div>
          <h2 className="text-[36px] md:text-[48px] font-bold mb-4">
            Stop shipping AI blind.
          </h2>
          <p className="text-[17px] text-zinc-400 mb-10 max-w-xl mx-auto">
            Know if your prompt change is better or worse — before your users do. Start your free trial in 30 seconds.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link href="/signup" className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-10 py-4 rounded-xl text-[16px] font-bold transition-all shadow-2xl shadow-violet-600/30 hover:-translate-y-0.5">
              Start free trial — no card needed
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
          <p className="mt-4 text-[13px] text-zinc-600">Questions? <a href="mailto:hello@tryrepath.com" className="text-zinc-400 hover:text-white underline">hello@tryrepath.com</a></p>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────── */}
      <footer className="border-t border-white/[0.05] py-10">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Image src="/logo-icon.png" alt="Repath" width={22} height={22} className="rounded" />
            <span className="text-[15px] font-bold">Repath</span>
            <span className="text-zinc-600 text-[13px]">© 2026</span>
          </div>
          <div className="flex items-center gap-6">
            {[
              ["#features","Features"],
              ["#how","How It Works"],
              ["#pricing","Pricing"],
              ["/login","Sign in"],
              ["mailto:hello@tryrepath.com","Contact"],
            ].map(([href, label]) => (
              <a key={href} href={href} className="text-[13px] text-zinc-500 hover:text-white transition-colors">{label}</a>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
