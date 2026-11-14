/**
 * AFLDB-ISSUE-363 TST-9: a registry of the seasons that integration suites COMMIT as fixtures, and a
 * fail-fast check for the suites whose assertions read the whole `seasons` table.
 *
 * WHY. Some suites cannot run inside a rolled-back transaction (the code under test opens its own
 * transaction, or reads through the shared client), so they commit fixtures and remove them in `afterAll`.
 * A killed process never reaches `afterAll`. The next full run then fails in suites that never touched the
 * fixture, with a message that names none of it: `admin-season-lists` derives its two test seasons from
 * `max(seasons.year)`, and `release-gates` asserts that 2026 is the only season still `in_progress`.
 * Review evidence (full review 2026-11-14): "2094: expected true to be false" and "expected [ 2094 ] to
 * deeply equal [ 2026 ]".
 *
 * WHAT THIS DOES NOT DO. It does not delete anything. The owning suites already pre-clean in `beforeAll`
 * (`cleanupIssue099`, `cleanup122`, `removeFixtureCorpus`), and a sweep from another suite could not
 * restore what an owner's `afterAll` restores (the real Coleman family is reloaded after the identity
 * block). So the recovery is to re-run the owning suite alone, and this check says so.
 *
 * SEASON OWNERSHIP (kept here so the claim is checkable). One suite per season, except where noted:
 *   2061  awards-reload-links.test.ts (multi-club season)    -- moved from 2091 (ISSUE-363 decision 2)
 *   2062  awards-reload-links.test.ts (finals season)        -- moved from 2093 (ISSUE-363 decision 2)
 *   2076  settle-afltables.test.ts (ISSUE-099 block)         -- moved from 2094 by TST-9
 *   2090  awards-reload-links.test.ts (tie season)
 *   2091  admin-coaches.test.ts; v2-curated-awards.test.ts (sealed season) -- known overlap, neither is awards
 *   2092  awards-reload-links.test.ts (in-progress season)   -- also v2-curated-awards.test.ts (open season) (known overlap)
 *   2093  settle-afltables.test.ts (ISSUE-122 block), deliberately paired with import-role-match-lock.test.ts
 *   2094  awards-reload-links.test.ts (identity block)       -- sole owner since TST-9
 * In shared mode suites run serially (vitest `fileParallelism: false`), so an overlap cannot collide in a normal
 * run; it can only mis-attribute a leak. In per-file mode (below) each file has its own database and an overlap
 * cannot even do that. The remaining overlaps are listed, not fixed: 2093 is shared on purpose with the
 * import-role lock fixture; 2091/2092 belong to suites outside decision (2), which named awards' 2091 and 2093.
 *
 * PER-FILE DATABASES (ISSUE-363 owner decision 1). `AFLDB_TEST_PER_FILE_DB=1` gives each suite in
 * {@link COMMITTING_SUITES} its own database (a copy of the base, dropped at the end of the file); `=all` gives every
 * integration file one. See packages/testing/src/per-file-db.ts. This guard is unchanged by it: in shared mode a
 * leak still fails fast; in per-file mode the victim suites read their own copy of the base, so the same check
 * fails if the BASE itself already holds a fixture season (a contaminated base is a real error), and a leak
 * inside the file's own database is reported exactly as before.
 */
import type postgres from 'postgres';

export const COMMITTED_FIXTURE_SEASONS: Readonly<Record<number, string>> = {
  2061: 'tests/integration/awards-reload-links.test.ts',
  2062: 'tests/integration/awards-reload-links.test.ts',
  2076: 'tests/integration/settle-afltables.test.ts',
  2090: 'tests/integration/awards-reload-links.test.ts',
  2091: 'tests/integration/admin-coaches.test.ts (or v2-curated-awards.test.ts)',
  2092: 'tests/integration/awards-reload-links.test.ts (or v2-curated-awards.test.ts)',
  2093: 'tests/integration/settle-afltables.test.ts (ISSUE-122) or import-role-match-lock.test.ts',
  2094: 'tests/integration/awards-reload-links.test.ts',
};

/**
 * Integration suites that COMMIT fixtures outside a rolled-back transaction (or that assert on the whole seasons
 * table and so are the victims of a leak), run against their own database when `AFLDB_TEST_PER_FILE_DB=1`.
 * Paths are relative to the repository root. Membership is the union of (a) files whose committed residue the
 * per-file audit recorded in a full run (`AFLDB_TEST_PER_FILE_DB_AUDIT`), (b) files with `INSERT INTO seasons`,
 * (c) consumers of a committed shared fixture helper (wildcard-final / brownlow / import-role-lock / sealed-registry),
 * (d) the leak-guard victims, and (e) settle-afltables, settle-promotion-deadlock and awards-reload-links, which commit
 * fixture seasons and clean them in afterAll. Per-file evidence:
 * docs/v2/evidence/remediation-20261114/run2/tests363/ (inventory-static.tsv, README.md). The list is a convenience
 * for `=1`; `=all` ignores it and is the safe mode, because a suite that restores its own state in afterAll leaves no
 * audit residue yet still leaks when its process is killed.
 */
export const COMMITTING_SUITES: readonly string[] = [
  'tests/integration/admin-awards.test.ts',
  'tests/integration/admin-brownlow.test.ts',
  'tests/integration/admin-club-leadership.test.ts',
  'tests/integration/admin-coaches.test.ts',
  'tests/integration/admin-draft.test.ts',
  'tests/integration/admin-fixtures.test.ts',
  'tests/integration/admin-season-lists.test.ts',
  'tests/integration/admin-special-records.test.ts',
  'tests/integration/afl-api-c7-observation.test.ts',
  'tests/integration/afl-api-ownership-census.test.ts',
  'tests/integration/after-siren.test.ts',
  'tests/integration/awards-reload-links.test.ts',
  'tests/integration/brownlow-pending-projection.test.ts',
  'tests/integration/data-editor.test.ts',
  'tests/integration/database.test.ts',
  'tests/integration/derived-rebuild-parity.test.ts',
  'tests/integration/dob-enrichment-issues.test.ts',
  'tests/integration/draftguru-import.test.ts',
  'tests/integration/grid-solver.test.ts',
  'tests/integration/import-role-match-lock.test.ts',
  'tests/integration/join-request-approval.test.ts',
  'tests/integration/match-admin-create.test.ts',
  'tests/integration/match-admin-delete.test.ts',
  'tests/integration/match-results-promotion.test.ts',
  'tests/integration/nl-answers-team-club.test.ts',
  'tests/integration/observation-spine.test.ts',
  'tests/integration/release-gates.test.ts',
  'tests/integration/sealed-editor-guard.test.ts',
  'tests/integration/settle-afl-api-brownlow-backtest.test.ts',
  'tests/integration/settle-afl-api-brownlow-reschedule.test.ts',
  'tests/integration/settle-afl-api-brownlow.test.ts',
  'tests/integration/settle-afl-api-state-b.test.ts',
  'tests/integration/settle-afl-api.test.ts',
  'tests/integration/settle-afltables.test.ts',
  'tests/integration/settle-promotion-deadlock.test.ts',
  'tests/integration/special-records-public-suppression.test.ts',
  'tests/integration/submission-promotion.test.ts',
  'tests/integration/v2-brownlow-eligibility.test.ts',
  'tests/integration/v2-coleman-publication.test.ts',
  'tests/integration/v2-curated-awards.test.ts',
  'tests/integration/venue-records.test.ts',
];

export type LeakedFixtureSeason = { year: number; status: string; owner: string };

/** `seasons` rows sitting on a year a committed-fixture suite reserves. Read-only. */
export async function leakedFixtureSeasons(client: postgres.Sql): Promise<LeakedFixtureSeason[]> {
  const years = Object.keys(COMMITTED_FIXTURE_SEASONS).map(Number);
  const rows = await client<{ year: number; status: string }[]>`
    SELECT year::int AS year, status::text AS status
      FROM seasons
     WHERE year = ANY(${years}::int[])
     ORDER BY year`;
  return rows.map((row) => ({ ...row, owner: COMMITTED_FIXTURE_SEASONS[row.year] }));
}

/**
 * For a suite whose assertions read the whole `seasons` table: throw, naming the leaked fixtures and the
 * recovery, instead of failing later with a number that explains nothing.
 */
export async function assertNoLeakedFixtureSeasons(client: postgres.Sql): Promise<void> {
  const leaked = await leakedFixtureSeasons(client);
  if (leaked.length === 0) return;
  throw new Error(
    'Committed fixture season(s) left in the test database by an interrupted earlier run: '
    + leaked.map((l) => `${l.year} (${l.status}; reserved by ${l.owner})`).join('; ')
    + '. This suite reads the whole seasons table and cannot pass with them present. Re-run the owning '
    + 'suite alone (it pre-cleans in beforeAll and removes its fixtures in afterAll), then re-run this one.',
  );
}
