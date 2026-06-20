"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowRight, Check, Loader2, AlertTriangle, BarChart3,
  Zap, FlaskConical, CreditCard, Star
} from "lucide-react";

interface Usage {
  plan: string;
  eval_quota_monthly: number;
  evals_used: number;
  evals_remaining: number;
  usage_percent: number;
  trial_active: boolean;
  trial_ends_at: string | null;
  active: boolean;
}

declare global {
  interface Window {
    Razorpay: new (opts: object) => { open(): void };
  }
}

const FONT = { fontFamily: "'Inter', system-ui, sans-serif" };

export default function BillingPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const isIndia = typeof window !== "undefined" && (
    Intl.DateTimeFormat().resolvedOptions().timeZone?.includes("Calcutta") ||
    Intl.DateTimeFormat().resolvedOptions().timeZone?.includes("Kolkata")
  );

  useEffect(() => {
    fetch("/api/billing/usage")
      .then(r => {
        if (r.status === 401) { window.location.href = "/login"; return null; }
        return r.json();
      })
      .then(d => { if (d) setUsage(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const daysLeft = usage?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(usage.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  const handleRazorpay = async (plan: string) => {
    const res = await fetch("/api/billing/razorpay/create-order", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) { setError("Failed to create payment order. Try again."); return; }
    const order = await res.json() as {
      orderId: string; amount: number; currency: string;
      keyId: string; tenantId: string; email: string; name: string;
      plan: string; testMode?: boolean;
    };
    if (!window.Razorpay) {
      await new Promise<void>(resolve => {
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    }
    new window.Razorpay({
      key: order.keyId, amount: order.amount, currency: order.currency,
      name: "Repath",
      description: `${order.plan.charAt(0).toUpperCase() + order.plan.slice(1)} Plan`,
      order_id: order.orderId,
      prefill: { email: order.email, name: order.name },
      theme: { color: "#7c3aed" },
      handler: () => {
        setSuccess(`Payment successful! Your ${order.plan} plan is now active.`);
        setTimeout(() => window.location.reload(), 2000);
      },
    }).open();
  };

  const handlePaddle = async (plan: string) => {
    const res = await fetch("/api/billing/paddle/create-checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (!res.ok) { setError("Failed to create checkout. Try again."); return; }
    const { checkoutUrl } = await res.json() as { checkoutUrl: string };
    if (checkoutUrl) window.location.href = checkoutUrl;
  };

  const handleUpgrade = async (plan: string) => {
    setUpgrading(plan); setError("");
    isIndia ? await handleRazorpay(plan) : await handlePaddle(plan);
    setUpgrading(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64" style={FONT}>
        <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
      </div>
    );
  }

  const planLabel = (p: string) => p.charAt(0).toUpperCase() + p.slice(1);
  const usedPct = Math.min((usage?.usage_percent ?? 0), 100);

  const plans = [
    {
      id: "starter",
      name: "Starter",
      usd: "$49",
      inr: "₹4,099",
      evals: "10,000 evals/month",
      features: [
        "3 active rollouts",
        "OpenAI + Anthropic + Gemini",
        "Auto-rollback",
        "7-day data retention",
        "Email alerts",
        "Dashboard + API",
      ],
      highlight: false,
    },
    {
      id: "pro",
      name: "Pro",
      usd: "$149",
      inr: "₹12,499",
      evals: "100,000 evals/month",
      features: [
        "Unlimited rollouts",
        "All providers + OpenRouter fallback",
        "Auto-rollback",
        "90-day data retention",
        "Slack + webhook alerts",
        "Custom eval criteria",
        "Priority support",
      ],
      highlight: true,
    },
  ];

  return (
    <div className="p-8 max-w-[900px] mx-auto" style={FONT}>

      {/* Page header */}
      <div className="mb-8">
        <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">Billing</h1>
        <p className="text-[13px] text-gray-500 mt-0.5">Manage your plan, usage, and payment</p>
      </div>

      {/* Test mode banner */}
      {process.env.NODE_ENV !== "production" && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 mb-6">
          <FlaskConical className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-semibold text-amber-800">Razorpay Test Mode</p>
            <p className="text-[12px] text-amber-700 mt-0.5">
              Use card <code className="font-mono font-bold">4111 1111 1111 1111</code>, any CVV, any future expiry.
            </p>
          </div>
        </div>
      )}

      {/* Success / Error */}
      {success && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-emerald-200 bg-emerald-50 mb-6">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <p className="text-[14px] text-emerald-800 font-medium">{success}</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-red-200 bg-red-50 mb-6">
          <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
          <p className="text-[14px] text-red-700">{error}</p>
        </div>
      )}

      {/* Current plan card */}
      {usage && (
        <div className="rounded-2xl border border-gray-200 bg-white p-6 mb-6 shadow-sm">
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Current Plan</p>
              <div className="flex items-center gap-2.5">
                <span className="text-[20px] font-bold text-gray-900 capitalize">{usage.plan}</span>
                {usage.trial_active && daysLeft !== null && (
                  <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-100 text-[11px] font-semibold text-violet-700">
                    <Zap className="w-3 h-3" />
                    {daysLeft} day{daysLeft !== 1 ? "s" : ""} left in trial
                  </span>
                )}
              </div>
            </div>
            {usage.plan === "trial" || usage.plan === "starter" ? (
              <Link href="#upgrade" className="px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
                Upgrade
              </Link>
            ) : (
              <span className="px-3 py-1.5 bg-emerald-50 text-emerald-700 text-[12px] font-semibold rounded-lg border border-emerald-100">
                Active
              </span>
            )}
          </div>

          {/* Usage bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[13px] text-gray-600 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-gray-400" />
                LLM evaluations this month
              </span>
              <span className="text-[13px] font-semibold text-gray-900 font-mono">
                {(usage.evals_used ?? 0).toLocaleString()} / {(usage.eval_quota_monthly ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-violet-500"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="text-[12px] text-gray-400 mt-1.5">
              {(usage.evals_remaining ?? 0).toLocaleString()} evaluations remaining
            </p>
          </div>
        </div>
      )}

      {/* Plans — always shown so users can buy at any time */}
      {usage?.plan !== "enterprise" && (
        <div id="upgrade">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-gray-900">
              {usage?.plan === "pro" ? "Your plan" : "Choose a plan"}
            </h2>
            <p className="text-[12px] text-gray-500">
              {isIndia ? "🇮🇳 UPI, cards, net banking via Razorpay" : "Cards & PayPal via Paddle"}
            </p>
          </div>

          <div className="grid md:grid-cols-2 gap-4 mb-4">
            {plans.map(plan => {
              const isCurrent = usage?.plan === plan.id;
              return (
                <div key={plan.id} className={`relative rounded-2xl border p-6 flex flex-col bg-white ${
                  isCurrent
                    ? "border-emerald-300 shadow-sm"
                    : plan.highlight
                    ? "border-violet-300 shadow-md shadow-violet-100"
                    : "border-gray-200"
                }`}>
                  {/* Badge — current or popular */}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded-full">
                        <Check className="w-3 h-3" /> CURRENT PLAN
                      </span>
                    </div>
                  )}
                  {!isCurrent && plan.highlight && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                      <span className="flex items-center gap-1 px-3 py-1 bg-violet-600 text-white text-[10px] font-bold rounded-full">
                        <Star className="w-3 h-3" /> MOST POPULAR
                      </span>
                    </div>
                  )}

                  <div className="mb-5">
                    <p className="text-[14px] font-bold text-gray-500 uppercase tracking-wide mb-2">{plan.name}</p>
                    <div className="flex items-baseline gap-1 mb-0.5">
                      <span className="text-[36px] font-bold text-gray-900">{isIndia ? plan.inr : plan.usd}</span>
                      <span className="text-[14px] text-gray-500">/month</span>
                    </div>
                    <p className="text-[13px] font-semibold text-violet-600">{plan.evals}</p>
                  </div>

                  <ul className="space-y-2.5 mb-6 flex-1">
                    {plan.features.map((f, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-[13px] text-gray-700">
                        <div className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 ${isCurrent ? "bg-emerald-500" : "bg-violet-600"}`}>
                          <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        </div>
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <div className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Check className="w-4 h-4" /> Active plan
                    </div>
                  ) : (
                    <button
                      onClick={() => handleUpgrade(plan.id)}
                      disabled={upgrading !== null}
                      className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold transition-all disabled:opacity-50 ${
                        plan.highlight
                          ? "bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200"
                          : "border border-gray-300 bg-white hover:bg-gray-50 text-gray-900"
                      }`}
                    >
                      {upgrading === plan.id
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : <>
                            {usage?.trial_active ? "Buy now" : "Upgrade"}
                            <ArrowRight className="w-4 h-4" />
                          </>
                      }
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <p className="text-[12px] text-gray-400 text-center mb-8">
            {isIndia ? "Powered by Razorpay · UPI, cards, net banking, wallets" : "Powered by Paddle · Cards, PayPal"}
            {" · "}7-day free trial · Cancel anytime
          </p>
        </div>
      )}

      {/* Enterprise */}
      <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <CreditCard className="w-4 h-4 text-gray-500" strokeWidth={1.8} />
            <p className="text-[14px] font-semibold text-gray-900">Enterprise</p>
          </div>
          <p className="text-[13px] text-gray-500">Unlimited evals, dedicated infra, SSO/SAML, SLA, on-call support.</p>
        </div>
        <a
          href="mailto:hello@tryrepath.com?subject=Enterprise"
          className="shrink-0 ml-4 px-4 py-2 border border-gray-300 bg-white text-gray-900 text-[13px] font-medium rounded-lg hover:bg-gray-50 transition-colors"
        >
          Contact us
        </a>
      </div>

      <div className="mt-6 pt-4 border-t border-gray-100">
        <Link href="/rollouts" className="text-[13px] text-gray-400 hover:text-gray-700 transition-colors">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
