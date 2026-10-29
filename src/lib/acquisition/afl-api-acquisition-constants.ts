// lib | Writer-free AFL API acquisition constants shared by acquire tools and settle writers
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.


/**
 * AFLDB V2 Stage 3 — writer-free constants the AFL API ACQUIRE tools need.
 *
 * "API clients never write final tables" (docs/v2/plan.md §3 D1) is proved statically by
 * tests/v2-acquisition-pipeline.test.ts: the import closure of the acquire CLIs must reach no
 * writer module. These three values used to live in the settle writers themselves
 * (`afl-api-brownlow.ts`, `afl-api-fixture-identity.ts`), so importing a constant pulled the
 * whole Brownlow settle (canonical-apply, observation-store, settle-core, ...) into the acquire
 * tools' closure. They are moved here unchanged and re-exported, value for value, from their
 * original modules, so every existing importer keeps working.
 *
 * This module imports nothing.
 */

/**
 * Distinguishes a `--fixtures-only` acquisition's manifest from a normal
 * `afl_api_match_snapshot` one — used by both `acquire-afl-api.ts` (to write
 * it) and `settle-afl-api-fixtures.ts` (to refuse a manifest that is not
 * this kind, and so that `settle-afl-api.ts` — which this constant does not
 * touch — can never mistake a fixtures-only snapshot for a complete one by
 * silently accepting it; that tool's own manifest check pins the OTHER
 * value, `afl_api_match_snapshot`).
 */
export const AFL_API_FIXTURE_ACQUISITION_KIND = 'afl_api_fixture_snapshot';

/* ------------------------------------------------------------------ *
 * §10 "Operational enablement" — default OFF, independent of the
 * match-family settle's own timer/flag.
 * ------------------------------------------------------------------ */

export const BROWNLOW_ENABLE_ENV = 'AFLDB_AFL_API_BROWNLOW_ENABLED';

/** Anything other than the literal string `'true'` is disabled — never a truthy-string guess. */
export function isAflApiBrownlowEnabled(env: Partial<Record<string, string | undefined>> = process.env): boolean {
  return env[BROWNLOW_ENABLE_ENV] === 'true';
}
