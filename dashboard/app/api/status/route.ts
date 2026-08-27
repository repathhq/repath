/**
 * Public status feed for /status.
 *
 * Deliberately unauthenticated — a status page nobody can read while signed
 * out is useless, since the times people check it are exactly the times they
 * cannot get in.
 *
 * It reports what it actually observes. The previous page was a hardcoded list
 * that always read "All systems operational", which is worse than having no
 * status page at all: during a real outage it would confidently say everything
 * was fine.
 */
import { NextResponse } from "next/server";

const GATEWAY =
  process.env.REPATH_GATEWAY_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

type ServiceStatus = "operational" | "degraded" | "down" | "unknown";

interface Service {
  name: string;
  status: ServiceStatus;
  detail: string;
}

export const dynamic = "force-dynamic";

export async function GET() {
  const services: Service[] = [];
  let gatewayReachable = false;

  const started = Date.now();
  try {
    const res = await fetch(`${GATEWAY}/ready`, {
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    const latency = Date.now() - started;
    const body = (await res.json().catch(() => ({}))) as {
      dependencies?: { database?: string; redis?: string };
    };

    gatewayReachable = true;

    services.push({
      name: "Gateway API",
      status: res.ok ? "operational" : "degraded",
      detail: `${latency}ms`,
    });
    services.push({
      name: "Database",
      status: body.dependencies?.database === "ok" ? "operational" : "down",
      detail: body.dependencies?.database === "ok" ? "reachable" : "unreachable",
    });
    services.push({
      name: "Redis",
      status: body.dependencies?.redis === "ok" ? "operational" : "down",
      detail: body.dependencies?.redis === "ok" ? "reachable" : "unreachable",
    });
  } catch {
    // The gateway is what serves customer traffic, so if it cannot be reached
    // everything behind it is unknown rather than assumed fine.
    services.push({ name: "Gateway API", status: "down", detail: "no response" });
    services.push({ name: "Database", status: "unknown", detail: "cannot check" });
    services.push({ name: "Redis", status: "unknown", detail: "cannot check" });
  }

  // This route is served by the dashboard, so reaching it proves the dashboard
  // is up. Saying anything else would be self-contradictory.
  services.push({ name: "Dashboard", status: "operational", detail: "serving" });

  const worst: ServiceStatus = services.some((s) => s.status === "down")
    ? "down"
    : services.some((s) => s.status === "degraded")
      ? "degraded"
      : services.some((s) => s.status === "unknown")
        ? "unknown"
        : "operational";

  const headline =
    worst === "operational"
      ? "All systems operational"
      : worst === "degraded"
        ? "Degraded performance"
        : worst === "down"
          ? "Service disruption"
          : "Status partially unknown";

  return NextResponse.json({
    headline,
    overall: worst,
    services,
    gateway_reachable: gatewayReachable,
    checked_at: new Date().toISOString(),
  });
}
