import { Copy, Check } from "lucide-react";
import { useState } from "react";

export default function QuickStart() {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const steps = [
    {
      number: "01",
      title: "Clone and configure",
      code: `git clone https://github.com/tryrepath/repath
cd repath && cp .env.example .env
# Add OPENAI_API_KEY and REPATH_API_TOKEN to .env`,
    },
    {
      number: "02",
      title: "Start all services",
      code: `docker compose up
# Gateway → :8080   Dashboard → :3000`,
    },
    {
      number: "03",
      title: "Create your first rollout",
      code: `cargo install --path crates/cli
repath rollout create -f examples/demo-canary.yaml
# watch the quality graph at http://localhost:3000`,
    },
  ];

  const handleCopy = (idx: number, code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  };

  return (
    <section className="py-20 bg-[#0a0a0b]">
      <div className="container max-w-4xl mx-auto px-4">
        {/* Title */}
        <h2 className="text-4xl font-semibold text-center text-white mb-16">
          Running in 60 seconds
        </h2>

        {/* Steps */}
        <div className="space-y-8">
          {steps.map((step, idx) => (
            <div key={idx} className="flex gap-6">
              {/* Step Number */}
              <div className="flex-shrink-0">
                <div className="w-12 h-12 rounded-full bg-[#7c3aed] flex items-center justify-center text-white font-bold text-lg">
                  {step.number}
                </div>
              </div>

              {/* Step Content */}
              <div className="flex-1">
                <h3 className="text-xl font-semibold text-white mb-3">
                  {step.title}
                </h3>
                <div className="bg-[#111113] border border-[#27272a] rounded-lg overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a] bg-[#0a0a0b]">
                    <span className="text-xs text-[#a1a1aa] font-mono">bash</span>
                    <button
                      onClick={() => handleCopy(idx, step.code)}
                      className="text-[#a1a1aa] hover:text-white transition-colors"
                    >
                      {copiedIdx === idx ? (
                        <Check className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                  <div className="p-4 font-mono text-sm text-[#e4e4e7] whitespace-pre-wrap break-words">
                    {step.code}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Documentation Link */}
        <div className="mt-12 text-center">
          <a
            href="https://docs.repath.io"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#7c3aed] hover:text-[#a78bfa] transition-colors font-medium"
          >
            See full documentation →
          </a>
        </div>
      </div>
    </section>
  );
}
