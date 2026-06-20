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
    setLoading(true); setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) { const d = await res.json(); setError((d as {error?:string}).error ?? "Login failed"); return; }
      window.location.href = "/rollouts";
    } catch { setError("Network error. Please try again."); }
    finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-white flex flex-col" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Nav */}
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-icon.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] tracking-tight text-gray-900">Repath</span>
        </Link>
        <p className="text-[14px] text-gray-500">Don&apos;t have an account? <Link href="/signup" className="text-violet-600 font-medium hover:underline">Start free trial</Link></p>
      </nav>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-[400px]">
          <h1 className="text-[28px] font-bold text-gray-900 mb-1">Welcome back</h1>
          <p className="text-[15px] text-gray-500 mb-8">Sign in to your Repath account.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Email</label>
              <input type="email" required value={form.email}
                onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                placeholder="you@company.com"
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-gray-900 placeholder-gray-400 text-[14px] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
              />
            </div>
            <div>
              <label className="block text-[13px] font-medium text-gray-700 mb-1.5">Password</label>
              <div className="relative">
                <input type={showPw ? "text" : "password"} required value={form.password}
                  onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                  placeholder="Your password"
                  className="w-full px-4 py-3 pr-12 rounded-xl border border-gray-200 text-gray-900 placeholder-gray-400 text-[14px] focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all"
                />
                <button type="button" onClick={() => setShowPw(p => !p)} className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-[13px] text-red-700">{error}</div>}
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gray-900 hover:bg-gray-800 disabled:opacity-50 text-white py-3.5 text-[15px] font-semibold transition-all">
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Sign in <ArrowRight className="w-5 h-5" /></>}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-100 text-center">
            <p className="text-[13px] text-gray-400">© 2026 Repath · <Link href="/privacy" className="hover:text-gray-600">Privacy</Link> · <Link href="/terms" className="hover:text-gray-600">Terms</Link></p>
          </div>
        </div>
      </div>
    </div>
  );
}
