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

// Feature tabs — data only, panels rendered inline below
const featureTabs = [
  { id: "canary",   label: "Canary Deployments", icon: GitBranch },
  { id: "judge",    label: "LLM-as-Judge",        icon: BarChart2 },
  { id: "rollback", label: "Auto-Rollback",       icon: RefreshCw },
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
  useEffect(() => { const id = setInterval(() => setTick(t => (t + 1) % 240), 40); return () => clearInterval(id); }, []);
  useEffect(() => {
    const id = setInterval(() => {
      phaseRef.current = (phaseRef.current + 1) % 3;
      setPhase(phaseRef.current === 0 ? "routing" : phaseRef.current === 1 ? "rollback" : "shadow");
    }, 5500);
    return () => clearInterval(id);
  }, []);

  // ── Fixed coordinate layout — nothing can overlap ──
  // viewBox: 820 × 500
  // Zone A (left):   Your App    x=20–170   y=210–290
  // Zone B (center): Gateway     x=220–390  y=195–315
  // Zone C (top-r):  Baseline    x=530–780  y=60–160
  // Zone D (bot-r):  Candidate   x=530–780  y=310–410
  // Zone E (bot-c):  Judge       x=220–390  y=370–450
  // Threshold badge: x=410–540   y=295–325  (between gateway and candidate — fixed)
  // Phase chip:      x=20–230    y=14–44    (top, never overlaps nodes)

  const T = tick / 240;
  const R = phase === "rollback";
  const S = phase === "shadow";
  const F = "Inter,system-ui,sans-serif";

  function lp(pts: number[][], t: number) {
    const n = pts.length - 1;
    const seg = Math.min(Math.floor(t * n), n - 1);
    const st = (t * n) - seg;
    const a = pts[seg], b = pts[seg + 1];
    return { x: a[0] + (b[0] - a[0]) * st, y: a[1] + (b[1] - a[1]) * st };
  }

  const pApp   = [[170,250],[218,250]] as number[][];
  const pBL    = [[392,222],[500,222],[500,110],[528,110]] as number[][];
  const pCand  = [[392,278],[500,278],[500,360],[528,360]] as number[][];
  const pJudge = [[305,316],[305,368]] as number[][];
  // Rollback: Judge → back left to Gateway (not to baseline)
  const pRB    = [[304,368],[304,310],[392,310]] as number[][];

  const cQ = R ? 0.62 : S ? 0.88 : 0.85;

  const D = (offs: number[], path: number[][], col: string, r: number, op = 1) =>
    offs.map((o, i) => {
      const t = (T + o) % 1; if (t > 0.96) return null;
      const p = lp(path, t);
      return <circle key={i} cx={p.x} cy={p.y} r={r} fill={col} opacity={op}/>;
    });

  return (
    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-[62%] min-w-[580px] h-[580px] pointer-events-none select-none" aria-hidden>
      <svg viewBox="0 0 820 500" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <defs>
          <filter id="sh1"><feDropShadow dx="0" dy="2" stdDeviation="8" floodColor="#6366f1" floodOpacity="0.09"/></filter>
          <filter id="sh2"><feDropShadow dx="0" dy="1" stdDeviation="6" floodColor="#000" floodOpacity="0.06"/></filter>
          <marker id="av" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,1 L0,7 L8,4 z" fill="#818cf8"/></marker>
          <marker id="ar" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,1 L0,7 L8,4 z" fill="#f87171"/></marker>
          <marker id="ap" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,1 L0,7 L8,4 z" fill="#a78bfa"/></marker>
        </defs>

        {/* ══ CONNECTORS ══════════════════════════════════════ */}
        {/* App → Gateway */}
        <line x1="170" y1="250" x2="218" y2="250" stroke="#818cf8" strokeWidth="2" markerEnd="url(#av)"/>

        {/* Gateway → Baseline (elbow right then up) */}
        <path d="M 392 222 H 500 V 110 H 528" stroke="#818cf8" strokeWidth="2" fill="none"
          markerEnd="url(#av)" opacity={R ? 0.2 : 1}/>

        {/* Gateway → Candidate (elbow right then down) */}
        <path d="M 392 278 H 500 V 360 H 528"
          stroke={R ? "#f87171" : S ? "#a78bfa" : "#818cf8"}
          strokeWidth="2" fill="none"
          strokeDasharray={R ? "7 4" : S ? "5 4" : undefined}
          markerEnd={R ? "url(#ar)" : S ? "url(#ap)" : "url(#av)"}/>

        {/* Gateway → Judge (dashed down) */}
        <line x1="305" y1="316" x2="305" y2="368" stroke="#c4b5fd" strokeWidth="1.5" strokeDasharray="5 4" markerEnd="url(#ap)"/>

        {/* Rollback: Judge → back to Gateway (shows traffic returning to stable) */}
        {R && <path d="M 304 368 V 310 H 392" stroke="#ef4444" strokeWidth="2" strokeDasharray="6 4" fill="none" markerEnd="url(#ar)"/>}

        {/* ══ % PILLS (fixed, on elbow midpoints — never overlap nodes) ══ */}
        {/* 80% pill: on baseline elbow at x=500, y=165 */}
        <rect x="478" y="152" width="44" height="20" rx="10" fill="#818cf8" opacity={R ? 0.3 : 1}/>
        <text x="500" y="166" textAnchor="middle" fontSize="11" fill="white" fontFamily={F} fontWeight="700">80%</text>

        {/* 20% pill: on candidate elbow at x=500, y=318 */}
        <rect x="478" y="305" width="44" height="20" rx="10" fill={R ? "#f87171" : S ? "#a78bfa" : "#818cf8"}/>
        <text x="500" y="319" textAnchor="middle" fontSize="11" fill="white" fontFamily={F} fontWeight="700">20%</text>

        {/* Threshold badge — below the candidate elbow, clear of all nodes */}
        {R && (
          <g>
            <rect x="392" y="420" width="126" height="28" rx="8" fill="#fef2f2" stroke="#fca5a5" strokeWidth="1.2"/>
            <text x="455" y="438" textAnchor="middle" fontSize="11" fill="#b91c1c" fontFamily={F} fontWeight="700">score &lt; 0.70 threshold</text>
          </g>
        )}

        {/* ══ NODE A — YOUR APP ═══════════════════════════════ */}
        {/* Fixed zone: x=20–170, y=215–285 */}
        <rect x="20" y="215" width="150" height="70" rx="14" fill="white" stroke="#e5e7eb" strokeWidth="1.5" filter="url(#sh2)"/>
        {/* 2×2 icon grid */}
        <rect x="36" y="231" width="7" height="7" rx="2" fill="#a78bfa"/>
        <rect x="46" y="231" width="7" height="7" rx="2" fill="#c4b5fd"/>
        <rect x="36" y="241" width="7" height="7" rx="2" fill="#c4b5fd"/>
        <rect x="46" y="241" width="7" height="7" rx="2" fill="#a78bfa"/>
        <text x="100" y="244" textAnchor="middle" fontSize="14" fill="#111827" fontFamily={F} fontWeight="800">YOUR APP</text>
        <text x="100" y="262" textAnchor="middle" fontSize="11" fill="#9ca3af" fontFamily={F}>any LLM client</text>

        {/* ══ NODE B — REPATH GATEWAY ═════════════════════════ */}
        {/* Fixed zone: x=220–390, y=195–315 */}
        <rect x="220" y="195" width="172" height="120" rx="16" fill="white" stroke="#ddd6fe" strokeWidth="1.8" filter="url(#sh1)"/>
        {/* pulsing ring — inside the node rect, safe */}
        <circle cx="306" cy="252" r={42 + Math.sin(tick * 0.07) * 2} stroke="rgba(124,58,237,0.06)" strokeWidth="1.5" fill="none"/>
        {/* icon */}
        <path d="M284 218 C284 218 292 213 306 218 C320 223 328 218 328 218" stroke="#7c3aed" strokeWidth="2" fill="none" strokeLinecap="round"/>
        <circle cx="306" cy="224" r="3" fill="#7c3aed"/>
        <text x="306" y="246" textAnchor="middle" fontSize="16" fill="#111827" fontFamily={F} fontWeight="800">REPATH</text>
        <text x="306" y="263" textAnchor="middle" fontSize="16" fill="#111827" fontFamily={F} fontWeight="800">GATEWAY</text>
        <text x="306" y="280" textAnchor="middle" fontSize="11" fill="#a78bfa" fontFamily={F}>routes · scores · &lt;2ms</text>

        {/* ══ NODE C — BASELINE ═══════════════════════════════ */}
        {/* Fixed zone: x=528–778, y=62–162 */}
        <rect x="528" y="62" width="250" height="96" rx="14" fill="white" stroke="#bfdbfe" strokeWidth="1.5" filter="url(#sh2)"/>
        <text x="653" y="92" textAnchor="middle" fontSize="16" fill="#1d4ed8" fontFamily={F} fontWeight="800">BASELINE</text>
        <text x="653" y="112" textAnchor="middle" fontSize="12.5" fill="#3b82f6" fontFamily={F} fontWeight="600">80% of traffic</text>
        <text x="653" y="130" textAnchor="middle" fontSize="11" fill="#93c5fd" fontFamily={F}>current prompt · score: 0.91 ✓</text>
        <text x="653" y="148" textAnchor="middle" fontSize="10" fill="#bfdbfe" fontFamily={F}>stable · quality gate passing</text>

        {/* ══ NODE D — CANDIDATE / SHADOW ═════════════════════ */}
        {/* Fixed zone: x=528–778, y=312–412 */}
        <rect x="528" y="312" width="250" height="96" rx="14" fill="white"
          stroke={R ? "#fca5a5" : S ? "#c4b5fd" : "#c7d2fe"} strokeWidth="1.5" filter="url(#sh2)"/>
        <text x="653" y="342" textAnchor="middle" fontSize="16"
          fill={R ? "#b91c1c" : S ? "#6d28d9" : "#4338ca"} fontFamily={F} fontWeight="800">
          {S ? "SHADOW" : "CANDIDATE"}
        </text>
        <text x="653" y="362" textAnchor="middle" fontSize="12.5"
          fill={R ? "#ef4444" : S ? "#7c3aed" : "#6366f1"} fontFamily={F} fontWeight="600">
          {S ? "parallel · no user impact" : "20% of traffic"}
        </text>
        <text x="653" y="380" textAnchor="middle" fontSize="11"
          fill={R ? "#fca5a5" : S ? "#a78bfa" : "#818cf8"} fontFamily={F}>
          {R ? `score: ${cQ} · auto-rollback triggered` : S ? `score: ${cQ} · comparing` : `score: ${cQ} · advancing`}
        </text>
        <text x="653" y="398" textAnchor="middle" fontSize="10"
          fill={R ? "#ef4444" : S ? "#a78bfa" : "#a5b4fc"} fontFamily={F}>
          {R ? "100% traffic returning to baseline" : S ? "shadow test · evaluating" : "new prompt · testing"}
        </text>

        {/* ══ NODE E — LLM JUDGE ══════════════════════════════ */}
        {/* Fixed zone: x=220–390, y=370–450 */}
        <rect x="220" y="370" width="172" height="78" rx="14" fill="white" stroke="#ede9fe" strokeWidth="1.5" filter="url(#sh2)"/>
        <path d="M248 392 L251 385 L254 392 L261 395 L254 398 L251 405 L248 398 L241 395 Z" fill="#a78bfa" opacity="0.8"/>
        <text x="306" y="400" textAnchor="middle" fontSize="14" fill="#111827" fontFamily={F} fontWeight="800">LLM JUDGE</text>
        <text x="306" y="417" textAnchor="middle" fontSize="11" fill="#7c3aed" fontFamily={F}>scores every response</text>
        <text x="306" y="433" textAnchor="middle" fontSize="10" fill="#c4b5fd" fontFamily={F}>async · ~120ms · 0ms user impact</text>

        {/* ══ PHASE CHIP (top-left, fixed zone x=20–240, y=14–44) ══ */}
        <rect x="20" y="14" width={R ? 196 : S ? 160 : 188} height="28" rx="14"
          fill={R ? "#fef2f2" : S ? "#f5f3ff" : "#f0fdf4"}
          stroke={R ? "#fca5a5" : S ? "#ddd6fe" : "#86efac"} strokeWidth="1"/>
        <circle cx="37" cy="28" r="5" fill={R ? "#ef4444" : S ? "#7c3aed" : "#22c55e"}>
          <animate attributeName="r" values="4;5.5;4" dur="1.6s" repeatCount="indefinite"/>
        </circle>
        <text x="49" y="33" fontSize="11.5" fill={R ? "#b91c1c" : S ? "#6d28d9" : "#15803d"} fontFamily={F} fontWeight="700">
          {R ? "ROLLBACK TRIGGERED" : S ? "SHADOW TESTING" : "CANARY ROUTING LIVE"}
        </text>

        {/* ══ ANIMATED PARTICLES ══════════════════════════════ */}
        {[0,0.42,0.78].map((o,i)=>{const t=(T+o)%1;if(t>0.96)return null;const p=lp(pApp,t);return<circle key={`a${i}`}cx={p.x}cy={p.y}r="5"fill="#818cf8"opacity="0.9"/>;})}
        {D([0,0.18,0.36,0.54,0.72],pBL,"#3b82f6",5,R?0.2:0.9)}
        {!S&&D([0,0.55],pCand,R?"#f87171":"#6366f1",5,0.9)}
        {S&&D([0,0.6],pCand,"#a78bfa",4,0.6)}
        {D([0,0.6],pJudge,"#a78bfa",4,0.75)}
        {R&&D([0,0.5],pRB,"#ef4444",5.5,0.9)}
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
      <section className="relative max-w-7xl mx-auto px-5 sm:px-8 pt-12 sm:pt-16 pb-16 sm:pb-20 min-h-[520px] sm:min-h-[620px] flex items-center overflow-hidden">
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
            className="text-3xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.06] mb-5"
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
      <section id="features" className="border-t border-gray-100 py-20 bg-white">
        <div className="max-w-7xl mx-auto px-6">

          {/* Tab bar — Together.ai style: 3 columns, underline active */}
          <div className="grid grid-cols-3 border-b-2 border-gray-100 mb-14">
            {featureTabs.map((t) => {
              const active = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center justify-center gap-2.5 py-4 text-[15px] font-semibold transition-all duration-200 border-b-2 -mb-px ${
                    active
                      ? "border-violet-600 text-gray-900"
                      : "border-transparent text-gray-400 hover:text-gray-700"
                  }`}
                >
                  <t.icon className={`w-4 h-4 ${active ? "text-violet-600" : "text-gray-400"}`} strokeWidth={1.8} />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* Panel — full-width dashboard card */}
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.28 }}
          >

            {/* ── CANARY DEPLOYMENTS ── */}
            {activeTab === "canary" && (
              <div className="grid lg:grid-cols-[380px_1fr] gap-12 items-start">
                {/* Left: description */}
                <div>
                  <div className="flex items-center gap-2.5 mb-5">
                    <GitBranch className="w-5 h-5 text-violet-600" strokeWidth={2} />
                    <span className="text-[13px] font-semibold text-violet-600 uppercase tracking-wide">Canary Deployments</span>
                  </div>
                  <h3 className="text-[32px] font-bold text-gray-900 leading-[1.15] tracking-tight mb-4">
                    Ship prompt changes<br />without the risk.
                  </h3>
                  <p className="text-[15px] text-gray-500 leading-relaxed mb-6">
                    Route a small % of traffic to a new prompt version. Quality gates control every step — traffic only advances when scores consistently hold.
                  </p>
                  {[
                    { label: "Traffic splitting", desc: "Any % down to 0.1% granularity. No SDK rewrites." },
                    { label: "Quality-gated advance", desc: "Traffic only increases when scores hold." },
                    { label: "Instant abort", desc: "Any step can halt immediately — traffic snaps back." },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3 mb-4">
                      <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-1">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-gray-900">{item.label}</div>
                        <div className="text-[13px] text-gray-500">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                  <Link href="/signup" className="inline-flex items-center gap-2 mt-2 px-5 py-2.5 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                    START FREE TRIAL <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                {/* Right: dashboard card */}
                <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[15px] font-semibold text-gray-900">Deployment Monitor</span>
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[11px] font-semibold text-emerald-600 border border-emerald-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> Live
                      </span>
                    </div>
                    <span className="text-[12px] text-gray-400 font-medium">rollout: support-v2</span>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-4 divide-x divide-gray-100">
                    {[
                      { label: "QUALITY SCORE", val: "0.87", sub: "was 0.91", valColor: "text-emerald-600" },
                      { label: "THRESHOLD",      val: "0.85", sub: "configured" },
                      { label: "TRAFFIC",        val: "50%",  sub: "to support-v2", valColor: "text-violet-600" },
                      { label: "STEP",           val: "3/4",  sub: "advancing" },
                    ].map(s => (
                      <div key={s.label} className="px-5 py-4">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
                        <p className={`text-[22px] font-bold ${s.valColor ?? "text-gray-900"}`}>{s.val}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{s.sub}</p>
                      </div>
                    ))}
                  </div>

                  {/* Rollout progress */}
                  <div className="px-6 py-5 border-t border-gray-100">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">Rollout Steps</p>
                    <div className="space-y-3">
                      {[
                        { pct: "5%",   label: "Step 1",  status: "passed",  score: "0.91" },
                        { pct: "25%",  label: "Step 2",  status: "passed",  score: "0.89" },
                        { pct: "50%",  label: "Step 3",  status: "live",    score: "0.87" },
                        { pct: "100%", label: "Step 4",  status: "pending", score: "—" },
                      ].map(step => (
                        <div key={step.pct} className="flex items-center gap-4">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                            step.status === "passed"  ? "bg-emerald-100" :
                            step.status === "live"    ? "bg-violet-100" : "bg-gray-100"
                          }`}>
                            {step.status === "passed"  && <Check className="w-3.5 h-3.5 text-emerald-600" strokeWidth={2.5} />}
                            {step.status === "live"    && <span className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />}
                            {step.status === "pending" && <span className="w-2 h-2 rounded-full bg-gray-300" />}
                          </div>
                          <div className="w-10 text-[13px] font-semibold text-gray-700">{step.pct}</div>
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full transition-all duration-700 ${
                              step.status === "passed" ? "w-full bg-emerald-400" :
                              step.status === "live"   ? "w-1/2 bg-violet-500" : "w-0"
                            }`} />
                          </div>
                          <div className={`text-[12px] font-mono w-10 text-right ${
                            step.status === "passed" ? "text-emerald-600" :
                            step.status === "live"   ? "text-violet-600" : "text-gray-300"
                          }`}>{step.score}</div>
                          <div className={`text-[11px] font-medium w-16 ${
                            step.status === "passed" ? "text-emerald-500" :
                            step.status === "live"   ? "text-violet-500 font-semibold" : "text-gray-300"
                          }`}>
                            {step.status === "passed" ? "✓ passed" : step.status === "live" ? "● live" : "pending"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Gate expression */}
                  <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-3">
                    <span className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold">Quality gate</span>
                    <code className="text-[12px] font-mono text-violet-600 bg-violet-50 px-2.5 py-0.5 rounded-md">score ≥ 0.85 for 10 min</code>
                  </div>
                </div>
              </div>
            )}

            {/* ── LLM-AS-JUDGE ── */}
            {activeTab === "judge" && (
              <div className="grid lg:grid-cols-[380px_1fr] gap-12 items-start">
                <div>
                  <div className="flex items-center gap-2.5 mb-5">
                    <BarChart2 className="w-5 h-5 text-violet-600" strokeWidth={2} />
                    <span className="text-[13px] font-semibold text-violet-600 uppercase tracking-wide">LLM-as-Judge</span>
                  </div>
                  <h3 className="text-[32px] font-bold text-gray-900 leading-[1.15] tracking-tight mb-4">
                    Score every response.<br />Catch silent regressions.
                  </h3>
                  <p className="text-[15px] text-gray-500 leading-relaxed mb-6">
                    An independent LLM judge scores every response against your custom rubric — async, ~120ms, zero latency added to your users.
                  </p>
                  {[
                    { label: "Plain-English criteria", desc: "Define what \"good\" means in natural language." },
                    { label: "8 judge models", desc: "GPT-4o, Claude 3.5, Gemini 1.5 Pro and more." },
                    { label: "Per-dimension scores", desc: "Accuracy, safety, format, tone — individually weighted." },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3 mb-4">
                      <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-1">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-gray-900">{item.label}</div>
                        <div className="text-[13px] text-gray-500">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                  <Link href="/signup" className="inline-flex items-center gap-2 mt-2 px-5 py-2.5 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                    START FREE TRIAL <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[15px] font-semibold text-gray-900">Evaluation Result</span>
                      <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-[11px] font-bold text-emerald-600 border border-emerald-100">PASS</span>
                    </div>
                    <span className="text-[12px] text-gray-400 font-mono">response #48291</span>
                  </div>

                  {/* Score bars */}
                  <div className="px-6 py-5 space-y-5">
                    {[
                      { dim: "Accuracy",    score: 0.91, color: "#7C3AED", bg: "bg-violet-500" },
                      { dim: "Safety",      score: 0.98, color: "#10B981", bg: "bg-emerald-500" },
                      { dim: "Helpfulness", score: 0.84, color: "#F97316", bg: "bg-orange-500" },
                      { dim: "Tone",        score: 0.79, color: "#EC4899", bg: "bg-pink-500" },
                    ].map(r => (
                      <div key={r.dim}>
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[13px] font-medium text-gray-700">{r.dim}</span>
                          <span className="text-[13px] font-bold font-mono" style={{ color: r.color }}>{r.score.toFixed(2)}</span>
                        </div>
                        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${r.bg}`} style={{ width: `${r.score * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Composite */}
                  <div className="mx-6 mb-5 rounded-xl bg-gray-50 border border-gray-200 px-5 py-4 flex items-center justify-between">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Composite Score</p>
                      <p className="text-[28px] font-bold text-gray-900">0.88</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Judge Model</p>
                      <p className="text-[13px] font-semibold text-gray-700">gpt-4o-mini</p>
                      <p className="text-[11px] text-gray-400 mt-0.5">~124ms · async</p>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center gap-3">
                    <span className="text-[11px] text-gray-400 uppercase tracking-wide font-semibold">Threshold</span>
                    <code className="text-[12px] font-mono text-purple-600 bg-purple-50 px-2.5 py-0.5 rounded-md">composite ≥ 0.80 → advance</code>
                  </div>
                </div>
              </div>
            )}

            {/* ── AUTO-ROLLBACK ── */}
            {activeTab === "rollback" && (
              <div className="grid lg:grid-cols-[380px_1fr] gap-12 items-start">
                <div>
                  <div className="flex items-center gap-2.5 mb-5">
                    <RefreshCw className="w-5 h-5 text-violet-600" strokeWidth={2} />
                    <span className="text-[13px] font-semibold text-violet-600 uppercase tracking-wide">Auto-Rollback</span>
                  </div>
                  <h3 className="text-[32px] font-bold text-gray-900 leading-[1.15] tracking-tight mb-4">
                    Automatically revert<br />in under 500ms.
                  </h3>
                  <p className="text-[15px] text-gray-500 leading-relaxed mb-6">
                    Repath continuously monitors quality in real-time and automatically rolls back traffic before your users are affected.
                  </p>
                  {[
                    { label: "Sub-500ms revert", desc: "Detected and reverted before users see a second bad response." },
                    { label: "4-response detection", desc: "Mean lag before a quality drop triggers rollback." },
                    { label: "Full audit trail", desc: "Every decision logged with scores and timestamps." },
                  ].map(item => (
                    <div key={item.label} className="flex items-start gap-3 mb-4">
                      <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center shrink-0 mt-1">
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </div>
                      <div>
                        <div className="text-[14px] font-semibold text-gray-900">{item.label}</div>
                        <div className="text-[13px] text-gray-500">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                  <Link href="/signup" className="inline-flex items-center gap-2 mt-2 px-5 py-2.5 bg-gray-900 text-white text-[13px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                    START FREE TRIAL <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>

                <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                    <div className="flex items-center gap-2.5">
                      <span className="text-[15px] font-semibold text-gray-900">Deployment Monitor</span>
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-[11px] font-semibold text-red-600 border border-red-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" /> Rollback
                      </span>
                    </div>
                    <span className="text-[12px] text-gray-400 font-medium">Last 30 min</span>
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-4 divide-x divide-gray-100">
                    {[
                      { label: "QUALITY SCORE", val: "0.61", sub: "was 0.91", valColor: "text-red-500" },
                      { label: "THRESHOLD",      val: "0.85", sub: "configured" },
                      { label: "TRAFFIC",        val: "25%",  sub: "to support-v2", valColor: "text-gray-700" },
                      { label: "USERS IMPACTED", val: "0",    sub: "none", valColor: "text-emerald-600" },
                    ].map(s => (
                      <div key={s.label} className="px-5 py-4">
                        <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">{s.label}</p>
                        <p className={`text-[22px] font-bold ${s.valColor ?? "text-gray-900"}`}>{s.val}</p>
                        <p className="text-[11px] text-gray-400 mt-0.5">{s.sub}</p>
                      </div>
                    ))}
                  </div>

                  {/* Timeline */}
                  <div className="px-6 pt-5 pb-2 border-t border-gray-100">
                    <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-4">Rollback Timeline</p>
                    <div className="flex items-start gap-0">
                      {[
                        { time: "03:47:12", label: "Quality regression\ndetected",    done: true },
                        { time: "03:47:12", label: "Threshold\ncrossed",              done: true },
                        { time: "03:47:13", label: "Rollback\ninitiated",             done: true },
                        { time: "03:47:13", label: "Traffic\nrestored",              done: true },
                      ].map((step, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center text-center">
                          <div className="flex items-center w-full">
                            <div className="flex-1 h-0.5 bg-violet-200 first:opacity-0" style={{ opacity: i === 0 ? 0 : 1 }} />
                            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center shrink-0 z-10">
                              <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
                            </div>
                            <div className="flex-1 h-0.5 bg-violet-200 last:opacity-0" style={{ opacity: i === 3 ? 0 : 1 }} />
                          </div>
                          <p className="text-[10px] font-mono text-gray-400 mt-2">{step.time}</p>
                          <p className="text-[11px] text-gray-600 font-medium mt-0.5 leading-tight whitespace-pre-line">{step.label}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Footer result */}
                  <div className="mx-6 mb-5 mt-4 rounded-xl bg-violet-600 px-5 py-3.5 flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <RefreshCw className="w-4.5 h-4.5 text-white" strokeWidth={2} />
                      <span className="text-[13px] font-bold text-white tracking-wide">AUTO-ROLLBACK COMPLETED</span>
                    </div>
                    <div className="text-right">
                      <p className="text-[22px] font-bold text-white leading-none">412ms</p>
                      <p className="text-[11px] text-violet-200">total time</p>
                    </div>
                  </div>

                  {/* Deployment status sidebar row */}
                  <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 grid grid-cols-2 gap-4 text-[12px]">
                    <div><span className="text-gray-400">Restored to</span> <span className="font-semibold text-emerald-600 ml-1">support-v1</span></div>
                    <div><span className="text-gray-400">Detection lag</span> <span className="font-semibold text-gray-700 ml-1">4 responses</span></div>
                  </div>
                </div>
              </div>
            )}

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
