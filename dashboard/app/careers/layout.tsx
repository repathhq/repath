import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/careers",
  "Careers",
  "Help make AI safe to ship. Remote, small team, whole systems end to end.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
