import type { Metadata } from "next";

/**
 * Metadata for a public page.
 *
 * A page that sets its own `openGraph` replaces the root's wholesale, image
 * included, so a shared /pricing link would show no card. Building every
 * page's metadata here keeps title, description, canonical URL, share image
 * and Twitter card together.
 */
export function pageMetadata(path: string, title: string, description: string): Metadata {
  const full = `${title} — Repath`;
  const image = { url: "/opengraph-image", width: 1200, height: 630, alt: "Repath — every prompt change ships behind a quality gate" };
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: "Repath", url: path, title: full, description, images: [image] },
    twitter: { card: "summary_large_image", title: full, description, images: [image] },
  };
}
