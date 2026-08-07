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
    // Jurvio is intentionally pre-launch. Block every route from indexing until
    // go-live is explicitly approved.
    return [
      {
        source: "/:path*",
        headers: [noIndexHeader],
      },
    ];
  },
};

export default nextConfig;
