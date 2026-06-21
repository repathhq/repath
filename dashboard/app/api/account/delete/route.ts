import { NextRequest, NextResponse } from "next/server";
import { getSession, cookieOptions } from "@/lib/auth";

const GATEWAY   = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

export async function POST(req: NextRequest) {
  const session = await getSession().catch(() => null);
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { confirmation } = await req.json();
  if (confirmation !== "delete my account") {
    return NextResponse.json({ error: "Confirmation text does not match" }, { status: 400 });
  }

  const res = await fetch(
    `${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}`,
    {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${API_TOKEN}` },
    }
  ).catch(() => null);

  if (!res?.ok) {
    const detail = res ? await res.text().catch(() => "") : "Gateway unreachable";
    return NextResponse.json(
      { error: `Failed to delete account. ${detail}` },
      { status: 502 }
    );
  }

  // Clear session cookie
  const response = NextResponse.json({ success: true });
  response.cookies.set({ ...cookieOptions(), value: "", maxAge: 0 });
  return response;
}
