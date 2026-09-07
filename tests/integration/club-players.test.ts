/**
 * getClubPlayers (player_clubs + players), the club-page complete Players
 * list added for AFLDB-ISSUE-149.
 *
 * Truth comes straight from `player_clubs` aggregated by the club's
 * lineage — a different aggregation than the one under test only in that
 * the test sums in JS.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubPlayers } from '@/db/queries/clubs';

afterAll(async () => {
  await sql.end();
});

async function clubIdBySlug(slug: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE slug = ${slug}`;
  expect(row, `club ${slug} is missing from afldb_test`).toBeDefined();
  return row.id;
}

async function lineageIds(clubId: number): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM clubs
     WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
  `;
  return rows.map((r) => r.id);
}

type PC = {
  playerId: number; clubId: number; games: number; goals: number;
  firstSeason: number; lastSeason: number;
};

async function playerClubs(lineage: number[]): Promise<PC[]> {
  return sql<PC[]>`
    SELECT player_id AS "playerId", club_id AS "clubId", games, goals,
           first_season AS "firstSeason", last_season AS "lastSeason"
      FROM player_clubs
     WHERE club_id = ANY(${lineage})
  `;
}

describe('getClubPlayers', () => {
  it('Richmond: one row per player, club-scoped totals equal to summed player_clubs', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = await lineageIds(clubId);
    const pcs = await playerClubs(lineage);

    const truth = new Map<number, { games: number; goals: number; first: number; last: number }>();
    for (const pc of pcs) {
      const t = truth.get(pc.playerId) ?? { games: 0, goals: 0, first: pc.firstSeason, last: pc.lastSeason };
      t.games += pc.games;
      t.goals += pc.goals;
      t.first = Math.min(t.first, pc.firstSeason);
      t.last = Math.max(t.last, pc.lastSeason);
      truth.set(pc.playerId, t);
    }

    const rows = await getClubPlayers(clubId);
    expect(rows.length).toBe(truth.size);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length); // no duplicate players

    for (const r of rows) {
      const t = truth.get(r.id);
      expect(t, `player ${r.id} not in player_clubs truth`).toBeDefined();
      expect(r.games).toBe(t!.games);
      expect(r.goals).toBe(t!.goals);
      expect(r.firstSeason).toBe(t!.first);
      expect(r.lastSeason).toBe(t!.last);
    }
  });

  it('default order is games descending, then goals descending', async () => {
    const rows = await getClubPlayers(await clubIdBySlug('richmond'));
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1];
      const b = rows[i];
      expect(a.games >= b.games).toBe(true);
      if (a.games === b.games) expect(a.goals >= b.goals).toBe(true);
    }
  });

  it("another club's games do not leak into this club's totals", async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));

    // A player who played for this club AND for a different organisation.
    const [multi] = await sql<{ playerId: number }[]>`
      SELECT pc.player_id AS "playerId"
        FROM player_clubs pc
       WHERE pc.club_id = ANY(${[...lineage]})
         AND EXISTS (
           SELECT 1 FROM player_clubs o
            WHERE o.player_id = pc.player_id
              AND o.club_id <> ALL(${[...lineage]})
         )
       LIMIT 1
    `;
    expect(multi, 'no multi-club player in this DB').toBeDefined();

    const [{ lineageGames }] = await sql<{ lineageGames: number }[]>`
      SELECT COALESCE(sum(games), 0)::int AS "lineageGames"
        FROM player_clubs
       WHERE player_id = ${multi.playerId} AND club_id = ANY(${[...lineage]})
    `;
    const [{ totalGames }] = await sql<{ totalGames: number }[]>`
      SELECT COALESCE(sum(games), 0)::int AS "totalGames"
        FROM player_clubs WHERE player_id = ${multi.playerId}
    `;
    expect(totalGames).toBeGreaterThan(lineageGames);

    const rows = await getClubPlayers(clubId);
    const row = rows.find((r) => r.id === multi.playerId);
    expect(row, 'multi-club player missing from the list').toBeDefined();
    expect(row!.games).toBe(lineageGames);
    expect(row!.games).toBeLessThan(totalGames);
  });

  it('a renamed club reports the same complete list under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c WHERE c.current_identity_id <> c.id LIMIT 1
    `;
    if (!pair) return;
    const era = await getClubPlayers(pair.eraId);
    const current = await getClubPlayers(pair.currentId);
    expect(new Set(era.map((r) => r.id))).toEqual(new Set(current.map((r) => r.id)));
    expect(era.length).toBeGreaterThan(0);
  });

  it('an unknown club id returns an empty list', async () => {
    expect(await getClubPlayers(-1)).toEqual([]);
  });
});
