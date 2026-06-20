import { NextResponse } from "next/server";

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const API_TOKEN = process.env.REPATH_API_TOKEN ?? "";

export async function GET() {
  try {
    const res = await fetch(`${GATEWAY}/api/v1/system/providers`, {
      headers: { "Authorization": `Bearer ${API_TOKEN}` },
      next: { revalidate: 30 }, // cache 30s
    });
    if (!res.ok) return NextResponse.json({ providers: [] });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json({ providers: [] });
  }
}
