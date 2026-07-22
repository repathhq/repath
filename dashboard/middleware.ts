import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

const PROTECTED = ["/rollouts", "/billing", "/settings", "/onboarding"];
const AUTH_PAGES = ["/login", "/signup"];

export async function middleware(req: NextRequest) {
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
    "/billing/:path*",
    "/settings/:path*",
    "/onboarding/:path*",
    "/login",
    "/signup",
  ],
};
