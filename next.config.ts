import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep production verification builds separate from the running local preview.
  distDir: process.env.NODE_ENV === "development" ? ".next-dev" : ".next",
  poweredByHeader: false,
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        // Compatible with Next's inline hydration and development tooling.
        // These directives block framing, plugins, and injected base/form targets.
        {
          key: "Content-Security-Policy",
          value: "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'",
        },
      ],
    }];
  },
};

export default nextConfig;
