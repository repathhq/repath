import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog through our own domain (see instrumentation-client.ts), so
  // tracker blocklists that match posthog.com do not drop product events.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://us-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/:path*", destination: "https://us.i.posthog.com/:path*" },
    ];
  },
  // PostHog's API paths end in a slash; Next would otherwise redirect them.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
