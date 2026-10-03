"use client";

import { MarketingShell, PageHero } from "./Marketing";

export type LegalSection = { h: string; body: React.ReactNode };

/** Terms, privacy and the like: one readable column, numbered sections. */
export function LegalPage({
  title,
  updated,
  intro,
  sections,
}: {
  title: string;
  updated: string;
  intro: React.ReactNode;
  sections: LegalSection[];
}) {
  return (
    <MarketingShell>
      <PageHero eyebrow={`Last updated ${updated}`} title={title} lead={intro} narrow />
      <article className="lp-pad" style={{ maxWidth: 860, margin: "0 auto", padding: "48px 40px 120px" }}>
        {sections.map((s, i) => (
          <section
            key={s.h}
            style={{ display: "grid", gridTemplateColumns: "48px 1fr", gap: 8, padding: "26px 0", borderTop: "1px solid var(--line2)" }}
          >
            <span className="lp-mono" style={{ fontSize: 12, color: "var(--fg4)", paddingTop: 4 }}>
              {String(i + 1).padStart(2, "0")}
            </span>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-0.01em", margin: "0 0 10px" }}>{s.h}</h2>
              <div style={{ fontSize: 15, lineHeight: 1.7, color: "var(--fg2)", display: "flex", flexDirection: "column", gap: 10 }}>
                {s.body}
              </div>
            </div>
          </section>
        ))}
      </article>
    </MarketingShell>
  );
}
