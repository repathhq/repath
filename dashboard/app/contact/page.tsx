"use client";

/**
 * Contact.
 *
 * Every channel here was checked to exist: the mailbox, and the public
 * repository's issues. A "GitHub Discussions" card was removed — Discussions
 * are disabled on the repository, so the link was a 404.
 */

import { ArrowRight, MarketingShell, PageHero } from "@/components/marketing/Marketing";

const CHANNELS: Array<{ title: string; detail: string; note: string; href: string; action: string }> = [
  {
    title: "Questions and support",
    detail: "hello@tryrepath.com",
    note: "A person replies, usually within a day.",
    href: "mailto:hello@tryrepath.com",
    action: "Email us",
  },
  {
    title: "Enterprise and self-hosting",
    detail: "hello@tryrepath.com",
    note: "Volume, invoicing, or running Repath in your own network — we'll set up a call.",
    href: "mailto:hello@tryrepath.com?subject=Enterprise",
    action: "Start a conversation",
  },
  {
    title: "Bugs and feature requests",
    detail: "github.com/repathhq/repath",
    note: "Open an issue on the public repository.",
    href: "https://github.com/repathhq/repath/issues",
    action: "Open an issue",
  },
];

export default function ContactPage() {
  return (
    <MarketingShell>
      <PageHero eyebrow="Contact" title="Talk to the people who build it." lead="Repath is a small team, so your message reaches someone who can actually change things." />
      <section className="lp-pad" style={{ maxWidth: 1280, margin: "0 auto", padding: "64px 40px 120px" }}>
        <div className="lp-cards-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20 }}>
          {CHANNELS.map((c) => (
            <a
              key={c.title}
              href={c.href}
              target={c.href.startsWith("http") ? "_blank" : undefined}
              rel={c.href.startsWith("http") ? "noopener noreferrer" : undefined}
              className="lp-card"
              style={{ border: "1px solid var(--line2)", borderRadius: 18, background: "var(--card)", padding: 28, display: "flex", flexDirection: "column", gap: 10, color: "var(--fg)" }}
            >
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{c.title}</h2>
              <span className="lp-mono" style={{ fontSize: 13, color: "var(--accent)" }}>
                {c.detail}
              </span>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--fg3)", margin: 0, flex: 1 }}>{c.note}</p>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, fontWeight: 550, marginTop: 8 }}>
                {c.action} <ArrowRight size={14} />
              </span>
            </a>
          ))}
        </div>
      </section>
    </MarketingShell>
  );
}
