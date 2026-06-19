import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

// Paddle price IDs (set these after creating products in Paddle dashboard)
const PADDLE_PRICES: Record<string, string> = {
  starter: process.env.PADDLE_PRICE_STARTER ?? "",
  pro: process.env.PADDLE_PRICE_PRO ?? "",
};

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plan } = await req.json();
  const priceId = PADDLE_PRICES[plan];
  if (!priceId) {
    return NextResponse.json({ error: "Invalid plan or Paddle price not configured" }, { status: 400 });
  }

  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Paddle not configured" }, { status: 503 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Create Paddle checkout session
  const res = await fetch("https://api.paddle.com/transactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      items: [{ price_id: priceId, quantity: 1 }],
      customer: { email: session.email },
      custom_data: {
        tenant_id: session.tenantId,
        plan,
      },
      checkout: {
        url: `${appUrl}/billing/success?plan=${plan}`,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json();
    return NextResponse.json({ error: "Failed to create checkout", detail: err }, { status: 500 });
  }

  const tx = await res.json() as { data: { checkout?: { url?: string }; id: string } };
  const checkoutUrl = tx.data?.checkout?.url;

  return NextResponse.json({
    checkoutUrl,
    transactionId: tx.data?.id,
  });
}
