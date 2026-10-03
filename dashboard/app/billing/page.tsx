"use client";

/**
 * Billing.
 *
 * Every customer pays through Razorpay in INR — international cards included —
 * so there is one checkout. This page used to send anyone outside India to a
 * Paddle checkout that was never configured, which meant no one abroad could
 * pay at all. Plan details come from lib/plans.ts, the same catalogue the
 * pricing page and the checkout route read.
 */

import { useState, useEffect } from "react";
import DashShell from "@/components/DashShell";
import Link from "next/link";
import { ArrowRight, Check, Loader2, AlertTriangle, BarChart3, Zap, CreditCard, Star, Receipt, ExternalLink } from "lucide-react";
import { PLANS, type PlanId } from "@/lib/plans";
import type { BillingDetails } from "@/lib/billing";

interface Usage {
  plan: string;
  eval_quota_monthly: number;
  evals_used: number;
  evals_remaining: number;
  usage_percent: number;
  trial_active: boolean;
  trial_ends_at: string | null;
  active: boolean;
  subscription_id?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
}

declare global {
  interface Window {
    Razorpay: new (opts: object) => { open(): void };
  }
}

const FONT = { fontFamily: "'Inter', system-ui, sans-serif" };
const PLAN_ORDER: PlanId[] = ["indie", "starter", "pro"];
const RANK: Record<string, number> = { trial: 0, free: 0, indie: 1, starter: 2, pro: 3, enterprise: 4 };

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const money = (minor: number, currency: string) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);

/** Loads Razorpay's checkout script once; false if it cannot (offline, blocked). */
async function loadCheckout(): Promise<boolean> {
  if (window.Razorpay) return true;
  await new Promise<void>((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => resolve();
    document.head.appendChild(s);
  });
  return Boolean(window.Razorpay);
}

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  issued: { label: "Due", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  partially_paid: { label: "Part paid", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  cancelled: { label: "Cancelled", cls: "bg-gray-50 text-gray-500 border-gray-200" },
  expired: { label: "Expired", cls: "bg-gray-50 text-gray-500 border-gray-200" },
};

export default function BillingPage() {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showCoupon, setShowCoupon] = useState(false);
  const [coupon, setCoupon] = useState("");
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [changingCard, setChangingCard] = useState(false);

  const loadDetails = () =>
    fetch("/api/billing/razorpay/details")
      .then((r) => (r.ok ? (r.json() as Promise<BillingDetails>) : null))
      .then((d) => setDetails(d))
      .catch(() => {});

  const load = () =>
    fetch("/api/billing/usage")
      .then((r) => {
        if (r.status === 401) {
          window.location.assign("/login");
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => {
        if (d) {
          setUsage(d);
          setNow(Date.now());
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => {
    load();
    loadDetails();
  }, []);

  const daysLeft =
    usage?.trial_ends_at && now !== null
      ? Math.max(0, Math.ceil((new Date(usage.trial_ends_at).getTime() - now) / 86400000))
      : null;

  const hasSubscription = Boolean(usage?.subscription_id) && (RANK[usage?.plan ?? ""] ?? 0) > 0;

  const handleRazorpay = async (plan: PlanId) => {
    const res = await fetch("/api/billing/razorpay/create-subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan, ...(couponApplied && coupon && { coupon: coupon.trim() }) }),
    });
    if (!res.ok) {
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      const msg = errData.error ?? "Could not start checkout. Try again.";
      if (msg.toLowerCase().includes("coupon")) {
        setCouponError(msg);
        setCouponApplied(false);
      } else {
        setError(msg);
      }
      setUpgrading(null);
      return;
    }
    const order = (await res.json()) as {
      subscriptionId: string;
      keyId: string;
      email: string;
      name: string;
      plan: string;
      planName: string;
    };
    if (!(await loadCheckout())) {
      setError("Could not load Razorpay checkout. Check your connection or ad blocker and try again.");
      setUpgrading(null);
      return;
    }
    new window.Razorpay({
      key: order.keyId,
      name: "Repath",
      description: `${order.planName} plan — billed monthly`,
      // subscription_id, not order_id: this authorises a recurring mandate.
      subscription_id: order.subscriptionId,
      prefill: { email: order.email, name: order.name },
      theme: { color: "#7c3aed" },
      modal: { ondismiss: () => setUpgrading(null) },
      handler: async (response: {
        razorpay_payment_id: string;
        razorpay_subscription_id: string;
        razorpay_signature: string;
      }) => {
        setVerifying(true);
        // The server re-reads the plan from Razorpay rather than trusting
        // anything sent from here, so no plan or tenant is posted back.
        const verify = await fetch("/api/billing/razorpay/verify-subscription", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_subscription_id: response.razorpay_subscription_id,
            razorpay_signature: response.razorpay_signature,
          }),
        });
        if (verify.ok) {
          window.location.assign(`/billing/success?plan=${order.plan}`);
        } else {
          setVerifying(false);
          const errData = (await verify.json().catch(() => ({}))) as { error?: string };
          setError(
            errData.error ??
              `Payment received but activation failed. Email hello@tryrepath.com with payment ID ${response.razorpay_payment_id}.`
          );
          setUpgrading(null);
        }
      },
    }).open();
  };

  // Razorpay's own card-change checkout for an existing mandate. The new card
  // is authorised by Razorpay; nothing on our side changes, so on success
  // the page just re-reads the method on file.
  const handleChangeCard = async () => {
    if (!details?.key_id || !details.subscription) return;
    setChangingCard(true);
    setError("");
    setSuccess("");
    if (!(await loadCheckout())) {
      setError("Could not load Razorpay checkout. Check your connection or ad blocker and try again.");
      setChangingCard(false);
      return;
    }
    new window.Razorpay({
      key: details.key_id,
      name: "Repath",
      description: "Update the card for your subscription",
      subscription_id: details.subscription.id,
      subscription_card_change: 1,
      theme: { color: "#7c3aed" },
      modal: { ondismiss: () => setChangingCard(false) },
      handler: () => {
        setChangingCard(false);
        setSuccess("Card updated. Future charges go to the new card.");
        loadDetails();
        load();
      },
    }).open();
  };

  const handleUpgrade = async (planId: PlanId) => {
    setUpgrading(planId);
    setError("");
    setSuccess("");
    await handleRazorpay(planId);
  };

  const handleCancel = async () => {
    setCancelling(true);
    setError("");
    const res = await fetch("/api/billing/razorpay/cancel-subscription", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setCancelling(false);
    setConfirmCancel(false);
    if (!res.ok) {
      setError(data.error ?? "Could not cancel. Email hello@tryrepath.com and we will do it for you.");
      return;
    }
    setSuccess("Subscription cancelled. You will not be charged again.");
    load();
  };

  if (loading) {
    return (
      <DashShell title="Billing">
        <div className="flex items-center justify-center h-64" style={FONT}>
          <Loader2 className="w-6 h-6 text-violet-600 animate-spin" />
        </div>
      </DashShell>
    );
  }

  if (verifying) {
    return (
      <DashShell title="Billing">
        <div className="flex flex-col items-center justify-center h-80 gap-4" style={FONT}>
          <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
          <div className="text-center">
            <p className="text-[16px] font-semibold text-gray-900">Verifying payment…</p>
            <p className="text-[13px] text-gray-500 mt-1">Activating your plan. This takes a few seconds.</p>
          </div>
        </div>
      </DashShell>
    );
  }

  const usedPct = Math.min(usage?.usage_percent ?? 0, 100);
  const userRank = RANK[usage?.plan ?? ""] ?? 0;
  const currentPlanName = usage ? (PLANS[usage.plan as PlanId]?.name ?? usage.plan.charAt(0).toUpperCase() + usage.plan.slice(1)) : "";

  return (
    <DashShell title="Billing">
      <div className="p-6 sm:p-8 max-w-[900px] mx-auto" style={FONT}>
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

        {/* Current plan */}
        {usage && (
          <div className="rounded-2xl border border-gray-200 bg-white p-6 mb-6 shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Current plan</p>
                <div className="flex items-center gap-2.5 flex-wrap">
                  <span className="text-[20px] font-bold text-gray-900">{currentPlanName}</span>
                  {usage.trial_active && daysLeft !== null && (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-100 text-[11px] font-semibold text-violet-700">
                      <Zap className="w-3 h-3" />
                      {daysLeft} day{daysLeft !== 1 ? "s" : ""} left in trial
                    </span>
                  )}
                </div>
                {hasSubscription && usage.current_period_end && (
                  <p className="text-[13px] text-gray-500 mt-1.5">
                    {usage.cancel_at_period_end
                      ? `Cancelled — stays active until ${formatDate(usage.current_period_end)}. You will not be charged again.`
                      : `Renews on ${formatDate(usage.current_period_end)}.`}
                  </p>
                )}
                {userRank > 0 && !usage.subscription_id && usage.plan !== "enterprise" && (
                  <p className="text-[13px] text-gray-500 mt-1.5">
                    Complimentary plan — there is no payment method on file and nothing will be charged.
                  </p>
                )}
                {!usage.trial_active && userRank === 0 && (
                  <p className="text-[13px] text-gray-500 mt-1.5">
                    Your requests still pass through Repath. Choose a plan to route rollouts and judge responses again.
                  </p>
                )}
              </div>
              {userRank < 3 ? (
                <Link href="#upgrade" className="shrink-0 px-3.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-[13px] font-semibold rounded-lg transition-colors">
                  {userRank === 0 ? "Choose a plan" : "Upgrade"}
                </Link>
              ) : (
                <span className="shrink-0 px-3 py-1.5 bg-emerald-50 text-emerald-700 text-[12px] font-semibold rounded-lg border border-emerald-100">
                  Active
                </span>
              )}
            </div>

            {(usage.eval_quota_monthly ?? 0) > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[13px] text-gray-600 flex items-center gap-1.5">
                    <BarChart3 className="w-4 h-4 text-gray-400" />
                    Judged evaluations this month
                  </span>
                  <span className="text-[13px] font-semibold text-gray-900 font-mono">
                    {(usage.evals_used ?? 0).toLocaleString()} / {(usage.eval_quota_monthly ?? 0).toLocaleString()}
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${usedPct > 90 ? "bg-red-500" : usedPct > 70 ? "bg-amber-500" : "bg-violet-500"}`}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="text-[12px] text-gray-400 mt-1.5">
                  {(usage.evals_remaining ?? 0).toLocaleString()} remaining. Past the limit, requests keep flowing; only judging pauses.
                </p>
              </div>
            )}

            {hasSubscription && !usage.cancel_at_period_end && (
              <div className="mt-5 pt-4 border-t border-gray-100">
                {confirmCancel ? (
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <p className="text-[13px] text-gray-700 flex-1">
                      Cancel your {currentPlanName} plan? It stays active
                      {usage.current_period_end ? ` until ${formatDate(usage.current_period_end)}` : " until the end of this billing period"}, and you
                      will not be charged again.
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setConfirmCancel(false)}
                        disabled={cancelling}
                        className="px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                      >
                        Keep plan
                      </button>
                      <button
                        onClick={handleCancel}
                        disabled={cancelling}
                        className="flex items-center gap-2 px-3.5 py-2 rounded-lg bg-red-600 text-white text-[13px] font-semibold hover:bg-red-700 disabled:opacity-50"
                      >
                        {cancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Cancel subscription
                      </button>
                    </div>
                  </div>
                ) : (
                  <button onClick={() => setConfirmCancel(true)} className="text-[13px] text-gray-500 hover:text-red-600 transition-colors">
                    Cancel subscription
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* A renewal that failed: Razorpay retries, and the customer should know */}
        {details?.subscription && ["pending", "halted"].includes(details.subscription.status) && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 mb-6">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-[14px] text-amber-800 flex-1">
              {details.subscription.status === "halted"
                ? "Your last payments failed and Razorpay has stopped retrying. Update your card to keep your plan."
                : "Your last payment failed. Razorpay will retry it; updating your card now avoids losing your plan."}
            </p>
            {details.payment_method?.changeable && (
              <button onClick={handleChangeCard} className="shrink-0 px-3.5 py-2 rounded-lg bg-amber-600 text-white text-[13px] font-semibold hover:bg-amber-700">
                Update card
              </button>
            )}
          </div>
        )}

        {/* Payment method and invoices */}
        {hasSubscription && details?.subscription && (
          <div className="grid md:grid-cols-[1fr_1.6fr] gap-4 mb-6">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm flex flex-col">
              <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Payment method</p>
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-7 rounded-md border border-gray-200 bg-gray-50 flex items-center justify-center shrink-0">
                  <CreditCard className="w-4 h-4 text-gray-500" strokeWidth={1.8} />
                </div>
                <span className="text-[14px] font-medium text-gray-900">
                  {details.payment_method?.label ?? "On file with Razorpay"}
                </span>
              </div>
              {!usage?.cancel_at_period_end && details.subscription.charge_at && (
                <p className="text-[13px] text-gray-500">
                  Next charge{" "}
                  <span className="text-gray-900 font-medium">
                    {money(details.invoices[0]?.amount_minor ?? PLANS[usage?.plan as PlanId]?.amountMinor ?? 0, details.invoices[0]?.currency ?? "INR")}
                  </span>{" "}
                  on {formatDate(details.subscription.charge_at)}.
                </p>
              )}
              <div className="mt-auto pt-4">
                {details.payment_method?.changeable ? (
                  <button
                    onClick={handleChangeCard}
                    disabled={changingCard}
                    className="flex items-center gap-2 px-3.5 py-2 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-50"
                  >
                    {changingCard && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Change card
                  </button>
                ) : details.payment_method ? (
                  <p className="text-[12px] text-gray-400">
                    Razorpay only lets card mandates switch in place. To pay another way, cancel and subscribe again once
                    this period ends.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <div className="flex items-center gap-2 px-6 pt-5 pb-3">
                <Receipt className="w-4 h-4 text-gray-400" strokeWidth={1.8} />
                <p className="text-[12px] font-semibold text-gray-400 uppercase tracking-wider">Invoices</p>
              </div>
              {details.invoices.length === 0 ? (
                <p className="px-6 pb-6 text-[13px] text-gray-500">Your first invoice appears here once it is charged.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <tbody>
                      {details.invoices.map((inv) => {
                        const st = INVOICE_STATUS[inv.status] ?? { label: inv.status, cls: "bg-gray-50 text-gray-500 border-gray-200" };
                        return (
                          <tr key={inv.id} className="border-t border-gray-100">
                            <td className="pl-6 py-3">
                              <div className="text-gray-900 whitespace-nowrap">{inv.date ? shortDate(inv.date) : "—"}</div>
                              {inv.period_start && inv.period_end && (
                                <div className="text-[12px] text-gray-400">
                                  {shortDate(inv.period_start)} – {shortDate(inv.period_end)}
                                </div>
                              )}
                            </td>
                            <td className="py-3 px-3 text-gray-900 font-mono whitespace-nowrap text-right">{money(inv.amount_minor, inv.currency)}</td>
                            <td className="py-3 px-3 whitespace-nowrap">
                              <span className={`px-2 py-0.5 rounded-md border text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                            </td>
                            <td className="py-3 pr-6 text-right whitespace-nowrap">
                              {inv.receipt_url && (
                                <a href={inv.receipt_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-violet-600 hover:underline">
                                  {inv.status === "paid" ? "Receipt" : "Pay"} <ExternalLink className="w-3 h-3" />
                                </a>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Plans */}
        {(!usage || usage.plan !== "enterprise") && (
          <div id="upgrade">
            <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
              <h2 className="text-[16px] font-semibold text-gray-900">{userRank >= 3 ? "Your plan" : "Choose a plan"}</h2>
              <p className="text-[12px] text-gray-500">Billed monthly in INR via Razorpay · UPI, net banking, Indian and international cards</p>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-4">
              {PLAN_ORDER.map((id) => {
                const plan = PLANS[id];
                const isCurrent = usage?.plan === id;
                const featured = id === "pro";
                const isDowngrade = RANK[id] < userRank;
                return (
                  <div
                    key={id}
                    className={`relative rounded-2xl border p-6 flex flex-col bg-white ${
                      isCurrent ? "border-emerald-300 shadow-sm" : featured ? "border-violet-300 shadow-md shadow-violet-100" : "border-gray-200"
                    }`}
                  >
                    {isCurrent && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="flex items-center gap-1 px-3 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded-full whitespace-nowrap">
                          <Check className="w-3 h-3" /> CURRENT PLAN
                        </span>
                      </div>
                    )}
                    {!isCurrent && featured && (
                      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                        <span className="flex items-center gap-1 px-3 py-1 bg-violet-600 text-white text-[10px] font-bold rounded-full whitespace-nowrap">
                          <Star className="w-3 h-3" /> MOST TEAMS
                        </span>
                      </div>
                    )}

                    <div className="mb-5">
                      <p className="text-[14px] font-bold text-gray-500 uppercase tracking-wide mb-2">{plan.name}</p>
                      <div className="flex items-baseline gap-2 mb-0.5">
                        {couponApplied && !isCurrent ? (
                          <>
                            <span className="text-[32px] font-bold text-emerald-600">₹1</span>
                            <span className="text-[16px] text-gray-400 line-through">{plan.inr}</span>
                          </>
                        ) : (
                          <span className="text-[32px] font-bold text-gray-900">{plan.inr}</span>
                        )}
                        <span className="text-[14px] text-gray-500">/month</span>
                      </div>
                      <p className="text-[12px] text-gray-400 mb-1.5">about {plan.usd} USD</p>
                      <p className="text-[13px] font-semibold text-violet-600">{plan.evaluations.toLocaleString("en-US")} judged evaluations / month</p>
                    </div>

                    <ul className="space-y-2.5 mb-6 flex-1">
                      {["Every feature", ...plan.facts].map((f) => (
                        <li key={f} className="flex items-center gap-2.5 text-[13px] text-gray-700">
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
                    ) : isDowngrade ? (
                      <div className="w-full flex items-center justify-center py-3 rounded-xl text-[13px] font-medium bg-gray-50 text-gray-400 border border-gray-200 text-center px-3">
                        {!hasSubscription
                          ? "Included in your plan"
                          : usage?.cancel_at_period_end
                            ? "Available once your current plan ends"
                            : "To move down a plan, cancel first"}
                      </div>
                    ) : (
                      <button
                        onClick={() => handleUpgrade(id)}
                        disabled={upgrading !== null}
                        className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[14px] font-semibold transition-all disabled:opacity-50 ${
                          featured ? "bg-violet-600 hover:bg-violet-700 text-white shadow-md shadow-violet-200" : "border border-gray-300 bg-white hover:bg-gray-50 text-gray-900"
                        }`}
                      >
                        {upgrading === id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <>
                            {userRank === 0 ? `Choose ${plan.name}` : `Upgrade to ${plan.name}`}
                            <ArrowRight className="w-4 h-4" />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex flex-col items-center gap-2 mb-8">
              <p className="text-[12px] text-gray-400 text-center">
                {hasSubscription
                  ? "Upgrading starts the new plan today and ends your current subscription, so you are never billed for two."
                  : "Cancel any time from this page; your plan runs to the end of the period you paid for."}
              </p>
              {showCoupon ? (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <input
                    type="text"
                    value={coupon}
                    onChange={(e) => {
                      setCoupon(e.target.value);
                      setCouponApplied(false);
                      setCouponError("");
                    }}
                    placeholder="Coupon code"
                    aria-label="Coupon code"
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white w-40"
                  />
                  <button
                    onClick={() => coupon.trim() && setCouponApplied(true)}
                    disabled={!coupon.trim() || couponApplied}
                    className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-[13px] font-medium text-gray-900 hover:bg-gray-50 disabled:opacity-40"
                  >
                    Apply
                  </button>
                  {couponApplied && (
                    <span className="flex items-center gap-1 text-[12px] text-emerald-600 font-semibold">
                      <Check className="w-3.5 h-3.5" /> Applied at checkout
                    </span>
                  )}
                  {couponError && <span className="text-[12px] text-red-600">{couponError}</span>}
                </div>
              ) : (
                <button onClick={() => setShowCoupon(true)} className="text-[12px] text-gray-400 hover:text-gray-700 underline underline-offset-2">
                  Have a coupon?
                </button>
              )}
            </div>
          </div>
        )}

        {/* Enterprise */}
        <div className="rounded-2xl border border-gray-200 bg-gray-50 p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-gray-500" strokeWidth={1.8} />
              <p className="text-[14px] font-semibold text-gray-900">Enterprise</p>
            </div>
            <p className="text-[13px] text-gray-500">Higher volumes, invoicing, or running Repath inside your own network.</p>
          </div>
          <a
            href="mailto:hello@tryrepath.com?subject=Enterprise"
            className="shrink-0 px-4 py-2 border border-gray-300 bg-white text-gray-900 text-[13px] font-medium rounded-lg hover:bg-gray-50 transition-colors"
          >
            Contact us
          </a>
        </div>
      </div>
    </DashShell>
  );
}
