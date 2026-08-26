"use client";

/**
 * Create a rollout.
 *
 * This page is what makes Repath self-serve. Until it existed, the only way to
 * create a rollout was the CLI talking straight to PostgreSQL — which meant an
 * operator had to run it by hand for every customer.
 *
 * The form deliberately mirrors the rollout YAML one-for-one, so what someone
 * builds here is the same object the CLI and the raw API accept.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api, type RolloutConfigInput } from "@/lib/api";
import { AlertCircle, ArrowLeft, Plus, Trash2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const MODELS = [
  { provider: "openai", model: "gpt-4o" },
  { provider: "openai", model: "gpt-4o-mini" },
  { provider: "openai", model: "gpt-4-turbo" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022" },
  { provider: "anthropic", model: "claude-3-5-haiku-20241022" },
  { provider: "gemini", model: "gemini-1.5-pro" },
];

interface StepDraft {
  weight: number;
  duration: string;
  minQuality: string;
}

/** A sensible canary: small taste, then half, then everything. */
const DEFAULT_STEPS: StepDraft[] = [
  { weight: 10, duration: "10m", minQuality: "0.8" },
  { weight: 50, duration: "30m", minQuality: "0.8" },
  { weight: 100, duration: "", minQuality: "" },
];

const label = "block text-[12.5px] font-medium text-gray-700 mb-1.5";
const input =
  "w-full px-3 py-2 rounded-lg border border-gray-200 text-[14px] text-gray-900 placeholder-gray-400 " +
  "focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-all bg-white";
const textarea = cn(input, "font-mono text-[13px] leading-relaxed resize-y min-h-[120px]");

function Card({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 sm:p-6 shadow-sm">
      <div className="mb-5">
        <h2 className="text-[15px] font-semibold text-gray-900">{title}</h2>
        {desc && <p className="text-[12.5px] text-gray-500 mt-0.5">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

function ModelPicker({
  value,
  onChange,
}: {
  value: { provider: string; model: string };
  onChange: (v: { provider: string; model: string }) => void;
}) {
  return (
    <select
      className={input}
      value={`${value.provider}/${value.model}`}
      onChange={(e) => {
        const [provider, ...rest] = e.target.value.split("/");
        onChange({ provider, model: rest.join("/") });
      }}
    >
      {MODELS.map((m) => (
        <option key={`${m.provider}/${m.model}`} value={`${m.provider}/${m.model}`}>
          {m.provider} · {m.model}
        </option>
      ))}
    </select>
  );
}

export default function NewRolloutPage() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [baseline, setBaseline] = useState(MODELS[1]);
  const [candidate, setCandidate] = useState(MODELS[1]);
  const [baselinePrompt, setBaselinePrompt] = useState("");
  const [candidatePrompt, setCandidatePrompt] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>(DEFAULT_STEPS);
  const [rollbackBelow, setRollbackBelow] = useState("0.7");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateStep = (i: number, patch: Partial<StepDraft>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const addStep = () =>
    setSteps((prev) => {
      const last = prev[prev.length - 1];
      // Insert before the final 100% step so the ramp stays increasing.
      const inserted = { weight: Math.min(90, last.weight), duration: "10m", minQuality: "0.8" };
      return [...prev.slice(0, -1), inserted, last];
    });

  const removeStep = (i: number) =>
    setSteps((prev) => (prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev));

  /** Client-side checks that mirror the server's, for a faster, clearer error. */
  function validate(): string | null {
    if (!name.trim()) return "Give the rollout a name.";
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim()))
      return "The name may contain only letters, numbers, hyphens and underscores.";
    if (!candidatePrompt.trim() && !baselinePrompt.trim())
      return "Set at least one prompt — otherwise the two versions are identical.";
    if (steps.length === 0) return "Add at least one rollout step.";

    let previous = 0;
    for (const [i, s] of steps.entries()) {
      if (s.weight < 1 || s.weight > 100)
        return `Step ${i + 1}: weight must be between 1 and 100.`;
      if (i > 0 && s.weight <= previous)
        return `Step ${i + 1}: weight must be greater than the previous step (${previous}%).`;
      previous = s.weight;
    }
    if (previous !== 100)
      return "The last step must reach 100% so the candidate can fully promote.";
    return null;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }

    const config: RolloutConfigInput = {
      apiVersion: "repath/v1",
      kind: "Rollout",
      metadata: { name: name.trim() },
      spec: {
        baseline: {
          provider: baseline.provider,
          model: baseline.model,
          prompt: { system: baselinePrompt.trim() || undefined },
          parameters: {},
        },
        candidate: {
          provider: candidate.provider,
          model: candidate.model,
          prompt: { system: candidatePrompt.trim() || undefined },
          parameters: {},
        },
        strategy: {
          type: "canary",
          steps: steps.map((s) => ({
            weight: s.weight,
            duration: s.duration.trim() || undefined,
            gate: s.minQuality.trim()
              ? { quality_score: `>= ${s.minQuality.trim()}` }
              : undefined,
          })),
          rollback: {
            trigger: { quality_score: `< ${rollbackBelow}` },
            action: "rollback",
          },
        },
      },
    };

    setSubmitting(true);
    try {
      const created = await api.rollouts.create(config);
      router.push(`/rollouts/${created.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the rollout.");
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="bg-white border-b border-gray-200 px-6 sm:px-8 h-14 flex items-center gap-3 sticky top-0 z-20">
        <Link
          href="/rollouts"
          className="flex items-center gap-1.5 text-[13px] text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
          Rollouts
        </Link>
        <span className="text-gray-300">/</span>
        <h1 className="text-[16px] font-semibold text-gray-900">New rollout</h1>
      </div>

      <form onSubmit={submit} className="p-6 sm:p-8 max-w-[860px] mx-auto flex flex-col gap-5">
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" strokeWidth={1.8} />
            <p className="text-[13px] text-red-700">{error}</p>
          </div>
        )}

        <Card title="Name" desc="How you'll refer to this rollout in the dashboard and CLI.">
          <input
            className={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="checkout-support-prompt"
            autoFocus
          />
        </Card>

        <Card
          title="Baseline"
          desc="What you're running today. Traffic starts here and only moves as gates pass."
        >
          <div className="flex flex-col gap-4">
            <div>
              <label className={label}>Model</label>
              <ModelPicker value={baseline} onChange={setBaseline} />
            </div>
            <div>
              <label className={label}>System prompt</label>
              <textarea
                className={textarea}
                value={baselinePrompt}
                onChange={(e) => setBaselinePrompt(e.target.value)}
                placeholder="You are a helpful customer support agent…"
              />
            </div>
          </div>
        </Card>

        <Card title="Candidate" desc="The change you want to test against the baseline.">
          <div className="flex flex-col gap-4">
            <div>
              <label className={label}>Model</label>
              <ModelPicker value={candidate} onChange={setCandidate} />
            </div>
            <div>
              <label className={label}>System prompt</label>
              <textarea
                className={textarea}
                value={candidatePrompt}
                onChange={(e) => setCandidatePrompt(e.target.value)}
                placeholder="You are a support agent. Be concise and specific…"
              />
            </div>
          </div>
        </Card>

        <Card
          title="Rollout steps"
          desc="Traffic moves to the next step only when the gate passes. Weights must increase and end at 100%."
        >
          <div className="flex flex-col gap-3">
            {steps.map((s, i) => (
              <div
                key={i}
                className="grid grid-cols-[1fr_1fr_1fr_auto] gap-3 items-end rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div>
                  <label className={label}>Traffic %</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className={input}
                    value={s.weight}
                    onChange={(e) => updateStep(i, { weight: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className={label}>Hold for</label>
                  <input
                    className={input}
                    value={s.duration}
                    onChange={(e) => updateStep(i, { duration: e.target.value })}
                    placeholder="10m"
                  />
                </div>
                <div>
                  <label className={label}>Min quality</label>
                  <input
                    className={input}
                    value={s.minQuality}
                    onChange={(e) => updateStep(i, { minQuality: e.target.value })}
                    placeholder="0.8"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  disabled={steps.length === 1}
                  aria-label={`Remove step ${i + 1}`}
                  className="mb-1 p-2 rounded-lg border border-gray-200 bg-white text-gray-400 hover:text-red-500 hover:border-red-200 disabled:opacity-40 disabled:hover:text-gray-400 disabled:hover:border-gray-200 transition-colors"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={1.8} />
                </button>
              </div>
            ))}

            <button
              type="button"
              onClick={addStep}
              className="self-start flex items-center gap-1.5 text-[13px] text-violet-600 hover:text-violet-700 font-medium"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2} />
              Add step
            </button>
          </div>
        </Card>

        <Card
          title="Automatic rollback"
          desc="If the candidate's quality falls below this, the controller returns all traffic to the baseline without waiting for you."
        >
          <div className="max-w-[220px]">
            <label className={label}>Roll back below</label>
            <input
              className={input}
              value={rollbackBelow}
              onChange={(e) => setRollbackBelow(e.target.value)}
              placeholder="0.7"
            />
          </div>
        </Card>

        <div className="flex items-center gap-3 pb-8">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-[13.5px] font-semibold rounded-lg hover:bg-violet-700 transition-colors shadow-sm disabled:opacity-50"
          >
            {submitting && <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />}
            {submitting ? "Creating…" : "Create rollout"}
          </button>
          <Link
            href="/rollouts"
            className="px-4 py-2.5 text-[13.5px] text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </Link>
          <p className="text-[12px] text-gray-400 ml-auto">
            Created paused at 0% — no traffic moves until the controller&apos;s first cycle.
          </p>
        </div>
      </form>
    </div>
  );
}
