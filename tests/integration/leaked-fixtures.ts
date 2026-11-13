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
 *   2076  settle-afltables.test.ts (ISSUE-099 block)         -- moved from 2094 by TST-9
 *   2090  awards-reload-links.test.ts (tie season)
 *   2091  awards-reload-links.test.ts (multi-club season)    -- also admin-coaches.test.ts  (known overlap)
 *   2092  awards-reload-links.test.ts (in-progress season)
 *   2093  awards-reload-links.test.ts (finals season)        -- also settle-afltables.test.ts (ISSUE-122 block,
 *         deliberately paired with import-role-match-lock.test.ts) (known overlap)
 *   2094  awards-reload-links.test.ts (identity block)       -- sole owner since TST-9
 * Suites run serially (vitest `fileParallelism: false`), so an overlap cannot collide in a normal run; it can
 * only mis-attribute a leak. The overlaps are listed, not fixed here, because 2093 is shared on purpose with
 * the import-role lock fixture and 2091 belongs to a suite outside this change.
 */
import type postgres from 'postgres';

export const COMMITTED_FIXTURE_SEASONS: Readonly<Record<number, string>> = {
  2076: 'tests/integration/settle-afltables.test.ts',
  2090: 'tests/integration/awards-reload-links.test.ts',
  2091: 'tests/integration/awards-reload-links.test.ts (or admin-coaches.test.ts)',
  2092: 'tests/integration/awards-reload-links.test.ts',
  2093: 'tests/integration/awards-reload-links.test.ts, settle-afltables.test.ts (ISSUE-122) or import-role-match-lock.test.ts',
  2094: 'tests/integration/awards-reload-links.test.ts',
};

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
