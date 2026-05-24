import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // save2repo lives at /home/dev/save2repo (WSL). When the build runs via the
  // Windows node binary across a \\wsl.localhost UNC path, turbopack can
  // misdetect the workspace root if any sibling directory contains a stray
  // package-lock.json. Pin the root explicitly.
  turbopack: {
    root: __dirname,
  },

  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default nextConfig;
