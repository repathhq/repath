"use client";

/**
 * Set a new password from an emailed reset link.
 *
 * The token arrives as a query parameter, so this component is wrapped in
 * Suspense — useSearchParams opts the route into client rendering, and Next
 * requires the boundary rather than inferring one.
 */

import Link from "next/link";
import Image from "next/image";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";

function ResetForm() {
  const token = useSearchParams().get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  // Derived during render rather than mirrored into state, so it can never
  // disagree with the fields it describes.
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && password !== confirm;
  const canSubmit = password.length >= 8 && password === confirm && !loading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not reset your password.");
        return;
      }
      setDone(true);
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div>
        <h1 className="text-[24px] font-bold text-gray-900 tracking-tight mb-2">
          This link is incomplete
        </h1>
        <p className="text-[14px] leading-relaxed text-gray-600 mb-6">
          It is missing its reset token, which usually means the email client
          shortened the URL. Request a new link and open it directly.
        </p>
        <Link
          href="/forgot-password"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800"
        >
          Request a new link
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div>
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50 mb-4">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={1.8} />
        </div>
        <h1 className="text-[24px] font-bold text-gray-900 tracking-tight mb-2">
          Password updated
        </h1>
        <p className="text-[14px] leading-relaxed text-gray-600 mb-6">
          You can sign in with your new password now. The reset link has been used
          and will not work again.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800"
        >
          Sign in
          <ArrowRight className="h-4 w-4" strokeWidth={2} />
        </Link>
      </div>
    );
  }

  return (
    <>
      <h1 className="text-[26px] font-bold text-gray-900 tracking-tight mb-2">
        Choose a new password
      </h1>
      <p className="text-[14px] text-gray-600 mb-7">
        At least 8 characters. Everything signed in elsewhere stays signed in.
      </p>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
            New password
          </label>
          <div className="relative">
            <input
              type={showPw ? "text" : "password"}
              required
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full px-3 py-2.5 pr-10 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide password" : "Show password"}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPw ? (
                <EyeOff className="h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Eye className="h-4 w-4" strokeWidth={1.8} />
              )}
            </button>
          </div>
          {tooShort && (
            <p className="mt-1.5 text-[12.5px] text-amber-700">
              That is {password.length} characters — 8 is the minimum.
            </p>
          )}
        </div>

        <div>
          <label className="block text-[13px] font-medium text-gray-700 mb-1.5">
            Confirm password
          </label>
          <input
            type={showPw ? "text" : "password"}
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Type it again"
            className="w-full px-3 py-2.5 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          {mismatch && (
            <p className="mt-1.5 text-[12.5px] text-amber-700">
              These two do not match yet.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            "Update password"
          )}
        </button>
      </form>
    </>
  );
}

export default function ResetPasswordPage() {
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
          <Suspense
            fallback={<div className="h-56 animate-pulse rounded-xl bg-gray-50" />}
          >
            <ResetForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
