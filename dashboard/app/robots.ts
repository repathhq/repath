import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/rollouts", "/routing", "/billing", "/settings", "/onboarding", "/logs", "/reset-password"],
    },
    sitemap: "https://tryrepath.com/sitemap.xml",
  };
}
