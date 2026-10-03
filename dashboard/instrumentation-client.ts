/**
 * Runs in the browser before the app becomes interactive. Starts PostHog:
 * pageviews (including client-side navigations), autocaptured clicks, session
 * replay, and web vitals.
 *
 * Events go to /ingest on our own domain, which next.config.ts rewrites to
 * PostHog, so ad blockers that block posthog.com do not silently drop them.
 *
 * Session replay masks every input field, every <pre> block (prompts,
 * request and response bodies, code), and anything marked data-ph-mask (the
 * request detail panel, rollout prompts, API keys) before it leaves the
 * browser: passwords, keys and customers' prompts are never recorded.
 */
import posthog from "posthog-js";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (key) {
  try {
    posthog.init(key, {
      api_host: "/ingest",
      ui_host: "https://us.posthog.com",
      defaults: "2025-05-24",
      capture_pageview: "history_change",
      person_profiles: "identified_only",
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: "pre, [data-ph-mask]",
      },
    });
  } catch {
    // Analytics must never break the product.
  }
}
