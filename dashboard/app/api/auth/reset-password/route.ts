/**
 * Redeem a password reset token.
 *
 * Hashing happens here rather than in the gateway because signup and the
 * settings password change already hash here — one bcrypt implementation to
 * keep correct, and the gateway never handles a plaintext password.
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function POST(req: NextRequest) {
  const GATEWAY =
    process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

  const { token, password } = await req.json().catch(() => ({}));

  if (!token || typeof token !== "string") {
    return NextResponse.json({ error: "That reset link is not valid." }, { status: 400 });
  }
  if (!password || typeof password !== "string" || password.length < 8) {
    return NextResponse.json(
      { error: "Your new password must be at least 8 characters." },
      { status: 400 }
    );
  }

  const password_hash = await bcrypt.hash(password, 12);

  let res: Response;
  try {
    res = await fetch(`${GATEWAY}/api/v1/cloud/password-reset/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_TOKEN}`,
      },
      body: JSON.stringify({ token, password_hash }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the server. Try again in a moment." },
      { status: 502 }
    );
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    return NextResponse.json(
      {
        error:
          body?.error?.message ??
          "That reset link has expired or already been used. Request a new one.",
      },
      { status: res.status }
    );
  }

  return NextResponse.json({ ok: true });
}
