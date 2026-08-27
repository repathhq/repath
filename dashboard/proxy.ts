import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

const PROTECTED = ["/rollouts", "/routing", "/billing", "/settings", "/onboarding"];
const AUTH_PAGES = ["/login", "/signup"];

/**
 * Route guard for authenticated pages.
 *
 * Named `proxy` rather than `middleware`: Next.js 16 deprecated the
 * `middleware` filename and export in favour of `proxy`, to make the network
 * boundary explicit. Behaviour is unchanged.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtected = PROTECTED.some(p => pathname === p || pathname.startsWith(p + "/"));
  const isAuthPage  = AUTH_PAGES.some(p => pathname === p || pathname.startsWith(p + "/"));

  const token = req.cookies.get("repath_session")?.value ?? null;
  const session = token ? await verifySession(token) : null;

  if (isProtected && !session) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && session) {
    const dashboardUrl = req.nextUrl.clone();
    dashboardUrl.pathname = "/rollouts";
    dashboardUrl.searchParams.delete("next");
    return NextResponse.redirect(dashboardUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/rollouts/:path*",
    "/routing/:path*",
    "/billing/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/login",
    "/signup",
  ],
};
