import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSession, createSession, cookieOptions } from "@/lib/auth";

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
  const expectedSignature = crypto
    .createHmac("sha256", keySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expectedSignature !== razorpay_signature) {
    return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
  }

  // Resolve tenant_id: prefer the one from the order (set during create-order),
  // fall back to the current session. Reject if neither is available.
  const session = await getSession().catch(() => null);
  const resolvedTenantId: string | null = (tenant_id && tenant_id !== "guest")
    ? tenant_id
    : (session?.tenantId ?? null);

  if (!resolvedTenantId || resolvedTenantId === "guest") {
    return NextResponse.json(
      { error: "Cannot activate plan — no tenant identity. Please log in and retry." },
      { status: 400 }
    );
  }

  if (!plan) {
    return NextResponse.json({ error: "Missing plan" }, { status: 400 });
  }

  // Activate plan on gateway — this is the authoritative write
  const gatewayUrl = process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const apiToken   = process.env.REPATH_API_TOKEN ?? "";

  let upgradeRes: Response;
  try {
    upgradeRes = await fetch(
      `${gatewayUrl}/api/v1/cloud/tenants/${resolvedTenantId}/upgrade`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiToken}` },
        body: JSON.stringify({
          plan,
          payment_id: razorpay_payment_id,
          payment_provider: "razorpay",
        }),
      }
    );
  } catch (err) {
    console.error("[verify-payment] Gateway unreachable:", err);
    return NextResponse.json(
      { error: `Gateway unreachable. Your payment was successful (ID: ${razorpay_payment_id}) — plan will activate automatically within minutes via webhook.` },
      { status: 502 }
    );
  }

  if (!upgradeRes.ok) {
    const detail = await upgradeRes.text().catch(() => "");
    console.error(`[verify-payment] Gateway upgrade failed ${upgradeRes.status}: ${detail}`);
    return NextResponse.json(
      { error: `Plan activation failed (gateway ${upgradeRes.status}). Contact support with payment ID: ${razorpay_payment_id}` },
      { status: 502 }
    );
  }

  // Refresh the session cookie so the new plan is reflected immediately
  // without requiring the user to log out and back in.
  const refreshedToken = await createSession({
    tenantId: resolvedTenantId,
    email:    session?.email ?? "",
    name:     session?.name  ?? "",
    plan,
  });

  const response = NextResponse.json({
    success: true,
    payment_id: razorpay_payment_id,
    plan,
  });
  response.cookies.set({ ...cookieOptions(), value: refreshedToken });
  return response;
}
