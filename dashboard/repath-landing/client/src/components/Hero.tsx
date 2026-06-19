import { Button } from "@/components/ui/button";
import { Github, ArrowRight, Copy, Check } from "lucide-react";
import { useState } from "react";

export default function Hero() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(
      'client = OpenAI(api_key="sk-...", base_url="http://your-repath/v1")'
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center pt-20 pb-20 overflow-hidden">
      {/* Background */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "url(https://d2xsxph8kpxj0f.cloudfront.net/310519663688915055/ZNUV3nN5AZGtoyPiumDGzC/hero-abstract-bg-VTFPx7ScmDWU2MRdHwA6gB.webp)",
          backgroundSize: "cover",
          backgroundPosition: "center",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0a0a0b] -z-10" />

      <div className="container max-w-4xl mx-auto px-4 flex flex-col items-center text-center">
        {/* Badge */}
        <div className="mb-8 inline-flex items-center gap-2 px-3 sm:px-4 py-2 rounded-full border border-[#27272a] bg-[#111113]/50 backdrop-blur-sm animate-fade-in text-xs sm:text-sm">
          <span className="font-medium text-[#7c3aed]">Open Source</span>
          <span className="text-[#a1a1aa]">·</span>
          <span className="text-[#a1a1aa]">BSL 1.1</span>
          <span className="hidden sm:inline text-[#a1a1aa]">·</span>
          <span className="hidden sm:inline text-[#a1a1aa]">847 ★</span>
        </div>

        {/* H1 */}
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white mb-6 leading-tight animate-fade-in-up" style={{animationDelay: '0.1s'}}>
          Ship AI changes
          <br />
          without the guesswork.
        </h1>

        {/* Subhead */}
        <p className="text-base sm:text-lg md:text-xl text-[#d4d4d8] mb-8 max-w-2xl leading-relaxed animate-fade-in-up" style={{animationDelay: '0.2s'}}>
          Repath sits between your app and OpenAI. It splits traffic, scores
          responses with an LLM judge, and rolls back automatically when quality
          drops — before your users notice.
        </p>

        {/* CTAs */}
        <div className="flex flex-col sm:flex-row gap-4 mb-12 animate-fade-in-up" style={{animationDelay: '0.3s'}}>
          <Button
            size="lg"
            className="bg-[#7c3aed] hover:bg-[#6d28d9] text-white flex items-center gap-2 transition-smooth glow-violet"
          >
            Get Started
            <ArrowRight className="w-5 h-5" />
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="border-[#27272a] text-[#e4e4e7] hover:bg-[#111113] flex items-center gap-2"
            asChild
          >
            <a
              href="https://github.com/tryrepath/repath"
              target="_blank"
              rel="noopener noreferrer"
            >
              <Github className="w-5 h-5" />
              View on GitHub
            </a>
          </Button>
        </div>

        {/* Terminal Block */}
        <div className="w-full max-w-2xl animate-fade-in-up" style={{animationDelay: '0.4s'}}>
          <div className="text-xs text-[#a1a1aa] mb-3 text-left">
            One line to integrate
          </div>
          <div className="bg-[#111113] border border-[#27272a] rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#0a0a0b]">
              <span className="text-xs text-[#a1a1aa] font-mono">python</span>
              <button
                onClick={handleCopy}
                className="text-[#a1a1aa] hover:text-white transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
            <div className="p-4 font-mono text-sm text-[#e4e4e7] space-y-2">
              <div>
                <span className="text-[#7c3aed]">client</span>
                <span className="text-[#a1a1aa]">=</span>
                <span className="text-[#a78bfa]"> OpenAI</span>
                <span className="text-[#a1a1aa]">(</span>
                <span className="text-[#a1a1aa]">api_key</span>
                <span className="text-[#a1a1aa]">=</span>
                <span className="text-green-400">"sk-..."</span>
                <span className="text-[#a1a1aa]">)</span>
              </div>
              <div className="text-[#666]"># After</div>
              <div>
                <span className="text-[#7c3aed]">client</span>
                <span className="text-[#a1a1aa]">=</span>
                <span className="text-[#a78bfa]"> OpenAI</span>
                <span className="text-[#a1a1aa]">(</span>
                <span className="text-[#a1a1aa]">api_key</span>
                <span className="text-[#a1a1aa]">=</span>
                <span className="text-green-400">"sk-..."</span>
                <span className="text-[#a1a1aa]">,</span>
                <span className="text-[#a1a1aa]"> base_url</span>
                <span className="text-[#a1a1aa]">=</span>
                <span className="text-green-400">"http://your-repath/v1"</span>
                <span className="text-[#a1a1aa]">)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Works with */}
        <div className="mt-12 flex flex-col items-center gap-4 animate-fade-in-up" style={{animationDelay: '0.5s'}}>
          <span className="text-xs text-[#a1a1aa] uppercase tracking-wider">
            Works with
          </span>
          <div className="flex items-center gap-8 opacity-60">
            <span className="text-sm font-semibold text-[#a1a1aa]">OpenAI</span>
            <span className="text-sm font-semibold text-[#a1a1aa]">Anthropic</span>
            <span className="text-sm font-semibold text-[#a1a1aa]">
              Google Gemini
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
