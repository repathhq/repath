/**
 * Change the signed-in user's password.
 *
 * Hashing lives here rather than in the gateway because signup already hashes
 * here — one implementation to keep correct, and the gateway never handles a
 * plaintext password.
 *
 * The current password is verified before the change. Without that, anyone who
 * got hold of a session cookie could lock the real owner out of their account.
 */
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSession } from "@/lib/auth";

const GATEWAY =
  process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const TOKEN = process.env.REPATH_API_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: { message: "Not signed in." } }, { status: 401 });
  }

  const { current_password, new_password } = await req.json();

  if (!current_password || !new_password) {
    return NextResponse.json(
      { error: { message: "Enter your current password and a new one." } },
      { status: 400 }
    );
  }
  if (new_password.length < 8) {
    return NextResponse.json(
      { error: { message: "Your new password must be at least 8 characters." } },
      { status: 400 }
    );
  }
  if (new_password === current_password) {
    return NextResponse.json(
      { error: { message: "That is the password you already have." } },
      { status: 400 }
    );
  }

  // Look up the stored hash to verify the current password.
  const lookup = await fetch(
    `${GATEWAY}/api/v1/cloud/tenants/by-email/${encodeURIComponent(session.email)}`,
    { headers: { Authorization: `Bearer ${TOKEN}` } }
  );

  if (!lookup.ok) {
    return NextResponse.json(
      { error: { message: "Could not verify your account." } },
      { status: 500 }
    );
  }

  const tenant = (await lookup.json()) as { password_hash?: string | null };
  if (!tenant.password_hash) {
    return NextResponse.json(
      { error: { message: "This account has no password set." } },
      { status: 400 }
    );
  }

  const matches = await bcrypt.compare(current_password, tenant.password_hash);
  if (!matches) {
    return NextResponse.json(
      { error: { message: "That is not your current password." } },
      { status: 403 }
    );
  }

  const password_hash = await bcrypt.hash(new_password, 12);

  const res = await fetch(`${GATEWAY}/api/v1/settings/profile`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      "X-Repath-Act-As-Tenant": session.tenantId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password_hash }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json(
      {
        error: {
          message:
            (body as { error?: { message?: string } })?.error?.message ??
            "Could not update your password.",
        },
      },
      { status: res.status }
    );
  }

  return NextResponse.json({ message: "Password updated." });
}
