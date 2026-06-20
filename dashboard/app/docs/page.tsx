"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Search, ChevronRight, GitBranch, Zap, Shield, BarChart2, RefreshCw, Cloud, Code2, Terminal, BookOpen } from "lucide-react";

const sections = [
  {
    title: "Getting Started",
    icon: BookOpen,
    color: "text-violet-600",
    bg: "bg-violet-50",
    articles: [
      { title: "Introduction to Repath", href: "#intro", desc: "What is Repath and how it works" },
      { title: "Quick start (5 minutes)", href: "#quickstart", desc: "Deploy your first canary rollout" },
      { title: "How to integrate", href: "#integrate", desc: "Change one line — that's it" },
      { title: "Core concepts", href: "#concepts", desc: "Rollouts, versions, evaluations" },
    ],
  },
  {
    title: "Canary Deployments",
    icon: GitBranch,
    color: "text-blue-600",
    bg: "bg-blue-50",
    articles: [
      { title: "Creating a rollout", href: "#create", desc: "YAML config and dashboard" },
      { title: "Traffic splitting", href: "#traffic", desc: "Weights, sticky sessions, steps" },
      { title: "Quality gates", href: "#gates", desc: "Advance and rollback thresholds" },
      { title: "Rollout strategies", href: "#strategies", desc: "Canary, shadow, blue-green" },
    ],
  },
  {
    title: "LLM-as-Judge",
    icon: BarChart2,
    color: "text-purple-600",
    bg: "bg-purple-50",
    articles: [
      { title: "How evaluation works", href: "#eval", desc: "Async scoring pipeline" },
      { title: "Writing criteria", href: "#criteria", desc: "Plain-English rubrics" },
      { title: "Supported judge models", href: "#models", desc: "GPT-4o, Claude, Gemini" },
      { title: "Composite scoring", href: "#scoring", desc: "Weighted dimensions" },
    ],
  },
  {
    title: "Auto-Rollback",
    icon: RefreshCw,
    color: "text-red-600",
    bg: "bg-red-50",
    articles: [
      { title: "Rollback triggers", href: "#triggers", desc: "Threshold configuration" },
      { title: "Detection latency", href: "#latency", desc: "Sub-500ms revert" },
      { title: "Audit trail", href: "#audit", desc: "Decision log and history" },
    ],
  },
  {
    title: "Provider Failover",
    icon: Cloud,
    color: "text-emerald-600",
    bg: "bg-emerald-50",
    articles: [
      { title: "Supported providers", href: "#providers", desc: "OpenAI, Anthropic, Gemini, OpenRouter" },
      { title: "Failover configuration", href: "#failover", desc: "Primary and fallback chain" },
      { title: "Circuit breaker", href: "#circuit", desc: "Automatic bypass on outage" },
    ],
  },
  {
    title: "API Reference",
    icon: Code2,
    color: "text-amber-600",
    bg: "bg-amber-50",
    articles: [
      { title: "REST API overview", href: "#api", desc: "Authentication, endpoints, errors" },
      { title: "Rollouts API", href: "#rollouts-api", desc: "Create, list, promote, rollback" },
      { title: "Evaluations API", href: "#evals-api", desc: "Query scores and decisions" },
      { title: "Webhooks", href: "#webhooks", desc: "Events, signatures, retry" },
    ],
  },
];

export default function DocsPage() {
  const [query, setQuery] = useState("");
  const filtered = sections.map(s => ({
    ...s,
    articles: s.articles.filter(a =>
      !query || a.title.toLowerCase().includes(query.toLowerCase()) || a.desc.toLowerCase().includes(query.toLowerCase())
    ),
  })).filter(s => s.articles.length > 0);

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-icon.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/#pricing" className="text-[14px] text-gray-500 hover:text-gray-900 transition-colors">Pricing</Link>
          <Link href="/login" className="text-[14px] text-gray-500 hover:text-gray-900 transition-colors">Sign in</Link>
          <Link href="/signup" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 transition-colors">Start free trial</Link>
        </div>
      </nav>

      {/* Hero */}
      <div className="bg-gray-50 border-b border-gray-100 py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-[40px] font-bold text-gray-900 mb-4">Documentation</h1>
          <p className="text-[17px] text-gray-500 mb-8">Everything you need to integrate Repath and ship AI safely.</p>
          <div className="relative max-w-xl mx-auto">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search docs — e.g. canary, rollback, API..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3.5 rounded-xl border border-gray-200 bg-white text-[15px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent shadow-sm"
            />
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="max-w-6xl mx-auto px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
          {[
            { icon: Terminal, label: "Quick Start", href: "#quickstart", color: "text-violet-600", bg: "bg-violet-50" },
            { icon: GitBranch, label: "First Rollout", href: "#create", color: "text-blue-600", bg: "bg-blue-50" },
            { icon: Code2, label: "API Reference", href: "#api", color: "text-amber-600", bg: "bg-amber-50" },
            { icon: Zap, label: "Integrations", href: "#integrate", color: "text-emerald-600", bg: "bg-emerald-50" },
          ].map(({ icon: Icon, label, href, color, bg }) => (
            <a key={label} href={href} className="flex items-center gap-3 p-4 rounded-xl border border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm transition-all group">
              <div className={`w-9 h-9 rounded-lg ${bg} flex items-center justify-center`}>
                <Icon className={`w-4.5 h-4.5 ${color}`} strokeWidth={1.8} />
              </div>
              <span className="text-[14px] font-medium text-gray-700 group-hover:text-gray-900">{label}</span>
              <ChevronRight className="w-4 h-4 text-gray-300 ml-auto group-hover:text-gray-500 transition-colors" />
            </a>
          ))}
        </div>

        {/* Sections grid */}
        {filtered.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-[15px]">No results for &ldquo;{query}&rdquo;</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filtered.map(s => (
              <div key={s.title}>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className={`w-8 h-8 rounded-lg ${s.bg} flex items-center justify-center`}>
                    <s.icon className={`w-4 h-4 ${s.color}`} strokeWidth={1.8} />
                  </div>
                  <h2 className="text-[15px] font-semibold text-gray-900">{s.title}</h2>
                </div>
                <ul className="space-y-1">
                  {s.articles.map(a => (
                    <li key={a.href}>
                      <a href={a.href} className="flex flex-col py-2.5 px-3 rounded-lg hover:bg-gray-50 transition-colors group">
                        <span className="text-[14px] font-medium text-gray-700 group-hover:text-gray-900">{a.title}</span>
                        <span className="text-[12px] text-gray-400 mt-0.5">{a.desc}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom CTA */}
      <div className="border-t border-gray-100 py-12 px-6 bg-gray-50">
        <div className="max-w-2xl mx-auto text-center">
          <h3 className="text-[20px] font-bold text-gray-900 mb-2">Need help?</h3>
          <p className="text-[14px] text-gray-500 mb-6">Can&apos;t find what you&apos;re looking for? We&apos;re happy to help.</p>
          <div className="flex gap-3 justify-center">
            <a href="mailto:hello@tryrepath.com" className="px-5 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800 transition-colors">Email us</a>
            <a href="https://github.com/repathhq/repath/discussions" target="_blank" rel="noopener noreferrer" className="px-5 py-2.5 border border-gray-200 text-gray-700 text-[14px] font-medium rounded-lg hover:bg-white transition-colors">GitHub Discussions</a>
          </div>
        </div>
      </div>
    </div>
  );
}
