"use client";

/**
 * Privacy policy.
 *
 * Describes the system as it is, checked against it on 2026-10-03. The
 * previous text named Neon in Singapore and Upstash as the data stores (it is
 * AWS RDS and EC2 in Mumbai), said prompts were not collected unless logging
 * was enabled (capture is on by default), and listed no sub-processors —
 * while the judge sends prompts and responses through the Vercel AI Gateway.
 * When the system changes, this page changes with it.
 */

import { LegalPage } from "@/components/marketing/LegalPage";

const P = ({ children }: { children: React.ReactNode }) => <p style={{ margin: 0 }}>{children}</p>;
const L = ({ items }: { items: React.ReactNode[] }) => (
  <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
    {items.map((it, i) => (
      <li key={i}>{it}</li>
    ))}
  </ul>
);

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="3 October 2026"
      intro="What Repath collects, why, where it is kept, who else handles it, and how long it stays."
      sections={[
        {
          h: "Who we are",
          body: <P>Repath (tryrepath.com) provides progressive delivery for AI applications: canary rollouts, quality evaluation and automatic rollback for prompts and models. Questions about this policy go to hello@tryrepath.com.</P>,
        },
        {
          h: "What we collect",
          body: (
            <L
              items={[
                <>
                  <strong>Account:</strong> your name, email address and a bcrypt hash of your password. We never store your
                  password itself.
                </>,
                <>
                  <strong>Requests you send through Repath:</strong> metadata — model, provider, token counts, latency,
                  status, estimated cost, time — and, unless you turn capture off, the prompt and the response.
                </>,
                <>
                  <strong>Evaluations:</strong> the scores and written reasons our judge gives each sampled response.
                </>,
                <>
                  <strong>Provider keys you save:</strong> encrypted at rest and used only to call those providers for you.
                </>,
                <>
                  <strong>Billing:</strong> your plan, subscription and payment identifiers, amounts and status. Card, UPI
                  and bank details go to Razorpay and never reach us.
                </>,
                <>
                  <strong>Technical logs:</strong> request paths, errors and timings needed to run and secure the service.
                </>,
              ]}
            />
          ),
        },
        {
          h: "How we use it",
          body: (
            <>
              <P>
                To run the service: route and proxy your requests, judge response quality, decide whether a rollout
                advances or rolls back, show you the request log, bill your plan, send transactional email (password
                resets, receipts, alerts you configure) and keep the service secure.
              </P>
              <P>We do not sell your data, use it for advertising, or use it to train models.</P>
            </>
          ),
        },
        {
          h: "Where it is stored",
          body: (
            <P>
              On Amazon Web Services in the Mumbai region (ap-south-1): a PostgreSQL database encrypted at rest, and
              application servers with encrypted disks. Traffic is encrypted in transit with TLS. Database backups are
              kept for seven days.
            </P>
          ),
        },
        {
          h: "How long it is kept",
          body: (
            <L
              items={[
                <>
                  Prompts and responses: 7 days on the Trial, Indie and Starter plans, 90 days on Pro and Enterprise,
                  then deleted automatically. The window is fixed when a request is recorded.
                </>,
                <>You can switch prompt and response capture off in Settings at any time.</>,
                <>Request metadata and evaluations: while your account exists.</>,
                <>
                  Your account and everything in it: deleted within 30 days of your request. Backups containing it
                  expire within a further seven days.
                </>,
              ]}
            />
          ),
        },
        {
          h: "Who else handles it",
          body: (
            <>
              <P>We use these sub-processors, each only for the purpose shown:</P>
              <L
                items={[
                  <>
                    <strong>Amazon Web Services</strong> — hosting, database and transactional email (SES).
                  </>,
                  <>
                    <strong>Vercel</strong> — the AI Gateway our judge uses; sampled prompts and responses pass through it
                    to be scored.
                  </>,
                  <>
                    <strong>Razorpay</strong> — subscriptions and payments.
                  </>,
                  <>
                    <strong>The model providers you configure</strong> — your requests are forwarded to them, using your
                    own keys and accounts, under their terms.
                  </>,
                ]}
              />
              <P>If your data must never leave your own network, Repath can be self-hosted.</P>
            </>
          ),
        },
        {
          h: "Cookies",
          body: (
            <P>
              One cookie keeps you signed in; it is HttpOnly and sent only over HTTPS. Your light or dark theme choice
              is remembered in your browser&apos;s local storage. There are no analytics, advertising or tracking cookies.
            </P>
          ),
        },
        {
          h: "Your rights",
          body: (
            <P>
              You can ask us for a copy of your data, to correct it, or to delete it, by emailing hello@tryrepath.com
              from your account&apos;s address. We answer within 30 days.
            </P>
          ),
        },
        {
          h: "Changes",
          body: <P>When this policy changes we update the date above, and for material changes we email account owners before they take effect.</P>,
        },
      ]}
    />
  );
}
