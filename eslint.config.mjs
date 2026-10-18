import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// AFLDB V2 plan D1 module boundaries (docs/v2/plan.md §3 D1, §7 R-009/R-010). ESLint matches
// import SPECIFIERS; tests/v2-module-boundaries.test.ts additionally resolves relative paths.
// A later block replaces (does not merge) an earlier block's options for the same rule, so every
// block repeats the shared patterns.
const restrict = (...groups) => ({
  "no-restricted-imports": ["error", { patterns: groups }],
});
const SHARED = [
  { group: ["@afldb/*/**"], message: "Import the package index (@afldb/<module>), never a subpath." },
  { group: ["**/legacy/**"], message: "Only legacy/** may import legacy/** (plan D10)." },
  { group: ["**/packages/**"], message: "Import a V2 package through @afldb/<module>, not by path." },
];
const NOT_TESTING = { group: ["@afldb/testing"], message: "Only tests/** may import @afldb/testing." };
const NOT_WEB = {
  group: ["@/app/*", "@/components/*"],
  message: "V2 packages must not import the web layer (src/app, src/components).",
};
const packageBlock = (module, forbidden) => ({
  files: [`packages/${module}/src/**`],
  rules: restrict(
    ...SHARED,
    NOT_WEB,
    ...(forbidden.length > 0
      ? [{ group: forbidden.map((m) => `@afldb/${m}`), message: `@afldb/${module} may not depend on these modules (plan D1).` }]
      : []),
  ),
});
const moduleBoundaries = [
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    ignores: ["tests/**", "packages/testing/**", "legacy/**"],
    rules: restrict(...SHARED, NOT_TESTING),
  },
  {
    files: ["src/app/**", "src/components/**"],
    rules: restrict(...SHARED, NOT_TESTING, {
      group: ["@afldb/acquisition"],
      message: "The web layer must not import acquisition (plan D1).",
    }),
  },
  {
    files: ["packages/domain/src/**"],
    rules: restrict(...SHARED, NOT_WEB, {
      group: ["@afldb/*", "postgres", "server-only", "next", "next/*", "react", "react-dom", "@/db/*", "node:fs", "fs"],
      message: "@afldb/domain imports nothing internal and stays pure (plan D1).",
    }),
  },
  packageBlock("db", ["acquisition", "derived", "admin", "testing"]),
  packageBlock("acquisition", ["derived", "admin", "testing"]),
  packageBlock("derived", ["acquisition", "admin", "testing"]),
  packageBlock("admin", ["acquisition", "derived", "testing"]),
  {
    files: ["packages/testing/src/**"],
    rules: restrict(...SHARED),
  },
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  ...moduleBoundaries,
  globalIgnores([
    ".next/**",
    "artifacts/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
    // AFLDB-ISSUE-265: a byte-preserved historical CommonJS preload, retained with the Phase A
    // reproduction tooling. Its bytes are hash-recorded, so it is ignored rather than edited.
    "issues/closed/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs",
  ]),
]);

export default eslintConfig;
