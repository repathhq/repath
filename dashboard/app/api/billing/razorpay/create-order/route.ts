import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Plan prices in INR paise (1 INR = 100 paise)
const PLAN_PRICES: Record<string, number> = {
  indie:   169900,   // ₹1,699  ($20)
  starter: 409900,   // ₹4,099  ($49)
  pro:     1249900,  // ₹12,499 ($149)
};

/**
 * The internal testing coupon, which charges a flat ₹1.
 *
 * The code lives in REPATH_TEST_COUPON, never in this file. A previous
 * version hardcoded it here, which put a working code for the ₹12,499 plan
 * into a public repository — anyone reading the source could buy Pro for one
 * rupee, repeatedly, forever. If the variable is unset no coupon is accepted
 * at all, so a deployment that forgets it fails closed rather than open.
 *
 * Rotate by changing the environment variable and redeploying; nothing else
 * needs to change.
 */
function resolveTestCoupon(submitted: string): boolean {
  const configured = process.env.REPATH_TEST_COUPON?.trim();
  if (!configured) return false;
  // Length check first so the comparison below can't be used as an oracle.
  if (submitted.length !== configured.length) return false;
  let diff = 0;
  for (let i = 0; i < configured.length; i++) {
    diff |= submitted.charCodeAt(i) ^ configured.charCodeAt(i);
  }
  return diff === 0;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { plan, guest_email, guest_name, coupon } = body;

  const baseAmount = PLAN_PRICES[plan];
  if (!baseAmount) {
    return NextResponse.json(
      { error: "Invalid plan. Must be 'indie', 'starter' or 'pro'." },
      { status: 400 }
    );
  }

  // Apply coupon if provided
  let amount = baseAmount;
  let appliedCoupon: string | null = null;
  if (coupon && typeof coupon === "string") {
    const submitted = coupon.trim();
    if (!resolveTestCoupon(submitted)) {
      return NextResponse.json({ error: "Invalid coupon code." }, { status: 400 });
    }
    amount = 100; // ₹1
    appliedCoupon = "test";
    // Redemptions are logged so an unexpected one is visible after the fact.
    console.warn(`[billing] test coupon redeemed for plan=${plan}`);
  }

  const keyId     = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Razorpay not configured — RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET missing" }, { status: 503 });
  }

  // Try to get logged-in session; fall back to guest info from request body
  const session  = await getSession().catch(() => null);
  const tenantId = session?.tenantId ?? "guest";
  const email    = session?.email    ?? guest_email ?? "";
  const name     = session?.name     ?? guest_name  ?? "";

  // Guard: check live plan from DB to prevent double-purchase (session cookie may be stale)
  if (session && tenantId !== "guest") {
    const gatewayUrl = process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
    const apiToken   = process.env.REPATH_API_TOKEN ?? "";
    const usageRes = await fetch(
      `${gatewayUrl}/api/v1/cloud/tenants/${tenantId}/usage`,
      { headers: { "Authorization": `Bearer ${apiToken}` } }
    ).catch(() => null);
    if (usageRes?.ok) {
      const usage = await usageRes.json() as { plan?: string };
      if (usage.plan === plan) {
        return NextResponse.json(
          { error: `You are already on the ${plan} plan.` },
          { status: 409 }
        );
      }
    }
  }

  // Create Razorpay order
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  let rzpRes: Response;
  try {
    rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Basic ${credentials}`,
      },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt:  `repath_${tenantId}_${Date.now()}`.slice(0, 40),
        notes: { tenant_id: tenantId, plan, email, ...(appliedCoupon && { coupon: appliedCoupon }) },
      }),
    });
  } catch (e) {
    return NextResponse.json(
      { error: "Could not reach Razorpay API", detail: String(e) },
      { status: 502 }
    );
  }

  if (!rzpRes.ok) {
    const err = await rzpRes.json().catch(() => ({}));
    console.error("Razorpay order creation failed:", err);
    return NextResponse.json(
      { error: "Razorpay order creation failed", detail: err },
      { status: 500 }
    );
  }

  const order = await rzpRes.json() as { id: string; amount: number; currency: string };

  return NextResponse.json({
    orderId:  order.id,
    amount:   order.amount,
    currency: order.currency,
    keyId,                                      // safe — public key only
    tenantId,
    email,
    name,
    plan,
    testMode: keyId.startsWith("rzp_test_"),
  });
}
