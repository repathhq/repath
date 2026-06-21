import { NextResponse } from "next/server";
import { getSession, createSession, cookieOptions } from "@/lib/auth";

const GATEWAY   = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

// POST /api/auth/refresh-session
// Re-reads the tenant's current plan from the DB and rewrites the session cookie.
// Call this after any plan change (payment success, webhook, etc.) so the
// in-browser session reflects the real plan without requiring a re-login.
export async function POST() {
  const session = await getSession().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Fetch current plan from authoritative source (the gateway DB)
  const res = await fetch(
    `${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}/usage`,
    { headers: { "Authorization": `Bearer ${API_TOKEN}` } }
  ).catch(() => null);

  if (!res?.ok) {
    // Gateway unreachable — return the existing session unchanged
    return NextResponse.json({ plan: session.plan, refreshed: false });
  }

  const data = await res.json() as { plan?: string };
  const freshPlan = data.plan ?? session.plan;

  if (freshPlan === session.plan) {
    // Nothing changed — no need to rewrite cookie
    return NextResponse.json({ plan: freshPlan, refreshed: false });
  }

  // Plan changed — rewrite cookie with updated plan
  const newToken = await createSession({
    tenantId: session.tenantId,
    email:    session.email,
    name:     session.name,
    plan:     freshPlan,
  });

  const response = NextResponse.json({ plan: freshPlan, refreshed: true });
  response.cookies.set({ ...cookieOptions(), value: newToken });
  return response;
}
