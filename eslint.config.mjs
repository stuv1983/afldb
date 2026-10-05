import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "artifacts/**",
    "coverage/**",
    "node_modules/**",
    "next-env.d.ts",
    // AFLDB-ISSUE-265: a byte-preserved historical CommonJS preload, retained with the Phase A
    // reproduction tooling. Its bytes are hash-recorded, so it is ignored rather than edited.
    "issues/open/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs",
  ]),
]);

export default eslintConfig;
