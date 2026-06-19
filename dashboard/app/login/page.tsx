"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const d = await res.json();
        setError((d as { error?: string }).error ?? "Login failed");
        return;
      }
      window.location.href = "/rollouts";
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#09090b] flex flex-col items-center justify-center px-4 py-16">
      <Link href="/" className="flex items-center gap-3 mb-10">
        <Image src="/logo-icon.png" alt="Repath" width={36} height={36} className="rounded-lg" />
        <span className="text-[22px] font-bold text-white">Repath</span>
      </Link>

      <div className="w-full max-w-md rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8">
        <h1 className="text-[24px] font-bold text-white mb-2">Sign in</h1>
        <p className="text-[14px] text-zinc-400 mb-8">Welcome back.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[13px] font-medium text-zinc-300 mb-1.5">Email</label>
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
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                placeholder="Your password"
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
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[--color-accent] hover:bg-[#6d28d9] disabled:opacity-50 text-white py-3.5 text-[15px] font-semibold transition-all"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign in <ArrowRight className="w-5 h-5" /></>}
          </button>
        </form>

        <p className="text-center text-[13px] text-zinc-500 mt-6">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[--color-accent] hover:underline">Start free trial</Link>
        </p>
      </div>
    </div>
  );
}
