"use client";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface ProviderSnapshot { provider_url: string; error_rate: number; total_requests: number; degraded: boolean; }

function providerName(url: string): string {
  if (url.includes("openai.com")) return "OpenAI";
  if (url.includes("anthropic.com")) return "Anthropic";
  if (url.includes("googleapis.com")) return "Gemini";
  if (url.includes("openrouter.ai")) return "OpenRouter";
  try { return new URL(url).hostname.split(".").slice(-2,-1)[0]; } catch { return url; }
}

export default function ProviderHealth() {
  const [providers, setProviders] = useState<ProviderSnapshot[]>([]);
  useEffect(() => {
    const load = () => fetch("/api/system/providers").then(r=>r.json()).then(d=>setProviders(d.providers??[])).catch(()=>{});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  if (providers.length === 0) return null;
  return (
    <div className="px-4 py-3 border-t border-gray-100">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Providers</p>
      <div className="space-y-1.5">
        {providers.map(p => (
          <div key={p.provider_url} className="flex items-center justify-between">
            <span className="text-[12px] text-gray-600">{providerName(p.provider_url)}</span>
            <div className="flex items-center gap-1.5">
              {p.total_requests > 0 && (
                <span className="text-[10px] text-gray-400">{(p.error_rate*100).toFixed(0)}%</span>
              )}
              <div className={cn("w-1.5 h-1.5 rounded-full",
                p.degraded ? "bg-red-500 animate-pulse" :
                p.error_rate > 0 ? "bg-amber-500" : "bg-emerald-500"
              )} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
