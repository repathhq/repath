import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, tenant_id } =
    await req.json();

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keySecret) {
    return NextResponse.json({ error: "Razorpay not configured" }, { status: 503 });
  }

  // Verify HMAC-SHA256 signature
  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(body)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
  }

  // Signature valid — activate plan on gateway
  const gatewayUrl = process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const apiToken  = process.env.REPATH_API_TOKEN ?? "";

  if (tenant_id && plan) {
    await fetch(`${gatewayUrl}/api/v1/cloud/tenants/${tenant_id}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
      body: JSON.stringify({
        plan,
        payment_id: razorpay_payment_id,
        payment_provider: "razorpay",
      }),
    }).catch(() => {}); // non-blocking — webhook will also fire
  }

  return NextResponse.json({
    success: true,
    payment_id: razorpay_payment_id,
    plan,
  });
}
