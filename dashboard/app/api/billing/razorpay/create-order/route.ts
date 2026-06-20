import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Plan prices in INR paise (1 INR = 100 paise)
const PLAN_PRICES: Record<string, number> = {
  starter: 409900,   // ₹4,099
  pro:     1249900,  // ₹12,499
};

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { plan, guest_email, guest_name } = body;

  const amount = PLAN_PRICES[plan];
  if (!amount) {
    return NextResponse.json({ error: "Invalid plan. Must be 'starter' or 'pro'." }, { status: 400 });
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
        notes: { tenant_id: tenantId, plan, email },
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
