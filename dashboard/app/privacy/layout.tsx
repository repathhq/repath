import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/privacy",
  "Privacy Policy",
  "What Repath collects, why, where it is stored, and how long it is kept.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
