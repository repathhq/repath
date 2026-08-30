"use client";

/**
 * Marketing landing page.
 *
 * Ported from the "Repath Landing v4" Claude Design canvas. Light and dark are
 * two token blocks over one set of markup (see landing.css); the toggle sets
 * `data-lp-theme` and persists the choice.
 *
 * Everything a real browser needs that a design canvas does not — hover and
 * focus states, reduced-motion, responsive collapse, real links — is in
 * landing.css or wired here, rather than approximated inline.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import "./landing.css";

// ── Interactive demo ─────────────────────────────────────────────────────
// The ladder the controller walks, and the thresholds it walks it by. These
// mirror the real defaults so the demo is not telling a different story from
// the product.
const LADDER = [0, 10, 50, 100] as const;
const ADVANCE_AT = 0.9;
const ROLLBACK_UNDER = 0.7;

interface Decision {
  action: "ADVANCE" | "ROLLBACK" | "HOLD" | "PROMOTE";
  move: string;
  reason: string;
  color: string;
  border: string;
}

const seedLog = (): Decision[] => [
  {
    action: "ADVANCE",
    move: "0% → 10%",
    reason: "gate passed · 1,204 samples",
    color: "var(--adv)",
    border: "var(--adv-line)",
  },
];

const MONO = "var(--font-geist-mono), ui-monospace, monospace";

// ── Small shared pieces ──────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 28 }}>
      <span
        className="lp-mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color: "var(--accent)",
        }}
      >
        {children}
      </span>
      <span
        style={{ flex: 1, height: 1, background: "linear-gradient(90deg, var(--line), transparent)" }}
      />
    </div>
  );
}

function ArrowRight() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ position: "relative", zIndex: 1 }}
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}

/** The primary CTA, with its travelling sheen. */
function StartFree({ delay, href = "/signup" }: { delay: string; href?: string }) {
  return (
    <Link
      href={href}
      className="lp-btn-primary"
      style={{
        position: "relative",
        overflow: "hidden",
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        height: 54,
        padding: "0 28px",
        borderRadius: 12,
        background: "var(--btn-bg)",
        color: "var(--btn-fg)",
        fontSize: 16,
        fontWeight: 550,
      }}
    >
      <span style={{ position: "relative", zIndex: 1 }}>Start free</span>
      <ArrowRight />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: 60,
          background: "linear-gradient(90deg,transparent,var(--sheen),transparent)",
          animation: `lp-sheen 4.5s ease-in-out infinite ${delay}`,
        }}
      />
    </Link>
  );
}

function Stat({
  label,
  value,
  sub,
  subColor = "var(--fg3)",
  last = false,
}: {
  label: string;
  value: string;
  sub?: string;
  subColor?: string;
  last?: boolean;
}) {
  return (
    <div style={{ padding: "16px 20px", borderRight: last ? undefined : "1px solid var(--line2)" }}>
      <div
        className="lp-mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--fg4)",
          marginBottom: 8,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span className="lp-mono" style={{ fontSize: 20, color: "var(--fg)" }}>
          {value}
        </span>
        {sub && (
          <span className="lp-mono" style={{ fontSize: 12, color: subColor }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function LogRow({
  action,
  move,
  reason,
  when,
  color,
  border,
  dim = false,
}: {
  action: string;
  move: string;
  reason: string;
  when: string;
  color: string;
  border: string;
  dim?: boolean;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr auto",
        gap: 12,
        padding: "13px 22px",
        borderTop: "1px solid var(--line2)",
        opacity: dim ? 0.6 : 1,
        background:
          action === "ROLLBACK" ? "linear-gradient(90deg, var(--roll-soft), transparent)" : undefined,
      }}
    >
      <span
        className="lp-mono"
        style={{
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: "0.08em",
          color,
          border: `1px solid ${border}`,
          borderRadius: 5,
          padding: "3px 7px",
          height: "fit-content",
        }}
      >
        {action}
      </span>
      <span className="lp-mono" style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.65 }}>
        {move}
        <br />
        <span style={{ color: "var(--fg3)" }}>{reason}</span>
      </span>
      <span className="lp-mono" style={{ fontSize: 11, color: "var(--fg4)" }}>
        {when}
      </span>
    </div>
  );
}

function FlowBox({
  children,
  accent = false,
  filled = false,
}: {
  children: React.ReactNode;
  accent?: boolean;
  filled?: boolean;
}) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: `1px solid ${accent ? "var(--accent-line)" : "var(--line)"}`,
        background: accent ? "var(--accent-soft)" : filled ? "var(--hover)" : undefined,
        padding: accent ? 18 : 16,
        textAlign: "center",
        color: "var(--fg)",
        boxSizing: "border-box",
        width: "100%",
      }}
    >
      {children}
    </div>
  );
}

function Connector({ h = 26 }: { h?: number }) {
  return <div aria-hidden="true" style={{ height: h, width: 1, background: "var(--dash)", margin: "0 auto" }} />;
}

function CodeCard({ title, code }: { title: string; code: string }) {
  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid var(--line2)",
        background: "var(--code)",
        overflow: "hidden",
      }}
    >
      <div
        className="lp-mono"
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--line2)",
          fontSize: 10,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: "var(--fg4)",
        }}
      >
        {title}
      </div>
      <pre
        className="lp-mono"
        style={{
          margin: 0,
          padding: 18,
          fontSize: 13,
          lineHeight: 1.85,
          color: "var(--fg)",
          whiteSpace: "pre-wrap",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

// ── Comparison table data ────────────────────────────────────────────────
type Cell = boolean | string;
const COMPARISON: Array<[string, Cell, Cell, Cell, Cell]> = [
  ["Canary deployments for prompts", true, "Enterprise", false, false],
  ["LLM quality evaluation", true, false, false, "View only"],
  ["Automatic rollback on quality", true, "Enterprise", false, false],
  ["Open source", true, false, true, true],
  ["Self-hostable", true, false, true, true],
  ["Price for startups", "Free", "$100K+/yr", "Free", "Free"],
];

function CompareCell({ value }: { value: Cell }) {
  if (value === true) {
    return (
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ margin: "0 auto", display: "block", stroke: "var(--adv)" }}
        role="img"
        aria-label="Yes"
      >
        <path d="M20 6 9 17l-5-5" />
      </svg>
    );
  }
  if (value === false) {
    return (
      <span className="lp-mono" style={{ fontSize: 14, color: "var(--fg5)" }} role="img" aria-label="No">
        —
      </span>
    );
  }
  return (
    <span className="lp-mono" style={{ fontSize: 12, color: "var(--fg2)" }}>
      {value}
    </span>
  );
}

// ── Theme ────────────────────────────────────────────────────────────────
// The theme lives on <html data-lp-theme>, written by a blocking inline
// script in layout.tsx before first paint — so there is no flash of the wrong
// theme on load. React subscribes to that attribute rather than owning it;
// mirroring it into state via an effect would repaint after hydration and
// reintroduce the flash the script exists to prevent.
type Theme = "light" | "dark";
const THEME_KEY = "repath-landing-theme";
const themeListeners = new Set<() => void>();

function subscribeTheme(cb: () => void) {
  themeListeners.add(cb);
  return () => themeListeners.delete(cb);
}
function readTheme(): Theme {
  return document.documentElement.dataset.lpTheme === "dark" ? "dark" : "light";
}
// The server has no DOM and no localStorage, so it always renders light —
// matching what the inline script paints before React arrives.
function readThemeOnServer(): Theme {
  return "light";
}
function writeTheme(next: Theme) {
  document.documentElement.dataset.lpTheme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private browsing, or storage disabled. Not being able to remember the
    // choice is not a reason to refuse it for this visit.
  }
  themeListeners.forEach((l) => l());
}

export default function LandingPage() {
  const theme = useSyncExternalStore(subscribeTheme, readTheme, readThemeOnServer);
  const chooseTheme = useCallback((next: Theme) => writeTheme(next), []);

  // ── Reveal on scroll ───────────────────────────────────────────────────
  //
  // Deliberately fail-safe. An earlier version hid every below-the-fold
  // section and relied on the observer to bring each back; loading a deep
  // link like /#demo scrolled past those sections before the observer was
  // watching, and they stayed at opacity 0 — a blank page. Content that
  // never animates is a small loss; content that never appears is the whole
  // page gone, so every branch here errs toward visible:
  //
  //   * a page opened at an anchor skips the effect entirely,
  //   * reduced-motion skips it,
  //   * no IntersectionObserver skips it,
  //   * and anything still hidden after a moment is revealed regardless.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>("[data-reveal]"));
    const show = (n: HTMLElement) => {
      n.style.opacity = "1";
      n.style.transform = "none";
    };

    if (
      window.location.hash ||
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    ) {
      nodes.forEach(show);
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          show(e.target as HTMLElement);
          io.unobserve(e.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.05 }
    );

    const hidden: HTMLElement[] = [];
    nodes.forEach((n) => {
      // Only hide what is genuinely below the fold — hiding what is already
      // on screen would blank the page for the time it takes to observe it.
      if (n.getBoundingClientRect().top < window.innerHeight * 0.92) return;
      n.style.transition =
        "opacity .8s cubic-bezier(.16,1,.3,1), transform .8s cubic-bezier(.16,1,.3,1)";
      n.style.opacity = "0";
      n.style.transform = "translateY(26px)";
      hidden.push(n);
      io.observe(n);
    });

    // Last resort. If the observer never fires — a mid-load scroll, a
    // restored session, a browser quirk — nothing stays invisible.
    const failsafe = window.setTimeout(() => hidden.forEach(show), 4000);

    return () => {
      io.disconnect();
      window.clearTimeout(failsafe);
    };
  }, []);

  // ── Demo state ─────────────────────────────────────────────────────────
  const [q, setQ] = useState(93);
  const [step, setStep] = useState(1);
  const [tick, setTick] = useState(12);
  const [log, setLog] = useState<Decision[]>(seedLog);
  const [countdown, setCountdown] = useState(24);

  useEffect(() => {
    const t = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 30)), 1000);
    return () => clearInterval(t);
  }, []);

  const qv = q / 100;
  const weight = LADDER[step];
  const qColor = qv >= ADVANCE_AT ? "var(--adv)" : qv < ROLLBACK_UNDER ? "var(--roll)" : "var(--fg)";

  const runTick = useCallback(() => {
    const cur = LADDER[step];
    let next = step;
    let entry: Decision;

    if (qv < ROLLBACK_UNDER) {
      next = 0;
      entry = {
        action: "ROLLBACK",
        move: `${cur}% → 0%`,
        reason: `quality ${qv.toFixed(2)} < 0.70`,
        color: "var(--roll)",
        border: "var(--roll-line)",
      };
    } else if (qv >= ADVANCE_AT) {
      if (cur === 100) {
        entry = {
          action: "PROMOTE",
          move: "100% → baseline",
          reason: "candidate is now the baseline",
          color: "var(--adv)",
          border: "var(--adv-line)",
        };
      } else {
        next = step + 1;
        entry = {
          action: "ADVANCE",
          move: `${cur}% → ${LADDER[next]}%`,
          reason: `quality ${qv.toFixed(2)} ≥ 0.90`,
          color: "var(--adv)",
          border: "var(--adv-line)",
        };
      }
    } else {
      entry = {
        action: "HOLD",
        move: `${cur}% → ${cur}%`,
        reason: `quality ${qv.toFixed(2)} between thresholds`,
        color: "var(--fg2)",
        border: "var(--line)",
      };
    }

    setStep(next);
    setTick((t) => t + 1);
    setLog((l) => [entry, ...l].slice(0, 6));
  }, [step, qv]);

  const resetDemo = useCallback(() => {
    setQ(93);
    setStep(1);
    setTick(12);
    setLog(seedLog());
  }, []);

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
    <div ref={rootRef} className="lp">
      {/* Ambient glows and grid. Decorative only. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -380,
          left: "50%",
          width: 1400,
          height: 900,
          marginLeft: -700,
          pointerEvents: "none",
          zIndex: 0,
          background: "radial-gradient(50% 50% at 50% 50%, var(--glow-a), transparent 70%)",
          filter: "blur(20px)",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 120,
          right: -200,
          width: 700,
          height: 700,
          pointerEvents: "none",
          zIndex: 0,
          background: "radial-gradient(50% 50% at 50% 50%, var(--glow-b), transparent 70%)",
          filter: "blur(30px)",
          animation: "lp-float 14s ease-in-out infinite",
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 1800,
          pointerEvents: "none",
          zIndex: 0,
          backgroundImage:
            "linear-gradient(to right, var(--grid) 1px, transparent 1px),linear-gradient(to bottom, var(--grid) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(180deg, #000, transparent 75%)",
          WebkitMaskImage: "linear-gradient(180deg, #000, transparent 75%)",
        }}
      />

      {/* ── Nav ──────────────────────────────────────────────────────── */}
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
        >
          <Link href="/" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Image src="/logo-icon.png" alt="" width={26} height={26} style={{ objectFit: "contain" }} />
            <span style={{ fontWeight: 600, fontSize: 18, letterSpacing: "-0.03em", color: "var(--fg)" }}>
              Repath
            </span>
          </Link>

          <div
            className="lp-nav-links"
            style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 14, fontWeight: 450 }}
          >
            <a className="lp-navlink" href="#how">How it works</a>
            <a className="lp-navlink" href="#demo">Live demo</a>
            <a className="lp-navlink" href="#features">Features</a>
            <a className="lp-navlink" href="#compare">Compare</a>
            <a className="lp-navlink" href="#selfhost">Self-host</a>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div
              role="group"
              aria-label="Colour theme"
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
              <button
                type="button"
                onClick={() => chooseTheme("light")}
                aria-pressed={theme === "light"}
                style={pill(theme === "light")}
              >
                light
              </button>
              <button
                type="button"
                onClick={() => chooseTheme("dark")}
                aria-pressed={theme === "dark"}
                style={pill(theme === "dark")}
              >
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

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <header
        className="lp-pad lp-hero"
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 1280,
          margin: "0 auto",
          padding: "104px 40px 0",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <div
          className="lp-mono"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            height: 34,
            padding: "0 8px 0 14px",
            borderRadius: 999,
            border: "1px solid var(--line)",
            background: "var(--chip)",
            backdropFilter: "blur(8px)",
            fontSize: 12,
            color: "var(--fg2)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "var(--adv)",
              boxShadow: "0 0 10px var(--adv)",
              animation: "lp-pulse 2s ease-in-out infinite",
            }}
          />
          <span style={{ color: "var(--fg)" }}>Controller live</span>
          <span style={{ color: "var(--fg5)" }}>·</span>
          <span>4,812 rollouts gated this week</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              height: 22,
              padding: "0 8px",
              borderRadius: 999,
              background: "var(--hover)",
              color: "var(--fg)",
            }}
          >
            v1.4
          </span>
        </div>

        <h1
          className="lp-h1"
          style={{
            fontSize: 92,
            lineHeight: 0.96,
            letterSpacing: "-0.048em",
            fontWeight: 600,
            margin: "36px 0 0",
            maxWidth: "17ch",
            animation: "lp-rise .9s cubic-bezier(.16,1,.3,1) .05s both",
          }}
        >
          Every prompt change ships behind a{" "}
          <span
            style={{
              background: "var(--grad)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
            }}
          >
            quality gate
          </span>
          .
        </h1>

        <p
          className="lp-lead"
          style={{
            fontSize: 21,
            lineHeight: 1.55,
            color: "var(--fg2)",
            margin: "28px 0 0",
            maxWidth: "60ch",
            textWrap: "pretty",
            animation: "lp-rise .9s cubic-bezier(.16,1,.3,1) .15s both",
          }}
        >
          Repath sits between your app and your model provider. It splits traffic, scores every
          response with a judge model, and pulls the candidate back to zero the moment quality
          drops — before a single user notices.
        </p>

        <div
          style={{
            display: "flex",
            gap: 12,
            marginTop: 40,
            flexWrap: "wrap",
            justifyContent: "center",
            animation: "lp-rise .9s cubic-bezier(.16,1,.3,1) .25s both",
          }}
        >
          <StartFree delay="1.2s" />
          <a
            href="#demo"
            className="lp-btn-ghost"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              height: 54,
              padding: "0 26px",
              borderRadius: 12,
              border: "1px solid var(--line)",
              background: "transparent",
              color: "var(--fg)",
              fontSize: 16,
              fontWeight: 500,
            }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Try the controller
          </a>
        </div>

        <div
          className="lp-mono"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 22,
            marginTop: 26,
            fontSize: 12,
            color: "var(--fg3)",
            flexWrap: "wrap",
            justifyContent: "center",
            animation: "lp-rise .9s cubic-bezier(.16,1,.3,1) .35s both",
          }}
        >
          <span>Free while you evaluate</span>
          <span style={{ color: "var(--fg5)" }}>·</span>
          <span>No card</span>
          <span style={{ color: "var(--fg5)" }}>·</span>
          <span>One base_url to integrate</span>
        </div>
      </header>

      {/* ── Hero figure ──────────────────────────────────────────────── */}
      <figure
        data-reveal
        className="lp-pad"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "64px auto 0", padding: "0 40px" }}
      >
        <div
          style={{
            position: "relative",
            borderRadius: 20,
            padding: 1,
            background: "var(--frame)",
            boxShadow: "var(--shadow)",
          }}
        >
          <div style={{ borderRadius: 19, background: "var(--panel-grad)", overflow: "hidden" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 16,
                padding: "14px 20px",
                borderBottom: "1px solid var(--line2)",
                flexWrap: "wrap",
              }}
            >
              <div
                className="lp-mono"
                style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 12, color: "var(--fg3)" }}
              >
                <span aria-hidden="true" style={{ display: "flex", gap: 6 }}>
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--line)" }}
                    />
                  ))}
                </span>
                <span style={{ color: "var(--fg)" }}>rollout / support-triage</span>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    height: 20,
                    padding: "0 8px",
                    borderRadius: 6,
                    border: "1px solid var(--line)",
                    color: "var(--fg2)",
                  }}
                >
                  v4 → candidate
                </span>
              </div>
              <div
                className="lp-mono"
                style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12, color: "var(--fg3)" }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--adv)" }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "var(--adv)",
                      boxShadow: "0 0 8px var(--adv)",
                      animation: "lp-pulse 2s ease-in-out infinite",
                    }}
                  />
                  live
                </span>
                <span>next tick {countdown}s</span>
              </div>
            </div>

            <div className="lp-hero-panel" style={{ display: "grid", gridTemplateColumns: "1.55fr 1fr" }}>
              <div style={{ borderRight: "1px solid var(--line2)" }}>
                <div
                  style={{
                    padding: "22px 24px 6px",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 24,
                    flexWrap: "wrap",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em" }}>
                      Judge quality score
                    </div>
                    <div className="lp-mono" style={{ fontSize: 12, color: "var(--fg3)", marginTop: 5 }}>
                      gpt-4o-mini · rolling 200-sample mean
                    </div>
                  </div>
                  <div className="lp-mono" style={{ display: "flex", gap: 22, fontSize: 12 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--fg2)" }}>
                      <span style={{ width: 16, height: 2, borderRadius: 2, background: "var(--baseline)" }} />
                      baseline
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "var(--fg2)" }}>
                      <span style={{ width: 16, height: 2, borderRadius: 2, background: "var(--accent)" }} />
                      candidate
                    </span>
                  </div>
                </div>

                <div style={{ padding: "4px 12px 0" }}>
                  <svg
                    viewBox="0 0 900 320"
                    style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
                    role="img"
                    aria-label="Candidate quality declining from 0.93 to 0.68 while baseline holds near 0.92, with a rollback marked at 0.68."
                  >
                    <defs>
                      <linearGradient id="candFill4" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.22" />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[30, 78, 126, 174, 222].map((y) => (
                      <line key={y} x1="60" y1={y} x2="860" y2={y} style={{ stroke: "var(--hair)", strokeWidth: 1 }} />
                    ))}
                    <line x1="60" y1="270" x2="860" y2="270" style={{ stroke: "var(--line2)", strokeWidth: 1 }} />
                    {[
                      [34, "1.00"], [82, "0.90"], [130, "0.80"], [178, "0.70"], [226, "0.60"], [274, "0.50"],
                    ].map(([y, t]) => (
                      <text key={t} x="48" y={y as number} textAnchor="end" fontFamily="var(--font-geist-mono), monospace" fontSize="11" style={{ fill: "var(--fg4)" }}>
                        {t}
                      </text>
                    ))}
                    <line x1="60" y1="78" x2="860" y2="78" strokeDasharray="5 6" style={{ stroke: "var(--adv)", strokeWidth: 1, opacity: 0.8 }} />
                    <line x1="60" y1="174" x2="860" y2="174" strokeDasharray="5 6" style={{ stroke: "var(--roll)", strokeWidth: 1, opacity: 0.8 }} />
                    <text x="866" y="75" fontFamily="var(--font-geist-mono), monospace" fontSize="11" style={{ fill: "var(--adv)" }}>advance ≥ 0.90</text>
                    <text x="866" y="171" fontFamily="var(--font-geist-mono), monospace" fontSize="11" style={{ fill: "var(--roll)" }}>rollback &lt; 0.70</text>

                    <path
                      d="M260,58.3 L310,59.8 L360,62.6 L410,67.9 L460,76.6 L510,88.6 L560,104.4 L610,120.2 L660,139.9 L710,162.5 L760,183.1 L760,270 L260,270 Z"
                      fill="url(#candFill4)"
                      style={{ animation: "lp-fade 1.2s ease-out 1.1s both" }}
                    />
                    <polyline
                      points="60,67.9 110,69.4 160,66 210,70.8 260,64.6 310,68.9 360,67.4 410,63.6 460,70.3 510,66.5 560,68.4 610,65 660,69.4 710,67 760,67.9 810,65.5 860,68.9"
                      fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="2000" strokeDashoffset="2000"
                      style={{ stroke: "var(--baseline)", strokeWidth: 2, animation: "lp-draw 1.6s cubic-bezier(.4,0,.2,1) .35s forwards" }}
                    />
                    <polyline
                      points="260,58.3 310,59.8 360,62.6 410,67.9 460,76.6 510,88.6 560,104.4 610,120.2 660,139.9 710,162.5 760,183.1"
                      fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray="2000" strokeDashoffset="2000"
                      style={{ stroke: "var(--accent)", strokeWidth: 2.5, animation: "lp-draw 1.5s cubic-bezier(.4,0,.2,1) .75s forwards" }}
                    />
                    <g style={{ animation: "lp-fade .6s ease-out 2.1s both" }}>
                      <line x1="760" y1="183.1" x2="760" y2="284" strokeDasharray="3 4" style={{ stroke: "var(--roll)", strokeWidth: 1 }} />
                      <circle cx="760" cy="183.1" r="10" style={{ fill: "var(--roll)", opacity: 0.16 }} />
                      <circle cx="760" cy="183.1" r="4.5" style={{ fill: "var(--roll)" }} />
                      <rect x="638" y="196" width="126" height="24" rx="6" style={{ fill: "var(--roll-soft)", stroke: "var(--roll-line)" }} />
                      <text x="701" y="212" textAnchor="middle" fontFamily="var(--font-geist-mono), monospace" fontSize="11" style={{ fill: "var(--roll)" }}>0.68 → rollback</text>
                    </g>
                    <circle cx="860" cy="68.9" r="4" style={{ fill: "var(--baseline)" }} />
                    {[["60", "14:00", "start"], ["260", "14:16", "middle"], ["460", "14:32", "middle"], ["660", "14:48", "middle"], ["860", "15:04", "end"]].map(([x, t, anchor]) => (
                      <text key={t} x={x} y="292" textAnchor={anchor === "start" ? undefined : (anchor as "middle" | "end")} fontFamily="var(--font-geist-mono), monospace" fontSize="11" style={{ fill: "var(--fg4)" }}>
                        {t}
                      </text>
                    ))}
                  </svg>
                </div>

                <div
                  className="lp-stats"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(4,1fr)",
                    borderTop: "1px solid var(--line2)",
                    marginTop: 14,
                  }}
                >
                  <Stat label="Quality" value="0.92" sub="0.68" subColor="var(--roll)" />
                  <Stat label="P95 latency" value="812" sub="ms" />
                  <Stat label="Error rate" value="0.00" sub="%" />
                  <Stat label="Samples judged" value="14,208" last />
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ padding: "22px 22px 12px", fontSize: 15, fontWeight: 550, letterSpacing: "-0.01em" }}>
                  Controller decisions
                </div>
                <div style={{ flex: 1 }}>
                  <LogRow action="ROLLBACK" move="50% → 0%" reason="quality 0.68 < 0.70" when="now" color="var(--roll)" border="var(--roll-line)" />
                  <LogRow action="HOLD" move="50% → 50%" reason="quality 0.72, drifting down" when="2m" color="var(--fg2)" border="var(--line)" />
                  <LogRow action="ADVANCE" move="10% → 50%" reason="quality 0.93 ≥ 0.90" when="18m" color="var(--adv)" border="var(--adv-line)" />
                  <LogRow action="ADVANCE" move="0% → 10%" reason="gate passed · 1,204 samples" when="44m" color="var(--adv)" border="var(--adv-line)" />
                  <LogRow action="START" move="rollout created" reason="baseline gpt-4o pinned" when="1h" color="var(--fg2)" border="var(--line)" dim />
                </div>
                <div
                  className="lp-mono"
                  style={{ padding: "14px 22px", borderTop: "1px solid var(--line2)", fontSize: 11, color: "var(--fg4)", lineHeight: 1.6 }}
                >
                  Written to postgres with the metrics that caused it
                </div>
              </div>
            </div>
          </div>
        </div>
        <figcaption
          className="lp-mono"
          style={{ fontSize: 11.5, color: "var(--fg4)", marginTop: 16, textAlign: "center" }}
        >
          A candidate degrading at constant latency and zero errors — caught and pulled at 0.68
        </figcaption>
      </figure>

      {/* ── Logo marquee ─────────────────────────────────────────────── */}
      <section
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "96px auto 0", padding: "0 40px" }}
      >
        <div
          className="lp-mono"
          style={{
            textAlign: "center",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--fg4)",
            marginBottom: 34,
          }}
        >
          Gating production traffic at
        </div>
        <div
          style={{
            position: "relative",
            overflow: "hidden",
            maskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)",
            WebkitMaskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)",
          }}
        >
          <div style={{ display: "flex", gap: 56, width: "max-content", animation: "lp-marquee 32s linear infinite" }}>
            {[0, 1].map((group) => (
              <div key={group} aria-hidden={group === 1} style={{ display: "flex", gap: 56, alignItems: "center" }}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className="lp-mono"
                    style={{
                      width: 150,
                      height: 44,
                      border: "1px dashed var(--line)",
                      borderRadius: 8,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 10,
                      color: "var(--fg5)",
                    }}
                  >
                    logo
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 01 The silent failure mode ───────────────────────────────── */}
      <section
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "120px auto 0", padding: "0 40px" }}
      >
        <SectionLabel>01 — The silent failure mode</SectionLabel>
        <h2 className="lp-h2" style={{ fontSize: 56, lineHeight: 1.03, letterSpacing: "-0.04em", fontWeight: 600, margin: 0, maxWidth: "24ch" }}>
          Nothing errors. Nothing alerts. The answers just get worse.
        </h2>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 52 }}>
          {[
            {
              stat: "97.6 → 2.4%",
              title: "Accuracy fell off a cliff",
              body: "A 2023 Stanford study measured GPT-4's accuracy on one coding task dropping from 97.6% to 2.4% inside a month. The API returned 200 the entire time.",
            },
            {
              stat: "0 errors",
              title: "Your dashboards stay green",
              body: "Status codes, latency and error rates are blind to quality. A regression that halves usefulness looks identical to a clean deploy.",
            },
            {
              stat: "34 days",
              title: "Found by customers, not by you",
              body: "A subtle prompt edit degraded responses for over a month before anyone tied the support tickets back to the deploy that caused them.",
            },
          ].map((c) => (
            <div
              key={c.title}
              className="lp-card lp-card-warn"
              style={{ borderRadius: 16, border: "1px solid var(--line2)", background: "var(--card)", padding: 28 }}
            >
              <div className="lp-mono" style={{ fontSize: 34, letterSpacing: "-0.03em", color: "var(--roll)", marginBottom: 18 }}>
                {c.stat}
              </div>
              <h3 style={{ fontSize: 18, fontWeight: 550, letterSpacing: "-0.015em", margin: "0 0 10px" }}>{c.title}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.65, color: "var(--fg2)", margin: 0 }}>{c.body}</p>
            </div>
          ))}
        </div>
        <p style={{ margin: "44px 0 0", fontSize: 30, lineHeight: 1.3, letterSpacing: "-0.03em", fontWeight: 500, maxWidth: "34ch", color: "var(--fg)" }}>
          Feature flags tell you the code deployed. Repath tells you whether it{" "}
          <span style={{ color: "var(--accent)" }}>worked</span>.
        </p>
      </section>

      {/* ── 02 How it works ──────────────────────────────────────────── */}
      <section
        id="how"
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "120px auto 0", padding: "0 40px" }}
      >
        <SectionLabel>02 — How it works</SectionLabel>
        <div className="lp-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start" }}>
          <h2 className="lp-h2" style={{ fontSize: 56, lineHeight: 1.03, letterSpacing: "-0.04em", fontWeight: 600, margin: 0 }}>
            One line in. A gate around every change.
          </h2>
          <p className="lp-lead" style={{ fontSize: 19, lineHeight: 1.6, color: "var(--fg2)", margin: 0, maxWidth: "46ch", textWrap: "pretty" }}>
            Point your existing SDK at Repath. Routing, recording, judging and deciding all happen off
            the request path — the Rust gateway adds under 2ms, and nothing in your hot path waits on
            an evaluation.
          </p>
        </div>

        <div style={{ marginTop: 44, borderRadius: 16, border: "1px solid var(--line2)", background: "var(--panel)", overflow: "hidden" }}>
          <div
            className="lp-mono"
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 20px", borderBottom: "1px solid var(--line2)", fontSize: 11, color: "var(--fg4)" }}
          >
            <span>python</span>
            <span>the entire integration</span>
          </div>
          <div className="lp-mono" style={{ padding: "22px 24px", fontSize: 14, lineHeight: 2, overflowX: "auto" }}>
            <div style={{ color: "var(--fg5)" }}># before</div>
            <div style={{ color: "var(--fg)", whiteSpace: "nowrap" }}>
              client = <span style={{ color: "var(--accent)" }}>OpenAI</span>(api_key=
              <span style={{ color: "var(--adv)" }}>&quot;sk-…&quot;</span>)
            </div>
            <div style={{ color: "var(--fg5)", marginTop: 12 }}># after</div>
            <div style={{ color: "var(--fg)", whiteSpace: "nowrap" }}>
              client = <span style={{ color: "var(--accent)" }}>OpenAI</span>(api_key=
              <span style={{ color: "var(--adv)" }}>&quot;sk-…&quot;</span>, base_url=
              <span style={{ color: "var(--adv)" }}>&quot;https://api.tryrepath.com/v1&quot;</span>)
            </div>
          </div>
        </div>

        {/* Architecture flow */}
        <div style={{ marginTop: 20, borderRadius: 16, border: "1px solid var(--line2)", background: "var(--panel-grad)", padding: "40px 32px" }}>
          <div className="lp-mono" style={{ maxWidth: 920, margin: "0 auto", display: "flex", flexDirection: "column", alignItems: "stretch", fontSize: 12 }}>
            <FlowBox filled>
              YOUR APP<span style={{ color: "var(--fg3)" }}> · base_url = api.tryrepath.com/v1</span>
            </FlowBox>
            <Connector />
            <FlowBox accent>
              <div style={{ textAlign: "center", letterSpacing: "0.08em", color: "var(--accent-strong)", marginBottom: 16 }}>
                REPATH GATEWAY · rust / axum · &lt;2ms
              </div>
              <div className="lp-flow-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <div style={{ borderRadius: 10, border: "1px solid var(--line)", padding: 14, textAlign: "center", lineHeight: 1.9, color: "var(--fg)" }}>
                  TRAFFIC ROUTER<br />
                  <span style={{ color: "var(--fg3)" }}>90% baseline · 10% candidate</span>
                </div>
                <div style={{ borderRadius: 10, border: "1px solid var(--line)", padding: 14, textAlign: "center", lineHeight: 1.9, color: "var(--fg)" }}>
                  REQUEST RECORDER<br />
                  <span style={{ color: "var(--fg3)" }}>async · never blocks</span>
                </div>
              </div>
            </FlowBox>
            <div className="lp-flow-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Connector />
                <FlowBox>
                  OPENAI · ANTHROPIC · GEMINI · OPENROUTER<br />
                  <span style={{ color: "var(--fg3)" }}>baseline and candidate</span>
                </FlowBox>
                <div style={{ flex: 1 }} />
                <div style={{ fontSize: 11, color: "var(--fg4)", padding: "16px 0 0", textAlign: "center", lineHeight: 1.7 }}>
                  response returns immediately<br />evaluation happens beside it
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <Connector />
                <FlowBox>
                  REDIS STREAM<span style={{ color: "var(--fg3)" }}> · eval-queue</span>
                </FlowBox>
                <Connector h={18} />
                <FlowBox>
                  PYTHON EVALUATOR<br />
                  <span style={{ color: "var(--fg3)" }}>checks + gpt-4o-mini judge</span>
                </FlowBox>
                <Connector h={18} />
                <FlowBox>
                  POSTGRES 16<span style={{ color: "var(--fg3)" }}> · scores</span>
                </FlowBox>
                <Connector h={18} />
                <FlowBox filled>
                  RUST CONTROLLER<span style={{ color: "var(--fg3)" }}> · every 30s</span><br />
                  <span style={{ color: "var(--adv)" }}>≥ 0.90 advance</span>{" "}
                  <span style={{ color: "var(--fg5)" }}>/</span>{" "}
                  <span style={{ color: "var(--roll)" }}>&lt; 0.70 rollback</span>
                </FlowBox>
              </div>
            </div>
          </div>
        </div>

        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20, marginTop: 20 }}>
          {[
            ["01", "Drop-in replacement", "Change a base URL. Keep the provider SDK you already use."],
            ["02", "Traffic splitting", "Send a slice of real requests to the new prompt or model. Both sides scored on identical criteria."],
            ["03", "Automatic rollback", "Below threshold, candidate weight goes to zero on the next tick. No pager, no human."],
          ].map(([n, title, body]) => (
            <div key={n} style={{ borderRadius: 14, border: "1px solid var(--line2)", padding: 24 }}>
              <div className="lp-mono" style={{ fontSize: 11, color: "var(--accent)", marginBottom: 12 }}>{n}</div>
              <h3 style={{ fontSize: 17, fontWeight: 550, letterSpacing: "-0.015em", margin: "0 0 8px" }}>{title}</h3>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg2)", margin: 0 }}>{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── 03 Live demo ─────────────────────────────────────────────── */}
      <section
        id="demo"
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "120px auto 0", padding: "0 40px" }}
      >
        <SectionLabel>03 — Live demo</SectionLabel>
        <div className="lp-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start", marginBottom: 44 }}>
          <h2 className="lp-h2" style={{ fontSize: 56, lineHeight: 1.03, letterSpacing: "-0.04em", fontWeight: 600, margin: 0 }}>
            Move the score. Watch the controller decide.
          </h2>
          <p className="lp-lead" style={{ fontSize: 19, lineHeight: 1.6, color: "var(--fg2)", margin: 0, maxWidth: "46ch" }}>
            This runs the real decision rule: advance at 0.90, hold between, rollback under 0.70. Drag
            the score and step the controller through the ladder.
          </p>
        </div>

        <div
          className="lp-demo"
          style={{
            borderRadius: 20,
            border: "1px solid var(--line2)",
            background: "var(--panel-grad)",
            overflow: "hidden",
            display: "grid",
            gridTemplateColumns: "1.05fr 1fr",
          }}
        >
          <div style={{ borderRight: "1px solid var(--line2)", padding: 32 }}>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 20 }}>
              <label
                htmlFor="lp-quality"
                className="lp-mono"
                style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg4)" }}
              >
                Candidate quality score
              </label>
              <div className="lp-mono" style={{ fontSize: 44, lineHeight: 1, letterSpacing: "-0.03em", color: qColor, transition: "color .3s" }}>
                {qv.toFixed(2)}
              </div>
            </div>
            <input
              id="lp-quality"
              className="lp-range"
              type="range"
              min={0}
              max={100}
              step={1}
              value={q}
              onChange={(e) => setQ(Number(e.target.value))}
              aria-valuetext={qv.toFixed(2)}
            />
            <div className="lp-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 10.5, color: "var(--fg4)", marginBottom: 36 }}>
              <span>0.00</span>
              <span style={{ color: "var(--roll)" }}>0.70 rollback</span>
              <span style={{ color: "var(--adv)" }}>0.90 advance</span>
              <span>1.00</span>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
              <div className="lp-mono" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg4)" }}>
                Traffic to candidate
              </div>
              <div className="lp-mono" style={{ fontSize: 11, color: "var(--fg3)" }}>step {step} of 3</div>
            </div>
            <div
              className="lp-mono"
              style={{ display: "flex", height: 44, borderRadius: 10, overflow: "hidden", border: "1px solid var(--line)", fontSize: 12 }}
              role="img"
              aria-label={`${100 - weight}% baseline, ${weight}% candidate`}
            >
              <div style={{ background: "var(--hover)", color: "var(--fg)", display: "flex", alignItems: "center", justifyContent: "center", transition: "flex 800ms cubic-bezier(.16,1,.3,1)", flex: 100 - weight || 0.0001, minWidth: 0, overflow: "hidden" }}>
                {weight <= 88 ? `${100 - weight}%` : ""}
              </div>
              <div style={{ background: "var(--accent)", color: "var(--btn-fg)", display: "flex", alignItems: "center", justifyContent: "center", transition: "flex 800ms cubic-bezier(.16,1,.3,1)", flex: weight || 0.0001, minWidth: 0, overflow: "hidden" }}>
                {weight >= 12 ? `${weight}%` : ""}
              </div>
            </div>
            <div className="lp-mono" style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--fg4)", marginTop: 10 }}>
              <span>baseline gpt-4o</span>
              <span>candidate v4</span>
            </div>

            <div style={{ display: "flex", gap: 12, marginTop: 36, flexWrap: "wrap" }}>
              <button
                type="button"
                onClick={runTick}
                className="lp-btn-primary"
                style={{ height: 46, padding: "0 22px", border: "none", borderRadius: 10, background: "var(--btn-bg)", color: "var(--btn-fg)", fontFamily: "inherit", fontSize: 15, fontWeight: 550, cursor: "pointer" }}
              >
                Run controller tick
              </button>
              <button
                type="button"
                onClick={resetDemo}
                className="lp-btn-ghost"
                style={{ height: 46, padding: "0 22px", border: "1px solid var(--line)", borderRadius: 10, background: "transparent", color: "var(--fg)", fontFamily: "inherit", fontSize: 15, fontWeight: 500, cursor: "pointer" }}
              >
                Reset
              </button>
            </div>
          </div>

          <div style={{ padding: 32, display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 18 }}>
              <div className="lp-mono" style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg4)" }}>
                Decision log
              </div>
              <div className="lp-mono" style={{ fontSize: 11, color: "var(--fg3)" }}>tick #{tick}</div>
            </div>
            <div style={{ flex: 1, minHeight: 300 }} aria-live="polite">
              {log.map((d, i) => (
                <div
                  key={`${tick}-${i}`}
                  style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: 14, padding: "14px 0", borderTop: "1px solid var(--line2)", alignItems: "start", animation: "lp-rise .5s cubic-bezier(.16,1,.3,1) both" }}
                >
                  <span
                    className="lp-mono"
                    style={{ fontSize: 10, fontWeight: 500, letterSpacing: "0.08em", color: d.color, border: `1px solid ${d.border}`, borderRadius: 5, padding: "3px 7px", whiteSpace: "nowrap" }}
                  >
                    {d.action}
                  </span>
                  <span className="lp-mono" style={{ fontSize: 12, color: "var(--fg)", lineHeight: 1.7 }}>
                    {d.move}
                    <br />
                    <span style={{ color: "var(--fg3)" }}>{d.reason}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── 04 What it does ──────────────────────────────────────────── */}
      <section
        id="features"
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "120px auto 0", padding: "0 40px" }}
      >
        <SectionLabel>04 — What it does</SectionLabel>
        <h2 className="lp-h2" style={{ fontSize: 56, lineHeight: 1.03, letterSpacing: "-0.04em", fontWeight: 600, margin: "0 0 52px", maxWidth: "22ch" }}>
          Four primitives. Everything else is configuration.
        </h2>

        <div className="lp-cards-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
          {[
            {
              n: "4.1",
              title: "Canary deployments for prompts",
              body: "Ladder a new version 10% → 50% → 100%. Every step carries its own gate, and the controller — not a human on a Friday — decides whether it passes.",
              file: "rollout.yaml",
              code: 'steps:\n  - weight: 10\n    gate:\n      quality_score: ">= 0.9"\n  - weight: 100',
            },
            {
              n: "4.2",
              title: "A judge model scores every response",
              body: "Describe what good looks like in plain English. Repath scores each response with gpt-4o-mini plus your programmatic checks. No metric schemas to design.",
              file: "judge.yaml",
              code: "judge_prompt: |\n  Score this response 0-1.\n  Criteria: accuracy, clarity,\n  relevance to the query.",
            },
            {
              n: "4.3",
              title: "Rollback in under 500ms",
              body: "When the rolling score crosses your threshold, candidate weight is zero before the next request is routed. Not eventually — on that tick.",
              file: "controller.yaml",
              code: "controller:\n  check_interval: 30s\n  rollback_threshold: 0.7\n  action: instant",
            },
            {
              n: "4.4",
              title: "Every decision is auditable",
              body: 'Advance, hold, rollback, promote — each stored with the exact metrics that triggered it. Enough to answer "why did this change?" months later.',
              file: "decisions · postgres",
              code: '{\n  "action": "rollback",\n  "reason": "quality 0.68 < 0.70",\n  "previous_weight": 50,\n  "new_weight": 0\n}',
            },
          ].map((f) => (
            <div key={f.n} className="lp-card" style={{ borderRadius: 18, border: "1px solid var(--line2)", background: "var(--card)", padding: 30 }}>
              <div className="lp-mono" style={{ fontSize: 11, color: "var(--accent)", marginBottom: 16 }}>{f.n}</div>
              <h3 style={{ fontSize: 26, lineHeight: 1.15, letterSpacing: "-0.028em", fontWeight: 600, margin: "0 0 12px" }}>{f.title}</h3>
              <p style={{ fontSize: 16, lineHeight: 1.65, color: "var(--fg2)", margin: "0 0 24px", maxWidth: "44ch" }}>{f.body}</p>
              <CodeCard title={f.file} code={f.code} />
            </div>
          ))}
        </div>
      </section>

      {/* ── 05 Compared ──────────────────────────────────────────────── */}
      <section
        id="compare"
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "120px auto 0", padding: "0 40px" }}
      >
        <SectionLabel>05 — Compared</SectionLabel>
        <h2 className="lp-h2" style={{ fontSize: 56, lineHeight: 1.03, letterSpacing: "-0.04em", fontWeight: 600, margin: "0 0 44px", maxWidth: "24ch" }}>
          Flags ship it. Observability watches it. Repath decides.
        </h2>
        <div className="lp-table-wrap" style={{ borderRadius: 18, border: "1px solid var(--line2)", overflow: "hidden", background: "var(--panel-grad)" }}>
          <table className="lp-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 15 }}>
            <thead>
              <tr>
                <th className="lp-mono" style={{ textAlign: "left", padding: "18px 24px", borderBottom: "1px solid var(--line2)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg4)", fontWeight: 400 }}>
                  Capability
                </th>
                <th style={{ textAlign: "center", padding: "18px 24px", borderBottom: "1px solid var(--line2)", fontSize: 15, fontWeight: 600, color: "var(--fg)", background: "var(--accent-soft)" }}>
                  Repath
                </th>
                {["LaunchDarkly", "LiteLLM", "Langfuse"].map((n) => (
                  <th key={n} className="lp-mono" style={{ textAlign: "center", padding: "18px 24px", borderBottom: "1px solid var(--line2)", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--fg4)", fontWeight: 400 }}>
                    {n}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARISON.map(([feature, a, b, c, d]) => (
                <tr key={feature}>
                  <td style={{ padding: "17px 24px", borderBottom: "1px solid var(--hair)", color: "var(--fg)" }}>{feature}</td>
                  <td style={{ padding: "17px 24px", borderBottom: "1px solid var(--hair)", textAlign: "center", background: "var(--accent-soft)" }}>
                    <CompareCell value={a} />
                  </td>
                  <td style={{ padding: "17px 24px", borderBottom: "1px solid var(--hair)", textAlign: "center" }}><CompareCell value={b} /></td>
                  <td style={{ padding: "17px 24px", borderBottom: "1px solid var(--hair)", textAlign: "center" }}><CompareCell value={c} /></td>
                  <td style={{ padding: "17px 24px", borderBottom: "1px solid var(--hair)", textAlign: "center" }}><CompareCell value={d} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── 06 Self-host ─────────────────────────────────────────────── */}
      <section
        id="selfhost"
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "120px auto 0", padding: "0 40px" }}
      >
        <SectionLabel>06 — Self-host</SectionLabel>
        <div className="lp-split" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 64, alignItems: "start", marginBottom: 44 }}>
          <h2 className="lp-h2" style={{ fontSize: 56, lineHeight: 1.03, letterSpacing: "-0.04em", fontWeight: 600, margin: 0 }}>
            Running locally in 60 seconds.
          </h2>
          <p className="lp-lead" style={{ fontSize: 19, lineHeight: 1.6, color: "var(--fg2)", margin: 0, maxWidth: "46ch" }}>
            The hosted product is the same code. BSL 1.1, converting to Apache 2.0 after four years —
            self-host it forever if you&rsquo;d rather.
          </p>
        </div>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 20 }}>
          {[
            ["01", "Clone and configure", "git clone github.com/repathhq/repath\ncd repath && cp .env.example .env"],
            ["02", "Start the stack", "docker compose up\n# gateway :8080 · console :3000"],
            ["03", "Create a rollout", "repath rollout create \\\n  -f examples/demo-canary.yaml"],
          ].map(([n, title, code]) => (
            <div key={n} style={{ borderRadius: 16, border: "1px solid var(--line2)", padding: 26 }}>
              <div className="lp-mono" style={{ fontSize: 11, color: "var(--accent)", marginBottom: 14 }}>{n}</div>
              <h3 style={{ fontSize: 18, fontWeight: 550, letterSpacing: "-0.015em", margin: "0 0 18px" }}>{title}</h3>
              <pre
                className="lp-mono"
                style={{ margin: 0, padding: 16, borderRadius: 10, border: "1px solid var(--line2)", background: "var(--code)", fontSize: 12.5, lineHeight: 1.85, color: "var(--fg)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}
              >
                {code}
              </pre>
            </div>
          ))}
        </div>
        <div className="lp-mono" style={{ marginTop: 32, fontSize: 13 }}>
          <Link href="/docs" className="lp-doclink">Read the full documentation →</Link>
        </div>
      </section>

      {/* ── Closing CTA ──────────────────────────────────────────────── */}
      <section
        data-reveal
        className="lp-pad lp-section"
        style={{ position: "relative", zIndex: 1, maxWidth: 1280, margin: "140px auto 0", padding: "0 40px 140px" }}
      >
        <div
          className="lp-cta-box"
          style={{ position: "relative", overflow: "hidden", borderRadius: 24, border: "1px solid var(--line)", background: "var(--cta)", padding: "88px 56px", textAlign: "center" }}
        >
          <div
            aria-hidden="true"
            style={{ position: "absolute", bottom: -320, left: "50%", width: 900, height: 600, marginLeft: -450, background: "radial-gradient(50% 50% at 50% 50%, var(--glow-a), transparent 70%)", filter: "blur(20px)", pointerEvents: "none" }}
          />
          <div style={{ position: "relative" }}>
            <h2 className="lp-h2-cta" style={{ fontSize: 64, lineHeight: 1.02, letterSpacing: "-0.045em", fontWeight: 600, margin: "0 auto", maxWidth: "22ch" }}>
              Ship the next prompt change without holding your breath.
            </h2>
            <p className="lp-lead" style={{ fontSize: 19, lineHeight: 1.6, color: "var(--fg2)", margin: "24px auto 0", maxWidth: "52ch" }}>
              Connect a base URL, define one gate, and let the controller hold the line. Free while you
              evaluate.
            </p>
            <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 40, flexWrap: "wrap" }}>
              <StartFree delay="2s" />
              <Link
                href="/contact"
                className="lp-btn-ghost"
                style={{ display: "inline-flex", alignItems: "center", height: 54, padding: "0 26px", borderRadius: 12, border: "1px solid var(--line)", color: "var(--fg)", fontSize: 16, fontWeight: 500 }}
              >
                Talk to an engineer
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────────────── */}
      <footer style={{ position: "relative", zIndex: 1, borderTop: "1px solid var(--line2)", padding: "56px 0 40px" }}>
        <div className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "0 40px" }}>
          <div className="lp-foot" style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 48 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <Image src="/logo-icon.png" alt="" width={22} height={22} style={{ objectFit: "contain" }} />
                <span style={{ fontWeight: 600, letterSpacing: "-0.03em" }}>Repath</span>
              </div>
              <p style={{ fontSize: 14, lineHeight: 1.65, color: "var(--fg3)", margin: "0 0 10px", maxWidth: "34ch" }}>
                Progressive delivery for AI. Canary rollouts, quality gates and automatic rollback for
                prompts and models.
              </p>
              <p className="lp-mono" style={{ fontSize: 11, color: "var(--fg5)", margin: 0 }}>Rust · Python · BSL 1.1</p>
            </div>
            {[
              { h: "Product", links: [["Docs", "/docs"], ["Pricing", "/pricing"], ["Status", "/status"], ["GitHub", "https://github.com/repathhq/repath"]] },
              { h: "Company", links: [["About", "/about"], ["Careers", "/careers"], ["Contact", "/contact"]] },
              { h: "Legal", links: [["Terms", "/terms"], ["Privacy", "/privacy"]] },
            ].map((col) => (
              <div key={col.h}>
                <h4 className="lp-mono" style={{ fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--fg4)", fontWeight: 400, margin: "0 0 16px" }}>
                  {col.h}
                </h4>
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 11, fontSize: 14 }}>
                  {col.links.map(([label, href]) => (
                    <li key={label}>
                      <Link href={href} className="lp-footlink">{label}</Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div
            className="lp-mono"
            style={{ borderTop: "1px solid var(--line2)", marginTop: 44, paddingTop: 22, display: "flex", justifyContent: "space-between", gap: 24, fontSize: 11, color: "var(--fg5)", flexWrap: "wrap" }}
          >
            <span>© {new Date().getFullYear()} Repath</span>
            <span>tryrepath.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
