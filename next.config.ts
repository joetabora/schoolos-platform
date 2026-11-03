import type { NextConfig } from "next";
import { getSecurityHeaders } from "./src/platform/security/headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
  agentRules: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [...getSecurityHeaders({ isDevelopment: process.env.NODE_ENV === "development" })],
      },
    ];
  },
};

export default nextConfig;
