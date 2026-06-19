"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Check, Eye, EyeOff, Loader2 } from "lucide-react";

function SignupForm() {
  const params = useSearchParams();
  const plan = params.get("plan") ?? "starter";

  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, plan }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Signup failed. Please try again.");
        return;
      }

      // Redirect to onboarding
      window.location.href = "/onboarding";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center px-4 py-16">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 mb-10">
        <Image src="/logo-icon.png" alt="Repath" width={36} height={36} className="rounded-lg" />
        <span className="text-[22px] font-bold text-white">Repath</span>
      </Link>

      <div className="w-full max-w-md">
        {/* Trial badge */}
        <div className="mb-6 p-4 rounded-xl border border-[--color-accent]/30 bg-[--color-accent]/[0.05] flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-[--color-accent] flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-white">7-day free trial — {planLabel} plan</p>
            <p className="text-[13px] text-zinc-400 mt-0.5">No credit card required. Cancel anytime.</p>
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
          <h1 className="text-[24px] font-bold text-white mb-2">Create your account</h1>
          <p className="text-[14px] text-zinc-400 mb-8">Start shipping AI safely in minutes.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-zinc-300 mb-1.5">Full name</label>
              <input
                type="text"
                required
                value={form.name}
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Abhi Sharma"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-[14px] focus:outline-none focus:border-[--color-accent]/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-zinc-300 mb-1.5">Work email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-[14px] focus:outline-none focus:border-[--color-accent]/50 transition-colors"
              />
            </div>

            <div>
              <label className="block text-[13px] font-medium text-zinc-300 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  required
                  minLength={8}
                  value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="8+ characters"
                  className="w-full px-4 py-3 pr-12 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder-zinc-600 text-[14px] focus:outline-none focus:border-[--color-accent]/50 transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(p => !p)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div className="p-3 rounded-lg bg-[--color-danger]/10 border border-[--color-danger]/20 text-[13px] text-[--color-danger]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-[--color-accent] hover:bg-[#6d28d9] disabled:opacity-50 text-white py-3.5 text-[15px] font-semibold transition-all shadow-lg shadow-[--color-accent]/25"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>Start free trial <ArrowRight className="w-5 h-5" /></>
              )}
            </button>
          </form>

          <p className="text-center text-[13px] text-zinc-500 mt-6">
            Already have an account?{" "}
            <Link href="/login" className="text-[--color-accent] hover:underline">Sign in</Link>
          </p>
        </div>

        <p className="text-center text-[12px] text-zinc-600 mt-6">
          By creating an account you agree to our{" "}
          <a href="https://github.com/repathhq/repath/blob/main/LICENSE" className="hover:text-zinc-400 underline" target="_blank" rel="noopener noreferrer">Terms</a>
          {" & "}
          <a href="#" className="hover:text-zinc-400 underline">Privacy Policy</a>.
        </p>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#09090b]" />}>
      <SignupForm />
    </Suspense>
  );
}
