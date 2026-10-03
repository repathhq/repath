import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, MarketingShell } from "@/components/marketing/Marketing";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <MarketingShell>
      <section className="lp-pad" style={{ maxWidth: 760, margin: "0 auto", padding: "120px 40px 160px" }}>
        <div className="lp-mono" style={{ fontSize: 12, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--roll)" }}>
          404 · rolled back
        </div>
        <h1 className="lp-h1" style={{ fontSize: 56, lineHeight: 1.04, letterSpacing: "-0.04em", fontWeight: 600, margin: "20px 0 0" }}>
          This page isn&apos;t here.
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, color: "var(--fg2)", margin: "20px 0 0", maxWidth: "48ch" }}>
          The link may be old, or the address mistyped. These are the places most people are looking for:
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 32 }}>
          <Link
            href="/"
            className="lp-btn-primary"
            style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 46, padding: "0 20px", borderRadius: 11, background: "var(--btn-bg)", color: "var(--btn-fg)", fontSize: 15, fontWeight: 550 }}
          >
            Home <ArrowRight />
          </Link>
          {[
            ["Docs", "/docs"],
            ["Pricing", "/pricing"],
            ["Sign in", "/login"],
          ].map(([label, href]) => (
            <Link
              key={href}
              href={href}
              className="lp-btn-ghost"
              style={{ display: "inline-flex", alignItems: "center", height: 46, padding: "0 20px", borderRadius: 11, border: "1px solid var(--line)", fontSize: 15, fontWeight: 550 }}
            >
              {label}
            </Link>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
