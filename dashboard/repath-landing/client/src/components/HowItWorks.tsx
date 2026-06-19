export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-20 bg-[#0a0a0b]">
      <div className="container max-w-7xl mx-auto px-4">
        {/* Title */}
        <h2 className="text-4xl font-semibold text-center text-white mb-4">
          Automated quality gates, not dashboards
        </h2>

        {/* Subtitle */}
        <p className="text-center text-[#a1a1aa] text-lg mb-12 max-w-2xl mx-auto">
          Most observability tools tell you what broke. Repath stops it from
          reaching your users.
        </p>

        {/* Architecture Diagram */}
        <div className="bg-[#111113] border border-[#27272a] rounded-lg p-8 overflow-x-auto">
          <img
            src="https://d2xsxph8kpxj0f.cloudfront.net/310519663688915055/ZNUV3nN5AZGtoyPiumDGzC/architecture-flow-bg-9MRTYuwCdCvaZ5BRMnCiAj.webp"
            alt="Repath Architecture"
            className="w-full h-auto"
          />
        </div>

        {/* Description */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">
              Drop-in replacement
            </h3>
            <p className="text-[#a1a1aa] text-sm">
              Change one line of code. Your app sends requests through Repath
              instead of directly to OpenAI.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">
              Traffic splitting
            </h3>
            <p className="text-[#a1a1aa] text-sm">
              Route a percentage of requests to a new model version. Repath
              scores both responses and compares quality.
            </p>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-2">
              Automatic rollback
            </h3>
            <p className="text-[#a1a1aa] text-sm">
              When quality drops below your threshold, Repath instantly rolls
              back to the baseline. No manual intervention.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
