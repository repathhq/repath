import type { MetadataRoute } from "next";

const SITE = "https://tryrepath.com";

// The public pages only. Everything behind sign-in is left out, and
// robots.ts keeps crawlers away from it.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { path: "", priority: 1 },
    { path: "/pricing", priority: 0.9 },
    { path: "/docs", priority: 0.9 },
    { path: "/about", priority: 0.6 },
    { path: "/contact", priority: 0.6 },
    { path: "/careers", priority: 0.4 },
    { path: "/status", priority: 0.4 },
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
  ].map(({ path, priority }) => ({ url: `${SITE}${path}`, changeFrequency: "weekly", priority }));
}
