/**
 * AFLDB-ISSUE-316 C7 observer: the reader's SQL against real PostgreSQL.
 *
 * Every row is written inside ONE transaction that is rolled back by a sentinel, so nothing
 * persists and nothing in the namespace can be left behind. Season 2098 is used by no other suite.
 * The reader itself is called with the transaction handle, and the CLI's own `read only`
 * transaction is exercised separately (a write attempted inside it must fail).
 */
import './guard';

import postgres from 'postgres';
import { afterAll, describe, expect, it } from 'vitest';

import { classifyC7, readC7Facts } from '../../src/lib/acquisition/afl-api-c7-observation';

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
