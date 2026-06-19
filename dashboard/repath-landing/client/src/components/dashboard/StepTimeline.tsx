import { Check, X, Loader2, Circle } from "lucide-react";

interface StepInfo {
  step_number: number;
  target_weight: number;
  gate_expression: string;
  status: "pending" | "active" | "passed" | "failed";
  started_at: string | null;
}

interface StepTimelineProps {
  steps: StepInfo[];
}

export function StepTimeline({ steps }: StepTimelineProps) {
  const getStepIcon = (status: string) => {
    switch (status) {
      case "passed":
        return <Check size={12} />;
      case "failed":
        return <X size={12} />;
      case "active":
        return <Loader2 size={12} className="animate-spin" />;
      default:
        return <Circle size={12} />;
    }
  };

  return (
    <div className="step-timeline">
      {steps.map((step, idx) => (
        <div key={idx} className={`step-item ${step.status}`}>
          <div className={`step-icon ${step.status}`}>{getStepIcon(step.status)}</div>
          <div className="step-content">
            <div className="step-title">
              Step {step.step_number} — {step.target_weight}%
            </div>
            <div className="step-gate">{step.gate_expression}</div>
            {step.status === "active" && step.started_at && (
              <div className="step-time">
                Started {new Date(step.started_at).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
