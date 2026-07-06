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
];

export default eslintConfig;
