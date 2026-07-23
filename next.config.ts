import type { NextConfig } from "next";

/**
 * Security headers (Phase 4): CSP scoped to what the app + Plaid Link need, frame
 * denial, and conservative defaults. 'unsafe-inline' for styles is required by
 * Tailwind's inline style attributes.
 *
 * PLAID LINK NEEDS MORE THAN cdn.plaid.com (#283, owner-reported live: connecting
 * a bank silently failed for EVERY institution). Plaid Link runs Google reCAPTCHA
 * for fraud/bot checks, which makes background calls to www.google.com /
 * www.gstatic.com and renders a challenge iframe from www.google.com /
 * recaptcha.google.com. Our old CSP allowed ONLY self + *.plaid.com, so reCAPTCHA
 * was refused (`Refused to connect … recaptcha/api2 … violates connect-src`) and
 * the connection died with no error — a self-inflicted, too-strict-CSP footgun that
 * permissive competitors don't hit. The Google/reCAPTCHA origins below are the
 * documented requirement (script-src + frame-src + connect-src + an img on gstatic).
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
      // its API calls (DECISIONS #41). www.google.com + www.gstatic.com are Plaid
      // Link's reCAPTCHA (fraud check) scripts. 'unsafe-eval' is dev-only.
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://cdn.plaid.com https://www.google.com https://www.gstatic.com`,
      "style-src 'self' 'unsafe-inline'",
      // gstatic serves reCAPTCHA's images/badge.
      "img-src 'self' data: blob: https://www.gstatic.com",
      "font-src 'self' data:",
      // *.plaid.com = Link API; www.google.com + www.gstatic.com = reCAPTCHA's
      // background validation calls (the ones the live console showed blocked).
      `connect-src 'self' https://*.plaid.com https://www.google.com https://www.gstatic.com${sentryConfigured ? " https://*.ingest.sentry.io" : ""}`,
      // *.plaid.com = Link iframe; www.google.com + recaptcha.google.com = the
      // reCAPTCHA challenge iframe Plaid can render mid-connection.
      "frame-src https://*.plaid.com https://www.google.com https://recaptcha.google.com",
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
