export default function ProblemSection() {
  const incidents = [
    {
      number: "97.6% → 2.4%",
      title: "GPT-4 accuracy drop",
      body: "A June 2023 Stanford study found GPT-4's accuracy on a coding task dropped from 97.6% to 2.4% in one month — with zero API errors. Nobody noticed.",
    },
    {
      number: "$110M",
      title: "Unity ML regression loss",
      body: "A model behavior change caused an undetected regression. By the time users reported it, the damage was done.",
    },
    {
      number: "34 days",
      title: "Undetected quality drift",
      body: "A subtle prompt change degraded response quality for 34 days before anyone correlated support tickets to the deployment.",
    },
  ];

  return (
    <section className="py-20 bg-[#0a0a0b]">
      <div className="container max-w-6xl mx-auto px-4">
        {/* Title */}
        <h2 className="text-4xl font-semibold text-center text-white mb-16">
          The silent failure mode
        </h2>

        {/* Incident Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
          {incidents.map((incident, idx) => (
            <div
              key={idx}
              className="bg-[#111113] border border-[#27272a] border-l-4 border-l-red-500 rounded-lg p-6 hover:border-[#3a3a3d] hover:bg-[#111113]/80 transition-all duration-300 hover-lift"
            >
              <div className="font-mono text-2xl font-bold text-red-500 mb-3">
                {incident.number}
              </div>
              <h3 className="text-lg font-semibold text-white mb-3">
                {incident.title}
              </h3>
              <p className="text-[#a1a1aa] text-sm leading-relaxed">
                {incident.body}
              </p>
            </div>
          ))}
        </div>

        {/* Quote Block */}
        <div className="bg-[#111113] border-l-4 border-l-[#7c3aed] rounded-lg p-8 text-center">
          <p className="text-lg md:text-xl text-[#e4e4e7] italic">
            "Feature flags check if code deployed. Repath checks if it actually
            worked."
          </p>
        </div>
      </div>
    </section>
  );
}
