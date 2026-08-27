"use client";

/**
 * Public status page.
 *
 * Reports what it actually observes. The previous version was a hardcoded list
 * that always read "All systems operational" — during a real outage it would
 * have confidently said everything was fine, which is worse than having no
 * status page at all.
 */

import Link from "next/link";
import Image from "next/image";
import { AlertTriangle, CheckCircle2, Clock, HelpCircle, Loader2, XCircle } from "lucide-react";
import { useResource } from "@/lib/hooks";

type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

interface StatusPayload {
  headline: string;
  overall: ServiceStatus;
  services: { name: string; status: ServiceStatus; detail: string }[];
  checked_at: string;
}

const LOOK: Record<
  ServiceStatus,
  { dot: string; pill: string; label: string; Icon: typeof CheckCircle2; icon: string }
> = {
  operational: {
    dot: "bg-emerald-500",
    pill: "text-emerald-600 bg-emerald-50",
    label: "Operational",
    Icon: CheckCircle2,
    icon: "text-emerald-500",
  },
  degraded: {
    dot: "bg-amber-500",
    pill: "text-amber-700 bg-amber-50",
    label: "Degraded",
    Icon: AlertTriangle,
    icon: "text-amber-500",
  },
  down: {
    dot: "bg-red-500",
    pill: "text-red-700 bg-red-50",
    label: "Down",
    Icon: XCircle,
    icon: "text-red-500",
  },
  unknown: {
    dot: "bg-gray-400",
    pill: "text-gray-600 bg-gray-100",
    label: "Unknown",
    Icon: HelpCircle,
    icon: "text-gray-400",
  },
};

export default function StatusPage() {
  const { data, loading } = useResource<StatusPayload>(() =>
    fetch("/api/status", { cache: "no-store" }).then((r) => r.json())
  );

  const overall = data?.overall ?? "unknown";
  const look = LOOK[overall];

  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/repath.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
        <Link
          href="/signup"
          className="px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          Start free trial
        </Link>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-2">
          {loading ? (
            <Loader2 className="w-4 h-4 text-gray-400 animate-spin" />
          ) : (
            <div className={`w-4 h-4 rounded-full ${look.dot} ${overall === "operational" ? "animate-pulse" : ""}`} />
          )}
          <h1 className="text-[32px] font-bold text-gray-900 tracking-tight">
            {loading ? "Checking…" : data?.headline}
          </h1>
        </div>
        <p className="text-[15px] text-gray-500 mb-12">
          {data?.checked_at
            ? `Checked ${new Date(data.checked_at).toLocaleString()}.`
            : "Checking Repath services…"}
        </p>

        <div className="rounded-2xl border border-gray-200 overflow-hidden mb-10">
          {loading || !data ? (
            <div className="px-6 py-10 text-center text-[14px] text-gray-400">Loading…</div>
          ) : (
            data.services.map((s, i) => {
              const l = LOOK[s.status];
              return (
                <div
                  key={s.name}
                  className={`flex items-center justify-between px-6 py-4 ${
                    i < data.services.length - 1 ? "border-b border-gray-100" : ""
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <l.Icon className={`w-4 h-4 ${l.icon}`} strokeWidth={2} />
                    <span className="text-[14px] font-medium text-gray-700">{s.name}</span>
                  </div>
                  <div className="flex items-center gap-6">
                    <span className="text-[12px] text-gray-400 font-mono">{s.detail}</span>
                    <span className={`text-[12px] font-semibold ${l.pill} px-2.5 py-0.5 rounded-full`}>
                      {l.label}
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> Incident history
          </h3>
          <p className="text-[14px] text-gray-500">
            Repath does not publish a historical incident log yet. This page reflects a live check
            made when you loaded it.
          </p>
        </div>
      </div>
    </div>
  );
}
