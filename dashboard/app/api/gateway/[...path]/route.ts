/**
 * Gateway proxy — forwards dashboard API calls to the Repath gateway.
 *
 * Every request is scoped to the signed-in user's tenant. This route holds the
 * operator token (server-side only, never sent to the browser) and tells the
 * gateway which tenant to act as via `X-Repath-Act-As-Tenant`, derived from the
 * session cookie rather than from anything the client can set.
 *
 * This scoping is the reason the route exists. An earlier version forwarded the
 * same operator token for every user with no tenant scope at all, so any signed-
 * in customer could list, read, promote, roll back and delete every other
 * customer's rollouts — including their system prompts.
 *
 *   /api/gateway/rollouts            -> gateway /api/v1/rollouts
 *   /api/gateway/system/health       -> gateway /api/v1/system/health
 */
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

/** Paths any signed-in user may read; they expose no tenant-owned data. */
const UNSCOPED_PATHS = new Set(["system/health", "system/providers"]);

async function proxy(req: NextRequest, path: string) {
  // Read per-request, not at module load: on Amplify's SSR compute a
  // top-level `const` can get frozen at cold start before env vars are
  // fully injected, silently baking in an empty token forever.
  const GATEWAY =
    process.env.REPATH_GATEWAY_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:8080";
  const TOKEN = process.env.REPATH_API_TOKEN ?? "";

  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: { message: "Not signed in." } },
      { status: 401 }
    );
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
  };

  // Scope to the session's tenant. System endpoints stay unscoped because they
  // report gateway health rather than anything a tenant owns.
  if (!UNSCOPED_PATHS.has(path)) {
    headers["X-Repath-Act-As-Tenant"] = session.tenantId;
  }

  const init: RequestInit = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.text();
  }

  try {
    const res = await fetch(`${GATEWAY}/api/v1/${path}`, init);
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: { message: `Gateway unreachable: ${e}` } },
      { status: 502 }
    );
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}

export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const { path } = await params;
  return proxy(req, path.join("/"));
}
