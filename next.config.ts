import type { NextConfig } from "next";

const noIndexHeader = {
  key: "X-Robots-Tag",
  value: "noindex, nofollow, noarchive, nosnippet, noimageindex",
};

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  async redirects() {
    return [
      { source: "/internal/heartbeat", destination: "/heartbeat", permanent: true },
      { source: "/in/heartbeat", destination: "/heartbeat", permanent: true },
    ];
  },
  async headers() {
    // Public pages must remain indexable. Only authenticated/internal surfaces
    // receive a noindex response header.
    return [
      { source: "/internal/:path*", headers: [noIndexHeader] },
      { source: "/in/:path*", headers: [noIndexHeader] },
      { source: "/heartbeat", headers: [noIndexHeader] },
    ];
  },
};

export default nextConfig;
