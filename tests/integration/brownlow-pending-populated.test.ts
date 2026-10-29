import './guard';

import { createHash } from 'node:crypto';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getClubBrownlowMedallists } from '@/db/queries/awards';
import { getBrownlowCareerLeaders, getBrownlowWinners } from '@/db/queries/brownlow';
import { axisPlayerIds } from '@/db/queries/grid-solver';
import { recomputeBrownlowCareerTotals, recomputeSeasonBrownlowStatus } from '@/db/queries/player-derived';
import { getPlayerBrownlow } from '@/db/queries/players';
import { getSeasonBrownlow } from '@/db/queries/seasons';
import type { GridAxisState } from '@/search/grid-solver-spec';

/**
 * AFLDB-ISSUE-316 — pending-Brownlow suppression proved over a POPULATED rebuilt database and a REAL
 * pending season, complementing brownlow-pending-projection.test.ts (which uses throwaway rows in a
 * reserved season on a bare template).
 *
 * Runs only against a COPY of a completed C2 rehearsal database (AFLDB_POPULATED_REHEARSAL_STATE=1):
 * 2026 must really be pending (availability `pending`, no authority row, no stored 2026 source vote)
 * and the accepted history must be present. It then plants three UNACCEPTED 2026 source votes on real
 * 2026 players and shows, through the real recomputes and projections, that no total, medal, winner,
 * rank, status or leader entry for 2026 appears and that every unrelated player's career total is
 * unchanged; that explicit acceptance exposes exactly the planted rows; and that withdrawing the
 * acceptance and removing the rows restores the whole-table fingerprints byte for byte.
 *
 * The planted votes are SYNTHETIC test data: they say nothing about any real 2026 vote.
 * COMMITTED changes (the code under test reads on its own pool); restored in `afterAll`. Never run it
 * on a database that is not a disposable copy.
 */

const SEASON = 2026;
const NS = 'issue316-bpop';
const enabled = process.env.AFLDB_POPULATED_REHEARSAL_STATE === '1';

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 2, onnotice: () => {} });

type Availability = { is_recorded: boolean; populated_rows: number | null; total_rows: number | null; coverage: string };
type Subject = { playerId: number; clubId: number; votes: number; rank: number };

let originalAvailability: Availability;
let subjects: Subject[] = [];
let planted = false;
let baseline: { careerFingerprint: string; statusFingerprint: string; winnersFingerprint: string; career: Map<number, { votes: number; medals: number }>; leaders: string };

const md5 = (value: unknown) => createHash('md5').update(JSON.stringify(value)).digest('hex');

async function careerFingerprint(): Promise<string> {
  const [row] = await owner<{ fingerprint: string }[]>`
    SELECT md5(string_agg(player_id::text || ':' || brownlow_votes::text || ':' || brownlow_medals::text, '|' ORDER BY player_id)) AS fingerprint
      FROM player_career_stats`;
  return row.fingerprint;
}

async function seasonStatusFingerprint(): Promise<string> {
  const [row] = await owner<{ fingerprint: string }[]>`
    SELECT md5(string_agg(player_id::text || ':' || brownlow_status::text || ':' || coalesce(brownlow_votes::text, '~'), '|' ORDER BY player_id)) AS fingerprint
      FROM player_season_stats WHERE season = ${SEASON}`;
  return row.fingerprint;
}

async function setAvailability(coverage: 'pending' | 'complete'): Promise<void> {
  await owner`
    UPDATE stat_availability SET coverage = ${coverage}::coverage_status, is_recorded = ${coverage === 'complete' ? true : originalAvailability.is_recorded}
     WHERE stat_key = 'brownlow_season_total' AND season = ${SEASON}`;
}

async function recomputeAll(): Promise<void> {
  const ids = subjects.map((s) => s.playerId);
  await owner.begin(async (tx) => {
    await recomputeSeasonBrownlowStatus(tx, SEASON);
    await recomputeBrownlowCareerTotals(tx, ids);
  });
}

async function project() {
  const ids = subjects.map((s) => s.playerId);
  const axis = (builder: GridAxisState['builder'], params: GridAxisState['params']) =>
    axisPlayerIds({ builder, params } as GridAxisState);
  const mine = new Set(ids);
  const medallistSet = await axis('brownlow_medallist', {});
  return {
    winners2026: (await getBrownlowWinners()).filter((r) => r.season === SEASON).map((r) => r.playerId),
    seasonRows: await getSeasonBrownlow(SEASON, 50),
    playerRows2026: (await Promise.all(ids.map((id) => getPlayerBrownlow(id)))).flat().filter((r) => r.season === SEASON),
    medallists2026: (await Promise.all(subjects.map((s) => getClubBrownlowMedallists(s.clubId)))).flat().filter((r) => r.season === SEASON),
    medallistAxis: ids.filter((id) => medallistSet.has(id)),
    seasonStatus: await owner<{ playerId: number; status: string; votes: number | null }[]>`
      SELECT player_id::int AS "playerId", brownlow_status::text AS status, brownlow_votes::int AS votes
        FROM player_season_stats WHERE season = ${SEASON} AND player_id = ANY(${ids}) ORDER BY player_id`,
    career: await owner<{ playerId: number; votes: number; medals: number }[]>`
      SELECT player_id::int AS "playerId", brownlow_votes::int AS votes, brownlow_medals::int AS medals
        FROM player_career_stats WHERE player_id = ANY(${ids}) ORDER BY player_id`,
    leaders: (await getBrownlowCareerLeaders({ limit: 100_000 })).rows.filter((r) => mine.has(r.playerId)).map((r) => r.playerId),
  };
}

describe.skipIf(!enabled)('AFLDB-ISSUE-316: unaccepted votes planted in the real pending 2026 season of a populated rebuild', () => {
  beforeAll(async () => {
    const [avail] = await owner<Availability[]>`
      SELECT is_recorded, populated_rows, total_rows, coverage::text AS coverage FROM stat_availability
       WHERE stat_key = 'brownlow_season_total' AND season = ${SEASON}`;
    const [{ authority }] = await owner<{ authority: number }[]>`SELECT count(*)::int AS authority FROM brownlow_season_authority WHERE season = ${SEASON}`;
    const [{ stored }] = await owner<{ stored: number }[]>`SELECT count(*)::int AS stored FROM brownlow_season_votes WHERE season = ${SEASON}`;
    const [{ history }] = await owner<{ history: number }[]>`SELECT count(DISTINCT season)::int AS history FROM brownlow_season_votes WHERE season < ${SEASON}`;
    if (!avail || avail.coverage !== 'pending' || authority !== 0 || stored !== 0 || history < 50) {
      throw new Error(`Refusing to run: not a pending-2026 populated rebuild (availability=${avail?.coverage}, authority rows=${authority}, stored 2026 votes=${stored}, historical seasons=${history}).`);
    }
    originalAvailability = avail;
    const rows = await owner<{ playerId: number; clubId: number }[]>`
      SELECT player_id::int AS "playerId", primary_club_id::int AS "clubId" FROM player_season_stats
       WHERE season = ${SEASON} AND primary_club_id IS NOT NULL ORDER BY games DESC, player_id LIMIT 3`;
    if (rows.length !== 3) throw new Error('Refusing to run: fewer than three 2026 players on the copy.');
    subjects = rows.map((r, i) => ({ ...r, votes: [25, 20, 15][i], rank: i + 1 }));
    const career = new Map<number, { votes: number; medals: number }>();
    for (const r of await owner<{ playerId: number; votes: number; medals: number }[]>`
      SELECT player_id::int AS "playerId", brownlow_votes::int AS votes, brownlow_medals::int AS medals FROM player_career_stats`) {
      career.set(r.playerId, { votes: r.votes, medals: r.medals });
    }
    baseline = {
      careerFingerprint: await careerFingerprint(),
      statusFingerprint: await seasonStatusFingerprint(),
      winnersFingerprint: md5(await getBrownlowWinners()),
      career,
      leaders: md5((await getBrownlowCareerLeaders({ limit: 100_000 })).rows),
    };
  }, 120_000);

  afterAll(async () => {
    try {
      if (planted) {
        await owner`DELETE FROM brownlow_season_votes WHERE season = ${SEASON} AND source_record_id LIKE ${`${NS}-%`}`;
        await setAvailability('pending');
        await recomputeAll();
      }
    } finally {
      await owner.end({ timeout: 5 });
    }
  }, 120_000);

  it('baseline: every career total equals the sum of its ACCEPTED season votes (history and 2025 intact; 2026 contributes nothing)', async () => {
    const [counts] = await owner<{ mismatched: number; players: number; seasons: number; votes: number; winners: number }[]>`
      WITH accepted AS (
        SELECT player_id, sum(votes)::int AS votes, count(*) FILTER (WHERE is_winner)::int AS medals
          FROM brownlow_season_votes b
         WHERE EXISTS (SELECT 1 FROM stat_availability av WHERE av.stat_key = 'brownlow_season_total' AND av.season = b.season AND av.coverage = 'complete')
           AND NOT EXISTS (SELECT 1 FROM stat_availability av WHERE av.stat_key = 'brownlow_season_total' AND av.season = b.season AND av.coverage = 'not_applicable')
         GROUP BY player_id)
      SELECT (SELECT count(*)::int FROM player_career_stats c LEFT JOIN accepted a USING (player_id)
               WHERE c.brownlow_votes IS DISTINCT FROM coalesce(a.votes, 0) OR c.brownlow_medals IS DISTINCT FROM coalesce(a.medals, 0)) AS mismatched,
             (SELECT count(*)::int FROM accepted) AS players,
             (SELECT count(DISTINCT season)::int FROM brownlow_season_votes WHERE season < ${SEASON}) AS seasons,
             (SELECT coalesce(sum(votes), 0)::int FROM brownlow_season_votes WHERE season < ${SEASON}) AS votes,
             (SELECT count(*)::int FROM brownlow_season_votes WHERE season < ${SEASON} AND is_winner) AS winners`;
    expect(counts.mismatched).toBe(0);
    expect(counts.players).toBeGreaterThan(0);
    expect(counts.seasons).toBeGreaterThanOrEqual(50);
    expect((await project()).winners2026).toEqual([]);
  });

  it('plants three UNACCEPTED 2026 source votes on real 2026 players; no projection exposes them and no career total moves', async () => {
    const [source] = await owner<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
    for (const s of subjects) {
      await owner`
        INSERT INTO brownlow_season_votes (season, player_id, club_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner, source_id, source_record_id)
        VALUES (${SEASON}, ${s.playerId}, ${s.clubId}, ${s.votes}, ${s.rank}, ${s.rank}, false, ${s.rank === 1}, ${source.id}, ${`${NS}-${s.rank}`})`;
    }
    planted = true;
    await recomputeAll();
    const p = await project();
    expect(p.winners2026).toEqual([]);
    expect(p.seasonRows).toEqual([]);
    expect(p.playerRows2026).toEqual([]);
    expect(p.medallists2026).toEqual([]);
    expect(p.medallistAxis.filter((id) => baseline.career.get(id)?.medals === 0)).toEqual([]);
    for (const row of p.seasonStatus) expect(row).toMatchObject({ status: 'pending', votes: null });
    expect(p.seasonStatus).toHaveLength(3);
    for (const row of p.career) expect(row).toEqual({ playerId: row.playerId, ...baseline.career.get(row.playerId) });
    expect(await careerFingerprint()).toBe(baseline.careerFingerprint);
    expect(await seasonStatusFingerprint()).toBe(baseline.statusFingerprint);
    expect(md5(await getBrownlowWinners())).toBe(baseline.winnersFingerprint);
    expect(md5((await getBrownlowCareerLeaders({ limit: 100_000 })).rows)).toBe(baseline.leaders);
  }, 120_000);

  it('CONTROL: explicit acceptance exposes exactly the planted rows and adds exactly their votes to the careers', async () => {
    await setAvailability('complete');
    await recomputeAll();
    const p = await project();
    const [first, second, third] = subjects;
    expect(p.winners2026).toEqual([first.playerId]);
    expect(p.seasonRows.map((r) => ({ id: r.id, votes: r.votes }))).toEqual([
      { id: first.playerId, votes: 25 }, { id: second.playerId, votes: 20 }, { id: third.playerId, votes: 15 },
    ]);
    expect(p.seasonStatus.map((r) => r.status)).toEqual(['complete', 'complete', 'complete']);
    for (const s of subjects) {
      const before = baseline.career.get(s.playerId)!;
      const after = p.career.find((r) => r.playerId === s.playerId)!;
      expect(after.votes).toBe(before.votes + s.votes);
      expect(after.medals).toBe(before.medals + (s.rank === 1 ? 1 : 0));
    }
    expect(await careerFingerprint()).not.toBe(baseline.careerFingerprint);
  }, 120_000);

  it('withdrawing acceptance and removing the rows restores every whole-table fingerprint exactly', async () => {
    await owner`DELETE FROM brownlow_season_votes WHERE season = ${SEASON} AND source_record_id LIKE ${`${NS}-%`}`;
    await setAvailability('pending');
    await recomputeAll();
    planted = false;
    const p = await project();
    expect(p.winners2026).toEqual([]);
    for (const row of p.seasonStatus) expect(row).toMatchObject({ status: 'pending', votes: null });
    expect(await careerFingerprint()).toBe(baseline.careerFingerprint);
    expect(await seasonStatusFingerprint()).toBe(baseline.statusFingerprint);
    expect(md5(await getBrownlowWinners())).toBe(baseline.winnersFingerprint);
    expect(md5((await getBrownlowCareerLeaders({ limit: 100_000 })).rows)).toBe(baseline.leaders);
    const [restored] = await owner<Availability[]>`
      SELECT is_recorded, populated_rows, total_rows, coverage::text AS coverage FROM stat_availability
       WHERE stat_key = 'brownlow_season_total' AND season = ${SEASON}`;
    expect(restored).toEqual(originalAvailability);
  }, 120_000);
});
