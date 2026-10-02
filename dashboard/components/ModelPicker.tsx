"use client";

/**
 * Pick a model from the catalog, or type any model id.
 *
 * The custom path matters more than the list: providers ship new models every
 * few weeks and retire old ones on a schedule nobody here controls. A customer
 * should never wait on a dashboard release to try a model their provider
 * already serves — the gateway passes any id through.
 */

import { useState } from "react";
import {
  CUSTOM,
  MODELS,
  PROVIDER_LABELS,
  isListed,
  key,
  parseKey,
  type ProviderId,
} from "@/lib/models";

type Value = { provider: string; model: string };

const PROVIDERS = Object.keys(PROVIDER_LABELS) as ProviderId[];

export default function ModelPicker({
  value,
  onChange,
  className,
  ariaLabel,
}: {
  value: Value;
  onChange: (v: Value) => void;
  className?: string;
  ariaLabel?: string;
}) {
  // A value that is not in the catalog — set by a custom entry, or by a
  // rollout created from the CLI — opens in custom mode rather than being
  // silently swapped for the first listed model.
  const [custom, setCustom] = useState(() => !isListed(value));

  return (
    <div className="flex flex-col gap-2">
      <select
        className={className}
        aria-label={ariaLabel}
        value={custom ? CUSTOM : key(value)}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true);
            onChange({ provider: value.provider, model: "" });
            return;
          }
          setCustom(false);
          onChange(parseKey(e.target.value));
        }}
      >
        {PROVIDERS.map((p) => (
          <optgroup key={p} label={PROVIDER_LABELS[p]}>
            {MODELS.filter((m) => m.provider === p).map((m) => (
              <option key={key(m)} value={key(m)}>
                {m.model}
                {m.note ? ` — ${m.note}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
        <option value={CUSTOM}>Custom model…</option>
      </select>

      {custom && (
        <div className="flex gap-2">
          <select
            className={className}
            style={{ maxWidth: 170 }}
            aria-label="Provider"
            value={value.provider}
            onChange={(e) => onChange({ provider: e.target.value, model: value.model })}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {PROVIDER_LABELS[p]}
              </option>
            ))}
          </select>
          <input
            className={className}
            aria-label="Model id"
            placeholder={
              value.provider === "openrouter" ? "vendor/model, e.g. x-ai/grok-4.7" : "exact model id"
            }
            value={value.model}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            onChange={(e) => onChange({ provider: value.provider, model: e.target.value.trim() })}
          />
        </div>
      )}
    </div>
  );
}
