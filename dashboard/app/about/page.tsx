import Link from "next/link";
import Image from "next/image";
import { ArrowRight } from "lucide-react";

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/repath.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
        <Link href="/signup" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 transition-colors">Start free trial</Link>
      </nav>
      <div className="max-w-3xl mx-auto px-6 py-20">
        <h1 className="text-[44px] font-bold text-gray-900 mb-6 tracking-tight">About Repath</h1>
        <div className="prose prose-gray max-w-none space-y-6">
          <p className="text-[18px] text-gray-500 leading-relaxed">Repath is the deployment safety layer for AI. We believe the biggest unsolved problem in production AI is not capability — it&apos;s reliability. AI models break silently, and teams have no safe way to roll out changes.</p>
          <p className="text-[16px] text-gray-500 leading-relaxed">We built Repath to fix that. A transparent proxy that splits traffic between prompt versions, scores every response with an AI judge, and reverts automatically when quality drops — all before your users notice.</p>
          <div className="rounded-2xl bg-gray-50 border border-gray-200 p-8 my-10">
            <h2 className="text-[22px] font-bold text-gray-900 mb-3">Our mission</h2>
            <p className="text-[16px] text-gray-600 leading-relaxed italic">&ldquo;Make it safe to ship AI. Every team that builds with LLMs should have the same deployment safety primitives that top tech companies use for traditional software.&rdquo;</p>
          </div>
          <h2 className="text-[24px] font-bold text-gray-900">Why we built this</h2>
          <p className="text-[16px] text-gray-500 leading-relaxed">We watched GPT-4 drop from 97% accuracy to 2% on coding tasks — silently, with zero API errors. We watched Unity lose $110M from an ML model regression that went undetected. We saw teams discover prompt regressions 34 days after they shipped.</p>
          <p className="text-[16px] text-gray-500 leading-relaxed">Feature flags solve deployment. Observability tools show you what happened. But nothing existed to prevent quality regressions from reaching users in the first place. That&apos;s the gap Repath fills.</p>
        </div>
        <div className="mt-14 pt-10 border-t border-gray-100 flex items-center justify-between">
          <Link href="/careers" className="text-[14px] text-violet-600 hover:underline font-medium">Join our team →</Link>
          <Link href="/signup" className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800 transition-colors">
            Start building <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
