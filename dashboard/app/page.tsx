"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import {
  ArrowRight, Copy, Check, BarChart3, Zap, Eye,
  Shield, Clock, GitBranch, Activity, Server, Code2, Layers,
  Globe, Lock, Cpu, Gauge, CircleDot, ChevronRight
} from "lucide-react";

function GithubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
    </svg>
  );
}

function TrafficFlowAnimation() {
  return (
    <div className="relative w-full max-w-4xl mx-auto h-[340px] overflow-hidden">
      {/* Connection lines */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 800 340" fill="none" preserveAspectRatio="xMidYMid meet">
        {/* Main line from App to Gateway */}
        <path d="M 100 170 L 300 170" stroke="rgba(124,58,237,0.3)" strokeWidth="2" strokeDasharray="6 4" />
        {/* Gateway to Baseline */}
        <path d="M 500 170 L 700 100" stroke="rgba(14,165,233,0.3)" strokeWidth="2" strokeDasharray="6 4" />
        {/* Gateway to Candidate */}
        <path d="M 500 170 L 700 240" stroke="rgba(217,119,6,0.3)" strokeWidth="2" strokeDasharray="6 4" />

        {/* Animated dots - App to Gateway */}
        <circle r="4" fill="#7c3aed">
          <animateMotion dur="2s" repeatCount="indefinite" path="M 100 170 L 300 170" />
        </circle>
        <circle r="4" fill="#7c3aed" opacity="0.6">
          <animateMotion dur="2s" repeatCount="indefinite" path="M 100 170 L 300 170" begin="0.7s" />
        </circle>
        <circle r="4" fill="#7c3aed" opacity="0.4">
          <animateMotion dur="2s" repeatCount="indefinite" path="M 100 170 L 300 170" begin="1.4s" />
        </circle>

        {/* Animated dots - Gateway to Baseline (90%) */}
        <circle r="4" fill="#0ea5e9">
          <animateMotion dur="1.8s" repeatCount="indefinite" path="M 500 170 L 700 100" />
        </circle>
        <circle r="4" fill="#0ea5e9" opacity="0.7">
          <animateMotion dur="1.8s" repeatCount="indefinite" path="M 500 170 L 700 100" begin="0.4s" />
        </circle>
        <circle r="4" fill="#0ea5e9" opacity="0.5">
          <animateMotion dur="1.8s" repeatCount="indefinite" path="M 500 170 L 700 100" begin="0.8s" />
        </circle>
        <circle r="4" fill="#0ea5e9" opacity="0.6">
          <animateMotion dur="1.8s" repeatCount="indefinite" path="M 500 170 L 700 100" begin="1.2s" />
        </circle>

        {/* Animated dots - Gateway to Candidate (10%) */}
        <circle r="3" fill="#d97706">
          <animateMotion dur="2.2s" repeatCount="indefinite" path="M 500 170 L 700 240" />
        </circle>

        {/* Eval line from Gateway down */}
        <path d="M 400 210 L 400 300" stroke="rgba(124,58,237,0.2)" strokeWidth="1.5" strokeDasharray="4 3" />
        <circle r="3" fill="#a78bfa" opacity="0.7">
          <animateMotion dur="3s" repeatCount="indefinite" path="M 400 210 L 400 300" />
        </circle>
      </svg>

      {/* Nodes */}
      {/* Your App */}
      <div className="absolute left-[4%] top-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-xl bg-white/[0.05] border border-white/[0.1] flex items-center justify-center backdrop-blur-sm">
          <Code2 className="w-7 h-7 text-white" strokeWidth={1.5} />
        </div>
        <span className="text-[12px] text-[--color-text-secondary] font-medium">Your App</span>
      </div>

      {/* Gateway */}
      <div className="absolute left-[37%] top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
        <div className="relative">
          <div className="absolute inset-0 rounded-xl bg-[--color-accent]/20 blur-xl animate-pulse" />
          <div className="relative w-20 h-20 rounded-xl bg-[--color-accent]/10 border border-[--color-accent]/30 flex items-center justify-center backdrop-blur-sm">
            <Image src="/logo-icon.png" alt="Repath" width={40} height={40} className="rounded-lg" />
          </div>
        </div>
        <span className="text-[13px] text-[--color-accent] font-semibold">Repath Gateway</span>
        <span className="text-[11px] text-[--color-text-muted]">Routes + Evaluates</span>
      </div>

      {/* Baseline */}
      <div className="absolute right-[4%] top-[20%] flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-xl bg-[--color-baseline]/10 border border-[--color-baseline]/30 flex items-center justify-center">
          <span className="text-[11px] font-bold text-[--color-baseline]">90%</span>
        </div>
        <span className="text-[12px] text-[--color-baseline] font-medium">Baseline</span>
        <span className="text-[10px] text-[--color-text-muted]">Current prompt</span>
      </div>

      {/* Candidate */}
      <div className="absolute right-[4%] bottom-[15%] flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-xl bg-[--color-candidate]/10 border border-[--color-candidate]/30 flex items-center justify-center">
          <span className="text-[11px] font-bold text-[--color-candidate]">10%</span>
        </div>
        <span className="text-[12px] text-[--color-candidate] font-medium">Candidate</span>
        <span className="text-[10px] text-[--color-text-muted]">New prompt</span>
      </div>

      {/* Evaluator */}
      <div className="absolute left-[37%] bottom-[2%] -translate-x-1/2 flex flex-col items-center gap-1">
        <div className="w-14 h-14 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
          <Eye className="w-6 h-6 text-purple-400" strokeWidth={1.5} />
        </div>
        <span className="text-[11px] text-purple-400 font-medium">LLM Judge</span>
      </div>
    </div>
  );
}

function RolloutStepsAnimation() {
  return (
    <div className="relative w-full max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        {[
          { weight: "5%", label: "Start", status: "done" },
          { weight: "25%", label: "Gate 1", status: "done" },
          { weight: "50%", label: "Gate 2", status: "active" },
          { weight: "100%", label: "Full", status: "pending" },
        ].map((step, idx) => (
          <div key={idx} className="flex flex-col items-center gap-3 relative z-10">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center text-[12px] font-bold border-2 transition-all duration-500 ${
              step.status === "done"
                ? "bg-[--color-success]/20 border-[--color-success] text-[--color-success]"
                : step.status === "active"
                ? "bg-[--color-accent]/20 border-[--color-accent] text-[--color-accent] animate-pulse"
                : "bg-white/[0.03] border-white/[0.1] text-[--color-text-muted]"
            }`}>
              {step.weight}
            </div>
            <span className={`text-[11px] font-medium ${
              step.status === "done" ? "text-[--color-success]" :
              step.status === "active" ? "text-[--color-accent]" :
              "text-[--color-text-muted]"
            }`}>{step.label}</span>
          </div>
        ))}
      </div>
      {/* Progress bar */}
      <div className="absolute top-6 left-6 right-6 h-[2px] bg-white/[0.06]">
        <div className="h-full bg-gradient-to-r from-[--color-success] via-[--color-success] to-[--color-accent] w-[58%] rounded-full relative">
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[--color-accent] animate-ping" />
        </div>
      </div>
    </div>
  );
}

function QualityScoreAnimation() {
  return (
    <div className="relative w-full max-w-md mx-auto h-[120px]">
      <div className="flex items-end justify-between h-full gap-1 px-4">
        {[0.92, 0.89, 0.91, 0.93, 0.88, 0.85, 0.72, 0.65].map((score, idx) => {
          const isRollback = score < 0.7;
          const isWarning = score >= 0.7 && score < 0.8;
          return (
            <div key={idx} className="flex-1 flex flex-col items-center gap-1">
              <span className={`text-[9px] font-mono ${
                isRollback ? "text-[--color-danger]" :
                isWarning ? "text-[--color-candidate]" :
                "text-[--color-success]"
              }`}>{score.toFixed(2)}</span>
              <div
                className={`w-full rounded-t-sm transition-all duration-700 ${
                  isRollback ? "bg-[--color-danger]" :
                  isWarning ? "bg-[--color-candidate]" :
                  "bg-[--color-success]"
                }`}
                style={{
                  height: `${score * 90}%`,
                  animationDelay: `${idx * 0.2}s`,
                }}
              />
            </div>
          );
        })}
      </div>
      {/* Threshold line */}
      <div className="absolute bottom-[63%] left-0 right-0 border-t border-dashed border-[--color-danger]/40">
        <span className="absolute right-0 -top-4 text-[9px] text-[--color-danger]/60">rollback threshold</span>
      </div>
      {/* Rollback indicator */}
      <div className="absolute bottom-0 right-2 flex items-center gap-1 px-2 py-1 rounded bg-[--color-danger]/10 border border-[--color-danger]/20">
        <div className="w-1.5 h-1.5 rounded-full bg-[--color-danger] animate-ping" />
        <span className="text-[9px] text-[--color-danger] font-medium">Auto-rollback triggered</span>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const handleCopyStep = (idx: number, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedStep(idx);
    setTimeout(() => setCopiedStep(null), 2000);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#09090b]">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-white/[0.06] bg-[#09090b]/90 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo-icon.png" alt="Repath" width={32} height={32} className="rounded-lg" />
            <span className="text-[20px] font-bold text-white tracking-tight">Repath</span>
          </div>
          <div className="flex items-center gap-6">
            <a href="#features" className="text-[14px] text-zinc-400 hover:text-white transition-colors hidden sm:block">Features</a>
            <a href="#how-it-works" className="text-[14px] text-zinc-400 hover:text-white transition-colors hidden sm:block">How It Works</a>
            <a href="#roadmap" className="text-[14px] text-zinc-400 hover:text-white transition-colors hidden sm:block">Roadmap</a>
            <a href="#quickstart" className="text-[14px] text-zinc-400 hover:text-white transition-colors hidden sm:block">Quick Start</a>
            <a
              href="https://github.com/repathhq/repath"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-4 py-2 text-[13px] text-white transition-all"
            >
              <GithubIcon className="w-4 h-4" />
              <span className="hidden sm:inline">GitHub</span>
            </a>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-screen flex flex-col items-center justify-center pt-20 pb-12 overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[20%] left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-[--color-accent]/[0.04] rounded-full blur-[150px]" />
          <div className="absolute top-[40%] left-[20%] w-[300px] h-[300px] bg-[--color-baseline]/[0.03] rounded-full blur-[100px]" />
          <div className="absolute top-[40%] right-[20%] w-[300px] h-[300px] bg-[--color-candidate]/[0.03] rounded-full blur-[100px]" />
          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-[0.02]" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />
        </div>

        <div className="relative max-w-5xl mx-auto px-6 flex flex-col items-center text-center">
          {/* Badge */}
          <div className="mb-8 inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[--color-accent]/30 bg-[--color-accent]/[0.06]">
            <div className="w-2 h-2 rounded-full bg-[--color-accent] animate-pulse" />
            <span className="text-[13px] font-medium text-[--color-accent]">Progressive Delivery for AI</span>
          </div>

          {/* H1 */}
          <h1 className="text-[48px] md:text-[68px] font-bold text-white mb-6 leading-[1.05] tracking-tight">
            Ship AI changes
            <br />
            <span className="bg-gradient-to-r from-[#a78bfa] via-[#7c3aed] to-[#4f46e5] bg-clip-text text-transparent">without the guesswork.</span>
          </h1>

          {/* Subhead */}
          <p className="text-[17px] md:text-[20px] text-zinc-400 mb-10 max-w-3xl leading-relaxed">
            Canary deployments for LLM prompts and models. Split traffic, evaluate quality with an AI judge, and <span className="text-white font-medium">auto-rollback when things break</span> — before users notice.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row gap-4 mb-20">
            <a
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-xl bg-[--color-accent] hover:bg-[#6d28d9] text-white px-8 py-4 text-[15px] font-semibold transition-all duration-200 shadow-xl shadow-[--color-accent]/30 hover:shadow-[--color-accent]/50 hover:-translate-y-0.5"
            >
              Get Started
              <ArrowRight className="w-5 h-5" />
            </a>
            <a
              href="https://github.com/repathhq/repath"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-white px-8 py-4 text-[15px] font-medium transition-all duration-200 hover:-translate-y-0.5"
            >
              <GithubIcon className="w-5 h-5" />
              View on GitHub
            </a>
          </div>

          {/* Live Traffic Flow Animation */}
          <div className="w-full">
            <p className="text-[13px] text-zinc-500 mb-4 uppercase tracking-wider font-medium">Live Traffic Flow</p>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] backdrop-blur-sm p-6 md:p-8">
              <TrafficFlowAnimation />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works - Animated Steps */}
      <section id="how-it-works" className="py-24 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              How It Works
            </h2>
            <p className="text-[16px] text-zinc-400">
              Three-step loop running automatically, 24/7.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-16">
            {[
              {
                num: "01",
                icon: GitBranch,
                title: "Split Traffic",
                body: "Route a percentage of requests to a new prompt or model version. Users see no difference — Repath transparently proxies both.",
                color: "text-[--color-baseline]",
                bg: "bg-[--color-baseline]/10",
                border: "border-[--color-baseline]/20",
              },
              {
                num: "02",
                icon: Eye,
                title: "Evaluate Quality",
                body: "An LLM judge scores every response on your criteria — helpfulness, accuracy, completeness. Async, never slows down requests.",
                color: "text-[--color-accent]",
                bg: "bg-[--color-accent]/10",
                border: "border-[--color-accent]/20",
              },
              {
                num: "03",
                icon: Shield,
                title: "Decide & Act",
                body: "Every 30 seconds, the controller checks scores. Quality good? Advance to more traffic. Quality dropped? Instant rollback.",
                color: "text-[--color-success]",
                bg: "bg-[--color-success]/10",
                border: "border-[--color-success]/20",
              },
            ].map(({ num, icon: Icon, title, body, color, bg, border }) => (
              <div key={num} className={`rounded-2xl border ${border} bg-white/[0.02] p-8 hover:bg-white/[0.04] transition-all duration-300 group`}>
                <div className="flex items-center gap-3 mb-5">
                  <div className={`p-3 rounded-xl ${bg}`}>
                    <Icon className={`w-5 h-5 ${color}`} strokeWidth={1.5} />
                  </div>
                  <span className={`text-[32px] font-bold ${color} opacity-30`}>{num}</span>
                </div>
                <h3 className="text-[18px] font-semibold text-white mb-3">{title}</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>

          {/* Rollout Steps Animation */}
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 md:p-10">
            <div className="text-center mb-8">
              <h3 className="text-[18px] font-semibold text-white mb-2">Progressive Rollout in Action</h3>
              <p className="text-[14px] text-zinc-400">Traffic advances through gates automatically when quality holds</p>
            </div>
            <RolloutStepsAnimation />
          </div>
        </div>
      </section>

      {/* The Problem */}
      <section className="py-24 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              AI models break <span className="text-[--color-danger]">silently</span>
            </h2>
            <p className="text-[16px] text-zinc-400 leading-relaxed">
              You can't detect "responses got 23% worse" by watching error rates. Zero HTTP errors. Zero exceptions. Just degraded output your users silently abandon.
            </p>
          </div>

          {/* Quality Score Visualization */}
          <div className="max-w-2xl mx-auto rounded-2xl border border-white/[0.06] bg-white/[0.02] p-8 mb-12">
            <div className="text-center mb-6">
              <h3 className="text-[15px] font-semibold text-white mb-1">Quality Score Over Time</h3>
              <p className="text-[12px] text-zinc-500">When the new prompt degrades, Repath catches it instantly</p>
            </div>
            <QualityScoreAnimation />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                icon: Activity,
                title: "Provider Updates Break You",
                body: "OpenAI and Anthropic push model updates without notice. Your carefully-tuned prompts degrade overnight — zero errors in logs.",
              },
              {
                icon: Clock,
                title: "Weeks Before You Notice",
                body: "Without quality scoring, prompt regressions hide for days. By the time users complain, the damage is done.",
              },
              {
                icon: BarChart3,
                title: "Feature Flags Can't Help",
                body: "Feature flags control deployment, not quality. They can't answer: 'is the new version producing better outputs?'",
              },
            ].map(({ icon: Icon, title, body }, idx) => (
              <div key={idx} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-7 hover:border-[--color-danger]/20 transition-all duration-300">
                <div className="mb-4 p-3 rounded-lg bg-[--color-danger]/10 w-fit">
                  <Icon className="w-5 h-5 text-[--color-danger]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[16px] font-semibold text-white mb-3">{title}</h3>
                <p className="text-[14px] text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              Everything You Need
            </h2>
            <p className="text-[16px] text-zinc-400">
              Purpose-built for AI deployment safety. Not feature flags bolted onto LLMs.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {[
              { icon: GitBranch, title: "Canary Deployments", body: "5% → 25% → 50% → 100% with quality gates at each step. Configurable weights, durations, thresholds." },
              { icon: Eye, title: "LLM-as-Judge", body: "GPT-4o-mini scores every response. Define criteria in plain English. Fully async — never slows requests." },
              { icon: Shield, title: "Auto-Rollback", body: "Quality < threshold? Traffic returns to baseline in <500ms. No human intervention needed." },
              { icon: Gauge, title: "Sub-2ms Overhead", body: "Rust gateway with lock-free config. 50K+ req/s per instance. No GC, no runtime overhead." },
              { icon: Lock, title: "Audit Trail", body: "Every advance/rollback decision logged with exact scores. Full visibility into why actions were taken." },
              { icon: Server, title: "Self-Hosted", body: "Docker Compose — one command. Data stays on your infra. No vendor lock-in." },
              { icon: Cpu, title: "Drop-in Integration", body: "Change base_url in your OpenAI client. One line. No SDK, no wrappers, no code changes." },
              { icon: Layers, title: "Real-time Dashboard", body: "Live traffic split, quality graphs, decision timeline. See everything as it happens." },
              { icon: Globe, title: "YAML Config", body: "Declare rollouts as code. Version control your deployment strategy. GitOps-ready." },
            ].map(({ icon: Icon, title, body }, idx) => (
              <div key={idx} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 hover:border-[--color-accent]/20 hover:bg-[--color-accent]/[0.02] transition-all duration-300 group">
                <div className="mb-4 p-2.5 rounded-lg bg-[--color-accent]/10 w-fit group-hover:bg-[--color-accent]/20 transition-colors">
                  <Icon className="w-5 h-5 text-[--color-accent]" strokeWidth={1.5} />
                </div>
                <h3 className="text-[15px] font-semibold text-white mb-2">{title}</h3>
                <p className="text-[13px] text-zinc-400 leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Repath */}
      <section className="py-24 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              Why Repath?
            </h2>
            <p className="text-[16px] text-zinc-400">
              The only tool that auto-rolls back based on semantic quality — not just error rates.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 max-w-5xl mx-auto">
            <div className="space-y-6">
              {[
                { title: "Semantic quality evaluation", body: "Not just error rates — we evaluate whether responses are actually good using LLM-as-judge scoring on your criteria." },
                { title: "One-line integration", body: "Change base_url in your OpenAI client. That's the entire integration. No SDK, no wrapper functions." },
                { title: "Quality drives rollout decisions", body: "Rollback triggers on 'responses got less helpful' — not just latency spikes or error rate increases." },
                { title: "Works with any LLM provider", body: "OpenAI today. Anthropic and Gemini coming Q3 2026. Any OpenAI-compatible endpoint works now." },
              ].map(({ title, body }, idx) => (
                <div key={idx} className="flex gap-4">
                  <div className="mt-2 w-2 h-2 rounded-full bg-[--color-accent] shrink-0" />
                  <div>
                    <h4 className="text-[15px] font-semibold text-white mb-1">{title}</h4>
                    <p className="text-[14px] text-zinc-400 leading-relaxed">{body}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-7">
              <h3 className="text-[14px] font-semibold text-zinc-300 uppercase tracking-wider mb-6">vs. Traditional Tools</h3>
              <div className="space-y-4">
                {[
                  { feature: "Auto-rollback on quality", us: "Built-in, free", them: "Enterprise only ($50K+/yr)" },
                  { feature: "LLM-as-judge scoring", us: "Drives decisions", them: "Observability only" },
                  { feature: "Integration effort", us: "1 line change", them: "SDK + config + metrics" },
                  { feature: "Self-hosted option", us: "Docker Compose", them: "SaaS only" },
                  { feature: "AI-native design", us: "Purpose-built", them: "Feature flags + bolt-on" },
                ].map(({ feature, us, them }, idx) => (
                  <div key={idx} className="rounded-lg bg-white/[0.02] border border-white/[0.04] p-3">
                    <div className="text-[13px] text-white font-medium mb-1.5">{feature}</div>
                    <div className="flex items-center gap-2 text-[12px]">
                      <Check className="w-3.5 h-3.5 text-[--color-success] shrink-0" />
                      <span className="text-[--color-success]">{us}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[12px] mt-1">
                      <span className="w-3.5 h-3.5 flex items-center justify-center text-zinc-500 shrink-0">x</span>
                      <span className="text-zinc-500">{them}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Tech Stack */}
      <section className="py-24 border-t border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              Built for Production
            </h2>
            <p className="text-[16px] text-zinc-400">
              Rust gateway, Python evaluators, Next.js dashboard. Not a prototype.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { icon: Cpu, label: "Rust Gateway", detail: "Axum + Tokio" },
              { icon: Activity, label: "Rust Controller", detail: "30s state machine" },
              { icon: Code2, label: "Python Evaluators", detail: "Async workers" },
              { icon: Layers, label: "Next.js Dashboard", detail: "React 19" },
              { icon: Server, label: "PostgreSQL 16", detail: "Persistent state" },
              { icon: Zap, label: "Redis Streams", detail: "Eval queue" },
              { icon: Globe, label: "Docker Compose", detail: "One command" },
              { icon: BarChart3, label: "CLI", detail: "Rust-powered" },
            ].map(({ icon: Icon, label, detail }, idx) => (
              <div key={idx} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 text-center hover:border-white/[0.12] transition-all">
                <Icon className="w-6 h-6 text-[--color-accent] mx-auto mb-3" strokeWidth={1.5} />
                <div className="text-[13px] font-semibold text-white">{label}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{detail}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Roadmap */}
      <section id="roadmap" className="py-24 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              Roadmap
            </h2>
            <p className="text-[16px] text-zinc-400">
              Where we are and what's coming. Building in public.
            </p>
          </div>

          <div className="space-y-5 max-w-4xl mx-auto">
            {/* Phase 1 */}
            <div className="rounded-xl border-2 border-[--color-accent]/40 bg-[--color-accent]/[0.03] p-7">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="px-3 py-1.5 rounded-full bg-[--color-accent] text-white text-[11px] font-bold">PHASE 1</span>
                <span className="px-3 py-1.5 rounded-full bg-[--color-success]/20 text-[--color-success] text-[11px] font-bold">COMPLETE</span>
                <span className="text-[13px] text-zinc-400">Q2 2026</span>
              </div>
              <h3 className="text-[18px] font-bold text-white mb-4">Core Platform</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  "OpenAI-compatible transparent proxy",
                  "Canary traffic splitting",
                  "LLM-as-judge quality evaluation",
                  "Auto advance & rollback controller",
                  "Real-time dashboard",
                  "CLI for rollout management",
                  "PostgreSQL + Redis infrastructure",
                  "Docker Compose one-command startup",
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[13px]">
                    <Check className="w-4 h-4 text-[--color-success] shrink-0" />
                    <span className="text-zinc-300">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase 2 */}
            <div className="rounded-xl border border-[--color-candidate]/30 bg-[--color-candidate]/[0.02] p-7">
              <div className="flex flex-wrap items-center gap-3 mb-4">
                <span className="px-3 py-1.5 rounded-full bg-[--color-candidate]/20 text-[--color-candidate] text-[11px] font-bold">PHASE 2</span>
                <span className="px-3 py-1.5 rounded-full border border-[--color-candidate]/30 text-[--color-candidate] text-[11px] font-bold animate-pulse">IN PROGRESS</span>
                <span className="text-[13px] text-zinc-400">Q3 2026</span>
              </div>
              <h3 className="text-[18px] font-bold text-white mb-4">Multi-Provider & Cloud</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {[
                  "Anthropic Claude support",
                  "Google Gemini support",
                  "Shadow testing mode",
                  "Repath Cloud (managed hosting)",
                  "Webhook & Slack alerts",
                  "Cost-aware routing",
                ].map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-[13px]">
                    <ChevronRight className="w-4 h-4 text-[--color-candidate] shrink-0" />
                    <span className="text-zinc-400">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Phase 3 & 4 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-7">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-3 py-1.5 rounded-full bg-[--color-baseline]/20 text-[--color-baseline] text-[11px] font-bold">PHASE 3</span>
                  <span className="text-[12px] text-zinc-500">Q4 2026</span>
                </div>
                <h3 className="text-[16px] font-bold text-white mb-3">Advanced Evals</h3>
                <ul className="space-y-2">
                  {["Drift detection", "Human feedback loops", "A/B with significance", "Custom judge models"].map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-[13px] text-zinc-400">
                      <ChevronRight className="w-3.5 h-3.5 text-[--color-baseline] shrink-0" />{item}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-7">
                <div className="flex items-center gap-2 mb-4">
                  <span className="px-3 py-1.5 rounded-full bg-purple-500/20 text-purple-400 text-[11px] font-bold">PHASE 4</span>
                  <span className="text-[12px] text-zinc-500">2027</span>
                </div>
                <h3 className="text-[16px] font-bold text-white mb-3">Enterprise</h3>
                <ul className="space-y-2">
                  {["SSO / SAML", "Team RBAC", "Kubernetes Helm chart", "Enterprise SLA & support"].map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2 text-[13px] text-zinc-400">
                      <ChevronRight className="w-3.5 h-3.5 text-purple-400 shrink-0" />{item}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Quick Start */}
      <section id="quickstart" className="py-24 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-[36px] md:text-[44px] font-bold text-white mb-4">
              Running in 60 Seconds
            </h2>
            <p className="text-[16px] text-zinc-400">
              Clone, configure, run. No account needed.
            </p>
          </div>

          <div className="space-y-6">
            {[
              { num: "1", title: "Clone & configure", code: "git clone https://github.com/repathhq/repath\ncd repath && cp .env.example .env\n# Add your OPENAI_API_KEY to .env" },
              { num: "2", title: "Start all services", code: "docker compose up\n# PostgreSQL, Redis, Gateway, Controller, Evaluator, Dashboard\n# Ready in ~30 seconds" },
              { num: "3", title: "Point your app", code: "client = OpenAI(\n    api_key=\"sk-...\",\n    base_url=\"http://localhost:8080/v1\"\n)" },
              { num: "4", title: "Create a canary rollout", code: "repath rollout create -f examples/demo-canary.yaml\nrepath rollout status demo-customer-support --watch" },
            ].map((step, idx) => (
              <div key={idx} className="flex gap-5">
                <div className="shrink-0">
                  <div className="w-9 h-9 rounded-full bg-[--color-accent] flex items-center justify-center text-white font-bold text-[14px]">
                    {step.num}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-[16px] font-semibold text-white mb-3">{step.title}</h3>
                  <div className="rounded-xl border border-white/[0.08] bg-zinc-900/80 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.06]">
                      <div className="flex gap-1.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                        <div className="w-2.5 h-2.5 rounded-full bg-zinc-700" />
                      </div>
                      <button onClick={() => handleCopyStep(idx, step.code)} className="text-zinc-500 hover:text-white transition-colors p-1">
                        {copiedStep === idx ? <Check className="w-4 h-4 text-[--color-success]" /> : <Copy className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="p-4 font-mono text-[13px] text-zinc-300 whitespace-pre-wrap leading-relaxed overflow-x-auto">{step.code}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 border-t border-white/[0.06] bg-white/[0.01]">
        <div className="max-w-4xl mx-auto px-6 text-center">
          <div className="mb-8 flex justify-center">
            <div className="p-4 rounded-2xl bg-[--color-accent]/[0.08] border border-[--color-accent]/20">
              <Image src="/logo-icon.png" alt="Repath" width={48} height={48} className="rounded-xl" />
            </div>
          </div>
          <h2 className="text-[32px] md:text-[40px] font-bold text-white mb-4">
            Stop shipping AI blind.
          </h2>
          <p className="text-[16px] text-zinc-400 mb-10 max-w-2xl mx-auto">
            Know if your prompt change is better or worse — before your users do.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <a
              href="https://github.com/repathhq/repath"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 px-8 py-4 text-[15px] font-semibold transition-all hover:-translate-y-0.5"
            >
              <GithubIcon className="w-5 h-5" />
              View on GitHub
            </a>
            <Link
              href="/rollouts"
              className="inline-flex items-center gap-2 rounded-xl bg-[--color-accent] hover:bg-[#6d28d9] text-white px-8 py-4 text-[15px] font-semibold transition-all shadow-lg shadow-[--color-accent]/25 hover:-translate-y-0.5"
            >
              Try Dashboard
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/[0.06] py-12">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-10 mb-10">
            <div>
              <div className="flex items-center gap-3 mb-4">
                <Image src="/logo-icon.png" alt="Repath" width={24} height={24} className="rounded" />
                <span className="text-[16px] font-bold text-white">Repath</span>
              </div>
              <p className="text-[13px] text-zinc-400 leading-relaxed">Progressive delivery for AI models.</p>
            </div>
            <div>
              <h4 className="text-[12px] font-semibold text-zinc-300 mb-4 uppercase tracking-wider">Product</h4>
              <ul className="space-y-2.5">
                <li><a href="#features" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Features</a></li>
                <li><a href="#roadmap" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Roadmap</a></li>
                <li><a href="#quickstart" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Quick Start</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[12px] font-semibold text-zinc-300 mb-4 uppercase tracking-wider">Community</h4>
              <ul className="space-y-2.5">
                <li><a href="https://github.com/repathhq/repath" target="_blank" rel="noopener noreferrer" className="text-[13px] text-zinc-500 hover:text-white transition-colors">GitHub</a></li>
                <li><a href="https://github.com/repathhq/repath/discussions" target="_blank" rel="noopener noreferrer" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Discussions</a></li>
                <li><a href="https://github.com/repathhq/repath/blob/main/CONTRIBUTING.md" target="_blank" rel="noopener noreferrer" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Contributing</a></li>
              </ul>
            </div>
            <div>
              <h4 className="text-[12px] font-semibold text-zinc-300 mb-4 uppercase tracking-wider">Legal</h4>
              <ul className="space-y-2.5">
                <li><a href="https://github.com/repathhq/repath/blob/main/LICENSE" target="_blank" rel="noopener noreferrer" className="text-[13px] text-zinc-500 hover:text-white transition-colors">License (BSL 1.1)</a></li>
                <li><a href="https://github.com/repathhq/repath/blob/main/CODE_OF_CONDUCT.md" target="_blank" rel="noopener noreferrer" className="text-[13px] text-zinc-500 hover:text-white transition-colors">Code of Conduct</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-white/[0.06] pt-8 flex flex-col sm:flex-row items-center justify-between gap-4">
            <p className="text-[12px] text-zinc-600">© 2026 Repath. BSL 1.1 — converts to Apache 2.0 after 4 years.</p>
            <a href="https://github.com/repathhq/repath" target="_blank" rel="noopener noreferrer" className="text-zinc-600 hover:text-white transition-colors">
              <GithubIcon className="w-5 h-5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
