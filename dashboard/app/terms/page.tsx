"use client";

/**
 * Terms of Service.
 *
 * Matches how billing and the service actually work (checked 2026-10-03).
 * The previous terms promised annual billing (only monthly exists), USD
 * payment through Paddle (not configured — every customer pays through
 * Razorpay in INR), a 99.9% uptime target on a single-instance deployment,
 * and a status.tryrepath.com that does not exist.
 *
 * Not legal advice: have counsel review before relying on it, and add the
 * contracting entity and governing law once those are settled.
 */

import { LegalPage } from "@/components/marketing/LegalPage";

const P = ({ children }: { children: React.ReactNode }) => <p style={{ margin: 0 }}>{children}</p>;

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      updated="3 October 2026"
      intro="The agreement between you and Repath when you use tryrepath.com and the Repath service."
      sections={[
        {
          h: "Acceptance",
          body: <P>By creating an account or using Repath you agree to these terms. If you use Repath for an organisation, you confirm you may bind it to them.</P>,
        },
        {
          h: "The service",
          body: (
            <P>
              Repath sits between your application and your model providers. It routes requests, runs canary
              rollouts, evaluates response quality with an automated judge, and advances or rolls back rollouts based
              on the results. Automated evaluation is a signal, not a guarantee: you remain responsible for what your
              application does.
            </P>
          ),
        },
        {
          h: "Your account and keys",
          body: (
            <P>
              Keep your credentials and Repath API key secret; activity under them is yours. You use your own model
              provider accounts and keys, and the fees those providers charge are between you and them.
            </P>
          ),
        },
        {
          h: "Free trial",
          body: (
            <P>
              New accounts get a 7-day trial with every feature and 1,000 judged evaluations, with no card required.
              When it ends, requests continue to pass through Repath but rollouts stop routing until you choose a
              paid plan.
            </P>
          ),
        },
        {
          h: "Plans and payment",
          body: (
            <>
              <P>
                Paid plans are monthly subscriptions, billed in Indian rupees through Razorpay and renewed
                automatically each month until cancelled. Prices in other currencies are shown for reference only.
                Applicable taxes are added where required.
              </P>
              <P>We may change prices with at least 30 days&apos; notice by email; a change applies from your next billing period after that notice.</P>
            </>
          ),
        },
        {
          h: "Cancellation and refunds",
          body: (
            <P>
              You can cancel at any time from the Billing page. Your plan stays active until the end of the period you
              have paid for and you are not charged again. Payments already made are not refunded except where the
              law requires it.
            </P>
          ),
        },
        {
          h: "Evaluation limits",
          body: (
            <P>
              Each plan includes a monthly number of judged evaluations. When you reach it, judging pauses until the
              next month or an upgrade; requests continue to be proxied and health checks continue to run.
            </P>
          ),
        },
        {
          h: "Acceptable use",
          body: (
            <P>
              Do not use Repath to break the law, infringe others&apos; rights, send harmful content, attack or overload
              the service or other users, or try to access data that is not yours. We may suspend accounts that do.
            </P>
          ),
        },
        {
          h: "Your data",
          body: (
            <P>
              Your data stays yours. You give us permission to process it only to provide the service, as described
              in the Privacy Policy, including its retention periods.
            </P>
          ),
        },
        {
          h: "Availability",
          body: (
            <P>
              We work to keep Repath available and publish its state at tryrepath.com/status, but the service is
              provided without an uptime guarantee unless one is agreed in writing, for example in an Enterprise
              agreement.
            </P>
          ),
        },
        {
          h: "Liability",
          body: (
            <P>
              Repath is provided as is. To the extent the law allows, we are not liable for indirect or consequential
              losses, and our total liability is limited to the fees you paid us in the three months before the claim.
            </P>
          ),
        },
        {
          h: "Ending the agreement",
          body: <P>You can stop using Repath and cancel at any time. We may end or suspend your access for a serious breach of these terms, with notice where we reasonably can.</P>,
        },
        {
          h: "Changes and contact",
          body: <P>If these terms change materially we will email account owners before the change takes effect. Questions: hello@tryrepath.com.</P>,
        },
      ]}
    />
  );
}
