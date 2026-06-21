import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let res: Response;
  try {
    res = await fetch(
      `${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}/usage`,
      {
        headers: { "Authorization": `Bearer ${API_TOKEN}` },
        signal: AbortSignal.timeout(5000),
      }
    );
  } catch {
    // Gateway unreachable — return plan from session as fallback
    return NextResponse.json({
      plan: session.plan,
      eval_quota_monthly: 0,
      evals_used: 0,
      evals_remaining: 0,
      usage_percent: 0,
      trial_active: session.plan === "trial",
      trial_ends_at: null,
      active: true,
      _fallback: true,
    });
  }

  if (!res.ok) {
    return NextResponse.json({
      plan: session.plan,
      eval_quota_monthly: 0,
      evals_used: 0,
      evals_remaining: 0,
      usage_percent: 0,
      trial_active: session.plan === "trial",
      trial_ends_at: null,
      active: true,
      _fallback: true,
    });
  }

  return NextResponse.json(await res.json());
}
