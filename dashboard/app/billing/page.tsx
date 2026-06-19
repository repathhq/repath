"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Check, Loader2, AlertTriangle, BarChart3, Zap } from "lucide-react";

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

export default function BillingPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Detect if Indian payment is preferred (simple geo heuristic via timezone)
  const isIndia = Intl.DateTimeFormat().resolvedOptions().timeZone?.includes("Calcutta") ||
    Intl.DateTimeFormat().resolvedOptions().timeZone?.includes("Kolkata");

  useEffect(() => {
    fetch("/api/billing/usage")
      .then(r => r.json())
      .then(d => { setUsage(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const daysLeft = usage?.trial_ends_at
    ? Math.max(0, Math.ceil((new Date(usage.trial_ends_at).getTime() - Date.now()) / 86400000))
    : null;

  const handleUpgrade = async (plan: string) => {
    setUpgrading(plan);
    setError("");

    if (isIndia) {
      await handleRazorpay(plan);
    } else {
      await handlePaddle(plan);
    }
    setUpgrading(null);
  };

  const handleRazorpay = async (plan: string) => {
    const res = await fetch("/api/billing/razorpay/create-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });

    if (!res.ok) {
      setError("Failed to create payment order. Try again.");
      return;
    }

    const order = await res.json() as {
      orderId: string; amount: number; currency: string;
      keyId: string; tenantId: string; email: string; name: string; plan: string;
    };

    // Load Razorpay SDK dynamically
    if (!window.Razorpay) {
      await new Promise<void>((resolve) => {
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.onload = () => resolve();
        document.head.appendChild(s);
      });
    }

    const rzp = new window.Razorpay({
      key: order.keyId,
      amount: order.amount,
      currency: order.currency,
      name: "Repath",
      description: `${order.plan.charAt(0).toUpperCase() + order.plan.slice(1)} Plan`,
      order_id: order.orderId,
      prefill: { email: order.email, name: order.name },
      theme: { color: "#7c3aed" },
      handler: () => {
        setSuccess(`Payment successful! Your ${order.plan} plan is now active.`);
        setTimeout(() => window.location.reload(), 2000);
      },
    });
    rzp.open();
  };

  const handlePaddle = async (plan: string) => {
    const res = await fetch("/api/billing/paddle/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });

    if (!res.ok) {
      setError("Failed to create checkout. Try again.");
      return;
    }

    const { checkoutUrl } = await res.json() as { checkoutUrl: string };
    if (checkoutUrl) {
      window.location.href = checkoutUrl;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-6 h-6 text-[--color-accent] animate-spin" />
      </div>
    );
  }

  const plans = [
    {
      name: "starter",
      label: "Starter",
      price: isIndia ? "₹4,099/mo" : "$49/mo",
      evals: "10,000 evals/mo",
      features: ["3 rollouts", "All providers", "7-day retention", "Email alerts"],
    },
    {
      name: "pro",
      label: "Pro",
      price: isIndia ? "₹12,499/mo" : "$149/mo",
      evals: "100,000 evals/mo",
      features: ["Unlimited rollouts", "All providers", "90-day retention", "Slack + webhooks", "Priority support"],
      highlight: true,
    },
  ];

  return (
    <div className="p-6 max-w-[900px] mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Image src="/logo-icon.png" alt="Repath" width={28} height={28} className="rounded-lg" />
        <div>
          <h1 className="text-[22px] font-bold text-white">Billing</h1>
          <p className="text-[13px] text-zinc-400">Usage, plan, and payment</p>
        </div>
      </div>

      {/* Alerts */}
      {success && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-[--color-success]/30 bg-[--color-success]/[0.06]">
          <Check className="w-4 h-4 text-[--color-success]" />
          <p className="text-[14px] text-[--color-success]">{success}</p>
        </div>
      )}
      {error && (
        <div className="flex items-center gap-3 p-4 rounded-xl border border-[--color-danger]/30 bg-[--color-danger]/[0.06]">
          <AlertTriangle className="w-4 h-4 text-[--color-danger]" />
          <p className="text-[14px] text-[--color-danger]">{error}</p>
        </div>
      )}

      {/* Current plan + trial */}
      {usage && (
        <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-6">
          <h2 className="text-[15px] font-semibold text-white mb-4">Current Plan</h2>
          <div className="flex flex-wrap items-center gap-4 mb-6">
            <span className="px-3 py-1.5 rounded-full bg-[--color-accent]/20 text-[--color-accent] text-[13px] font-bold uppercase tracking-wide">
              {usage.plan}
            </span>
            {usage.trial_active && daysLeft !== null && (
              <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[--color-candidate]/10 border border-[--color-candidate]/20 text-[--color-candidate] text-[12px] font-medium">
                <Zap className="w-3 h-3" />
                Trial — {daysLeft} day{daysLeft !== 1 ? "s" : ""} left
              </span>
            )}
          </div>

          {/* Usage bar */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[13px]">
              <span className="text-zinc-400 flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4" />
                LLM evaluations this month
              </span>
              <span className="text-white font-medium">
                {usage.evals_used.toLocaleString()} / {usage.eval_quota_monthly.toLocaleString()}
              </span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usage.usage_percent > 90 ? "bg-[--color-danger]" :
                  usage.usage_percent > 70 ? "bg-[--color-candidate]" :
                  "bg-[--color-accent]"
                }`}
                style={{ width: `${Math.min(usage.usage_percent, 100)}%` }}
              />
            </div>
            <p className="text-[12px] text-zinc-500">
              {usage.evals_remaining.toLocaleString()} evaluations remaining this month
            </p>
          </div>
        </div>
      )}

      {/* Upgrade plans */}
      {usage?.plan !== "pro" && usage?.plan !== "enterprise" && (
        <div>
          <h2 className="text-[15px] font-semibold text-white mb-4">
            {isIndia ? "Upgrade — UPI, cards, net banking accepted" : "Upgrade — Cards & PayPal accepted"}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {plans.filter(p => p.name !== usage?.plan).map((plan) => (
              <div
                key={plan.name}
                className={`rounded-xl border p-6 flex flex-col ${
                  plan.highlight
                    ? "border-[--color-accent]/40 bg-[--color-accent]/[0.03]"
                    : "border-white/[0.08] bg-white/[0.02]"
                }`}
              >
                {plan.highlight && (
                  <span className="mb-3 self-start px-2.5 py-1 rounded-full bg-[--color-accent] text-white text-[10px] font-bold">
                    RECOMMENDED
                  </span>
                )}
                <div className="mb-4">
                  <p className="text-[18px] font-bold text-white">{plan.label}</p>
                  <p className="text-[24px] font-bold text-white mt-1">{plan.price}</p>
                  <p className="text-[13px] text-zinc-400 mt-0.5">{plan.evals}</p>
                </div>
                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-center gap-2 text-[13px] text-zinc-300">
                      <Check className="w-3.5 h-3.5 text-[--color-success] shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => handleUpgrade(plan.name)}
                  disabled={upgrading !== null}
                  className={`w-full flex items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-semibold transition-all disabled:opacity-50 ${
                    plan.highlight
                      ? "bg-[--color-accent] hover:bg-[#6d28d9] text-white shadow-lg shadow-[--color-accent]/20"
                      : "bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-white"
                  }`}
                >
                  {upgrading === plan.name ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <>Upgrade to {plan.label} <ArrowRight className="w-4 h-4" /></>
                  )}
                </button>
              </div>
            ))}
          </div>
          <p className="text-[12px] text-zinc-600 mt-3 text-center">
            {isIndia ? "Powered by Razorpay · UPI, cards, net banking, wallets" : "Powered by Paddle · Cards, PayPal"}
          </p>
        </div>
      )}

      {/* Enterprise CTA */}
      <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-6 text-center">
        <p className="text-[15px] font-semibold text-white mb-1">Need more?</p>
        <p className="text-[14px] text-zinc-400 mb-4">
          Enterprise plan includes unlimited evaluations, dedicated infra, SSO, and SLA.
        </p>
        <a
          href="mailto:hello@tryrepath.com?subject=Enterprise"
          className="inline-flex items-center gap-2 text-[14px] text-[--color-accent] hover:underline"
        >
          Contact us for Enterprise <ArrowRight className="w-4 h-4" />
        </a>
      </div>

      <div className="border-t border-white/[0.06] pt-4">
        <Link href="/rollouts" className="text-[13px] text-zinc-500 hover:text-white transition-colors">
          ← Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
