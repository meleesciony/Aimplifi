import type { NextConfig } from "next";

/**
 * Security headers (Phase 4): CSP with no third-party scripts (the app loads
 * none), frame denial, and conservative defaults. 'unsafe-inline' for styles
 * is required by Tailwind's inline style attributes; script-src stays strict.
 *
 * DEV ONLY: `next dev` compiles client code with eval-based source maps
 * (eval-source-map), so the dev runtime needs 'unsafe-eval' or the CSP blocks
 * the ENTIRE client bundle from executing — no hydration, every button dead
 * (this silently broke Plaid Link in `npm run dev`). Production builds use no
 * eval, so 'unsafe-eval' is added in development only and prod stays strict.
 */
const isDev = process.env.NODE_ENV !== "production";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // cdn.plaid.com hosts the Plaid Link SDK; *.plaid.com is the Link iframe +
      // its API calls (DECISIONS #41). Scoped to Plaid only. 'unsafe-eval' is
      // dev-only (Next.js HMR/source-maps); never emitted in production.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://cdn.plaid.com`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://*.plaid.com",
      "frame-src https://*.plaid.com",
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
