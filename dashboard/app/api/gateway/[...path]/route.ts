/**
 * Gateway proxy route — forwards requests to the Repath gateway,
 * injecting the server-side API token so it never leaks to the browser.
 *
 * All dashboard API calls go through here:
 *   /api/gateway/rollouts → gateway /api/v1/rollouts
 *   /api/gateway/system/health → gateway /api/v1/system/health
 */
import { NextRequest, NextResponse } from "next/server";

const GATEWAY = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const TOKEN   = process.env.REPATH_API_TOKEN ?? "";

async function proxy(req: NextRequest, path: string) {
  const url  = `${GATEWAY}/api/v1/${path}`;
  const init: RequestInit = {
    method:  req.method,
    headers: { "Authorization": `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const res  = await fetch(url, init);
    const body = await res.text();
    return new NextResponse(body, {
      status:  res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: { message: `Gateway unreachable: ${e}` } },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}
