import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Plan prices in INR paise (1 INR = 100 paise)
const PLAN_PRICES: Record<string, number> = {
  starter: 409900,   // ₹4,099
  pro: 1249900,      // ₹12,499
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plan } = await req.json();
  const amount = PLAN_PRICES[plan];
  if (!amount) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return NextResponse.json({ error: "Razorpay not configured" }, { status: 503 });
  }

  // Create Razorpay order
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Basic ${credentials}`,
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `repath_${session.tenantId}_${Date.now()}`,
      notes: {
        tenant_id: session.tenantId,
        plan,
        email: session.email,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: "Failed to create order", detail: err }, { status: 500 });
  }

  const order = await res.json() as { id: string; amount: number; currency: string };
  return NextResponse.json({
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId,
    tenantId: session.tenantId,
    email: session.email,
    name: session.name,
    plan,
    testMode: keyId.startsWith("rzp_test_"),
  });
}
