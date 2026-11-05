import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  outputFileTracingIncludes: {
    "/api/generate": ["./poc/references/**/*", "./poc/prompt.txt"],
  },
};

export default nextConfig;
