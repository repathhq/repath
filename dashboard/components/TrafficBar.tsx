"use client";

export default function TrafficBar({ weight }: { weight: number }) {
  const candidatePct = Math.round(weight * 100);
  const baselinePct = 100 - candidatePct;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-7 w-full overflow-hidden rounded-lg bg-gray-100">
        {baselinePct > 0 && (
          <div
            className="flex items-center justify-center text-[11px] font-semibold text-blue-700 bg-blue-100 transition-all duration-700"
            style={{ flex: baselinePct }}
          >
            {baselinePct > 15 && `${baselinePct}%`}
          </div>
        )}
        {candidatePct > 0 && (
          <div
            className="flex items-center justify-center text-[11px] font-semibold text-amber-700 bg-amber-100 transition-all duration-700"
            style={{ flex: candidatePct }}
          >
            {candidatePct > 15 && `${candidatePct}%`}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-gray-500">Baseline <span className="font-semibold text-blue-700">{baselinePct}%</span></span>
        <span className="text-gray-500">Candidate <span className="font-semibold text-amber-700">{candidatePct}%</span></span>
      </div>
    </div>
  );
}
