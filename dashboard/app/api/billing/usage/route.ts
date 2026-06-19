import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const res = await fetch(
    `${GATEWAY}/api/v1/cloud/tenants/${session.tenantId}/usage`,
    { headers: { "Authorization": `Bearer ${API_TOKEN}` } }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "Failed to fetch usage" }, { status: 502 });
  }

  return NextResponse.json(await res.json());
}
