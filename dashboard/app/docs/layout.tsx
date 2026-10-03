import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/docs",
  "Documentation",
  "Point your OpenAI-compatible client at Repath, create a rollout, and let the controller advance or roll back on judged quality.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
