"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { GitBranch, CreditCard, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSystemHealth } from "@/lib/hooks";
import ProviderHealth from "@/components/ProviderHealth";

const nav = [
  { href: "/rollouts",  label: "Rollouts", icon: GitBranch },
  { href: "/billing",   label: "Billing",  icon: CreditCard },
  { href: "/settings",  label: "Settings", icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useSystemHealth();

  return (
    <aside className="flex h-screen w-[220px] flex-col bg-white border-r border-gray-200">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-4 border-b border-gray-100">
        <Image src="/logo-icon.png" alt="Repath" width={24} height={24} className="rounded-lg" />
        <span className="text-[15px] font-semibold text-gray-900 tracking-tight">Repath</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 px-2 overflow-auto">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 text-[14px] rounded-lg transition-all duration-150 mb-0.5",
                active
                  ? "bg-violet-50 text-violet-700 font-medium"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              )}
            >
              <Icon className={cn("h-[17px] w-[17px]", active ? "text-violet-600" : "text-gray-400")} strokeWidth={1.8} />
              <span className="flex-1">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Provider Health */}
      <ProviderHealth />

      {/* System Status */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-2 text-[12px]">
          <span className={cn(
            "h-[6px] w-[6px] rounded-full",
            !health ? "bg-gray-300" :
            health.status === "ok" ? "bg-emerald-500 animate-pulse" : "bg-amber-500"
          )} />
          <span className={cn(
            "text-[12px]",
            !health ? "text-gray-400" :
            health.status === "ok" ? "text-emerald-600" : "text-amber-600"
          )}>
            {!health ? "Connecting…" : health.status === "ok" ? "All systems normal" : "Degraded"}
          </span>
        </div>
      </div>
    </aside>
  );
}
