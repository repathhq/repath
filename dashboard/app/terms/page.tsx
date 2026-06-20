import Link from "next/link";
import Image from "next/image";

export default function TermsPage() {
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
        <h1 className="text-[36px] font-bold text-gray-900 mb-8 tracking-tight">Terms of Service</h1>
        <div className="space-y-8 text-[15px] text-gray-600 leading-relaxed">
          {[
            { h: "1. Acceptance", body: "By using Repath, you agree to these terms. If you are using Repath on behalf of a company, you represent that you have authority to bind that company." },
            { h: "2. Service description", body: "Repath is a cloud-based AI deployment safety platform. We provide canary deployments, LLM-as-judge evaluation, automatic rollback, and provider failover for LLM applications." },
            { h: "3. Free trial", body: "New accounts receive a 7-day free trial with full access. No credit card is required to start. After the trial, a paid plan is required to continue using the service." },
            { h: "4. Payment", body: "Paid plans are billed monthly or annually. Indian customers pay in INR via Razorpay. International customers pay in USD via Paddle. All payments are non-refundable except as required by law." },
            { h: "5. Acceptable use", body: "You may not use Repath to violate any laws, infringe third-party rights, transmit harmful content, or attempt to reverse engineer the service. We reserve the right to suspend accounts for violations." },
            { h: "6. Uptime and SLAs", body: "Repath targets 99.9% uptime for Starter/Pro plans. Enterprise plans include a custom SLA. Scheduled maintenance will be communicated in advance via status.tryrepath.com." },
            { h: "7. Limitation of liability", body: "Repath is provided as-is. We are not liable for indirect, incidental, or consequential damages arising from use of the service." },
            { h: "8. Contact", body: "For terms questions: hello@tryrepath.com" },
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
