/**
 * Cancel the signed-in account's subscription at the end of its paid period.
 *
 * Pricing and the terms promise this ("cancel any time from Billing; the plan
 * stays until the end of the period you paid for"), and until now there was no
 * way to do it short of emailing us.
 *
 * `cancel_at_cycle_end: 1` stops renewal without ending the current period, so
 * nobody loses days they paid for. The subscription id is read from the
 * account on the server, never taken from the request: otherwise anyone could
 * cancel anyone's subscription by posting its id.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { captureServer } from "@/lib/analytics-server";

export async function POST() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Payments are not configured on this deployment." }, { status: 503 });
  }

  const session = await getSession().catch(() => null);
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Sign in to manage billing." }, { status: 401 });
  }

  const usageRes = await fetch(`${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}/usage`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!usageRes?.ok) {
    return NextResponse.json({ error: "Could not load your subscription. Try again in a minute." }, { status: 502 });
  }
  const usage = (await usageRes.json()) as { subscription_id?: string | null; cancel_at_period_end?: boolean };
  const subscriptionId = usage.subscription_id;
  if (!subscriptionId) {
    return NextResponse.json({ error: "This account has no subscription to cancel." }, { status: 400 });
  }
  if (usage.cancel_at_period_end) {
    return NextResponse.json({ ok: true, already: true });
  }

  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${credentials}` },
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach Razorpay. Nothing was changed; try again." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = (await res.json().catch(() => ({}))) as { error?: { description?: string } };
    const reason = detail.error?.description ?? `Razorpay returned ${res.status}`;
    console.error(`[billing] cancel failed for ${session.tenantId}: ${reason}`);
    return NextResponse.json(
      { error: `Razorpay did not accept the cancellation: ${reason}. Email hello@tryrepath.com and we will cancel it for you.` },
      { status: 502 }
    );
  }

  // Razorpay has stopped renewal. Recording it locally only changes what
  // Billing shows, so a failure here is logged and reported as success: the
  // customer will not be charged again either way.
  const mark = await fetch(`${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}/subscription/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
    body: JSON.stringify({ subscription_id: subscriptionId }),
    signal: AbortSignal.timeout(10000),
  }).catch(() => null);
  if (!mark?.ok) {
    console.error(`[billing] cancelled ${subscriptionId} at Razorpay but could not record it locally`);
  }

  await captureServer(session.tenantId, "subscription_cancelled", { $set: { paying: false, cancelled: true } });

  return NextResponse.json({ ok: true });
}
