import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession, cookieOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  // Read per-request, not at module load: on Amplify's SSR compute a
  // top-level `const` can get frozen at cold start before env vars are
  // fully injected, silently baking in an empty token forever.
  const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
  const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

  const { email, password } = await req.json();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  // Fetch tenant by email from gateway
  const res = await fetch(
    `${GATEWAY}/api/v1/cloud/tenants/by-email/${encodeURIComponent(email)}`,
    { headers: { "Authorization": `Bearer ${API_TOKEN}` } }
  );

  if (!res.ok) {
    // Generic error — don't reveal whether email exists
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const tenant = await res.json() as {
    id: string; name: string; email: string; plan: string; password_hash?: string;
  };

  if (!tenant.password_hash) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, tenant.password_hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const token = await createSession({
    tenantId: tenant.id,
    email: tenant.email,
    name: tenant.name,
    plan: tenant.plan,
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set({ ...cookieOptions(), value: token });
  return response;
}
