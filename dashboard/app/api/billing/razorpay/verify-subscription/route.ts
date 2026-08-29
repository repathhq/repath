/**
 * Activate a plan after the customer authorises a subscription mandate.
 *
 * Two things are deliberate here.
 *
 * The signature for subscriptions is HMAC over `payment_id|subscription_id`,
 * which is the reverse of the order flow's `order_id|payment_id`. Getting the
 * order wrong yields a check that always fails — or, if written to compare
 * loosely, one that always passes.
 *
 * The plan and tenant come from the subscription's `notes`, fetched back from
 * Razorpay, never from the request body. The body is client-controlled: if it
 * decided the tier, anyone could authorise the ₹1,699 plan and post "pro".
 */
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const GATEWAY =
    process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Payments are not configured." }, { status: 503 });
  }

  const { razorpay_payment_id, razorpay_subscription_id, razorpay_signature } =
    await req.json().catch(() => ({}));

  if (!razorpay_payment_id || !razorpay_subscription_id || !razorpay_signature) {
    return NextResponse.json({ error: "Missing payment details." }, { status: 400 });
  }

  const expected = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_payment_id}|${razorpay_subscription_id}`)
    .digest("hex");

  // Constant-time compare. `!==` on hex strings short-circuits and leaks the
  // expected digest to anyone able to measure latency across many attempts.
  const provided = Buffer.from(String(razorpay_signature));
  const computed = Buffer.from(expected);
  const valid =
    provided.length === computed.length && crypto.timingSafeEqual(provided, computed);

  if (!valid) {
    return NextResponse.json({ error: "Invalid payment signature." }, { status: 400 });
  }

  // Read the authoritative tier and tenant back from Razorpay.
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  let subRes: Response;
  try {
    subRes = await fetch(
      `https://api.razorpay.com/v1/subscriptions/${encodeURIComponent(razorpay_subscription_id)}`,
      { headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(15000) }
    );
  } catch {
    return NextResponse.json(
      {
        error: `Payment succeeded but we could not confirm it. It will activate shortly — payment ID: ${razorpay_payment_id}`,
      },
      { status: 502 }
    );
  }

  if (!subRes.ok) {
    return NextResponse.json(
      { error: `Could not verify the subscription. Payment ID: ${razorpay_payment_id}` },
      { status: 502 }
    );
  }

  const sub = (await subRes.json()) as {
    id: string;
    status: string;
    current_end?: number | null;
    notes?: { tenant_id?: string; plan?: string };
  };

  const tenantId = sub.notes?.tenant_id;
  const plan = sub.notes?.plan;

  if (!tenantId || !plan) {
    return NextResponse.json(
      { error: "This subscription is not linked to an account. Contact support." },
      { status: 400 }
    );
  }

  // The signed-in user must be the one the subscription was created for.
  // Without this, a valid signature from one account could activate another.
  const session = await getSession().catch(() => null);
  if (session?.tenantId && session.tenantId !== tenantId) {
    return NextResponse.json({ error: "This subscription belongs to another account." }, { status: 403 });
  }

  const upgradeRes = await fetch(
    `${GATEWAY}/api/v1/cloud/tenants/${tenantId}/subscription`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_TOKEN}` },
      body: JSON.stringify({
        plan,
        subscription_id: sub.id,
        subscription_status: sub.status,
        // Razorpay reports seconds; the gateway wants an ISO instant.
        current_period_end: sub.current_end
          ? new Date(sub.current_end * 1000).toISOString()
          : null,
        payment_id: razorpay_payment_id,
      }),
    }
  ).catch(() => null);

  if (!upgradeRes?.ok) {
    const detail = upgradeRes ? await upgradeRes.text().catch(() => "") : "gateway unreachable";
    console.error(`[billing] activation failed: ${detail}`);
    return NextResponse.json(
      {
        error: `Payment succeeded but activation failed. Contact support@tryrepath.com with payment ID: ${razorpay_payment_id}`,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, plan });
}
