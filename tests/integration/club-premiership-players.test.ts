/**
 * getClubPremiershipPlayers (player_club_season_stats), the club-page
 * Premiership Players section added for AFLDB-ISSUE-149.
 *
 * Independent truth: premiership attribution comes from
 * `player_club_season_stats.is_premier`, and the SET of premiership
 * seasons is cross-checked two other ways — `club_seasons.is_premier`
 * (headline totals) and `getClubPremierships` (won Grand Finals). A
 * material disagreement fails the test rather than being hidden.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubPremierships, getClubPremiershipPlayers } from '@/db/queries/clubs';

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

describe('getClubPremiershipPlayers', () => {
  it('Richmond: every row is an is_premier player_club_season_stats row for a lineage club', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const rows = await getClubPremiershipPlayers(clubId);
    expect(rows.length, 'no premiership players in this DB').toBeGreaterThan(20);

    for (const r of rows) {
      const [raw] = await sql<{ isPremier: boolean; clubId: number; games: number; finals: number }[]>`
        SELECT is_premier AS "isPremier", club_id AS "clubId", games, finals
          FROM player_club_season_stats
         WHERE player_id = ${r.playerId} AND season = ${r.season} AND club_id IN (
           SELECT id FROM clubs
            WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
         )
      `;
      expect(raw, `${r.season}/${r.playerId}`).toBeDefined();
      expect(raw.isPremier).toBe(true);
      expect(lineage.has(raw.clubId)).toBe(true);
      expect(r.games).toBe(raw.games);
      expect(r.finals).toBe(raw.finals);
    }
  });

  it('premiership seasons agree with club_seasons.is_premier and with getClubPremierships', async () => {
    const clubId = await clubIdBySlug('richmond');
    const rows = await getClubPremiershipPlayers(clubId);
    const playerSeasons = new Set(rows.map((r) => r.season));

    const csRows = await sql<{ season: number }[]>`
      SELECT DISTINCT season FROM club_seasons
       WHERE is_premier = true AND club_id IN (
         SELECT id FROM clubs
          WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
       )
    `;
    const clubSeasonYears = new Set(csRows.map((r) => r.season));
    const gfYears = new Set((await getClubPremierships(clubId)).map((p) => p.year));

    // Safety-critical direction: every season with premiership players
    // must be a real premiership season by both other canonical measures.
    // A failure here means is_premier is attributing a flag the club did
    // not win — surface it, never hide it.
    for (const s of playerSeasons) {
      expect(clubSeasonYears.has(s), `${s} not in club_seasons.is_premier`).toBe(true);
      expect(gfYears.has(s), `${s} not a won Grand Final in getClubPremierships`).toBe(true);
    }
    // The other direction (a won Grand Final with no premiership players)
    // is only expected where player_club_season_stats covers that era, so
    // it is asserted from the earliest season the players table reaches.
    const earliest = Math.min(...playerSeasons);
    const gfInEra = [...gfYears].filter((y) => y >= earliest).sort();
    expect(gfInEra).toEqual([...playerSeasons].sort());
  });

  it('a player who won more than one flag appears once per premiership season', async () => {
    const clubId = await clubIdBySlug('richmond');
    const rows = await getClubPremiershipPlayers(clubId);

    const byPlayer = new Map<number, number[]>();
    for (const r of rows) {
      byPlayer.set(r.playerId, [...(byPlayer.get(r.playerId) ?? []), r.season]);
    }
    const multi = [...byPlayer.entries()].find(([, seasons]) => seasons.length > 1);
    expect(multi, 'no multi-premiership player in this DB').toBeDefined();
    const seasons = multi![1];
    expect(new Set(seasons).size).toBe(seasons.length); // one row per season, no dupes
  });

  it('is ordered newest premiership season first', async () => {
    const rows = await getClubPremiershipPlayers(await clubIdBySlug('richmond'));
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].season).toBeGreaterThanOrEqual(rows[i].season);
    }
  });

  it('excludes a non-premiership player-season for the same club', async () => {
    const clubId = await clubIdBySlug('richmond');
    const [notPremier] = await sql<{ playerId: number; season: number }[]>`
      SELECT player_id AS "playerId", season
        FROM player_club_season_stats
       WHERE is_premier = false AND club_id IN (
         SELECT id FROM clubs
          WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
       )
       LIMIT 1
    `;
    expect(notPremier).toBeDefined();
    const rows = await getClubPremiershipPlayers(clubId);
    expect(rows.some((r) => r.playerId === notPremier.playerId && r.season === notPremier.season))
      .toBe(false);
  });

  it('an unknown club id returns an empty list', async () => {
    expect(await getClubPremiershipPlayers(-1)).toEqual([]);
  });
});
