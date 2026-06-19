import { BarChart3, Zap, TrendingDown, Eye } from "lucide-react";

export default function FeaturesSection() {
  const features = [
    {
      title: "Canary deployments for prompts",
      body: "Route 5% → 25% → 100% of traffic to a new prompt version. Each step has configurable quality gates. The controller enforces them.",
      icon: BarChart3,
      code: `steps:
  - weight: 10
    gate:
      quality_score: ">= 0.9"
  - weight: 100`,
      direction: "left",
    },
    {
      title: "gpt-4o-mini judges every response",
      body: "Define what good looks like in plain English. Repath sends each response to a judge model and scores it against your criteria. No metrics schemas, no custom code.",
      icon: Eye,
      code: `judge_prompt: |
  Score this response 0-1.
  Criteria: accuracy, clarity,
  relevance to the query.`,
      direction: "right",
    },
    {
      title: "Rollback in under 500ms",
      body: "When the rolling quality score drops below your threshold, the controller sets candidate traffic to zero before the next request. Not eventually. Now.",
      icon: Zap,
      code: `controller:
  check_interval: 30s
  rollback_threshold: 0.7
  action: instant`,
      direction: "left",
    },
    {
      title: "Every decision is audited",
      body: "Advance, rollback, or hold — every controller decision is logged with the exact metrics that triggered it. Full history, queryable, exportable.",
      icon: TrendingDown,
      code: `{
  "timestamp": "2024-06-18T12:45:30Z",
  "action": "rollback",
  "reason": "quality < 0.7",
  "metrics": {...}
}`,
      direction: "right",
    },
  ];

  return (
    <section id="features" className="py-20 bg-[#0a0a0b]">
      <div className="container max-w-6xl mx-auto px-4">
        {/* Title */}
        <h2 className="text-4xl font-semibold text-center text-white mb-16">
          What it does
        </h2>

        {/* Features */}
        <div className="space-y-16">
          {features.map((feature, idx) => {
            const Icon = feature.icon;
            const isLeft = feature.direction === "left";

            return (
              <div
                key={idx}
                className={`grid grid-cols-1 md:grid-cols-2 gap-8 items-center ${
                  isLeft ? "" : "md:grid-flow-dense"
                }`}
              >
                {/* Text Content */}
                <div className={isLeft ? "md:col-span-1" : "md:col-span-1 md:order-2"}>
                  <div className="flex items-center gap-3 mb-4">
                    <Icon className="w-6 h-6 text-[#7c3aed]" />
                    <h3 className="text-2xl font-semibold text-white">
                      {feature.title}
                    </h3>
                  </div>
                  <p className="text-[#a1a1aa] text-base leading-relaxed mb-6">
                    {feature.body}
                  </p>
                </div>

                {/* Code Block */}
                <div className={isLeft ? "md:col-span-1 md:order-2" : "md:col-span-1"}>
                  <div className="bg-[#111113] border border-[#27272a] rounded-lg overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#27272a] bg-[#0a0a0b]">
                      <span className="text-xs text-[#a1a1aa] font-mono">
                        yaml
                      </span>
                    </div>
                    <div className="p-4 font-mono text-sm text-[#e4e4e7] whitespace-pre-wrap break-words">
                      {feature.code}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
