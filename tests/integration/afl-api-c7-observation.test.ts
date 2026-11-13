/**
 * AFLDB-ISSUE-316 C7 observer: the reader's SQL against real PostgreSQL.
 *
 * Every row is written inside ONE transaction that is rolled back by a sentinel, so nothing
 * persists and nothing in the namespace can be left behind. Season 2098 is used by no other suite.
 * The reader itself is called with the transaction handle, and the CLI's own `read only`
 * transaction is exercised separately (a write attempted inside it must fail).
 */
import './guard';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { classifyC7, readC7Facts } from '../../src/lib/acquisition/afl-api-c7-observation';
import { missingAflApiSeasonEnumeration } from '../../src/lib/acquisition/afl-api-season-enumeration';
import { runSettleAflApi } from '../../src/lib/acquisition/settle-afl-api';
import { parseSourceFamilyRegistry } from '../../src/lib/acquisition/source-families';
import {
  changesOf, classifyOpening, expectedOpening, readOpeningFacts, surfaceDigest, transitionProblems, writeOpening,
  type OpeningExpectation,
} from '../../src/lib/rollover/season-opening';

const SEASON = 2098;
const url = process.env.AFLDB_TEST_DATABASE_URL!;
const db = postgres(url, { max: 1, onnotice: () => {} });
afterAll(async () => { await db.end({ timeout: 5 }); });

class Rollback extends Error {}

/** Three synthetic clubs, created inside the caller's rolled-back transaction (a schema-only database has none). */
async function makeClubs(tx: postgres.TransactionSql, count: number): Promise<{ id: number }[]> {
  await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
  const [org] = await tx<{ id: number }[]>`
    INSERT INTO club_organizations (name, slug) VALUES ('C7 observer org', 'c7-observer-org') RETURNING id`;
  const out: { id: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const slug = `c7-observer-club-${i}`;
    const [club] = await tx<{ id: number }[]>`
      INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
      VALUES (${slug}, ${`C7 Observer Club ${i}`}, ${`C7 ${i}`}, ${`C7${i}`}, -1, ${slug}, ${org.id})
      RETURNING id`;
    await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
    out.push(club);
  }
  return out;
}

describe('readC7Facts against PostgreSQL (rolled back)', () => {
  it('counts only afl_api matches, period rows and both-club statistics, and reads batches', async () => {
    let seen: Awaited<ReturnType<typeof readC7Facts>> | null = null;
    let verdictOk = false;
    await db.begin(async (tx) => {
      const [{ since }] = await tx<{ since: string }[]>`SELECT (now() - interval '1 second')::text AS since`;
      const [aflApi] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
      const [other] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key <> 'afl_api' ORDER BY id LIMIT 1`;
      expect(aflApi, 'sources.afl_api must exist (migration)').toBeTruthy();
      const clubs = await makeClubs(tx, 3);
      expect(clubs.length).toBe(3);
      await tx`INSERT INTO seasons (year, league) VALUES (${SEASON}, 'AFL') ON CONFLICT (year) DO NOTHING`;

      const insertMatch = async (n: number, sourceId: number, home: number, away: number) => {
        const [m] = await tx<{ id: number }[]>`
          INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
                               home_club_id, away_club_id, home_score, away_score, result, margin, attendance_status,
                               source_id, source_record_id)
          VALUES (${`${SEASON}|1|${SEASON}-03-0${n}|c7-${n}h|c7-${n}a`}, ${SEASON}, '1', 1, 'home_and_away', false,
                  ${`${SEASON}-03-0${n}`}, 'Test Venue', ${home}, ${away}, 60, 30, 'home_win', 30,
                  'not_collected'::coverage_status, ${sourceId}, ${`CD_M${SEASON}C7${n}`})
          RETURNING id`;
        return m.id;
      };
      const full = await insertMatch(1, aflApi.id, clubs[0].id, clubs[1].id);       // periods + both-club stats
      const bare = await insertMatch(2, aflApi.id, clubs[0].id, clubs[2].id);       // neither
      const foreign = await insertMatch(3, other.id, clubs[1].id, clubs[2].id);     // other source
      expect([full, bare, foreign].every(Number.isInteger)).toBe(true);

      for (const club of [clubs[0].id, clubs[1].id]) {
        for (const period of [1, 2, 3, 4]) {
          await tx`INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points) VALUES (${full}, ${club}, ${period}, 1, 1, 7)`;
        }
      }
      // only 3 periods for the bare match's home club: must not count as "with period scores"
      for (const period of [1, 2, 3]) {
        await tx`INSERT INTO match_period_scores (match_id, club_id, period, goals, behinds, points) VALUES (${bare}, ${clubs[0].id}, ${period}, 1, 1, 7)`;
      }
      for (const [i, club] of [clubs[0].id, clubs[1].id].entries()) {
        const name = `C7 Observer Player ${i}`;
        const [p] = await tx<{ id: number }[]>`
          INSERT INTO players (display_name, search_name, sort_name, slug)
          VALUES (${name}, afldb_normalise_name(${name}), ${name}, ${`c7-observer-player-${i}`}) RETURNING id`;
        await tx`INSERT INTO player_match_stats (player_id, match_id, club_id) VALUES (${p.id}, ${full}, ${club})`;
      }
      // one club only on the bare match: must not count as "both clubs"
      const [solo] = await tx<{ id: number }[]>`
        INSERT INTO players (display_name, search_name, sort_name, slug)
        VALUES ('C7 Observer Solo', afldb_normalise_name('C7 Observer Solo'), 'C7 Observer Solo', 'c7-observer-solo') RETURNING id`;
      await tx`INSERT INTO player_match_stats (player_id, match_id, club_id) VALUES (${solo.id}, ${bare}, ${clubs[0].id})`;

      const counters = JSON.stringify({
        seasonFeedMatches: 2, seasonFeedComplete: 1, seasonFeedStatusCounts: { CONCLUDED: 2 }, derivedRecomputeRuns: 1,
      });
      await tx`
        INSERT INTO import_batches (source_id, tool, status, started_at, completed_at, notes, validation_result)
        VALUES (${aflApi.id}, 'settle-afl-api.ts', 'completed', now(), now(), ${`season=${SEASON};snapshot=c7-test;`}, ${counters}::text::jsonb)`;
      await tx`
        INSERT INTO import_batches (source_id, tool, status, started_at, notes)
        VALUES (${aflApi.id}, 'settle-afl-api.ts', 'running', now(), ${`season=${SEASON};snapshot=c7-test-running;`})`;
      await tx`
        INSERT INTO import_batches (source_id, tool, status, started_at, completed_at)
        VALUES (${aflApi.id}, 'settle-afltables.ts', 'completed', now(), now())`;

      seen = await readC7Facts(tx, { season: SEASON, since, round: null, expectedConcluded: null, unit: null });
      // 2 concluded in the feed, 2 afl_api matches, but one lacks periods and stats and a batch is still running
      verdictOk = classifyC7(seen).verdict === 'FAILED_PROCESSING';

      // the CLI's transaction type forbids writes: prove that against this same database
      throw new Rollback();
    }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });

    expect(seen).not.toBeNull();
    const facts = seen!;
    expect(facts.canonical).toEqual({ matches: 2, withPeriodScores: 1, withPlayerStatsBothClubs: 1, otherSource: 1 });
    expect(facts.afltablesBatchesSince).toBe(1);
    const ours = facts.batches.filter((b) => b.season === SEASON);
    expect(ours.map((b) => b.status).sort()).toEqual(['completed', 'running']);
    const completed = ours.find((b) => b.status === 'completed')!;
    expect(completed.counters).toMatchObject({ seasonFeedComplete: 1 });
    expect(verdictOk).toBe(true); // running batch => FAILED_PROCESSING, deliberately

    const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM matches WHERE season = ${SEASON}`;
    expect(n).toBe(0); // rolled back
  });

  it('the CLI\'s read-only transaction refuses a write', async () => {
    const probe = postgres(url, { max: 1, onnotice: () => {} });
    try {
      let message = '';
      try {
        await probe.begin('read only', async (ro) => {
          await ro`INSERT INTO sources (key, name, kind) VALUES ('c7-write-probe', 'x', 'manual')`;
        });
      } catch (error) { message = String(error); }
      expect(message).toMatch(/read-only/);
      const [{ n }] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM sources WHERE key = 'c7-write-probe'`;
      expect(n).toBe(0);
    } finally { await probe.end({ timeout: 5 }); }
  });

  it('the round filter narrows the canonical counts', async () => {
    let seen: Awaited<ReturnType<typeof readC7Facts>> | null = null;
    await db.begin(async (tx) => {
      const [aflApi] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afl_api'`;
      const clubs = await makeClubs(tx, 2);
      await tx`INSERT INTO seasons (year, league) VALUES (${SEASON}, 'AFL') ON CONFLICT (year) DO NOTHING`;
      for (const round of ['1', '2']) {
        await tx`
          INSERT INTO matches (match_key, season, round_code, round_number, round_type, is_final, match_date, venue_raw,
                               home_club_id, away_club_id, home_score, away_score, result, margin, attendance_status, source_id)
          VALUES (${`${SEASON}|${round}|${SEASON}-04-0${round}|c7r-h|c7r-a`}, ${SEASON}, ${round}, ${Number(round)}, 'home_and_away', false,
                  ${`${SEASON}-04-0${round}`}, 'Test Venue', ${clubs[0].id}, ${clubs[1].id}, 60, 30, 'home_win', 30,
                  'not_collected'::coverage_status, ${aflApi.id})`;
      }
      seen = await readC7Facts(tx, { season: SEASON, since: new Date().toISOString(), round: '2', expectedConcluded: 1, unit: null });
      throw new Rollback();
    }).catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
    expect(seen!.canonical.matches).toBe(1);
  });
});

/*
 * AFLDB-ISSUE-350 / ISSUE-332 gate: the season-opening reader and writer against real PostgreSQL, all inside ONE rolled-back
 * transaction. Two oracles, chosen by what the database holds (a stated property of the oracle, never a literal count):
 *   - clubs present (a rebuilt `afldb_test`, or a production snapshot): the REAL tracked contract. A rebuilt database already
 *     has the season (state OPEN, which is also the proof that the tracked register and a fresh load agree); the snapshot is
 *     production's pre-opening state. Either way the test first restores production's pre-opening state INSIDE the transaction
 *     (open identities back to year - 1, season row removed) and then runs the real write.
 *   - schema-only (no clubs): a synthetic register of three identities and a synthetic previous season.
 */
describe('season opening (AFLDB-ISSUE-350) against PostgreSQL (rolled back)', () => {
  const root = process.cwd();
  const seasonsDoc = JSON.parse(readFileSync(join(root, 'data/reference/seasons.json'), 'utf8'));
  const clubsDoc = JSON.parse(readFileSync(join(root, 'data/reference/clubs.json'), 'utf8'));

  /** The synthetic world of a schema-only database: three open identities, one previous season, one next. */
  async function syntheticWorld(tx: postgres.TransactionSql) {
    await tx`INSERT INTO seasons (year, league, status) VALUES (2096, 'AFL', 'complete'::season_status)`;
    await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
    const identities: Record<string, unknown>[] = [];
    for (let i = 0; i < 3; i += 1) {
      const slug = `s350-club-${i}`;
      const [org] = await tx<{ id: number }[]>`INSERT INTO club_organizations (name, slug, first_season, last_season) VALUES (${`S350 org ${i}`}, ${`${slug}-org`}, 2096, 2096) RETURNING id`;
      const [club] = await tx<{ id: number }[]>`
        INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id, succession, is_current_afl_club, first_season, last_season)
        VALUES (${slug}, ${`S350 Club ${i}`}, ${`S${i}`}, ${`S3${i}`}, -1, ${slug}, ${org.id}, 'current', true, ${2096}, ${2096}) RETURNING id`;
      await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
      // the historical arm of afldb_season_list_clubs needs a club_seasons row for the previous season, as every real club has
      await tx`INSERT INTO club_seasons (season, club_id, played, wins, draws, losses, points_for, points_against) VALUES (2096, ${club.id}, 0, 0, 0, 0, 0, 0)`;
      identities.push({ hist: slug, slug, succession: 'current', is_current_afl_club: true, first_season: 2096, last_season: null });
    }
    return {
      seasonsDoc: { first_season: 1897, last_season: 2097, league_eras: [{ league: 'AFL', first_season: 1990, last_season: null }], in_progress_seasons: [2097], season_notes: { '2097': 'synthetic' } },
      clubsDoc: { identities },
    };
  }

  /** Real data: put production's pre-opening state back inside the transaction. */
  async function productionLike(tx: postgres.TransactionSql, exp: OpeningExpectation) {
    const [{ m }] = await tx<{ m: number }[]>`SELECT max(year)::int AS m FROM seasons`;
    expect(m, `seasons must end at ${exp.year} (open) or ${exp.previousYear} (production-like); a fixture season above is left over from another run`).toBeGreaterThanOrEqual(exp.previousYear);
    expect([exp.previousYear, exp.year]).toContain(m);
    if (m === exp.year) {
      await tx`UPDATE clubs SET last_season = ${exp.previousYear}::smallint WHERE is_current_afl_club AND last_season = ${exp.year}::smallint`;
      await tx`UPDATE club_organizations SET last_season = ${exp.previousYear}::smallint WHERE last_season = ${exp.year}::smallint`;
      // fails loudly if anything already depends on the season row
      await tx`DELETE FROM seasons WHERE year = ${exp.year}::smallint`;
    }
  }

  async function rolledBack(work: (tx: postgres.TransactionSql) => Promise<void>): Promise<void> {
    await db.begin(async (tx) => { await work(tx); throw new Rollback(); })
      .catch((error: unknown) => { if (!(error instanceof Rollback)) throw error; });
  }

  it('production-like state classifies NOT_OPEN, the write opens it, the proof holds, a second write is a no-op and a divergent row is refused', async () => {
    let ran = false;
    await rolledBack(async (tx) => {
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM clubs`;
      const world = n === 0 ? await syntheticWorld(tx) : { seasonsDoc, clubsDoc };
      const exp = expectedOpening(world.seasonsDoc, world.clubsDoc);
      if (n > 0) await productionLike(tx, exp);

      const before = await readOpeningFacts(tx, exp.year);
      const verdict = classifyOpening(exp, before);
      expect(verdict.problems).toEqual([]);
      expect(verdict.state).toBe('NOT_OPEN');
      const changes = changesOf(verdict);
      expect(changes.insertSeason).toBe(true);
      expect(changes.clubIds).toHaveLength(exp.open.length);
      expect(before.identityForYear.every((r) => r.club === null)).toBe(true); // the defect: no club resolves for the season

      await writeOpening(tx, exp, changes);
      const after = await readOpeningFacts(tx, exp.year);
      expect(transitionProblems(exp, changes, before, after)).toEqual([]);
      expect(classifyOpening(exp, after).state).toBe('OPEN');
      expect(after.identityForYear.filter((r) => r.club !== null)).toHaveLength(exp.open.length);

      // idempotent: the open state has nothing left to change, and writing nothing touches nothing
      const again = changesOf(classifyOpening(exp, after));
      expect(again).toEqual({ insertSeason: false, clubIds: [], orgIds: [] });
      await writeOpening(tx, exp, again);
      expect(surfaceDigest(await readOpeningFacts(tx, exp.year))).toBe(surfaceDigest(after));

      // present and different is a refusal, never an adoption
      await tx`UPDATE seasons SET status = 'complete'::season_status WHERE year = ${exp.year}::smallint`;
      const refused = classifyOpening(exp, await readOpeningFacts(tx, exp.year));
      expect(refused.state).toBe('REFUSED');
      expect(refused.problems.join('\n')).toMatch(/differs from the tracked contract/);
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('a count mismatch between the plan and the live rows throws, so the transaction cannot commit a wrong write', async () => {
    await rolledBack(async (tx) => {
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM clubs`;
      const world = n === 0 ? await syntheticWorld(tx) : { seasonsDoc, clubsDoc };
      const exp = expectedOpening(world.seasonsDoc, world.clubsDoc);
      if (n > 0) await productionLike(tx, exp);
      const verdict = classifyOpening(exp, await readOpeningFacts(tx, exp.year));
      const changes = changesOf(verdict);
      // a plan naming a club that no longer holds year - 1 is refused by the bounded UPDATE itself
      await tx`INSERT INTO seasons (year, league, status, notes) VALUES (${exp.year}::smallint, ${exp.league}, 'in_progress'::season_status, ${exp.notes})`;
      await tx`UPDATE clubs SET last_season = ${exp.year}::smallint WHERE id = ${changes.clubIds[0]}`;
      await expect(writeOpening(tx, exp, { ...changes, insertSeason: false })).rejects.toThrow(/updated \d+ clubs rows/);
    });
  });

  it('the settle HALT precondition is the same row the operation creates: season absent before, present after', async () => {
    await rolledBack(async (tx) => {
      const [{ n }] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM clubs`;
      const world = n === 0 ? await syntheticWorld(tx) : { seasonsDoc, clubsDoc };
      const exp = expectedOpening(world.seasonsDoc, world.clubsDoc);
      if (n > 0) await productionLike(tx, exp);
      const seasonRow = () => tx<{ year: number }[]>`SELECT year FROM seasons WHERE year = ${exp.year}`;
      expect(await seasonRow()).toHaveLength(0);
      // The real settle, run inside this rolled-back transaction (begin runs the callback on `tx`), halts by name before any write.
      const registry = parseSourceFamilyRegistry(JSON.parse(readFileSync(join(root, 'data/reference/source-families.json'), 'utf8')));
      const halted = await runSettleAflApi({ begin: async (callback: (t: postgres.TransactionSql) => unknown) => callback(tx) } as unknown as postgres.Sql, {
        registry, apply: true, autoApply: true, requireCompleteSource: true, inProgressSeasons: [exp.year],
        bundle: { snapshotLabel: 'issue350-halt', season: exp.year, bundleContractVersion: 2, units: [{ bundle: {} as never, settleRecords: [] }], buildFailures: [], seasonFeed: missingAflApiSeasonEnumeration(exp.year, 'CD_S350') },
      });
      expect(halted.halt?.reason).toBe('season_row_missing');
      expect(halted.applied).toBe(false);
      expect(halted.batchId).toBeNull();
      await writeOpening(tx, exp, changesOf(classifyOpening(exp, await readOpeningFacts(tx, exp.year))));
      expect(await seasonRow()).toHaveLength(1);
    });
  });
});
