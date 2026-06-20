import Link from "next/link";
import Image from "next/image";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo-icon.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
      </nav>
      <div className="max-w-3xl mx-auto px-6 py-16">
        <p className="text-[13px] text-gray-400 mb-2">Last updated: June 20, 2026</p>
        <h1 className="text-[36px] font-bold text-gray-900 mb-8 tracking-tight">Privacy Policy</h1>
        <div className="space-y-8 text-[15px] text-gray-600 leading-relaxed">
          {[
            { h: "1. Data we collect", body: "Account information (name, email, password hash), usage data (API calls, evaluation counts, rollout events), and technical logs (request metadata, latency, error rates). We do not collect the content of your LLM prompts or responses unless you explicitly enable logging." },
            { h: "2. How we use data", body: "To provide and improve the Repath service, send transactional emails (receipts, alerts), calculate billing, and ensure security. We do not sell your data to third parties." },
            { h: "3. Data storage", body: "Data is stored on Neon (PostgreSQL) hosted in AWS ap-southeast-1 (Singapore) and Upstash (Redis). All data is encrypted at rest (AES-256) and in transit (TLS 1.3)." },
            { h: "4. LLM request data", body: "In cloud mode, request/response pairs are temporarily processed for quality evaluation (LLM-as-judge). This data is retained for the duration of your plan's data retention period, then automatically deleted. For self-hosted deployments, data never leaves your infrastructure." },
            { h: "5. Cookies", body: "We use a single session cookie (HttpOnly, Secure) for authentication. No third-party tracking cookies." },
            { h: "6. Your rights", body: "You may request deletion of your account and data at any time by emailing hello@tryrepath.com. We will complete deletion within 30 days." },
            { h: "7. Contact", body: "For privacy questions: hello@tryrepath.com" },
          ].map(s => (
            <div key={s.h}>
              <h2 className="text-[18px] font-semibold text-gray-900 mb-2">{s.h}</h2>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
