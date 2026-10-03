import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/terms",
  "Terms of Service",
  "The agreement between you and Repath when you use the service.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
