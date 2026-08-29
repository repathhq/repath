"use client";

/**
 * Request a password reset link.
 *
 * The confirmation is deliberately identical whether or not the address has an
 * account, matching the API. Saying "no account with that email" here would
 * hand anyone a way to test which addresses are customers.
 */

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, MailCheck } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      setSent(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen bg-white flex flex-col"
      style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
    >
      <nav className="px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5 w-fit">
          <Image src="/repath.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
      </nav>

      <div className="flex-1 flex items-center justify-center px-6 pb-24">
        <div className="w-full max-w-[380px]">
          {sent ? (
            <div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 mb-4">
                <MailCheck className="h-5 w-5 text-emerald-600" strokeWidth={1.8} />
              </div>
              <h1 className="text-[24px] font-bold text-gray-900 tracking-tight mb-2">
                Check your email
              </h1>
              <p className="text-[14px] leading-relaxed text-gray-600 mb-6">
                If <span className="font-medium text-gray-900">{email}</span> has an account,
                a link to set a new password is on its way. It expires in 30 minutes and can be
                used once.
              </p>
              <p className="text-[13px] text-gray-500 mb-6">
                Nothing arrived? Check spam, then{" "}
                <button
                  onClick={() => setSent(false)}
                  className="text-violet-600 hover:underline"
                >
                  try a different address
                </button>
                .
              </p>
              <Link
                href="/login"
                className="inline-flex items-center gap-1.5 text-[13.5px] text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="h-3.5 w-3.5" strokeWidth={2} />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-[26px] font-bold text-gray-900 tracking-tight mb-2">
                Reset your password
              </h1>
              <p className="text-[14px] text-gray-600 mb-7">
                Enter the email you signed up with and we&rsquo;ll send you a link to set a new one.
              </p>

              {error && (
                <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
                    Work email
                  </label>
                  <input
                    type="email"
                    required
                    autoFocus
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@company.com"
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <>
                      Send reset link
                      <ArrowRight className="h-4 w-4" strokeWidth={2} />
                    </>
                  )}
                </button>
              </form>

              <p className="mt-6 text-[13.5px] text-gray-600">
                Remembered it?{" "}
                <Link href="/login" className="text-violet-600 hover:underline">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
