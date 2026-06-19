import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSession, cookieOptions } from "@/lib/auth";

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const { name, email, password, plan } = await req.json();

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  // Generate a short tenant ID: ten_ + 8 hex chars
  const tenantId = "ten_" + Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, "0")).join("");

  // Hash password (store in gateway DB via tenant record)
  const passwordHash = await bcrypt.hash(password, 12);

  // Create tenant in gateway
  const res = await fetch(`${GATEWAY}/api/v1/cloud/tenants`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${API_TOKEN}`,
    },
    body: JSON.stringify({ id: tenantId, name, email, password_hash: passwordHash }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const msg = (err as { error?: { message?: string } })?.error?.message ?? "Failed to create account";
    // Duplicate email check
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("duplicate")) {
      return NextResponse.json({ error: "An account with this email already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const tenant = await res.json();

  // Create session JWT
  const token = await createSession({
    tenantId: tenant.id,
    email,
    name,
    plan: tenant.plan ?? "trial",
  });

  const response = NextResponse.json({ ok: true, tenantId: tenant.id });
  response.cookies.set({ ...cookieOptions(), value: token });
  return response;
}
