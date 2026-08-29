/**
 * Start a recurring subscription.
 *
 * Replaces the one-time Order flow, under which a single payment bought a plan
 * permanently: nothing stored a period end, no renewal ever ran, and monthly
 * recurring revenue was in practice one-time revenue.
 *
 * A Razorpay Subscription sets up a mandate, so renewals are charged
 * automatically. The reconciler in the controller polls subscription state and
 * downgrades a tenant whose period has lapsed.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { PLANS, INTERNAL_TEST_PLAN_ID, isPlanId } from "@/lib/plans";

/** Billing cycles requested up front. Razorpay requires a finite count; 120
 *  is ten years, i.e. "until cancelled" for any practical purpose. */
const TOTAL_CYCLES = 120;

/**
 * The internal testing coupon. The code lives in REPATH_TEST_COUPON, never in
 * this file — a previous version hardcoded it, publishing a working discount
 * for the ₹12,499 plan to a public repository. Unset means no coupon is
 * accepted, so a deployment that forgets it fails closed.
 */
function isTestCoupon(submitted: string): boolean {
  const configured = process.env.REPATH_TEST_COUPON?.trim();
  if (!configured) return false;
  if (submitted.length !== configured.length) return false;
  let diff = 0;
  for (let i = 0; i < configured.length; i++) {
    diff |= submitted.charCodeAt(i) ^ configured.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) {
    return NextResponse.json(
      { error: "Payments are not configured on this deployment." },
      { status: 503 }
    );
  }

  const { plan, coupon } = await req.json().catch(() => ({}));

  if (!isPlanId(plan)) {
    return NextResponse.json(
      { error: "Invalid plan. Must be 'indie', 'starter' or 'pro'." },
      { status: 400 }
    );
  }

  // A subscription is billed to an identity, so unlike the old guest-friendly
  // order flow this requires being signed in. Otherwise there is no account to
  // attach the mandate to, and a renewal months later would have nowhere to go.
  const session = await getSession().catch(() => null);
  if (!session?.tenantId) {
    return NextResponse.json(
      { error: "Sign in before subscribing." },
      { status: 401 }
    );
  }

  let razorpayPlanId = PLANS[plan].razorpayPlanId;
  let appliedCoupon: string | null = null;

  if (coupon && typeof coupon === "string") {
    if (!isTestCoupon(coupon.trim())) {
      return NextResponse.json({ error: "Invalid coupon code." }, { status: 400 });
    }
    // Swap to the ₹1 plan but keep the requested tier's quota, so the whole
    // recurring path is exercised cheaply.
    razorpayPlanId = INTERNAL_TEST_PLAN_ID;
    appliedCoupon = "test";
    console.warn(`[billing] test coupon redeemed for plan=${plan}`);
  }

  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  let res: Response;
  try {
    res = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({
        plan_id: razorpayPlanId,
        total_count: TOTAL_CYCLES,
        customer_notify: 1,
        // Read back on activation to decide which quota to grant. The tier is
        // taken from here rather than from the client on the callback, so a
        // tampered callback cannot claim a plan that was never paid for.
        notes: {
          tenant_id: session.tenantId,
          plan,
          ...(appliedCoupon && { coupon: appliedCoupon }),
        },
      }),
      signal: AbortSignal.timeout(15000),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not reach Razorpay.", detail: String(e) },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    console.error("[billing] subscription creation failed:", detail);
    return NextResponse.json(
      { error: "Could not start the subscription.", detail },
      { status: 502 }
    );
  }

  const sub = (await res.json()) as { id: string; status: string };

  return NextResponse.json({
    subscriptionId: sub.id,
    status: sub.status,
    keyId, // publishable key — safe for the browser
    plan,
    planName: PLANS[plan].name,
    amountMinor: appliedCoupon ? 100 : PLANS[plan].amountMinor,
    email: session.email,
    name: session.name,
    tenantId: session.tenantId,
  });
}
