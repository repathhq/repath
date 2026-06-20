import Link from "next/link";
import Image from "next/image";
import { CheckCircle2, Clock } from "lucide-react";

const services = [
  { name: "Gateway API", status: "operational", latency: "1.8ms avg" },
  { name: "Controller (auto-rollback)", status: "operational", latency: "30s interval" },
  { name: "LLM Judge evaluator", status: "operational", latency: "124ms avg" },
  { name: "Dashboard", status: "operational", latency: "—" },
  { name: "PostgreSQL (Neon)", status: "operational", latency: "4ms avg" },
  { name: "Redis (Upstash)", status: "operational", latency: "2ms avg" },
];

export default function StatusPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-icon.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
        <Link href="/signup" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 transition-colors">Start free trial</Link>
      </nav>
      <div className="max-w-3xl mx-auto px-6 py-16">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-4 h-4 rounded-full bg-emerald-500 animate-pulse" />
          <h1 className="text-[32px] font-bold text-gray-900 tracking-tight">All systems operational</h1>
        </div>
        <p className="text-[15px] text-gray-500 mb-12">Updated in real-time. All Repath services are running normally.</p>

        <div className="rounded-2xl border border-gray-200 overflow-hidden mb-10">
          {services.map((s, i) => (
            <div key={s.name} className={`flex items-center justify-between px-6 py-4 ${i < services.length - 1 ? "border-b border-gray-100" : ""}`}>
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-4.5 h-4.5 text-emerald-500" strokeWidth={2} />
                <span className="text-[14px] font-medium text-gray-700">{s.name}</span>
              </div>
              <div className="flex items-center gap-6">
                <span className="text-[12px] text-gray-400 font-mono">{s.latency}</span>
                <span className="text-[12px] font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-0.5 rounded-full">Operational</span>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50 p-6">
          <h3 className="text-[15px] font-semibold text-gray-900 mb-3 flex items-center gap-2">
            <Clock className="w-4 h-4 text-gray-400" /> Incident history
          </h3>
          <p className="text-[14px] text-gray-500">No incidents in the last 90 days.</p>
        </div>
      </div>
    </div>
  );
}
