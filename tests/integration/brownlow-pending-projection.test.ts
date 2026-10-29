import './guard';

import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { getClubBrownlowMedallists } from '@/db/queries/awards';
import { getBrownlowCareerLeaders, getBrownlowWinners } from '@/db/queries/brownlow';
import { axisPlayerIds } from '@/db/queries/grid-solver';
import {
  recomputeBrownlowCareerTotals,
  recomputePlayerDerivedStats,
  recomputeSeasonBrownlowStatus,
} from '@/db/queries/player-derived';
import { getPlayerBrownlow } from '@/db/queries/players';
import { getSeasonBrownlow } from '@/db/queries/seasons';
import type { GridAxisState } from '@/search/grid-solver-spec';

/**
 * AFLDB-ISSUE-316 (closure limitation L2) — a pending Brownlow season whose stored source votes
 * are NOT accepted must yield no authoritative total, winner, rank, season status or publication
 * through the REAL projections.
 *
 * The earlier "zero exposed rows" evidence was vacuous: the database held no unaccepted source
 * vote at all, so a projection that ignored acceptance would also have returned nothing. This
 * suite plants SYNTHETIC unaccepted source votes (three `afltables`-owned
 * `brownlow_season_votes` rows, namespaced `issue316-bpend-`, in the reserved season 2066) and
 * runs every affected projection against them, in each way a season can be unaccepted. Each
 * assertion has a positive control: the same rows, once ACCEPTED, are returned. A projection that
 * passes the pending cases only because it reads nothing fails the control.
 *
 * The data are synthetic test fixtures. They are not evidence about any real season, and nothing
 * here is a statement about Brownlow 2026.
 *
 * COMMITTED FIXTURES (the code under test reads on its own pool), swept in `afterAll`. The suite
 * refuses to start over an existing 2066 season or a namespaced row it did not create.
 */

const SEASON = 2066;
const NS = 'issue316-bpend';
const ACTOR_EMAIL = `${NS}-actor@example.test`;

const owner = postgres(process.env.AFLDB_TEST_DATABASE_URL as string, { max: 2, onnotice: () => {} });

type Fixture = { orgId: number; clubId: number; actorId: number; playerIds: [number, number, number] };
let fixture: Fixture;

async function purge(): Promise<void> {
  const players = await owner<{ id: number }[]>`SELECT id FROM players WHERE slug LIKE ${`${NS}-%`}`;
  const ids = players.map((r) => r.id);
  await owner`DELETE FROM player_season_stats WHERE season = ${SEASON}`;
  if (ids.length > 0) {
    await owner`DELETE FROM player_career_stats WHERE player_id = ANY(${ids})`;
    await owner`DELETE FROM player_clubs WHERE player_id = ANY(${ids})`;
  }
  await owner`DELETE FROM brownlow_season_votes WHERE season = ${SEASON}`;
  await owner`DELETE FROM brownlow_season_authority WHERE season = ${SEASON}`;
  await owner`DELETE FROM stat_availability WHERE season = ${SEASON}`;
  if (ids.length > 0) await owner`DELETE FROM players WHERE id = ANY(${ids})`;
  await owner`DELETE FROM seasons WHERE year = ${SEASON}`;
  await owner`DELETE FROM clubs WHERE slug LIKE ${`${NS}-%`}`;
  await owner`DELETE FROM club_organizations WHERE slug LIKE ${`${NS}-%`}`;
  await owner`DELETE FROM auth_users WHERE email = ${ACTOR_EMAIL}`;
}

async function setCoverage(coverage: 'complete' | 'partial' | 'not_applicable' | 'pending' | null): Promise<void> {
  await owner`DELETE FROM stat_availability WHERE stat_key = 'brownlow_season_total' AND season = ${SEASON}`;
  if (coverage === null) return;
  await owner`
    INSERT INTO stat_availability (stat_key, season, is_recorded, coverage)
    VALUES ('brownlow_season_total', ${SEASON}, ${coverage === 'complete' || coverage === 'partial'},
            ${coverage}::coverage_status)
  `;
}

async function setAuthority(state: 'absent' | 'unpublished' | 'published'): Promise<void> {
  await owner`DELETE FROM brownlow_season_authority WHERE season = ${SEASON}`;
  if (state === 'absent') return;
  if (state === 'unpublished') {
    await owner`
      INSERT INTO brownlow_season_authority (season, revision, updated_by)
      VALUES (${SEASON}, 1, ${fixture.actorId})
    `;
    return;
  }
  await owner`
    INSERT INTO brownlow_season_authority (season, revision, published_revision, published_by, published_at, updated_by)
    VALUES (${SEASON}, 1, 1, ${fixture.actorId}, now(), ${fixture.actorId})
  `;
}

type Projection = {
  winners: number[];
  seasonRows: { id: number; votes: number; isWinner: boolean }[];
  playerRows: { season: number; votes: number; voteRank: number | null; isWinner: boolean }[];
  medallists: number[];
  medallistAxis: boolean;
  careerMinAxis: boolean;
  seasonStatus: { status: string; votes: number | null }[];
  career: { votes: number; medals: number }[];
  leaders: number[];
};

/** Run every affected real recompute, then read every affected real projection. */
async function project(): Promise<Projection> {
  const ids = fixture.playerIds;
  await owner.begin(async (tx) => {
    // recomputePlayerDerivedStats replaces the season rows of the ids it is given, and these
    // fixture players have no match statistics, so the season rows are re-planted as 'pending'
    // before the season-status recompute that the Brownlow workflow runs.
    await recomputePlayerDerivedStats(tx, [...ids], SEASON);
    await tx`DELETE FROM player_season_stats WHERE season = ${SEASON}`;
    for (const id of ids) {
      await tx`
        INSERT INTO player_season_stats (player_id, season, primary_club_id, games, brownlow_status)
        VALUES (${id}, ${SEASON}, ${fixture.clubId}, 1, 'pending'::coverage_status)`;
    }
    await recomputeSeasonBrownlowStatus(tx, SEASON);
    await recomputeBrownlowCareerTotals(tx, [...ids]);
  });
  const mine = new Set<number>(ids);
  const axis = (builder: GridAxisState['builder'], params: GridAxisState['params']) =>
    axisPlayerIds({ builder, params } as GridAxisState);
  const medallistSet = await axis('brownlow_medallist', {});
  const careerSet = await axis('brownlow_votes_career_min', { votes: '1' });
  return {
    winners: (await getBrownlowWinners()).filter((r) => r.season === SEASON).map((r) => r.playerId),
    seasonRows: (await getSeasonBrownlow(SEASON, 10)).map((r) => ({ id: r.id, votes: r.votes, isWinner: r.isWinner })),
    playerRows: await getPlayerBrownlow(ids[0]),
    medallists: (await getClubBrownlowMedallists(fixture.clubId)).filter((r) => r.season === SEASON).map((r) => r.playerId),
    medallistAxis: medallistSet.has(ids[0]),
    careerMinAxis: careerSet.has(ids[0]),
    seasonStatus: await owner<{ status: string; votes: number | null }[]>`
      SELECT brownlow_status::text AS status, brownlow_votes::int AS votes
        FROM player_season_stats WHERE season = ${SEASON} ORDER BY player_id`,
    career: await owner<{ votes: number; medals: number }[]>`
      SELECT brownlow_votes::int AS votes, brownlow_medals::int AS medals
        FROM player_career_stats WHERE player_id = ANY(${[...ids]}) ORDER BY player_id`,
    leaders: (await getBrownlowCareerLeaders({ limit: 10_000 })).rows
      .filter((r) => mine.has(r.playerId)).map((r) => r.playerId),
  };
}

function expectNothingAuthoritative(p: Projection, status: 'pending' | 'not_applicable'): void {
  expect(p.winners).toEqual([]);
  expect(p.seasonRows).toEqual([]);
  expect(p.playerRows).toEqual([]);
  expect(p.medallists).toEqual([]);
  expect(p.medallistAxis).toBe(false);
  expect(p.careerMinAxis).toBe(false);
  expect(p.seasonStatus).toHaveLength(3);
  for (const row of p.seasonStatus) expect(row).toEqual({ status, votes: null });
  expect(p.career).toEqual([{ votes: 0, medals: 0 }, { votes: 0, medals: 0 }, { votes: 0, medals: 0 }]);
  expect(p.leaders).toEqual([]);
}

describe('AFLDB-ISSUE-316 L2: unaccepted pending-Brownlow source votes reach no authoritative projection', () => {
  beforeAll(async () => {
    const taken = await owner`SELECT 1 FROM seasons WHERE year = ${SEASON}`;
    const foreign = await owner`SELECT 1 FROM players WHERE slug LIKE ${`${NS}-%`}`;
    if (taken.length > 0 || foreign.length > 0) {
      throw new Error(`Refusing to run: season ${SEASON} or ${NS}-* rows already exist and are not this suite's.`);
    }
    fixture = await owner.begin(async (tx) => {
      await tx`SET CONSTRAINTS clubs_current_identity_id_fkey DEFERRED`;
      const [org] = await tx<{ id: number }[]>`
        INSERT INTO club_organizations (name, slug) VALUES (${`ISSUE-316 synthetic org`}, ${`${NS}-org`}) RETURNING id`;
      const [club] = await tx<{ id: number }[]>`
        INSERT INTO clubs (slug, name, short_name, abbreviation, current_identity_id, legacy_club_hist, organization_id)
        VALUES (${`${NS}-club`}, 'ISSUE-316 Synthetic Club', 'Synthetic', 'SYN', -1, ${`${NS}-club`}, ${org.id})
        RETURNING id`;
      await tx`UPDATE clubs SET current_identity_id = ${club.id} WHERE id = ${club.id}`;
      const [actor] = await tx<{ id: number }[]>`
        INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
        VALUES (${ACTOR_EMAIL}, 'super_admin', NULL, NULL, now()) RETURNING id`;
      await tx`INSERT INTO seasons (year, league, status) VALUES (${SEASON}, 'AFL', 'complete'::season_status)`;
      const playerIds: number[] = [];
      for (const n of [1, 2, 3]) {
        const [player] = await tx<{ id: number }[]>`
          INSERT INTO players (legacy_player_id, display_name, sort_name, search_name, slug, given_name, surname)
          VALUES (${-316_000_000 - n}, ${`Synthetic Pending ${n} (ISSUE-316 fixture)`},
                  ${`Pending, Synthetic ${n} (ISSUE-316 fixture)`}, ${`synthetic pending ${n} issue316 fixture`},
                  ${`${NS}-player-${n}`}, 'Synthetic', ${`Pending${n}`})
          RETURNING id`;
        playerIds.push(player.id);
      }
      const [source] = await tx<{ id: number }[]>`SELECT id FROM sources WHERE key = 'afltables'`;
      const votes: [number, number, number][] = [[20, 1, 1], [18, 2, 0], [12, 3, 0]];
      for (const [i, [v, rank, winner]] of votes.entries()) {
        await tx`
          INSERT INTO brownlow_season_votes
                (season, player_id, club_id, votes, vote_rank, eligible_rank, is_ineligible, is_winner,
                 source_id, source_record_id)
          VALUES (${SEASON}, ${playerIds[i]}, ${club.id}, ${v}, ${rank}, ${rank}, false, ${winner === 1},
                  ${source.id}, ${`${NS}-${i + 1}`})`;
      }
      // Career rows first (recomputePlayerDerivedStats deletes the season rows of the ids it is given).
      await recomputePlayerDerivedStats(tx, playerIds, SEASON);
      for (const id of playerIds) {
        await tx`
          INSERT INTO player_season_stats (player_id, season, primary_club_id, games, brownlow_status)
          VALUES (${id}, ${SEASON}, ${club.id}, 1, 'pending'::coverage_status)`;
      }
      return { orgId: org.id, clubId: club.id, actorId: actor.id, playerIds: playerIds as [number, number, number] };
    });
  }, 60_000);

  afterAll(async () => {
    try {
      await purge();
    } finally {
      await owner.end({ timeout: 5 });
    }
  }, 60_000);

  it('plants three unaccepted source votes, one a winner (the data the projections must not expose)', async () => {
    const rows = await owner<{ votes: number; isWinner: boolean }[]>`
      SELECT votes, is_winner AS "isWinner" FROM brownlow_season_votes WHERE season = ${SEASON} ORDER BY votes DESC`;
    expect(rows).toEqual([{ votes: 20, isWinner: true }, { votes: 18, isWinner: false }, { votes: 12, isWinner: false }]);
  });

  it('no availability row and no authority row: nothing authoritative is exposed', async () => {
    await setCoverage(null);
    await setAuthority('absent');
    expectNothingAuthoritative(await project(), 'pending');
  });

  it("availability 'partial' and an UNPUBLISHED authority row: still nothing authoritative", async () => {
    await setCoverage('partial');
    await setAuthority('unpublished');
    expectNothingAuthoritative(await project(), 'pending');
  });

  it("availability 'pending': still nothing authoritative", async () => {
    await setCoverage('pending');
    await setAuthority('unpublished');
    expectNothingAuthoritative(await project(), 'pending');
  });

  it("availability 'not_applicable' excludes the season outright, even with a PUBLISHED authority row", async () => {
    await setCoverage('not_applicable');
    await setAuthority('published');
    expectNothingAuthoritative(await project(), 'not_applicable');
  });

  it("CONTROL: availability 'complete' accepts the same rows, and every projection now returns them", async () => {
    await setCoverage('complete');
    await setAuthority('absent');
    const p = await project();
    const [first, second, third] = fixture.playerIds;
    expect(p.winners).toEqual([first]);
    expect(p.seasonRows).toEqual([
      { id: first, votes: 20, isWinner: true }, { id: second, votes: 18, isWinner: false },
      { id: third, votes: 12, isWinner: false },
    ]);
    expect(p.playerRows).toEqual([{ season: SEASON, votes: 20, voteRank: 1, isWinner: true, isIneligible: false }]);
    expect(p.medallists).toEqual([first]);
    expect(p.medallistAxis).toBe(true);
    expect(p.careerMinAxis).toBe(true);
    expect(p.seasonStatus).toEqual([
      { status: 'complete', votes: 20 }, { status: 'complete', votes: 18 }, { status: 'complete', votes: 12 },
    ]);
    expect(p.career).toEqual([{ votes: 20, medals: 1 }, { votes: 18, medals: 0 }, { votes: 12, medals: 0 }]);
    expect(p.leaders).toEqual([first, second, third]);
  });

  it('CONTROL: a PUBLISHED authority revision accepts the rows without any availability row', async () => {
    await setCoverage(null);
    await setAuthority('published');
    const p = await project();
    expect(p.winners).toEqual([fixture.playerIds[0]]);
    expect(p.playerRows).toEqual([{ season: SEASON, votes: 20, voteRank: 1, isWinner: true, isIneligible: false }]);
    expect(p.seasonStatus.map((r) => r.status)).toEqual(['complete', 'complete', 'complete']);
    expect(p.career[0]).toEqual({ votes: 20, medals: 1 });
  });

  it('withdrawing acceptance returns every projection to nothing (no stale authoritative total survives)', async () => {
    await setCoverage(null);
    await setAuthority('unpublished');
    expectNothingAuthoritative(await project(), 'pending');
  });
});
