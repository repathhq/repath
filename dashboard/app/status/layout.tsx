import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/status",
  "Status",
  "Live status of the Repath gateway, database, queue and dashboard.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
