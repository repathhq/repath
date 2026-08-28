// TEMPORARY diagnostic route — reveals a SHA-256 hash only, never the value.
// Used to compare the Amplify-baked REPATH_API_TOKEN against the gateway's
// live value without ever exposing either. Delete once diagnosed.
import { NextResponse } from "next/server";
import { createHash } from "crypto";

export async function GET() {
  const token = process.env.REPATH_API_TOKEN ?? "";
  const hash = createHash("sha256").update(token + "\n").digest("hex");
  return NextResponse.json({ REPATH_API_TOKEN_sha256: hash, length: token.length });
}
