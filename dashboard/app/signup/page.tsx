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
      if (!res.ok) { setError(data.error ?? "Signup failed. Please try again."); return; }
      window.location.href = "/onboarding";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Nav */}
      <nav className="bg-white border-b border-gray-100 px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-icon.png" alt="Repath" width={26} height={26} className="rounded-lg" />
          <span className="text-[15px] font-bold text-gray-900">Repath</span>
        </Link>
        <p className="text-[13px] text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-violet-600 font-semibold hover:underline">Sign in</Link>
        </p>
      </nav>

      <div className="flex-1 flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-[400px]">
          {/* Trial badge */}
          <div className="mb-6 p-3.5 rounded-xl border border-violet-200 bg-violet-50 flex items-center gap-3">
            <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center shrink-0">
              <Check className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
            </div>
            <div>
              <p className="text-[13.5px] font-semibold text-violet-900">7-day free trial — {planLabel} plan</p>
              <p className="text-[12px] text-violet-600 mt-0.5">No credit card required. Cancel anytime.</p>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-200 bg-white shadow-[0_2px_8px_rgba(0,0,0,0.06)] p-7">
            <h1 className="text-[22px] font-bold text-gray-900 mb-1">Create your account</h1>
            <p className="text-[13.5px] text-gray-500 mb-7">Start shipping AI safely in minutes.</p>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1.5">Full name</label>
                <input
                  type="text" required value={form.name}
                  onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                  placeholder="Abhi Sharma"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 text-[14px] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1.5">Work email</label>
                <input
                  type="email" required value={form.email}
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="you@company.com"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 text-[14px] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all bg-white"
                />
              </div>

              <div>
                <label className="block text-[12.5px] font-semibold text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? "text" : "password"}
                    required minLength={8} value={form.password}
                    onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                    placeholder="8+ characters"
                    className="w-full px-3.5 py-2.5 pr-11 rounded-lg border border-gray-200 text-gray-900 placeholder-gray-400 text-[14px] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all bg-white"
                  />
                  <button
                    type="button" onClick={() => setShowPw(p => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-[13px] text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white py-3 text-[14px] font-semibold transition-all shadow-sm mt-2"
              >
                {loading ? (
                  <Loader2 className="w-4.5 h-4.5 animate-spin" />
                ) : (
                  <>Start free trial <ArrowRight className="w-4 h-4" /></>
                )}
              </button>
            </form>
          </div>

          <p className="text-center text-[11.5px] text-gray-400 mt-5">
            By creating an account you agree to our{" "}
            <a href="https://github.com/repathhq/repath/blob/main/LICENSE" className="hover:text-gray-600 underline" target="_blank" rel="noopener noreferrer">Terms</a>
            {" & "}
            <a href="#" className="hover:text-gray-600 underline">Privacy Policy</a>.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <SignupForm />
    </Suspense>
  );
}
