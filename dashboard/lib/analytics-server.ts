/**
 * Product analytics (PostHog), server side.
 *
 * For the events that matter most to the funnel — an account created, a plan
 * paid for, a subscription cancelled, a first rollout — and must not depend
 * on a browser that may block analytics. Sent to PostHog's capture API with
 * the tenant id as distinct id, the same id the browser identifies with.
 *
 * Awaited, with a short timeout: on serverless compute a fire-and-forget
 * request can be frozen before it is sent. Never throws.
 */
export async function captureServer(tenantId: string, event: string, properties: Record<string, unknown> = {}) {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return;
  const host = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";
  try {
    await fetch(`${host}/i/v0/e/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: key,
        event,
        distinct_id: tenantId,
        properties: { ...properties, $lib: "repath-dashboard-server" },
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // Analytics must never break the product.
  }
}
