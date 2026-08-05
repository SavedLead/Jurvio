import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  async redirects() {
    // The court heartbeat now lives at the public, read-only /heartbeat route.
    // Permanently redirect the former gated paths so no duplicate live route
    // exists and any saved links keep working.
    return [
      { source: "/internal/heartbeat", destination: "/heartbeat", permanent: true },
      { source: "/in/heartbeat", destination: "/heartbeat", permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
