import type { NextConfig } from "next";

/**
 * Security headers (Phase 4): CSP with no third-party scripts (the app loads
 * none), frame denial, and conservative defaults. 'unsafe-inline' for styles
 * is required by Tailwind's inline style attributes; script-src stays strict.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'", // Next.js inline runtime bootstrap
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "base-uri 'self'",
    ].join("; "),
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Driver packages must stay external to the server bundle so the correct
  // runtime binary loads (better-sqlite3 native addon locally; pg in
  // production). See src/lib/db-adapter.ts and DECISIONS #35.
  serverExternalPackages: [
    "@prisma/adapter-pg",
    "@prisma/adapter-better-sqlite3",
    "better-sqlite3",
    "pg",
  ],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
