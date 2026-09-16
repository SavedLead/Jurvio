import type { NextConfig } from "next";

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
};

export default nextConfig;
