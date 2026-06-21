import Link from "next/link";
import Image from "next/image";
import { Briefcase, MapPin, ArrowUpRight } from "lucide-react";

export default function CareersPage() {
  return (
    <div className="min-h-screen bg-white" style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      <nav className="border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 bg-white z-40">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/repath.png" alt="Repath" width={32} height={32} className="rounded-lg" />
          <span className="font-bold text-[18px] text-gray-900">Repath</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/docs" className="text-[14px] text-gray-500 hover:text-gray-900">Docs</Link>
          <Link href="/signup" className="px-4 py-2 bg-gray-900 text-white text-[13px] font-medium rounded-lg hover:bg-gray-800 transition-colors">Start free trial</Link>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-6 py-20">
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100 text-[12px] font-medium text-violet-700 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />
            We&apos;re hiring
          </div>
          <h1 className="text-[44px] font-bold text-gray-900 tracking-tight mb-4">Build the future of AI deployment</h1>
          <p className="text-[18px] text-gray-500 max-w-2xl leading-relaxed">
            We&apos;re a small, ambitious team building the progressive delivery layer for AI. If you care deeply about reliability, quality, and developer experience — we&apos;d love to meet you.
          </p>
        </div>

        {/* Values */}
        <div className="grid md:grid-cols-3 gap-6 mb-16">
          {[
            { title: "Remote first", desc: "Work from anywhere. We care about output, not office hours." },
            { title: "High ownership", desc: "Small team means real impact. You'll own entire systems." },
            { title: "Move fast", desc: "Ship daily. We build, measure, and iterate quickly." },
          ].map(v => (
            <div key={v.title} className="rounded-xl border border-gray-200 p-6 bg-gray-50">
              <h3 className="text-[15px] font-semibold text-gray-900 mb-2">{v.title}</h3>
              <p className="text-[13px] text-gray-500 leading-relaxed">{v.desc}</p>
            </div>
          ))}
        </div>

        {/* No openings */}
        <div className="rounded-2xl border-2 border-dashed border-gray-200 py-20 text-center">
          <div className="w-14 h-14 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-5">
            <Briefcase className="w-6 h-6 text-gray-400" strokeWidth={1.5} />
          </div>
          <h2 className="text-[20px] font-semibold text-gray-900 mb-2">No open positions right now</h2>
          <p className="text-[14px] text-gray-500 max-w-sm mx-auto mb-8">
            We don&apos;t have any open roles at the moment, but we&apos;re always interested in exceptional people.
          </p>
          <a href="mailto:hello@tryrepath.com?subject=General application"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-gray-900 text-white text-[14px] font-medium rounded-lg hover:bg-gray-800 transition-colors">
            Send us your CV <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>

        <p className="text-center text-[13px] text-gray-400 mt-8 flex items-center justify-center gap-1.5">
          <MapPin className="w-3.5 h-3.5" /> Remote · India & Global
        </p>
      </div>
    </div>
  );
}
