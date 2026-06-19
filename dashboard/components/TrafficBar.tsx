"use client";

export default function TrafficBar({ weight }: { weight: number }) {
  const candidatePct = Math.round(weight * 100);
  const baselinePct = 100 - candidatePct;

  return (
    <div className="flex flex-col gap-3">
      {/* Bar */}
      <div className="flex h-8 w-full overflow-hidden rounded-lg bg-[--color-surface-2]">
        {baselinePct > 0 && (
          <div
            className="flex items-center justify-center text-[11px] font-semibold text-[--color-baseline] bg-[--color-baseline]/20 transition-all duration-700"
            style={{ flex: baselinePct }}
          >
            {baselinePct > 15 && `${baselinePct}%`}
          </div>
        )}
        {candidatePct > 0 && (
          <div
            className="flex items-center justify-center text-[11px] font-semibold text-[--color-candidate] bg-[--color-candidate]/20 transition-all duration-700"
            style={{ flex: candidatePct }}
          >
            {candidatePct > 15 && `${candidatePct}%`}
          </div>
        )}
      </div>

      {/* Labels */}
      <div className="flex items-center justify-between text-[12px]">
        <div className="text-[--color-text-secondary]">
          Baseline <span className="font-semibold text-[--color-baseline]">{baselinePct}%</span>
        </div>
        <div className="text-[--color-text-secondary]">
          Candidate <span className="font-semibold text-[--color-candidate]">{candidatePct}%</span>
        </div>
      </div>
    </div>
  );
}
