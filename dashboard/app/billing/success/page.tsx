"use client";

import Link from "next/link";
import Image from "next/image";
import { Check, ArrowRight } from "lucide-react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function SuccessContent() {
  const params = useSearchParams();
  const plan = params.get("plan") ?? "pro";
  const label = plan.charAt(0).toUpperCase() + plan.slice(1);

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <div className="w-16 h-16 rounded-full bg-[--color-success]/20 border border-[--color-success]/30 flex items-center justify-center">
            <Check className="w-8 h-8 text-[--color-success]" />
          </div>
        </div>

        <Image src="/logo-icon.png" alt="Repath" width={32} height={32} className="rounded-lg mx-auto mb-4" />
        <h1 className="text-[28px] font-bold text-white mb-3">
          You&apos;re on {label}!
        </h1>
        <p className="text-[15px] text-zinc-400 mb-8">
          Your payment was successful. Your plan is now active.
        </p>

        <div className="space-y-3">
          <Link
            href="/rollouts"
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[--color-accent] hover:bg-[#6d28d9] text-white px-6 py-3.5 text-[15px] font-semibold transition-all"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
          <Link
            href="/billing"
            className="w-full inline-flex items-center justify-center text-[14px] text-zinc-400 hover:text-white transition-colors"
          >
            View billing details
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function BillingSuccessPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b]" />}>
      <SuccessContent />
    </Suspense>
  );
}
