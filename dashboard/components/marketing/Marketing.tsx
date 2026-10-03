"use client";

/**
 * The public site's frame: navigation, footer, theme, and the small pieces
 * every marketing page shares.
 *
 * Extracted from the landing page so every public page is one product in
 * both themes. Before this, /pricing, /docs, /about and the rest each had
 * their own hand-rolled nav and footer, light-only, in an older visual
 * language — a visitor clicking "Pricing" from the landing page landed on
 * a different-looking site.
 */

import Image from "next/image";
import Link from "next/link";
import { useTheme } from "@/lib/theme";
import "@/app/landing.css";

export const MONO = "var(--font-geist-mono), ui-monospace, monospace";

// ── Navigation ───────────────────────────────────────────────────────────

/** Links for pages other than the landing page, which passes its own anchors. */
export const SITE_LINKS: Array<[label: string, href: string]> = [
  ["How it works", "/#how"],
  ["Features", "/#features"],
  ["Pricing", "/pricing"],
  ["Docs", "/docs"],
];

export function MarketingNav({ links = SITE_LINKS }: { links?: Array<[string, string]> }) {
  const [theme, setTheme] = useTheme();

  const pill = (active: boolean) => ({
    border: "none",
    cursor: "pointer",
    height: 26,
    padding: "0 11px",
    borderRadius: 999,
    fontFamily: MONO,
    fontSize: 11,
    letterSpacing: "0.02em",
    transition: "background .25s, color .25s",
    background: active ? "var(--btn-bg)" : "transparent",
    color: active ? "var(--btn-fg)" : "var(--fg2)",
  });

  return (
    <nav
      style={{
        position: "sticky",
        top: 0,
        zIndex: 80,
        background: "var(--nav)",
        backdropFilter: "blur(18px) saturate(160%)",
        WebkitBackdropFilter: "blur(18px) saturate(160%)",
        borderBottom: "1px solid var(--line2)",
      }}
    >
      <div
        className="lp-pad"
        style={{
          maxWidth: 1280,
          margin: "0 auto",
          padding: "16px 40px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 32,
        }}
        data-nav-row
      >
        <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Image src="/repath-mark.png" alt="" width={26} height={26} style={{ objectFit: "contain" }} />
          <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.03em", color: "var(--fg)" }}>
            Repath
          </span>
        </Link>

        <div
          className="lp-nav-links"
          style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 450 }}
        >
          {links.map(([label, href]) =>
            href.startsWith("#") ? (
              <a key={href} className="lp-navlink" href={href}>
                {label}
              </a>
            ) : (
              <Link key={href} className="lp-navlink" href={href}>
                {label}
              </Link>
            ),
          )}
        </div>

        <div className="lp-nav-actions" style={{ display: "flex", alignItems: "center", gap: 14, whiteSpace: "nowrap" }}>
          <div
            role="group"
            aria-label="Colour theme"
            className="lp-theme-pill"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              padding: 3,
              borderRadius: 999,
              border: "1px solid var(--line2)",
              background: "var(--chip)",
            }}
          >
            <button type="button" onClick={() => setTheme("light")} aria-pressed={theme === "light"} style={pill(theme === "light")}>
              light
            </button>
            <button type="button" onClick={() => setTheme("dark")} aria-pressed={theme === "dark"} style={pill(theme === "dark")}>
              dark
            </button>
          </div>
          <Link href="/login" style={{ fontSize: 14, fontWeight: 450, color: "var(--fg2)" }}>
            Sign in
          </Link>
          <Link
            href="/signup"
            className="lp-btn-primary"
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 38,
              padding: "0 18px",
              borderRadius: 10,
              background: "var(--btn-bg)",
              color: "var(--btn-fg)",
              fontSize: 14,
              fontWeight: 550,
            }}
          >
            Start free
          </Link>
        </div>
      </div>
    </nav>
  );
}

// ── Footer ───────────────────────────────────────────────────────────────

export function MarketingFooter() {
  return (
    <footer style={{ position: "relative", zIndex: 1, borderTop: "1px solid var(--line2)", padding: "56px 0 40px" }}>
      <div className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px" }}>
        <div className="lp-foot" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48 }}>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <Image src="/repath-mark.png" alt="" width={22} height={22} style={{ objectFit: "contain" }} />
              <span style={{ fontWeight: 600, letterSpacing: "-0.03em" }}>Repath</span>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--fg3)", margin: "0 0 10px", maxWidth: "34ch" }}>
              Progressive delivery for AI. Canary rollouts, quality gates and automatic rollback for prompts and
              models.
            </p>
            <p className="lp-mono" style={{ fontSize: 11, color: "var(--fg5)", margin: 0 }}>
              Rust · Python · BSL 1.1
            </p>
          </div>
          {[
            {
              h: "Product",
              links: [
                ["Docs", "/docs"],
                ["Pricing", "/pricing"],
                ["Status", "/status"],
                ["GitHub", "https://github.com/repathhq/repath"],
              ],
            },
            {
              h: "Company",
              links: [
                ["About", "/about"],
                ["Careers", "/careers"],
                ["Contact", "/contact"],
              ],
            },
            {
              h: "Legal",
              links: [
                ["Terms", "/terms"],
                ["Privacy", "/privacy"],
              ],
            },
          ].map((col) => (
            <div key={col.h}>
              <h4
                className="lp-mono"
                style={{
                  fontSize: 10,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: "var(--fg4)",
                  fontWeight: 400,
                  margin: "0 0 16px",
                }}
              >
                {col.h}
              </h4>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11, fontSize: 14 }}>
                {col.links.map(([label, href]) => (
                  <li key={label}>
                    <Link href={href} className="lp-footlink">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div
          className="lp-mono"
          style={{
            borderTop: "1px solid var(--line2)",
            marginTop: 44,
            paddingTop: 22,
            display: "flex",
            justifyContent: "space-between",
            gap: 24,
            fontSize: 11,
            color: "var(--fg5)",
            flexWrap: "wrap",
          }}
        >
          <span>© {new Date().getFullYear()} Repath</span>
          <span>tryrepath.com</span>
        </div>
      </div>
    </footer>
  );
}

// ── Shell for every public page except the landing page ─────────────────

export function MarketingShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp" style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* The landing page's grid, quieter: these pages are for reading. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 720,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage:
            "linear-gradient(to right, var(--grid) 1px, transparent 1px),linear-gradient(to bottom, var(--grid) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(180deg, #000, transparent 80%)",
          WebkitMaskImage: "linear-gradient(180deg, #000, transparent 80%)",
        }}
      />
      <MarketingNav />
      <main style={{ position: "relative", zIndex: 1, flex: 1 }}>{children}</main>
      <MarketingFooter />
    </div>
  );
}

// ── Shared pieces ────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
      <span className="lp-mono" style={{ fontSize: 11, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--accent)" }}>
        {children}
      </span>
      <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg, var(--line), transparent)" }} />
    </div>
  );
}

/** The opening of a marketing page: eyebrow, headline, lead. */
export function PageHero({
  eyebrow,
  title,
  lead,
  children,
  narrow = false,
}: {
  eyebrow: string;
  title: React.ReactNode;
  lead?: React.ReactNode;
  children?: React.ReactNode;
  narrow?: boolean;
}) {
  return (
    <header
      className="lp-pad"
      style={{ maxWidth: narrow ? 860 : 1280, margin: "0 auto", padding: "88px 40px 0" }}
    >
      <SectionLabel>{eyebrow}</SectionLabel>
      <h1
        className="lp-h2"
        style={{
          fontSize: 52,
          lineHeight: 1.04,
          letterSpacing: "-0.04em",
          fontWeight: 600,
          margin: "0 0 18px",
          maxWidth: "18ch",
          textWrap: "balance",
        }}
      >
        {title}
      </h1>
      {lead && (
        <p className="lp-lead" style={{ fontSize: 19, lineHeight: 1.55, color: "var(--fg2)", margin: 0, maxWidth: "60ch" }}>
          {lead}
        </p>
      )}
      {children}
    </header>
  );
}

/** A bordered, softly filled surface — the landing page's card. */
export function Card({
  children,
  style,
  hover = false,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  hover?: boolean;
}) {
  return (
    <div
      className={hover ? "lp-card" : undefined}
      style={{
        border: "1px solid var(--line2)",
        borderRadius: 18,
        background: "var(--card)",
        padding: 28,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ArrowRight({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

export function Check({ color = "var(--adv)" }: { color?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0, marginTop: 3 }}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
