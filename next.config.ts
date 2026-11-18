import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  typedRoutes: true,
  async redirects() {
    return [
      { source: "/internal/heartbeat", destination: "/heartbeat", permanent: true },
      // Directory indexes that only render a "coming soon" empty state.
      // Profile URLs under these paths stay in place.
      { source: "/parties", destination: "/cases", permanent: true },
      { source: "/attorneys", destination: "/cases", permanent: true },
      { source: "/law-firms", destination: "/cases", permanent: true },
    ];
  },
};

export default nextConfig;
