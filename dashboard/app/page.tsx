"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "motion/react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  ArrowRight, ChevronRight, Check, GitBranch, Menu, X,
  RefreshCw, Zap, Shield, BarChart2, Lock, Cloud, ChevronLeft,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";

/* ─── Palette ────────────────────────────────────────────────────────────── */
const C = {
  blue:   { bg: "#DBEAFE", label: "#1D4ED8", text: "#0F172A" },
  violet: { bg: "#EDE9FE", label: "#6D28D9", text: "#0F172A" },
  amber:  { bg: "#FEF3C7", label: "#B45309", text: "#0F172A" },
  dark:   "#09090B",
};

/* ─── Data ────────────────────────────────────────────────────────────────── */
const qualityData = [
  { t: "T+0",  v1: 0.92, v2: null },
  { t: "T+1",  v1: 0.89, v2: null },
  { t: "T+2",  v1: 0.91, v2: 0.92 },
  { t: "T+3",  v1: 0.93, v2: 0.88 },
  { t: "T+4",  v1: 0.91, v2: 0.85 },
  { t: "T+5",  v1: 0.92, v2: 0.72 },
  { t: "T+6",  v1: 0.91, v2: 0.65 },
  { t: "T+7",  v1: 0.93, v2: null },
];

const capabilities = [
  "Canary Deployments",
  "LLM-as-Judge",
  "Auto-Rollback",
  "Provider Failover",
  "Quality Gates",
  "Audit Trail",
  "Provider Health",
  "One-line Integration",
];

const researchCards = [
  { tag: "CANARY",   title: "5% → 25% → 50% → 100%",               sub: "Configurable quality gates at every step. Traffic only advances when scores hold.", author: "Repath Labs" },
  { tag: "SCORING",  title: "Async LLM judge — zero latency overhead", sub: "Every response evaluated against your rubric. Results arrive in ~120ms, never blocking your users.", author: "Repath Research", highlight: true },
  { tag: "ROLLBACK", title: "Auto-revert in under 500ms",              sub: "Score drops below threshold? 100% traffic back to stable instantly. No on-call needed.", author: "Repath Infra" },
  { tag: "FAILOVER", title: "Silent provider switching",               sub: "OpenAI down? We retry then silently failover to Anthropic or OpenRouter. Your app keeps running.", author: "Repath Platform" },
];

const featureTabs = [
  {
    id: "canary",
    label: "Canary Deployments",
    icon: GitBranch,
    headline: "Canary Deployments",
    primary: "5% → 25% → 50% → 100% with configurable quality gates at each step. Point your app at Repath instead of OpenAI directly. We route a small % to your new prompt — users see nothing different.",
    sub: [
      { label: "Traffic splitting", desc: "Any % down to 0.1% granularity. No SDK rewrites." },
      { label: "Quality-gated advance", desc: "Traffic only increases when scores consistently hold." },
      { label: "Instant abort", desc: "Any step can halt immediately — traffic snaps back." },
    ],
    panel: (
      <div className="h-full flex flex-col gap-3 p-6 font-mono text-xs">
        <div className="flex items-center gap-2 mb-1">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-emerald-600 font-semibold text-[11px] tracking-wide">ROLLOUT: new-support-prompt</span>
        </div>
        <div className="text-[11px] text-gray-500 mb-2">Quality gate: score ≥ 0.85 to advance</div>
        {[
          { pct: "5%",   status: "passed", color: "text-emerald-600" },
          { pct: "25%",  status: "passed", color: "text-emerald-600" },
          { pct: "50%",  status: "live",   color: "text-blue-600" },
          { pct: "100%", status: "pending",color: "text-gray-400" },
        ].map((step) => (
          <div key={step.pct} className="flex items-center gap-3">
            <div className={`w-12 text-right font-semibold ${step.color === "text-gray-400" ? "text-gray-400" : "text-gray-800"}`}>{step.pct}</div>
            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${step.status === "passed" ? "bg-emerald-400 w-full" : step.status === "live" ? "bg-blue-400 w-1/2" : "w-0"}`} />
            </div>
            <span className={`text-[11px] font-medium ${step.color}`}>
              {step.status === "passed" ? "✓ passed" : step.status === "live" ? "● live" : "pending"}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    id: "judge",
    label: "LLM-as-Judge",
    icon: BarChart2,
    headline: "LLM-as-Judge Evaluation",
    primary: "An independent LLM judge scores every response against your custom rubric — accuracy, tone, safety, format. Results stream back in ~120ms, fully async. No latency added to your users.",
    sub: [
      { label: "Plain-English criteria", desc: "Define what \"good\" means in natural language." },
      { label: "8 judge models", desc: "GPT-4o, Claude 3.5, Gemini 1.5 Pro and more." },
      { label: "Per-dimension scores", desc: "Accuracy, safety, format, tone — individually weighted." },
    ],
    panel: (
      <div className="h-full p-6 flex flex-col gap-4">
        <div className="text-xs text-gray-500 font-mono mb-1">EVAL RESULT — response #48291</div>
        {[
          { dim: "Accuracy",  score: 0.91, color: "#7C3AED" },
          { dim: "Safety",    score: 0.98, color: "#10B981" },
          { dim: "Format",    score: 0.84, color: "#F97316" },
          { dim: "Tone",      score: 0.79, color: "#EC4899" },
        ].map((r) => (
          <div key={r.dim} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-gray-600 font-medium">{r.dim}</span>
              <span className="font-semibold text-gray-900 font-mono">{r.score.toFixed(2)}</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${r.score * 100}%`, background: r.color }} />
            </div>
          </div>
        ))}
        <div className="mt-2 pt-3 border-t border-gray-100 flex items-center justify-between text-xs">
          <span className="text-gray-500">Composite</span>
          <span className="font-bold text-gray-900 font-mono">0.88 — PASS</span>
        </div>
      </div>
    ),
  },
  {
    id: "rollback",
    label: "Auto-Rollback",
    icon: RefreshCw,
    headline: "Auto-Rollback in <500ms",
    primary: "Score drops below your threshold? Repath halts the canary and restores 100% of traffic to the stable version automatically — in under 500ms. No manual intervention, no on-call alerts at 3am.",
    sub: [
      { label: "Sub-500ms revert", desc: "Detected and reverted before users see a second bad response." },
      { label: "4-response detection", desc: "Mean lag before a quality drop triggers rollback." },
      { label: "Full audit trail", desc: "Every decision logged with scores and timestamps." },
    ],
    panel: (
      <div className="h-full p-6 flex flex-col gap-3">
        <div className="text-xs font-mono text-gray-500 mb-1">ROLLBACK EVENT — 2026-06-20 03:47 UTC</div>
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
          <RefreshCw className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-500" />
          <span>Quality score dropped to <strong>0.61</strong> (threshold: 0.85) — auto-rollback triggered</span>
        </div>
        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-xs text-emerald-700 flex items-start gap-2">
          <Check className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-500" />
          <span>100% traffic restored to <strong>v1-stable</strong> in <strong>412ms</strong></span>
        </div>
        <div className="text-xs text-gray-500 font-mono mt-auto pt-3 border-t border-gray-100">
          Detection lag: 4 responses · 0 users impacted beyond threshold
        </div>
      </div>
    ),
  },
];

const features = [
  { icon: GitBranch, title: "Canary deployments",         body: "5% → 25% → 50% → 100% with configurable quality gates at each step." },
  { icon: BarChart2,  title: "LLM-as-judge evaluation",   body: "Define criteria in plain English. Scores every response asynchronously — never slows your app." },
  { icon: RefreshCw,  title: "Auto-rollback in <500ms",   body: "Score drops below threshold? Back to baseline instantly. No manual intervention." },
  { icon: Zap,        title: "Provider failover",          body: "OpenAI down? We retry, then silently switch to Anthropic or OpenRouter. Your app keeps running." },
  { icon: Cloud,      title: "Provider health tracking",  body: "Live error rates per provider. Know about outages before your users do." },
  { icon: Lock,       title: "Full audit trail",           body: "Every advance and rollback logged with exact scores. Complete visibility into every decision." },
];

const pricingPlans = [
  {
    name: "Starter",
    usd: "$49",
    inr: "₹4,099",
    period: "/month",
    features: [
      "10,000 evals/mo",
      "3 active rollouts",
      "OpenAI + Anthropic + Gemini",
      "Auto-rollback",
      "7-day data retention",
      "Email alerts",
      "Dashboard + API",
    ],
    cta: "Start free trial",
    style: "outline",
  },
  {
    name: "Pro",
    usd: "$149",
    inr: "₹12,499",
    period: "/month",
    badge: "MOST POPULAR",
    features: [
      "100,000 evals/mo",
      "Unlimited rollouts",
      "All providers + OpenRouter fallback",
      "Auto-rollback",
      "90-day data retention",
      "Slack + webhook alerts",
      "Custom eval criteria",
      "Priority support",
    ],
    cta: "Start free trial",
    style: "primary",
  },
  {
    name: "Enterprise",
    usd: "Custom",
    inr: "",
    period: "",
    features: [
      "Unlimited evals",
      "Dedicated infrastructure",
      "SSO / SAML",
      "Team RBAC",
      "1-year data retention",
      "On-call support",
      "Custom SLA",
    ],
    cta: "Contact us",
    style: "outline",
  },
];

/* ─── Helpers ──────────────────────────────────────────────────────────────── */
function AnimatedNumber({ value, prefix = "", suffix = "" }: { value: number; prefix?: string; suffix?: string }) {
  const [n, setN] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true });
  useEffect(() => {
    if (!inView) return;
    const start = performance.now();
    const dur = 1200;
    const tick = (now: number) => {
      const p = Math.min((now - start) / dur, 1);
      const ease = 1 - Math.pow(1 - p, 3);
      setN(Math.round(ease * value));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [inView, value]);
  return <span ref={ref}>{prefix}{n}{suffix}</span>;
}

function Marquee() {
  return (
    <div className="overflow-hidden relative">
      <div className="flex gap-12 items-center w-max" style={{ animation: "scroll-x 28s linear infinite" }}>
        {[...capabilities, ...capabilities].map((name, i) => (
          <span key={i} className="text-sm font-medium text-gray-400 tracking-widest uppercase whitespace-nowrap hover:text-gray-600 transition-colors">{name}</span>
        ))}
      </div>
      <style>{`@keyframes scroll-x { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  );
}

/* ─── Animated Hero Traffic Flow ──────────────────────────────────────────── */
function HeroTrafficFlow() {
  const [tick, setTick] = useState(0);
  const [phase, setPhase] = useState<"routing"|"rollback"|"shadow">("routing");
  const phaseRef = useRef(0);

  useEffect(() => {
    const id = setInterval(() => setTick(t => (t + 1) % 240), 40);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const id = setInterval(() => {
      phaseRef.current = (phaseRef.current + 1) % 3;
      setPhase(phaseRef.current === 0 ? "routing" : phaseRef.current === 1 ? "rollback" : "shadow");
    }, 5500);
    return () => clearInterval(id);
  }, []);

  const T = tick / 240;
  const R = phase === "rollback";
  const S = phase === "shadow";
  const F = "Inter,system-ui,sans-serif";

  function lp(pts: number[][], t: number) {
    const n = pts.length - 1;
    const seg = Math.min(Math.floor(t * n), n - 1);
    const st  = (t * n) - seg;
    const a = pts[seg], b = pts[seg + 1];
    return { x: a[0] + (b[0] - a[0]) * st, y: a[1] + (b[1] - a[1]) * st };
  }

  // ── Compact layout: viewBox 760×480 ──
  // App node:        cx=90  cy=240  w=130 h=76
  // Gateway node:    cx=310 cy=240  w=140 h=100
  // Baseline node:   cx=600 cy=130  w=150 h=92
  // Candidate node:  cx=600 cy=350  w=150 h=96
  // Judge node:      cx=310 cy=410  w=140 h=68

  // Paths (elbow routing)
  const pApp  = [[155,240],[238,240]] as number[][];
  const pBL   = [[382,214],[480,214],[480,130],[522,130]] as number[][];
  const pCand = [[382,266],[480,266],[480,350],[522,350]] as number[][];
  const pJudge= [[310,292],[310,374]] as number[][];
  const pRB   = [[382,410],[510,410],[510,242],[522,242]] as number[][];

  const cQ = R ? 0.62 : S ? 0.88 : 0.85;

  const mkDots = (offs: number[], path: number[][], col: string, r: number, op = 1) =>
    offs.map((o, i) => {
      const t = (T + o) % 1; if (t > 0.96) return null;
      const p = lp(path, t);
      return <circle key={i} cx={p.x} cy={p.y} r={r} fill={col} opacity={op}/>;
    });

  return (
    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[60%] min-w-[560px] h-[600px] pointer-events-none select-none" aria-hidden>
      <svg viewBox="0 0 760 480" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <filter id="ns"><feDropShadow dx="0" dy="2" stdDeviation="8" floodColor="#7c3aed" floodOpacity="0.08"/></filter>
          <filter id="nw"><feDropShadow dx="0" dy="1" stdDeviation="6" floodColor="#000" floodOpacity="0.06"/></filter>
          <marker id="ma" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L7,3.5 z" fill="#818cf8"/>
          </marker>
          <marker id="mr" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L7,3.5 z" fill="#f87171"/>
          </marker>
          <marker id="mv" markerWidth="7" markerHeight="7" refX="5" refY="3.5" orient="auto">
            <path d="M0,0.5 L0,6.5 L7,3.5 z" fill="#a78bfa"/>
          </marker>
        </defs>

        {/* ── Lines ─────────────────────────────────── */}
        {/* App → Gateway */}
        <line x1="155" y1="240" x2="238" y2="240" stroke="#818cf8" strokeWidth="2" markerEnd="url(#ma)"/>

        {/* Gateway → Baseline */}
        <path d="M 382 214 H 480 V 130 H 522"
          stroke="#818cf8" strokeWidth="2" fill="none" markerEnd="url(#ma)"
          opacity={R ? 0.25 : 1}/>

        {/* Gateway → Candidate */}
        <path d="M 382 266 H 480 V 350 H 522"
          stroke={R ? "#f87171" : S ? "#a78bfa" : "#6366f1"}
          strokeWidth="2"
          strokeDasharray={R ? "6 4" : S ? "5 4" : undefined}
          fill="none"
          markerEnd={R ? "url(#mr)" : "url(#ma)"}/>

        {/* Gateway → Judge */}
        <line x1="310" y1="292" x2="310" y2="374"
          stroke="#a78bfa" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#mv)"/>

        {/* Judge → rollback (red, only R phase) */}
        {R && <path d="M 382 410 H 510 V 242 H 522"
          stroke="#f87171" strokeWidth="2" strokeDasharray="6 4" fill="none" markerEnd="url(#mr)"/>}

        {/* ── % pills on lines ────────────────────── */}
        <rect x="458" y="200" width="46" height="22" rx="11" fill="#818cf8"/>
        <text x="481" y="215" textAnchor="middle" fontSize="11" fill="white" fontFamily={F} fontWeight="700">80%</text>

        <rect x="458" y="338" width="46" height="22" rx="11"
          fill={R ? "#f87171" : S ? "#a78bfa" : "#6366f1"}/>
        <text x="481" y="353" textAnchor="middle" fontSize="11" fill="white" fontFamily={F} fontWeight="700">20%</text>

        {/* threshold badge */}
        {R && <>
          <rect x="455" y="290" width="106" height="26" rx="7" fill="#fef2f2" stroke="#fca5a5" strokeWidth="1"/>
          <text x="508" y="307" textAnchor="middle" fontSize="10.5" fill="#b91c1c" fontFamily={F} fontWeight="700">score &lt; 0.70 threshold</text>
        </>}

        {/* ── YOUR APP node ─────────────────────── */}
        <rect x="26" y="202" width="130" height="76" rx="14" fill="white" stroke="#e5e7eb" strokeWidth="1.5" filter="url(#nw)"/>
        <rect x="42" y="217" width="7" height="7" rx="1.5" fill="#a78bfa"/>
        <rect x="52" y="217" width="7" height="7" rx="1.5" fill="#c4b5fd"/>
        <rect x="42" y="227" width="7" height="7" rx="1.5" fill="#c4b5fd"/>
        <rect x="52" y="227" width="7" height="7" rx="1.5" fill="#a78bfa"/>
        <text x="91" y="231" textAnchor="middle" fontSize="13.5" fill="#111827" fontFamily={F} fontWeight="800">YOUR APP</text>
        <text x="91" y="249" textAnchor="middle" fontSize="11" fill="#9ca3af" fontFamily={F}>any LLM client</text>
        <text x="91" y="266" textAnchor="middle" fontSize="10" fill="#d1d5db" fontFamily={F}>OpenAI · Anthropic · custom</text>

        {/* ── REPATH GATEWAY node ──────────────── */}
        <rect x="240" y="190" width="140" height="100" rx="16" fill="white" stroke="#c4b5fd" strokeWidth="1.5" filter="url(#ns)"/>
        {/* icon */}
        <path d="M298 208 C298 208 306 203 310 208 C314 213 322 208 322 208" stroke="#7c3aed" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="310" cy="214" r="3.5" fill="#7c3aed"/>
        <text x="310" y="237" textAnchor="middle" fontSize="15" fill="#111827" fontFamily={F} fontWeight="800">REPATH</text>
        <text x="310" y="253" textAnchor="middle" fontSize="15" fill="#111827" fontFamily={F} fontWeight="800">GATEWAY</text>
        <text x="310" y="269" textAnchor="middle" fontSize="10.5" fill="#9ca3af" fontFamily={F}>routes · scores</text>
        <text x="310" y="282" textAnchor="middle" fontSize="10" fill="#7c3aed" fontFamily={F} fontWeight="600">&lt;2ms overhead</text>
        <circle cx="310" cy="240" r={46 + Math.sin(tick * 0.07) * 2.5}
          stroke="rgba(124,58,237,0.06)" strokeWidth="1.5" fill="none"/>

        {/* ── BASELINE node ─────────────────────── */}
        <rect x="522" y="84" width="216" height="92" rx="14" fill="white" stroke="#bfdbfe" strokeWidth="1.5" filter="url(#nw)"/>
        <text x="630" y="113" textAnchor="middle" fontSize="15" fill="#1d4ed8" fontFamily={F} fontWeight="800">BASELINE</text>
        <text x="630" y="130" textAnchor="middle" fontSize="12" fill="#3b82f6" fontFamily={F} fontWeight="600">80% of traffic  ·  score: 0.91 ✓</text>
        <text x="630" y="147" textAnchor="middle" fontSize="10.5" fill="#93c5fd" fontFamily={F}>current prompt · stable</text>
        {/* thin underline accent */}
        <line x1="556" y1="157" x2="704" y2="157" stroke="#dbeafe" strokeWidth="1"/>
        <text x="630" y="169" textAnchor="middle" fontSize="10" fill="#93c5fd" fontFamily={F}>quality gate: passing</text>

        {/* ── CANDIDATE / SHADOW node ────────────── */}
        <rect x="522" y="304" width="216" height="92" rx="14" fill="white"
          stroke={R ? "#fca5a5" : S ? "#c4b5fd" : "#c7d2fe"} strokeWidth="1.5" filter="url(#nw)"/>
        <text x="630" y="333" textAnchor="middle" fontSize="15"
          fill={R ? "#b91c1c" : S ? "#6d28d9" : "#4338ca"} fontFamily={F} fontWeight="800">
          {S ? "SHADOW" : "CANDIDATE"}
        </text>
        <text x="630" y="350" textAnchor="middle" fontSize="12"
          fill={R ? "#ef4444" : S ? "#7c3aed" : "#6366f1"} fontFamily={F} fontWeight="600">
          {S ? "parallel · no user impact" : `20% traffic  ·  score: ${cQ}`}
        </text>
        <text x="630" y="367" textAnchor="middle" fontSize="10.5"
          fill={R ? "#fca5a5" : S ? "#a78bfa" : "#818cf8"} fontFamily={F}>
          {R ? "⚠ auto-rollback triggered" : S ? "evaluating before expose" : "→ advancing"}
        </text>
        <line x1="556" y1="377" x2="704" y2="377" stroke={R ? "#fecaca" : "#e0e7ff"} strokeWidth="1"/>
        <text x="630" y="389" textAnchor="middle" fontSize="10"
          fill={R ? "#ef4444" : "#818cf8"} fontFamily={F} fontWeight="600">
          {R ? "100% traffic returning to baseline" : S ? "shadow test · comparing" : "new prompt · testing"}
        </text>

        {/* ── LLM JUDGE node ────────────────────── */}
        <rect x="240" y="374" width="140" height="68" rx="14" fill="white" stroke="#ddd6fe" strokeWidth="1.5" filter="url(#nw)"/>
        <path d="M276 390 L279 384 L282 390 L288 393 L282 396 L279 402 L276 396 L270 393 Z" fill="#7c3aed" opacity="0.75"/>
        <text x="310" y="401" textAnchor="middle" fontSize="13" fill="#111827" fontFamily={F} fontWeight="800">LLM JUDGE</text>
        <text x="310" y="416" textAnchor="middle" fontSize="10.5" fill="#7c3aed" fontFamily={F}>scores every response · async · ~120ms</text>
        <text x="310" y="432" textAnchor="middle" fontSize="10" fill="#c4b5fd" fontFamily={F}>0ms user impact</text>

        {/* ── Phase chip (top-left floating) ──── */}
        <rect x="22" y="14" width={R ? 188 : S ? 152 : 178} height="28" rx="14"
          fill={R ? "#fef2f2" : S ? "#f5f3ff" : "#f0fdf4"}
          stroke={R ? "#fca5a5" : S ? "#ddd6fe" : "#86efac"} strokeWidth="1"/>
        <circle cx="38" cy="28" r="5.5"
          fill={R ? "#ef4444" : S ? "#7c3aed" : "#22c55e"}>
          <animate attributeName="r" values="4.5;6;4.5" dur="1.6s" repeatCount="indefinite"/>
        </circle>
        <text x="50" y="33" fontSize="11.5" fill={R?"#b91c1c":S?"#6d28d9":"#15803d"} fontFamily={F} fontWeight="700">
          {R ? "ROLLBACK TRIGGERED" : S ? "SHADOW TESTING" : "CANARY ROUTING LIVE"}
        </text>

        {/* ── Particles ────────────────────────── */}
        {/* App → Gateway */}
        {[0, 0.45, 0.8].map((o, i) => {
          const t = (T + o) % 1; if (t > 0.96) return null;
          const p = lp(pApp, t);
          return <circle key={`a${i}`} cx={p.x} cy={p.y} r="5.5" fill="#818cf8" opacity="0.9"/>;
        })}
        {/* → Baseline (5 dots, blue) */}
        {mkDots([0,0.18,0.36,0.54,0.72], pBL, "#3b82f6", 5, R ? 0.25 : 0.9)}
        {/* → Candidate (2 dots) */}
        {!S && mkDots([0,0.52], pCand, R?"#f87171":"#6366f1", 5, 0.9)}
        {/* → shadow dots (violet, faint) */}
        {S && mkDots([0,0.55], pCand, "#a78bfa", 4, 0.6)}
        {/* → Judge */}
        {mkDots([0,0.6], pJudge, "#a78bfa", 4.5, 0.75)}
        {/* Judge → rollback */}
        {R && mkDots([0,0.48], pRB, "#ef4444", 5.5, 0.9)}
      </svg>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-3 py-2 text-xs">
      <div className="text-gray-500 mb-1">{label}</div>
      {payload.map((p) => p.value != null && (
        <div key={p.dataKey} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-gray-700">{p.name === "v1" ? "v1 stable" : "v2 canary"}: <strong>{p.value.toFixed(2)}</strong></span>
        </div>
      ))}
    </div>
  );
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function LandingPage() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("canary");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", fn, { passive: true });
    return () => window.removeEventListener("scroll", fn);
  }, []);

  const tab = featureTabs.find((t) => t.id === activeTab)!;

  return (
    <div className="min-h-screen bg-white text-[#0A0A0B] overflow-x-hidden" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* ══ NAV ══════════════════════════════════════════════════════════════ */}
      <header className={`sticky top-0 z-50 bg-white transition-shadow duration-200 ${scrolled ? "shadow-[0_1px_0_0_rgba(0,0,0,0.08)]" : ""}`}>
        <nav className="max-w-7xl mx-auto px-6 h-[68px] flex items-center justify-between gap-6">
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <Image src="/logo-icon.png" alt="Repath" width={40} height={40} className="rounded-xl" />
            <span className="font-bold text-[20px] tracking-tight">Repath</span>
          </Link>

          <div className="hidden md:flex items-center gap-0.5">
            {[["#features","Features"],["#how-it-works","How It Works"],["#pricing","Pricing"]].map(([href, label]) => (
              <a key={href} href={href} className="px-3.5 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors rounded-lg hover:bg-gray-50">{label}</a>
            ))}
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm text-gray-600 hover:text-gray-900 transition-colors px-3 py-2">Sign in</Link>
            <Link href="/signup" className="px-4 py-2 text-sm font-medium bg-[#0A0A0B] text-white rounded-lg hover:bg-gray-800 transition-colors">Start free trial</Link>
          </div>

          <button className="md:hidden text-gray-600 hover:text-gray-900" onClick={() => setMobileOpen(!mobileOpen)}>
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>

        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 bg-white px-6 py-4 flex flex-col gap-1">
            {[["#features","Features"],["#how-it-works","How It Works"],["#pricing","Pricing"]].map(([href, label]) => (
              <a key={href} href={href} className="py-2.5 text-sm text-gray-600 hover:text-gray-900" onClick={() => setMobileOpen(false)}>{label}</a>
            ))}
            <div className="flex gap-3 pt-3 border-t border-gray-100 mt-2">
              <Link href="/login" className="text-sm text-gray-600 py-2">Sign in</Link>
              <Link href="/signup" className="px-4 py-2 text-sm font-medium bg-[#0A0A0B] text-white rounded-lg">Start free trial</Link>
            </div>
          </div>
        )}
      </header>

      {/* ══ HERO ═════════════════════════════════════════════════════════════ */}
      <section className="relative max-w-7xl mx-auto px-8 pt-16 pb-20 min-h-[620px] flex items-center overflow-hidden">
        <HeroTrafficFlow />

        <div className="relative z-10 max-w-[480px]">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 text-xs text-gray-500 mb-6 border border-gray-200">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            AI-native progressive delivery · 7-day free trial
          </div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-5xl md:text-6xl font-bold tracking-tight leading-[1.06] mb-5"
          >
            Ship AI changes<br />
            <span className="text-gray-400">without the risk.</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            className="text-lg text-gray-500 leading-relaxed mb-8 max-w-[480px]"
          >
            Canary deployments for LLM prompts and models. Repath splits traffic, scores every response with an AI judge, and rolls back automatically before your users notice.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.18, duration: 0.6 }}
            className="flex flex-wrap gap-3 mb-8"
          >
            <Link href="/signup" className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0A0A0B] text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors">
              Start free trial <ArrowRight className="w-4 h-4" />
            </Link>
            <a href="#pricing" className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
              See pricing
            </a>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className="flex flex-wrap gap-x-5 gap-y-2"
          >
            {["No credit card to start", "7-day free trial", "Cancel anytime", "UPI & cards accepted"].map((t) => (
              <span key={t} className="flex items-center gap-1.5 text-xs text-gray-400">
                <Check className="w-3.5 h-3.5 text-gray-400" /> {t}
              </span>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ══ CAPABILITIES MARQUEE ══════════════════════════════════════════════ */}
      <section className="border-t border-gray-100 py-8">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-6 overflow-hidden">
            <span className="text-xs text-gray-400 uppercase tracking-widest whitespace-nowrap shrink-0">What we do</span>
            <div className="flex-1 overflow-hidden"><Marquee /></div>
          </div>
        </div>
      </section>

      {/* ══ PLATFORM STATS ════════════════════════════════════════════════════ */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="text-center mb-14"
        >
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">The Repath Platform</h2>
          <p className="text-gray-500 text-lg max-w-xl mx-auto">Catch regressions, evaluate quality, and revert automatically — all before your users notice.</p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { palette: C.blue,   arrow: "↑", tag: "FASTER DETECTION", value: 4,   suffix: " responses", desc: "Mean responses before a quality drop is flagged and rollback triggered.",         link: null },
            { palette: C.violet, arrow: "↓", tag: "LATENCY ADDED",     value: 0,   suffix: "ms",         desc: "Eval runs async — never touches your critical path. Your users never feel it.", link: "How it works" },
            { palette: C.amber,  arrow: "<", tag: "ROLLBACK SPEED",    value: 500, suffix: "ms",         desc: "Time from detection to full traffic restore on the stable version.",             link: null },
          ].map((s, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="rounded-2xl p-8 flex flex-col gap-4"
              style={{ background: s.palette.bg }}
            >
              <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-widest uppercase" style={{ color: s.palette.label }}>
                <span>{s.arrow}</span><span>{s.tag}</span>
              </div>
              <div className="text-6xl md:text-7xl font-bold tracking-tight" style={{ color: s.palette.text }}>
                {s.arrow === "<" ? (
                  <span>&lt;<AnimatedNumber value={s.value} suffix={s.suffix} /></span>
                ) : (
                  <AnimatedNumber value={s.value} suffix={s.suffix} />
                )}
              </div>
              <p className="text-sm leading-relaxed" style={{ color: s.palette.label }}>{s.desc}</p>
              {s.link && (
                <a href="#how-it-works" className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wider" style={{ color: s.palette.label }}>
                  {s.link} <ChevronRight className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          ))}
        </div>
      </section>

      {/* ══ TAB FEATURES ══════════════════════════════════════════════════════ */}
      <section id="features" className="border-t border-gray-100 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-3 border-b border-gray-200 mb-12">
            {featureTabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`py-4 text-sm font-medium text-center transition-all border-b-2 -mb-px ${
                  activeTab === t.id
                    ? "border-[#0A0A0B] text-[#0A0A0B]"
                    : "border-transparent text-gray-400 hover:text-gray-600"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
            className="grid md:grid-cols-2 gap-12 items-start"
          >
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg bg-violet-100 flex items-center justify-center">
                  <tab.icon className="w-4 h-4 text-violet-600" />
                </div>
                <h3 className="text-lg font-semibold">{tab.headline}</h3>
              </div>
              <p className="text-gray-500 leading-relaxed mb-6">{tab.primary}</p>
              <div className="flex flex-col gap-4 mb-8">
                {tab.sub.map((item) => (
                  <div key={item.label} className="flex items-start gap-3">
                    <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5">
                      <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-gray-900">{item.label}</div>
                      <div className="text-sm text-gray-500">{item.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <Link href="/signup" className="inline-flex items-center gap-1.5 text-sm font-semibold bg-[#0A0A0B] text-white px-5 py-2.5 rounded-lg hover:bg-gray-800 transition-colors">
                START FREE TRIAL
              </Link>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-gray-50 overflow-hidden" style={{ minHeight: 260 }}>
              {tab.panel}
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══ PROBLEM (dark) ════════════════════════════════════════════════════ */}
      <section className="py-24" style={{ background: C.dark }}>
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-6"
          >
            <div className="inline-flex items-center gap-2 text-xs text-red-400 font-mono mb-4">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
              quality regressions caught live
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-3">AI models break silently.</h2>
            <p className="text-gray-400 max-w-xl">Zero HTTP errors. Zero exceptions. Just worse outputs your users silently abandon — and you don&apos;t know for days.</p>
          </motion.div>

          <div className="relative mt-10">
            <div className="flex gap-4 overflow-x-auto pb-4" style={{ scrollbarWidth: "none" }}>
              {researchCards.map((card, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: 20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  className={`shrink-0 w-72 rounded-2xl p-6 flex flex-col justify-between gap-4 ${card.highlight ? "bg-gray-600/40 border border-gray-500/40" : "bg-gray-900/60 border border-gray-800"}`}
                  style={{ minHeight: 220 }}
                >
                  <div>
                    <span className="text-[10px] font-semibold tracking-widest uppercase text-gray-400 bg-gray-800 px-2 py-1 rounded">{card.tag}</span>
                    <h4 className="text-white font-semibold text-base mt-4 leading-snug">{card.title}</h4>
                    <p className="text-gray-400 text-sm mt-2 leading-relaxed">{card.sub}</p>
                  </div>
                  <div className="text-xs text-gray-500 uppercase tracking-wider">{card.author}</div>
                </motion.div>
              ))}
            </div>
            <div className="flex gap-2 mt-6">
              <button className="w-8 h-8 rounded-full border border-gray-700 flex items-center justify-center text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="w-8 h-8 rounded-full border border-gray-700 flex items-center justify-center text-gray-400 hover:text-white hover:border-gray-500 transition-colors">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mt-16 rounded-2xl border border-gray-800 bg-gray-900/50 p-8"
          >
            <div className="flex items-center justify-between mb-6">
              <div>
                <div className="text-sm text-gray-400 mb-1">Quality score over time — Repath catches the drop instantly</div>
                <div className="flex gap-4">
                  <span className="flex items-center gap-1.5 text-xs text-gray-400"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block" />v1 stable</span>
                  <span className="flex items-center gap-1.5 text-xs text-gray-400"><span className="w-2 h-2 rounded-full bg-orange-400 inline-block" />v2 canary</span>
                </div>
              </div>
              <div className="text-right text-xs text-red-400 bg-red-900/30 border border-red-800/50 rounded-lg px-3 py-1.5">
                Auto-rollback triggered
              </div>
            </div>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={qualityData} margin={{ top: 4, right: 4, left: -16, bottom: 0 }}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366F1" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#F97316" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#F97316" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="t" tick={{ fill: "#6B7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0.4, 1.0]} tickFormatter={(v: number) => v.toFixed(2)} tick={{ fill: "#6B7280", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip content={<ChartTooltip />} />
                  <ReferenceLine y={0.85} stroke="rgba(239,68,68,0.6)" strokeDasharray="4 4" label={{ value: "rollback threshold", fill: "#EF4444", fontSize: 10, position: "insideTopRight" }} />
                  <Area type="monotone" dataKey="v1" name="v1" stroke="#6366F1" strokeWidth={2} fill="url(#g1)" dot={false} />
                  <Area type="monotone" dataKey="v2" name="v2" stroke="#F97316" strokeWidth={2} fill="url(#g2)" dot={false} connectNulls={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══ HOW IT WORKS ══════════════════════════════════════════════════════ */}
      <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-24">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mb-14"
        >
          <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">How it works</p>
          <h2 className="text-3xl md:text-4xl font-bold tracking-tight max-w-xl">Three steps. Automatic.<br />No code changes beyond one line.</h2>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {[
            { n: "01", title: "Split traffic",              body: "Point your app at Repath instead of OpenAI directly. We route a small % to your new prompt or model — users see nothing different." },
            { n: "02", title: "Score every response",       body: "An LLM judge evaluates every response against your quality criteria. Async — never adds latency to your app." },
            { n: "03", title: "Auto-advance or rollback",   body: "Quality holding? Traffic advances to 100%. Quality drops? Rollback in under 500ms, before your users notice." },
          ].map((step, i) => (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.5 }}
              className="flex flex-col gap-4"
            >
              <div className="text-[11px] font-semibold tracking-widest uppercase text-violet-500">{step.n}</div>
              <div className="w-full h-px bg-gray-200 relative">
                <div className="absolute left-0 top-0 h-px bg-violet-400" style={{ width: i === 0 ? "100%" : i === 1 ? "50%" : "10%" }} />
              </div>
              <h3 className="text-xl font-semibold mt-2">{step.title}</h3>
              <p className="text-gray-500 text-sm leading-relaxed">{step.body}</p>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="mt-14 rounded-2xl border border-gray-200 bg-gray-50 p-8"
        >
          <div className="text-sm font-medium text-gray-700 mb-1">Rollout: <span className="font-mono text-gray-900">new-support-prompt</span></div>
          <div className="text-xs text-gray-400 mb-6">Quality gate: score ≥ 0.85 to advance</div>
          <div className="flex items-center gap-0">
            {[
              { label: "5%",   status: "passed" },
              { label: "25%",  status: "passed" },
              { label: "50%",  status: "live" },
              { label: "100%", status: "pending" },
            ].map((step, i) => (
              <div key={step.label} className="flex items-center flex-1 last:flex-none">
                <div className="flex flex-col items-center gap-2">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold border-2 ${step.status === "passed" ? "bg-emerald-50 border-emerald-400 text-emerald-700" : step.status === "live" ? "bg-blue-50 border-blue-400 text-blue-700 animate-pulse" : "bg-gray-100 border-gray-300 text-gray-400"}`}>
                    {step.status === "passed" ? <Check className="w-3.5 h-3.5" /> : step.status === "live" ? "●" : "○"}
                  </div>
                  <div className="text-xs font-semibold text-gray-700">{step.label}</div>
                  <div className={`text-[10px] ${step.status === "passed" ? "text-emerald-600" : step.status === "live" ? "text-blue-600" : "text-gray-400"}`}>
                    {step.status === "passed" ? "✓ passed" : step.status === "live" ? "live" : "pending"}
                  </div>
                </div>
                {i < 3 && (
                  <div className="flex-1 h-0.5 mx-2 mb-8" style={{ background: step.status === "passed" ? "#34D399" : "#E5E7EB" }} />
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </section>

      {/* ══ FEATURES GRID ═════════════════════════════════════════════════════ */}
      <section className="border-t border-gray-100 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="mb-14"
          >
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">Everything you need</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight max-w-xl">
              Built specifically for AI deployment safety.<br />
              <span className="text-gray-400">Not feature flags with an AI sticker.</span>
            </h2>
          </motion.div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 12 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: (i % 3) * 0.08, duration: 0.5 }}
                className="flex flex-col gap-3 group"
              >
                <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center group-hover:bg-violet-100 transition-colors">
                  <f.icon className="w-5 h-5 text-gray-600 group-hover:text-violet-600 transition-colors" />
                </div>
                <h3 className="font-semibold text-[15px]">{f.title}</h3>
                <p className="text-sm text-gray-500 leading-relaxed">{f.body}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ══ PRICING ═══════════════════════════════════════════════════════════ */}
      <section id="pricing" className="border-t border-gray-100 py-24">
        <div className="max-w-7xl mx-auto px-6">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="text-center mb-5"
          >
            <p className="text-xs font-semibold tracking-widest uppercase text-gray-400 mb-3">Simple pricing</p>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-3">7-day free trial on every plan.</h2>
            <p className="text-gray-500">No credit card required to start.</p>
          </motion.div>

          <div className="flex items-center justify-center gap-2 mb-12 text-sm text-gray-500">
            <span>🇮🇳</span>
            <span>Indian customers: pay in INR via UPI, cards, net banking — powered by Razorpay</span>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {pricingPlans.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5 }}
                className={`relative rounded-2xl p-8 flex flex-col gap-6 border ${plan.style === "primary" ? "border-gray-900 bg-[#0A0A0B] text-white" : "border-gray-200 bg-white text-gray-900"}`}
              >
                {plan.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="px-3 py-1 text-[10px] font-semibold tracking-widest bg-violet-600 text-white rounded-full">{plan.badge}</span>
                  </div>
                )}
                <div>
                  <div className={`text-xs font-semibold tracking-widest uppercase mb-4 ${plan.style === "primary" ? "text-gray-400" : "text-gray-500"}`}>{plan.name}</div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-4xl font-bold">{plan.usd}</span>
                    {plan.period && <span className={`text-sm ${plan.style === "primary" ? "text-gray-400" : "text-gray-500"}`}>{plan.period}</span>}
                  </div>
                  {plan.inr && (
                    <div className={`text-sm mt-1 ${plan.style === "primary" ? "text-gray-400" : "text-gray-500"}`}>{plan.inr}/month in India</div>
                  )}
                </div>
                <ul className="flex flex-col gap-3 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className={`flex items-start gap-2.5 text-sm ${plan.style === "primary" ? "text-gray-300" : "text-gray-600"}`}>
                      <Check className={`w-4 h-4 shrink-0 mt-0.5 ${plan.style === "primary" ? "text-violet-400" : "text-emerald-500"}`} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.name === "Enterprise" ? "mailto:hello@tryrepath.com?subject=Enterprise" : "/signup"}
                  className={`py-2.5 px-4 rounded-lg text-sm font-medium text-center transition-all ${plan.style === "primary" ? "bg-white text-black hover:bg-gray-100" : "bg-[#0A0A0B] text-white hover:bg-gray-800"}`}
                >
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </div>

          <p className="text-center text-sm text-gray-400 mt-8">All plans include provider failover, auto-rollback, and real-time dashboard. Cancel anytime.</p>
        </div>
      </section>

      {/* ══ CTA ═══════════════════════════════════════════════════════════════ */}
      <section className="border-t border-gray-100 py-24" style={{ background: C.dark }}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
          >
            <div className="flex items-center gap-2 text-gray-400 text-sm justify-center mb-3">
              <div className="flex items-center gap-2">
                <Image src="/logo-icon.png" alt="Repath" width={24} height={24} className="rounded-md" />
                <span className="font-medium text-white">Repath</span>
              </div>
            </div>
            <h2 className="text-3xl md:text-5xl font-bold text-white mb-4">Stop shipping AI blind.</h2>
            <p className="text-gray-400 text-lg mb-8 max-w-xl mx-auto">
              Know if your prompt change is better or worse — before your users do. Start your free trial in 30 seconds.
            </p>
            <Link href="/signup" className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-medium rounded-lg hover:bg-gray-100 transition-colors text-sm mb-6">
              Start free trial — no card needed <ArrowRight className="w-4 h-4" />
            </Link>
            <div className="text-sm text-gray-500 mt-4">
              Questions? <a href="mailto:hello@tryrepath.com" className="text-gray-300 hover:text-white transition-colors">hello@tryrepath.com</a>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ══ FOOTER ════════════════════════════════════════════════════════════ */}
      <footer className="bg-gray-50 border-t border-gray-200 overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 pt-16 pb-0">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 md:col-span-1 flex flex-col gap-3">
              <Link href="/" className="flex items-center gap-2">
                <Image src="/logo-icon.png" alt="Repath" width={22} height={22} className="rounded-md" />
                <span className="font-semibold text-sm">Repath</span>
              </Link>
            </div>
            {[
              { h: "PRODUCT", links: [
                { label: "Canary Deployments", href: "/#features" },
                { label: "LLM-as-Judge", href: "/#features" },
                { label: "Auto-Rollback", href: "/#features" },
                { label: "Provider Failover", href: "/#features" },
                { label: "Dashboard", href: "/rollouts" },
              ]},
              { h: "DEVELOPERS", links: [
                { label: "Docs", href: "/docs" },
                { label: "API Reference", href: "/docs#api" },
                { label: "GitHub", href: "https://github.com/repathhq/repath" },
                { label: "Status", href: "/status" },
              ]},
              { h: "PRICING", links: [
                { label: "Pricing overview", href: "/pricing" },
                { label: "Starter — $49/mo", href: "/signup?plan=starter" },
                { label: "Pro — $149/mo", href: "/signup?plan=pro" },
                { label: "Enterprise", href: "mailto:hello@tryrepath.com?subject=Enterprise" },
              ]},
              { h: "COMPANY", links: [
                { label: "About", href: "/about" },
                { label: "Careers", href: "/careers" },
                { label: "Contact", href: "/contact" },
                { label: "Privacy Policy", href: "/privacy" },
                { label: "Terms of Service", href: "/terms" },
              ]},
            ].map((col) => (
              <div key={col.h} className="flex flex-col gap-3">
                <h4 className="text-[10px] font-semibold text-gray-500 uppercase tracking-widest">{col.h}</h4>
                <ul className="flex flex-col gap-2">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <a href={l.href} target={l.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer"
                        className="text-sm text-gray-600 hover:text-gray-900 transition-colors">{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Watermark */}
        <div className="relative overflow-hidden" style={{ height: 120 }}>
          <div
            className="absolute bottom-0 left-0 right-0 text-center select-none pointer-events-none"
            style={{
              fontSize: "clamp(80px, 16vw, 180px)",
              fontWeight: 800,
              letterSpacing: "-0.03em",
              lineHeight: 0.85,
              color: "rgba(0,0,0,0.05)",
            }}
          >
            Repath
          </div>
        </div>

        <div className="border-t border-gray-200 bg-gray-50">
          <div className="max-w-7xl mx-auto px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-xs text-gray-400">© 2026 Repath</p>
            <div className="flex gap-5 text-xs text-gray-400">
              {[["Privacy Policy","/privacy"],["Terms of Service","/terms"],["Contact","/contact"],["Status","/status"]].map(([l,h]) => (
                <a key={l} href={h} className="hover:text-gray-700 transition-colors">{l}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
