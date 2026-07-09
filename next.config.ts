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
// Sentry ingest only when a DSN is configured — keep prod CSP tight otherwise
// (PRIVACY.md: no third-party scripts; connect-src widened only for ingest).
const sentryConfigured = !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

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
      `connect-src 'self' https://*.plaid.com${sentryConfigured ? " https://*.ingest.sentry.io" : ""}`,
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
  // HSTS: production only (dev is plain http, which ignores it — and gating avoids
  // pinning a local HTTPS proxy). 2-year max-age + includeSubDomains; aimplifi.app,
  // www, and *.vercel.app all serve valid TLS. No `preload` (that submission is an
  // irreversible, externally-registered commitment).
  ...(isDev
    ? []
    : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
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
