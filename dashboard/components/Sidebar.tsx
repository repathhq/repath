"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  GitBranch, CreditCard, Settings, Menu, X,
  HelpCircle, ExternalLink, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSystemHealth } from "@/lib/hooks";
import ProviderHealth from "@/components/ProviderHealth";

const nav = [
  { href: "/rollouts",  label: "Rollouts",  icon: GitBranch },
  { href: "/billing",   label: "Billing",   icon: CreditCard },
  { href: "/settings",  label: "Settings",  icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useSystemHealth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const inner = (
    <aside className="flex h-full w-[260px] flex-col bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 h-14 border-b border-gray-100 shrink-0">
        <Image src="/repath.png" alt="Repath" width={34} height={34} className="rounded-xl" />
        <span className="text-[15px] font-bold text-gray-900 tracking-tight">Repath</span>
        <span className="ml-auto text-[10px] font-semibold tracking-widest uppercase px-1.5 py-0.5 rounded bg-violet-50 text-violet-600 border border-violet-100">Beta</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-5 px-3 space-y-1 overflow-auto">
        <p className="px-3 mb-2 text-[10px] font-semibold tracking-widest uppercase text-gray-400">
          Deployments
        </p>
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 text-[14px] rounded-lg transition-all duration-150 group",
                active
                  ? "bg-violet-50 text-violet-700 font-semibold"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50 font-medium"
              )}
            >
              <Icon
                className={cn(
                  "h-[17px] w-[17px] shrink-0",
                  active ? "text-violet-600" : "text-gray-400 group-hover:text-gray-600"
                )}
                strokeWidth={active ? 2 : 1.8}
              />
              <span className="flex-1">{label}</span>
              {active && <ChevronRight className="h-3.5 w-3.5 text-violet-400" strokeWidth={2.5} />}
            </Link>
          );
        })}
      </nav>

      {/* Provider Health */}
      <ProviderHealth />

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-100 space-y-3 shrink-0">
        {/* System status */}
        <div className="flex items-center gap-2">
          <span className={cn(
            "h-[6px] w-[6px] rounded-full shrink-0",
            !health ? "bg-gray-300" :
            health.status === "ok" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
          )} />
          <span className={cn(
            "text-[11.5px]",
            !health ? "text-gray-400" :
            health.status === "ok" ? "text-emerald-600" : "text-amber-600"
          )}>
            {!health ? "Connecting…" : health.status === "ok" ? "All systems normal" : "Degraded"}
          </span>
        </div>

        {/* Docs link */}
        <a
          href="https://github.com/repathhq/repath"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-[12px] text-gray-400 hover:text-gray-600 transition-colors"
        >
          <HelpCircle className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          Docs & Support
          <ExternalLink className="h-3 w-3 ml-auto" strokeWidth={1.8} />
        </a>
      </div>
    </aside>
  );

  return (
    <>
      {/* Mobile toggle button */}
      <button
        className="md:hidden fixed top-3.5 left-4 z-50 p-2 rounded-lg bg-white border border-gray-200 shadow-sm"
        onClick={() => setMobileOpen(o => !o)}
        aria-label="Toggle menu"
      >
        {mobileOpen ? <X className="h-4 w-4 text-gray-700" /> : <Menu className="h-4 w-4 text-gray-700" />}
      </button>

      {/* Desktop sidebar */}
      <div className="hidden md:flex h-screen sticky top-0">
        {inner}
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/30 z-40"
            onClick={() => setMobileOpen(false)}
          />
          <div className="md:hidden fixed inset-y-0 left-0 z-50 flex">
            {inner}
          </div>
        </>
      )}
    </>
  );
}
