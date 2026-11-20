import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  distDir: '.next',
  output: 'standalone',
  // Server Functions receive credentials. Next's dev logger prints their arguments by default.
  logging: { serverFunctions: false },
  // Explicit hostnames for temporary LAN/tunnel previews; no public wildcard.
  allowedDevOrigins: process.env.NAVIGATOR_DEV_ALLOWED_ORIGINS?.split(',').map((host) => host.trim()).filter(Boolean),
  // Signed desktop bundles are immutable; keep the bounded Next cache in memory.
  experimental: {
    agentUpgrade: "security",
    isrFlushToDisk: process.env.NAVIGATOR_DESKTOP !== '1',
  },
  turbopack: {
    root: process.cwd(),
  },
  images: {
    unoptimized: true,
  },
  async redirects() {
    return [
      {
        source: "/episode/:id*",
        destination: "/series/:id*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
