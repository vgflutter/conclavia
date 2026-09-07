import type { NextConfig } from "next";

function publicDevelopmentHost(): string[] {
  if (process.env.NODE_ENV === "production" || !process.env.CONCLAVIA_PUBLIC_URL) {
    return [];
  }

  try {
    return [new URL(process.env.CONCLAVIA_PUBLIC_URL).hostname];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  output: "standalone",
  allowedDevOrigins: ["127.0.0.1", ...publicDevelopmentHost()],
  devIndicators: false,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
