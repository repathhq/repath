import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/about",
  "About",
  "Repath is the deployment layer for AI: canary rollouts for prompts and models, judged on real traffic, rolled back automatically.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
