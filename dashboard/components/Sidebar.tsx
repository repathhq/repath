"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { GitBranch, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSystemHealth } from "@/lib/hooks";
import ProviderHealth from "@/components/ProviderHealth";

const nav = [
  { href: "/rollouts", label: "Rollouts", icon: GitBranch, exact: false },
  { href: "/billing",  label: "Billing",  icon: CreditCard, exact: false },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { data: health } = useSystemHealth();

  return (
    <aside className="flex h-screen w-[220px] flex-col bg-[--color-surface] border-r border-[--color-border]">
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-4 border-b border-[--color-border]">
        <Image src="/logo-icon.png" alt="Repath" width={24} height={24} className="rounded" />
        <span className="text-[14px] font-semibold text-[--color-text]">Repath</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-3 overflow-auto">
        {nav.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-3 px-4 py-[10px] text-[14px] transition-all duration-150 border-l-2",
                active
                  ? "border-l-[--color-accent] bg-[--color-accent]/[0.08] text-[--color-accent]"
                  : "border-l-transparent text-[--color-text-secondary] hover:text-[--color-text] hover:bg-white/[0.02]"
              )}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
              <span className="flex-1">{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Provider Health */}
      <ProviderHealth />

      {/* System Status */}
      <div className="px-4 py-4 border-t border-[--color-border]">
        <div className="flex items-center gap-2 text-[12px]">
          <span className={cn(
            "h-[6px] w-[6px] rounded-full",
            !health ? "bg-[--color-text-muted]" :
            health.status === "ok" ? "bg-[--color-success] animate-pulse" : "bg-[--color-candidate]"
          )} />
          <span className={cn(
            !health ? "text-[--color-text-muted]" :
            health.status === "ok" ? "text-[--color-success]" : "text-[--color-candidate]"
          )}>
            {!health ? "Connecting…" : health.status === "ok" ? "All systems normal" : "Degraded"}
          </span>
        </div>
      </div>
    </aside>
  );
}
