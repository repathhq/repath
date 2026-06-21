"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, ArrowRight, Sparkles, Loader2 } from "lucide-react";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

function SuccessContent() {
  const params = useSearchParams();
  const plan = params.get("plan") ?? "starter";
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);

  const [confirmedPlan, setConfirmedPlan] = useState<string | null>(null);

  // Refresh session cookie so the new plan is live immediately everywhere.
  // For Razorpay the cookie was already refreshed in verify-payment; this is
  // the safety net for Paddle (webhook-driven) and any edge cases.
  useEffect(() => {
    fetch("/api/auth/refresh-session", { method: "POST" })
      .then(r => r.json())
      .then((d: { plan?: string }) => setConfirmedPlan(d.plan ?? plan))
      .catch(() => setConfirmedPlan(plan));
  }, [plan]);

  const displayPlan = confirmedPlan ?? plan;
  const displayLabel = displayPlan.charAt(0).toUpperCase() + displayPlan.slice(1);
  const ready = confirmedPlan !== null;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        {/* Success icon */}
        <div className="mb-6 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-emerald-50 border-2 border-emerald-200 flex items-center justify-center">
            <Check className="w-7 h-7 text-emerald-600" strokeWidth={2.5} />
          </div>
        </div>

        <Image src="/repath.png" alt="Repath" width={30} height={30} className="rounded-lg mx-auto mb-5" />

        <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-8 mb-5">
          {ready ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-violet-50 border border-violet-200 mb-4">
              <Sparkles className="w-3.5 h-3.5 text-violet-600" strokeWidth={1.8} />
              <span className="text-[12px] font-semibold text-violet-700">{displayLabel} Plan Active</span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-gray-100 border border-gray-200 mb-4">
              <Loader2 className="w-3.5 h-3.5 text-gray-400 animate-spin" />
              <span className="text-[12px] font-medium text-gray-500">Activating plan…</span>
            </div>
          )}

          <h1 className="text-[24px] font-bold text-gray-900 mb-2">Payment successful!</h1>
          <p className="text-[14px] text-gray-500">
            {ready
              ? `Your ${displayLabel} plan is now active. Start shipping AI safely.`
              : "Confirming your payment and activating your plan…"}
          </p>
        </div>

        <div className="space-y-2.5">
          <Link
            href="/rollouts"
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white px-6 py-3 text-[14px] font-semibold transition-all shadow-sm"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/billing"
            className="w-full inline-flex items-center justify-center text-[13px] text-gray-500 hover:text-gray-700 transition-colors"
          >
            View billing details →
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SuccessContent />
    </Suspense>
  );
}
