// eslint-config-next 16 ships native flat configs (the FlatCompat wrapper used
// for the 15.x eslintrc-style config now throws a circular-structure error).
import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      // Session-audit scratch output (probe scripts, screenshots) — gitignored,
      // not product code.
      ".audit/**",
    ],
  },
  {
    // O.3: every e2e spec must take `test` from the shared harness module, which installs the
    // streamed-reveal drain (tests/e2e/helpers/test.ts explains why). A spec importing Playwright's
    // `test` directly would opt out silently and reintroduce the flake — so the fence is enforced
    // here rather than remembered at 56 call sites. Type-only imports are unaffected.
    files: ["tests/e2e/**/*.spec.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@playwright/test",
              importNames: ["test", "expect"],
              message:
                "Import { test, expect } from './helpers/test' instead — it installs the streamed-reveal drain (O.3).",
            },
          ],
        },
      ],
    },
  },
];

export default eslintConfig;
