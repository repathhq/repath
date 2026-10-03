import { pageMetadata } from "@/lib/metadata";

// The page itself is a client component, which cannot export metadata.
export const metadata = pageMetadata(
  "/contact",
  "Contact",
  "Questions, support, enterprise and self-hosting — talk to the people who build Repath.",
);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
