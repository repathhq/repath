import { NextResponse } from "next/server";
import { cookieOptions } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({ ...cookieOptions(), value: "", maxAge: 0 });
  return response;
}
