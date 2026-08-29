/**
 * Request a password reset link.
 *
 * Answers identically whether or not the address has an account — the gateway
 * does the same. Any difference in status, body or timing here would turn this
 * into a way to test which email addresses are customers.
 */
import { NextRequest, NextResponse } from "next/server";

const SAME_ANSWER = {
  message: "If that address has an account, a reset link is on its way.",
};

export async function POST(req: NextRequest) {
  // Read per-request, not at module load: on Amplify's SSR compute a
  // top-level `const` can get frozen at cold start before env vars are
  // fully injected, silently baking in an empty token forever.
  const GATEWAY =
    process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

  const { email } = await req.json().catch(() => ({ email: null }));

  if (!email || typeof email !== "string") {
    return NextResponse.json({ error: "Enter your email address." }, { status: 400 });
  }

  try {
    await fetch(`${GATEWAY}/api/v1/cloud/password-reset/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Deliberately swallowed. Telling the caller the gateway is unreachable
    // reveals nothing useful to them and everything to someone probing.
    // The gateway logs the real failure.
  }

  return NextResponse.json(SAME_ANSWER);
}
