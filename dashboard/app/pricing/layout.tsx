import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/pricing",
  "Pricing",
  "Every plan includes the whole product: canary rollouts, an LLM judge, automatic rollback. Plans differ in judged evaluations per month. 7-day free trial, no card.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
