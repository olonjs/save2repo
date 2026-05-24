import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["@sparticuz/chromium", "playwright-core"],
  outputFileTracingIncludes: {
    "/*": [
      "./node_modules/@sparticuz/chromium/**/*",
      "./node_modules/playwright-core/**/*",
    ],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
};

export default nextConfig;