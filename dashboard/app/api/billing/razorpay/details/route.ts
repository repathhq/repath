/**
 * What Billing shows about the money side of a subscription: the payment
 * method on file, the next charge, and every invoice with its receipt.
 *
 * Read from Razorpay on each request rather than from our tables. Our
 * `payments` table records the first charge, made at checkout; renewals are
 * charged by Razorpay on its own schedule and only appear there. Razorpay's
 * invoices are the complete record, and each has a hosted receipt page.
 *
 * The subscription id comes from the account on the server, never from the
 * request, so one customer cannot read another's billing.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import type { BillingDetails, PaymentMethod } from "@/lib/billing";

type RazorpayInvoice = {
  id: string;
  status: string;
  amount: number;
  amount_paid: number;
  currency: string;
  date: number | null;
  paid_at: number | null;
  billing_start: number | null;
  billing_end: number | null;
  short_url: string | null;
  payment_id: string | null;
};

type RazorpayPayment = {
  method: string;
  vpa?: string | null;
  bank?: string | null;
  wallet?: string | null;
  card?: { last4?: string; network?: string; type?: string; issuer?: string | null } | null;
};

const iso = (s: number | null | undefined) => (s ? new Date(s * 1000).toISOString() : null);

function describe(p: RazorpayPayment): PaymentMethod {
  switch (p.method) {
    case "card": {
      const network = p.card?.network && p.card.network !== "Unknown" ? p.card.network : "Card";
      return { method: "card", label: p.card?.last4 ? `${network} ending ${p.card.last4}` : network, changeable: true };
    }
    case "upi":
      return { method: "upi", label: p.vpa ? `UPI · ${p.vpa}` : "UPI AutoPay", changeable: false };
    case "emandate":
    case "netbanking":
      return { method: p.method, label: p.bank ? `Bank mandate · ${p.bank}` : "Bank mandate", changeable: false };
    case "wallet":
      return { method: "wallet", label: p.wallet ? `Wallet · ${p.wallet}` : "Wallet", changeable: false };
    default:
      return { method: p.method, label: p.method, changeable: false };
  }
}

export async function GET() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

  const session = await getSession().catch(() => null);
  if (!session?.tenantId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const empty: BillingDetails = { key_id: keyId ?? null, subscription: null, payment_method: null, invoices: [] };

  const usage = await fetch(`${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}/usage`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` },
    signal: AbortSignal.timeout(10000),
  })
    .then((r) => (r.ok ? (r.json() as Promise<{ subscription_id?: string | null }>) : null))
    .catch(() => null);
  const subscriptionId = usage?.subscription_id;
  if (!subscriptionId || !keyId || !keySecret) {
    return NextResponse.json(empty);
  }

  const auth = { Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}` };
  const get = <T,>(path: string) =>
    fetch(`https://api.razorpay.com/v1/${path}`, { headers: auth, signal: AbortSignal.timeout(15000) })
      .then((r) => (r.ok ? (r.json() as Promise<T>) : null))
      .catch(() => null);

  const id = encodeURIComponent(subscriptionId);
  const [sub, invoiceList] = await Promise.all([
    get<{ id: string; status: string; charge_at: number | null; current_end: number | null; payment_method?: string | null }>(`subscriptions/${id}`),
    get<{ items: RazorpayInvoice[] }>(`invoices?subscription_id=${id}&count=50`),
  ]);

  if (!sub) {
    return NextResponse.json({ ...empty, error: "Could not reach Razorpay. Showing what we have." }, { status: 200 });
  }

  const invoices = (invoiceList?.items ?? [])
    .filter((inv) => inv.status !== "draft")
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));

  // The method on file is the one the latest paid invoice was charged to.
  const lastPaid = invoices.find((inv) => inv.status === "paid" && inv.payment_id);
  const payment = lastPaid?.payment_id
    ? await get<RazorpayPayment>(`payments/${encodeURIComponent(lastPaid.payment_id)}?expand[]=card`)
    : null;

  const details: BillingDetails = {
    key_id: keyId,
    subscription: {
      id: sub.id,
      status: sub.status,
      charge_at: iso(sub.charge_at),
      current_end: iso(sub.current_end),
      payment_method: sub.payment_method ?? null,
    },
    payment_method: payment ? describe(payment) : null,
    invoices: invoices.map((inv) => ({
      id: inv.id,
      status: inv.status,
      amount_minor: inv.status === "paid" ? inv.amount_paid : inv.amount,
      currency: inv.currency,
      date: iso(inv.paid_at ?? inv.date),
      period_start: iso(inv.billing_start),
      period_end: iso(inv.billing_end),
      receipt_url: inv.short_url,
    })),
  };
  return NextResponse.json(details);
}
