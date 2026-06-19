import { Check, X } from "lucide-react";

export default function ComparisonTable() {
  const rows = [
    {
      feature: "Canary deployments",
      repath: true,
      launchDarkly: "Enterprise",
      liteLLM: false,
      langfuse: false,
    },
    {
      feature: "LLM quality evaluation",
      repath: true,
      launchDarkly: false,
      liteLLM: false,
      langfuse: "View",
    },
    {
      feature: "Auto rollback",
      repath: true,
      launchDarkly: "Enterprise",
      liteLLM: false,
      langfuse: false,
    },
    {
      feature: "Open source",
      repath: true,
      launchDarkly: false,
      liteLLM: true,
      langfuse: true,
    },
    {
      feature: "Self-hostable",
      repath: true,
      launchDarkly: false,
      liteLLM: true,
      langfuse: true,
    },
    {
      feature: "Price for startups",
      repath: "Free",
      launchDarkly: "$100K+/yr",
      liteLLM: "Free",
      langfuse: "Free",
    },
  ];

  const renderCell = (value: any) => {
    if (value === true) {
      return <Check className="w-5 h-5 text-green-500 mx-auto" />;
    }
    if (value === false) {
      return <X className="w-5 h-5 text-[#666] mx-auto" />;
    }
    return <span className="text-sm text-[#a1a1aa]">{value}</span>;
  };

  return (
    <section id="comparison" className="py-20 bg-[#0a0a0b]">
      <div className="container max-w-6xl mx-auto px-4">
        {/* Title */}
        <h2 className="text-4xl font-semibold text-center text-white mb-16">
          How Repath compares
        </h2>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[#27272a]">
                <th className="text-left px-6 py-4 text-sm font-semibold text-[#a1a1aa]">
                  Feature
                </th>
                <th className="text-center px-6 py-4 text-sm font-semibold text-white bg-[#111113] border-l-4 border-l-[#7c3aed]">
                  Repath
                </th>
                <th className="text-center px-6 py-4 text-sm font-semibold text-[#a1a1aa]">
                  LaunchDarkly
                </th>
                <th className="text-center px-6 py-4 text-sm font-semibold text-[#a1a1aa]">
                  LiteLLM
                </th>
                <th className="text-center px-6 py-4 text-sm font-semibold text-[#a1a1aa]">
                  Langfuse
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className="border-b border-[#27272a] hover:bg-[#111113]/50 transition-colors"
                >
                  <td className="px-6 py-4 text-sm text-[#e4e4e7]">
                    {row.feature}
                  </td>
                  <td className="text-center px-6 py-4 bg-[#111113]/30">
                    {renderCell(row.repath)}
                  </td>
                  <td className="text-center px-6 py-4">
                    {renderCell(row.launchDarkly)}
                  </td>
                  <td className="text-center px-6 py-4">
                    {renderCell(row.liteLLM)}
                  </td>
                  <td className="text-center px-6 py-4">
                    {renderCell(row.langfuse)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
