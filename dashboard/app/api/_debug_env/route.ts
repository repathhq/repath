// TEMPORARY diagnostic route — reveals presence/length only, never values.
// Deployed to find out why REPATH_API_TOKEN isn't reaching Amplify SSR
// runtime. Delete once the real cause is found.
import { NextResponse } from "next/server";

export async function GET() {
  const keys = Object.keys(process.env).filter(
    (k) => !k.startsWith("npm_") && !k.startsWith("_")
  );
  return NextResponse.json({
    REPATH_API_TOKEN_present: "REPATH_API_TOKEN" in process.env,
    REPATH_API_TOKEN_length: process.env.REPATH_API_TOKEN?.length ?? -1,
    NEXT_PUBLIC_API_URL_value: process.env.NEXT_PUBLIC_API_URL ?? null,
    JWT_SECRET_present: "JWT_SECRET" in process.env,
    total_env_keys: keys.length,
    sample_keys: keys.sort().slice(0, 60),
    has_repath_prefixed: keys.filter((k) => k.startsWith("REPATH_") || k.startsWith("NEXT_PUBLIC_")),
  });
}
