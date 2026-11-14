// tests | D-365-1 Brownlow coverage recompute pending versus declared no-medal integration regression
// Soft size threshold: 500 LOC. Run `phaneslight loc-check` if uncertain.
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { finaliseBrownlowMatch } from '@/db/queries/admin-brownlow';
import { recomputeBrownlowCoverage, recomputeSeasonBrownlowStatus } from '@/db/queries/player-derived';
import { BROWNLOW_MANUAL_SOURCE_KEY } from '@/lib/brownlow/entry';
import {
  BROWNLOW_PENDING_SEASON,
  cleanupSeededBrownlowSeasons,
  seedBrownlowSeason,
  type BrownlowFixture,
} from './brownlow-fixture';

/**
 * AFLDB-ISSUE-365, owner decision D-365-1 (remediation run 4):
 *
 *   "a completed season without loaded Brownlow results remains pending unless an explicit authoritative
 *    decision establishes that no medal was awarded. Missing data must not imply no medal. Preserve
 *    historical no-medal seasons and test both cases."
 *
 * Both cases are tested here against the REAL `recomputeBrownlowCoverage`:
 *
 *   - the COMPLETED-BUT-UNLOADED case runs on a suite-owned fixture season (2063, a completed season with two
 *     home-and-away matches, no `brownlow_season_votes`, no decisions and no coverage row);
 *   - the DECLARED no-medal case runs on the real 1900 and 1943, each inside a transaction that is always rolled
 *     back, so nothing real is written.
 *
 * EXPECTED VALUES are literals that follow from the owner's text, never read back from the function under test.
 * Provenance of each:
 *   - 'pending' / 'not_applicable' for the fixture season: the owner's rule itself;
 *   - 1900 and 1943 `not_applicable` at all three grains: `data/reference/stat-availability.json` `coverage_ranges`
 *     (the declared 1897-1923 and 1942-1945 `not_applicable` ranges), which the rebuild loads;
 *   - the all-season sweep oracle: the same committed JSON (`brownlow_season_total` ranges), parsed here, plus the
 *     literal that 2027, an in-progress season with no row, reads `pending`;
 *   - the fixture's two home-and-away matches: the shape in `brownlow-fixture.ts`.
 *
 * Fixture season 2063 is committed (the finalise path opens its own connection) and removed in `afterAll`; the
 * fixture's own collision guard refuses to start over an existing 2063.
 */

process.env.AFLDB_IMPORT_DATABASE_URL = process.env.AFLDB_TEST_DATABASE_URL;

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 2, onnotice: () => {} });

const STAT_KEYS = ['brownlow_season_total', 'brownlow_round_votes', 'brownlow_match_votes'] as const;
type StatKey = (typeof STAT_KEYS)[number];
type AvailabilityRow = {
  statKey: StatKey; isRecorded: boolean; coverage: string; populatedRows: number | null; totalRows: number | null;
};

let fixture: BrownlowFixture;
let actorId = 0;
let createdThrowawayAdmin = false;

beforeAll(async () => {
  const [existing] = await owner<{ id: number }[]>`SELECT id FROM auth_users ORDER BY id LIMIT 1`;
  if (existing) {
    actorId = existing.id;
  } else {
    const [created] = await owner<{ id: number }[]>`
      INSERT INTO auth_users (email, role)
      VALUES ('issue-365-brownlow-pending-test@example.test', 'super_admin')
      RETURNING id
    `;
    actorId = created.id;
    createdThrowawayAdmin = true;
  }
  const [manual] = await owner`SELECT id FROM sources WHERE key = ${BROWNLOW_MANUAL_SOURCE_KEY}`;
  if (!manual) throw new Error(`source '${BROWNLOW_MANUAL_SOURCE_KEY}' must exist; the Brownlow writer refuses without it.`);
  fixture = await seedBrownlowSeason(BROWNLOW_PENDING_SEASON);
});

afterAll(async () => {
  let teardownError: unknown;
  try {
    await cleanupSeededBrownlowSeasons();
  } catch (error) {
    teardownError = error;
  }
  if (createdThrowawayAdmin && teardownError === undefined) {
    await owner`DELETE FROM auth_users WHERE id = ${actorId}`;
  }
  await owner.end();
  await sql.end();
  if (teardownError !== undefined) throw teardownError;
});

async function readRows(runner: postgres.Sql | postgres.TransactionSql, season: number): Promise<AvailabilityRow[]> {
  const rows = await runner<AvailabilityRow[]>`
    SELECT stat_key AS "statKey", is_recorded AS "isRecorded", coverage::text AS coverage,
           populated_rows AS "populatedRows", total_rows AS "totalRows"
      FROM stat_availability
     WHERE season = ${season} AND stat_key = ANY(${[...STAT_KEYS]}::text[])
     ORDER BY stat_key
  `;
  return rows.map((row) => ({ ...row })); // plain objects: the result array carries extra members
}

function rowFor(rows: AvailabilityRow[], key: StatKey): AvailabilityRow {
  const row = rows.find((r) => r.statKey === key);
  if (!row) throw new Error(`no stat_availability row for ${key}`);
  return row;
}

/** Plant exactly the three Brownlow rows for the fixture season (committed; the suite owns season 2063). */
async function plantRows(coverage: 'not_applicable' | 'pending' | 'complete' | null): Promise<void> {
  await owner`DELETE FROM stat_availability WHERE season = ${fixture.season} AND stat_key = ANY(${[...STAT_KEYS]}::text[])`;
  if (coverage === null) return;
  for (const key of STAT_KEYS) {
    await owner`
      INSERT INTO stat_availability (stat_key, season, is_recorded, coverage, populated_rows, total_rows)
      VALUES (${key}, ${fixture.season}, ${coverage === 'complete'}, ${coverage}::coverage_status, NULL, NULL)
    `;
  }
}

async function recomputeCommitted(season: number): Promise<void> {
  await owner.begin(async (tx) => { await recomputeBrownlowCoverage(tx, season); });
}

class RolledBack extends Error {}

/** Run `recomputeBrownlowCoverage` for one season in a transaction that is ALWAYS rolled back; return before and after. */
async function recomputeRolledBack(season: number): Promise<{ before: AvailabilityRow[]; after: AvailabilityRow[]; post: AvailabilityRow[] }> {
  const before = await readRows(owner, season);
  let after: AvailabilityRow[] = [];
  try {
    await owner.begin(async (tx) => {
      await recomputeBrownlowCoverage(tx, season);
      after = await readRows(tx, season);
      throw new RolledBack('always rolled back');
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  }
  return { before, after, post: await readRows(owner, season) };
}

describe('D-365-1: a completed season with no loaded medal is pending, never not_applicable', () => {
  it('precondition: the fixture season is completed, holds no medal rows, no decisions and no coverage row', async () => {
    const [facts] = await owner<{ status: string; medals: number; decisions: number; rows: number; haMatches: number }[]>`
      SELECT (SELECT status::text FROM seasons WHERE year = ${fixture.season})                     AS status,
             (SELECT count(*) FROM brownlow_season_votes WHERE season = ${fixture.season})::int      AS medals,
             (SELECT count(*) FROM brownlow_vote_entry_state WHERE season = ${fixture.season})::int  AS decisions,
             (SELECT count(*) FROM stat_availability WHERE season = ${fixture.season}
                 AND stat_key LIKE 'brownlow%')::int                                                 AS rows,
             (SELECT count(*) FROM matches WHERE season = ${fixture.season}
                 AND round_type = 'home_and_away')::int                                              AS "haMatches"
    `;
    expect(facts).toEqual({ status: 'complete', medals: 0, decisions: 0, rows: 0, haMatches: 2 });
  });

  it('a recompute of the completed season writes pending at all three grains (no coverage row to begin with)', async () => {
    await recomputeCommitted(fixture.season);
    const rows = await readRows(owner, fixture.season);
    expect(rows.map((r) => r.statKey)).toEqual(['brownlow_match_votes', 'brownlow_round_votes', 'brownlow_season_total']);
    // Expected values are literals from the owner's rule. The match grain also records its measured counts
    // (0 of the fixture's 2 home-and-away matches carry a full 6-vote mirror), which is not a coverage claim.
    expect(rowFor(rows, 'brownlow_season_total')).toEqual({
      statKey: 'brownlow_season_total', isRecorded: false, coverage: 'pending', populatedRows: null, totalRows: null,
    });
    expect(rowFor(rows, 'brownlow_round_votes')).toEqual({
      statKey: 'brownlow_round_votes', isRecorded: false, coverage: 'pending', populatedRows: null, totalRows: null,
    });
    expect(rowFor(rows, 'brownlow_match_votes')).toEqual({
      statKey: 'brownlow_match_votes', isRecorded: false, coverage: 'pending', populatedRows: 0, totalRows: 2,
    });
  });

  it('heals a season already (wrongly) marked not_applicable: the rule never reads the existing row', async () => {
    await plantRows('not_applicable');
    // Control: the planted state is what the player-facing status follows, so the corrupted state is real.
    await owner.begin(async (tx) => { await recomputeSeasonBrownlowStatus(tx, fixture.season); });
    const planted = await owner<{ status: string }[]>`
      SELECT DISTINCT brownlow_status::text AS status FROM player_season_stats WHERE season = ${fixture.season}`;
    expect(planted.map((r) => r.status)).toEqual(['not_applicable']);

    await recomputeCommitted(fixture.season);
    const rows = await readRows(owner, fixture.season);
    expect(rows.map((r) => [r.statKey, r.coverage])).toEqual([
      ['brownlow_match_votes', 'pending'], ['brownlow_round_votes', 'pending'], ['brownlow_season_total', 'pending'],
    ]);

    await owner.begin(async (tx) => { await recomputeSeasonBrownlowStatus(tx, fixture.season); });
    const healed = await owner<{ status: string; votes: number | null }[]>`
      SELECT DISTINCT brownlow_status::text AS status, brownlow_votes::int AS votes
        FROM player_season_stats WHERE season = ${fixture.season}`;
    expect(healed).toEqual([{ status: 'pending', votes: null }]);
  });

  it('a pending completed season admits a finalisation, which then reads partial; a not_applicable one is refused', async () => {
    const match = fixture.matches[0];
    const selection = { three: match.homePlayerIds[0], two: match.homePlayerIds[1], one: match.awayPlayerIds[0] };

    // Refusal control on the same fixture: planted not_applicable (what the old rule produced) locks the season.
    await plantRows('not_applicable');
    const refused = await finaliseBrownlowMatch({ matchId: match.matchId, selection, expectedRevision: 0, actorId });
    expect(refused.ok).toBe(false);
    if (refused.ok) throw new Error('unreachable');
    expect(refused.code).toBe('season_not_polled');

    // The state the recompute now produces for a completed, unloaded season admits the decision.
    await plantRows(null);
    await recomputeCommitted(fixture.season);
    const stateBefore = rowFor(await readRows(owner, fixture.season), 'brownlow_season_total').coverage;
    const admitted = await finaliseBrownlowMatch({ matchId: match.matchId, selection, expectedRevision: 0, actorId });
    if (!admitted.ok) {
      throw new Error(`finalisation refused (season_total was '${stateBefore}'): ${admitted.code} ${admitted.message ?? ''}`);
    }
    expect(stateBefore).toBe('pending');
    expect(admitted.value.status).toBe('final');
    const after = await readRows(owner, fixture.season);
    // Decisions now exist for the season: some totals are settled, none published.
    expect(rowFor(after, 'brownlow_season_total').coverage).toBe('partial');
    expect(rowFor(after, 'brownlow_round_votes').coverage).toBe('partial');
  });
});

describe('D-365-1: declared no-medal seasons stay not_applicable', () => {
  // Provenance: stat-availability.json declares 1897-1923 and 1942-1945 not_applicable at every Brownlow grain.
  for (const season of [1900, 1943]) {
    it(`recomputing ${season} inside a rolled-back transaction keeps all three grains not_applicable`, async () => {
      const { before, after, post } = await recomputeRolledBack(season);
      expect(before.map((r) => [r.statKey, r.coverage, r.isRecorded])).toEqual([
        ['brownlow_match_votes', 'not_applicable', false],
        ['brownlow_round_votes', 'not_applicable', false],
        ['brownlow_season_total', 'not_applicable', false],
      ]);
      // Season-total and round rows are byte-identical (every column).
      expect(rowFor(after, 'brownlow_season_total')).toEqual(rowFor(before, 'brownlow_season_total'));
      expect(rowFor(after, 'brownlow_round_votes')).toEqual(rowFor(before, 'brownlow_round_votes'));
      // The match row keeps its coverage claim. Its measured counts are NULL in the loaded row and are filled by ANY
      // recompute (the pre-D-365-1 rule too): populated 0 of the season's home-and-away matches (an independent count).
      const [{ haMatches }] = await owner<{ haMatches: number }[]>`
        SELECT count(*)::int AS "haMatches" FROM matches WHERE season = ${season} AND round_type = 'home_and_away'`;
      expect(haMatches).toBeGreaterThan(0);
      expect(rowFor(before, 'brownlow_match_votes').populatedRows).toBeNull();
      expect({ ...rowFor(after, 'brownlow_match_votes'), populatedRows: null, totalRows: null })
        .toEqual({ ...rowFor(before, 'brownlow_match_votes'), populatedRows: null, totalRows: null });
      expect(rowFor(after, 'brownlow_match_votes').populatedRows).toBe(0);
      expect(rowFor(after, 'brownlow_match_votes').totalRows).toBe(haMatches);
      // And the rollback left the real rows exactly as they were.
      expect(post).toEqual(before);
    });
  }

  it('a declared no-medal season still refuses a Brownlow finalisation (season_not_polled) and writes nothing', async () => {
    const [match] = await owner<{ id: number }[]>`
      SELECT id FROM matches WHERE season = 1943 AND round_type = 'home_and_away' ORDER BY id LIMIT 1`;
    expect(match).toBeDefined();
    const before = await readRows(owner, 1943);
    const [a, b, c] = fixture.playerIds; // lockMatch refuses before the selection is looked at
    const result = await finaliseBrownlowMatch({
      matchId: match.id, selection: { three: a, two: b, one: c }, expectedRevision: 0, actorId,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.code).toBe('season_not_polled');
    expect(await readRows(owner, 1943)).toEqual(before);
    const [{ n }] = await owner<{ n: number }[]>`
      SELECT count(*)::int AS n FROM brownlow_vote_entry_state WHERE match_id = ${match.id}`;
    expect(n).toBe(0);
  });
});

describe('D-365-1: the all-season sweep (every recompute rolled back)', () => {
  it('no season is ever recomputed to not_applicable unless declared; season totals match the committed reference grid', async () => {
    const reference = JSON.parse(readFileSync(
      join(__dirname, '..', '..', 'data', 'reference', 'stat-availability.json'), 'utf8',
    )) as { coverage_ranges: Array<{ stat_key: string; coverage: string; first_season: number; last_season: number }> };
    const gridCoverage = (season: number): string | null =>
      reference.coverage_ranges.find((r) => r.stat_key === 'brownlow_season_total'
        && r.first_season <= season && season <= r.last_season)?.coverage ?? null;

    // Real seasons only: 1897-2027 (2027 is in progress and has no committed row). Fixture seasons are above this.
    const seasons = await owner<{ year: number }[]>`SELECT year FROM seasons WHERE year BETWEEN 1897 AND 2027 ORDER BY year`;
    expect(seasons.length).toBeGreaterThanOrEqual(130);

    const declared = (year: number): boolean => (year >= 1897 && year <= 1923) || (year >= 1942 && year <= 1945);
    const violations: string[] = [];
    for (const { year } of seasons) {
      const { after, before, post } = await recomputeRolledBack(year);
      if (JSON.stringify(post) !== JSON.stringify(before)) violations.push(`${year}: rollback did not restore`);
      for (const key of STAT_KEYS) {
        const coverage = rowFor(after, key).coverage;
        if (declared(year) !== (coverage === 'not_applicable')) {
          violations.push(`${year} ${key}: ${coverage} (declared=${declared(year)})`);
        }
      }
      const expectedTotal = year === 2027 ? 'pending' : gridCoverage(year);
      if (rowFor(after, 'brownlow_season_total').coverage !== expectedTotal) {
        violations.push(`${year} brownlow_season_total: ${rowFor(after, 'brownlow_season_total').coverage} != ${expectedTotal}`);
      }
    }
    expect(violations).toEqual([]);
  }, 120_000);
});
