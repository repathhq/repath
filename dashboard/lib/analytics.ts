/**
 * Product analytics (PostHog), browser side.
 *
 * Initialised in instrumentation-client.ts. Every helper here is a no-op when
 * NEXT_PUBLIC_POSTHOG_KEY is unset, so local development and self-hosted
 * deployments send nothing anywhere.
 *
 * Event names are past-tense facts ("checkout_started"), shared with the
 * server-side events in analytics-server.ts, so a funnel can mix the two.
 */
import posthog from "posthog-js";

export const analyticsEnabled = () => Boolean(process.env.NEXT_PUBLIC_POSTHOG_KEY);

export function track(event: string, properties?: Record<string, unknown>) {
  if (!analyticsEnabled()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Analytics must never break the product.
  }
}

/** Ties this browser's anonymous history to the account, so a funnel can
 *  follow one person from the landing page to a paid plan. Keyed by tenant
 *  id, which is also what the server-side events use. */
export function identify(user: { tenantId: string; email?: string; name?: string; plan?: string }) {
  if (!analyticsEnabled()) return;
  try {
    if (posthog.get_distinct_id() === user.tenantId) {
      posthog.setPersonProperties({ plan: user.plan });
      return;
    }
    posthog.identify(user.tenantId, { email: user.email, name: user.name, plan: user.plan });
  } catch {
    // ignore
  }
}

/** On sign-out, so the next person on this browser is not merged into the
 *  previous account. */
export function resetAnalytics() {
  if (!analyticsEnabled()) return;
  try {
    posthog.reset();
  } catch {
    // ignore
  }
}
