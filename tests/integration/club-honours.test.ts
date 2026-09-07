/**
 * getClubBrownlowMedallists (brownlow_season_votes) and getClubHonours
 * (award_winners), the club-page Awards & Honours section added for
 * AFLDB-ISSUE-149.
 *
 * The single rule under test: an honour appears on a club's page ONLY
 * when the player's club for that award season is in the club's lineage.
 * An honour earned at another club must not leak.
 *
 * The season club is attributed differently per source, and each test
 * proves the semantic against an INDEPENDENT table rather than replaying
 * the implementation query:
 *   - Brownlow: `brownlow_season_votes.club_id` is NULL for every winner
 *     row in the canonical data, so the club is the player's actual
 *     same-season club. The implementation reads
 *     `player_season_stats.primary_club_id` (only when `club_count = 1`);
 *     these tests check against `player_club_season_stats`
 *     (player_id + season + club_id), a different table.
 *   - National honours: `award_winners.club_id` is populated and is the
 *     attribution column.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubBrownlowMedallists, getClubHonours } from '@/db/queries/awards';

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

describe('getClubBrownlowMedallists', () => {
  // Independent attribution oracle: the club(s) the player is recorded as
  // having played for in that exact season, from player_club_season_stats
  // (keyed player_id + season + club_id). Deliberately a different table
  // from the implementation's player_season_stats.primary_club_id, so the
  // test proves the semantic and not the query.
  async function sameSeasonClubIds(playerId: number, season: number): Promise<number[]> {
    const rows = await sql<{ clubId: number }[]>`
      SELECT club_id AS "clubId"
        FROM player_club_season_stats
       WHERE player_id = ${playerId} AND season = ${season}
    `;
    return rows.map((r) => r.clubId);
  }

  it("Richmond: every row is a genuine is_winner row attributed to the player's same-season club, within Richmond's lineage", async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const rows = await getClubBrownlowMedallists(clubId);
    expect(rows.length, 'no Richmond Brownlow medallists in this DB').toBeGreaterThan(0);

    for (const r of rows) {
      // 1. a real Brownlow winner row
      const [raw] = await sql<{ isWinner: boolean }[]>`
        SELECT is_winner AS "isWinner"
          FROM brownlow_season_votes
         WHERE player_id = ${r.playerId} AND season = ${r.season}
      `;
      expect(raw, `${r.season}/${r.playerId}`).toBeDefined();
      expect(raw.isWinner, `${r.season}/${r.playerId} is not an is_winner row`).toBe(true);

      // 2. attributed to a club the player actually played for that season
      const seasonClubs = await sameSeasonClubIds(r.playerId, r.season);
      expect(seasonClubs.length, `${r.season} winner has no same-season club row`).toBeGreaterThan(0);

      // 3. and that same-season club is in Richmond's lineage
      expect(
        seasonClubs.every((id) => lineage.has(id)),
        `${r.season} same-season club is outside Richmond's lineage`,
      ).toBe(true);
    }

    // Deterministic newest-first ordering.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].season).toBeGreaterThanOrEqual(rows[i].season);
    }
  });

  it('includes the known Richmond Brownlow medallists', async () => {
    const rows = await getClubBrownlowMedallists(await clubIdBySlug('richmond'));
    const got = new Set(rows.map((r) => `${r.season}|${r.playerName}`));
    for (const expected of [
      '2017|Dustin Martin',
      '2012|Trent Cotchin',
      '1971|Ian Stewart',
      '1954|Roy Wright',
      '1952|Roy Wright',
      '1948|Bill Morris',
      '1930|Stan Judkins',
    ]) {
      expect(got.has(expected), `Richmond Brownlow list is missing ${expected}`).toBe(true);
    }
  });

  it("a Brownlow won at another club does not appear on this club's page", async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = await lineageIds(clubId);
    // A genuine winner none of whose same-season club rows are Richmond's.
    const [elsewhere] = await sql<{ playerId: number; season: number }[]>`
      SELECT bsv.player_id AS "playerId", bsv.season
        FROM brownlow_season_votes bsv
       WHERE bsv.is_winner = true
         AND EXISTS (
           SELECT 1 FROM player_club_season_stats x
            WHERE x.player_id = bsv.player_id AND x.season = bsv.season
         )
         AND NOT EXISTS (
           SELECT 1 FROM player_club_season_stats y
            WHERE y.player_id = bsv.player_id AND y.season = bsv.season
              AND y.club_id = ANY(${lineage})
         )
       LIMIT 1
    `;
    expect(elsewhere, 'no Brownlow winner attributed outside Richmond in this DB').toBeDefined();

    const rows = await getClubBrownlowMedallists(clubId);
    expect(rows.some((r) => r.playerId === elsewhere.playerId && r.season === elsewhere.season))
      .toBe(false);
  });

  it('preserves co-winners as separate rows', async () => {
    // The most recent season with more than one Brownlow winner.
    const [tie] = await sql<{ season: number }[]>`
      SELECT season
        FROM brownlow_season_votes
       WHERE is_winner = true
       GROUP BY season
      HAVING count(*) > 1
       ORDER BY season DESC
       LIMIT 1
    `;
    if (!tie) return; // no tied Brownlow in this DB

    const coWinners = await sql<{ playerId: number }[]>`
      SELECT player_id AS "playerId"
        FROM brownlow_season_votes
       WHERE is_winner = true AND season = ${tie.season}
    `;
    expect(coWinners.length).toBeGreaterThan(1);

    // Each co-winner appears exactly once on its own same-season club's
    // page — the query never merges a tied year into a single row.
    for (const w of coWinners) {
      const [pcss] = await sql<{ clubId: number }[]>`
        SELECT club_id AS "clubId"
          FROM player_club_season_stats
         WHERE player_id = ${w.playerId} AND season = ${tie.season}
         LIMIT 1
      `;
      if (!pcss) continue;
      const rows = await getClubBrownlowMedallists(pcss.clubId);
      const mine = rows.filter(
        (r) => r.season === tie.season && r.playerId === w.playerId,
      );
      expect(mine.length, `co-winner ${w.playerId} in ${tie.season}`).toBe(1);
    }
  });

  it('a renamed club reports the same medallists under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c WHERE c.current_identity_id <> c.id LIMIT 1
    `;
    if (!pair) return;
    const era = await getClubBrownlowMedallists(pair.eraId);
    const current = await getClubBrownlowMedallists(pair.currentId);
    expect(new Set(era.map((r) => `${r.season}|${r.playerId}`)))
      .toEqual(new Set(current.map((r) => `${r.season}|${r.playerId}`)));
  });

  it('an unknown club id returns an empty list', async () => {
    expect(await getClubBrownlowMedallists(-1)).toEqual([]);
  });
});

describe('getClubHonours', () => {
  it('Richmond: every row is a category=award winner attributed to a lineage club, not the Brownlow', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const rows = await getClubHonours(clubId);
    expect(rows.length, 'no national honours for Richmond in this DB').toBeGreaterThan(0);

    for (const r of rows) {
      const [raw] = await sql<{ clubId: number | null; category: string; slug: string }[]>`
        SELECT w.club_id AS "clubId", a.category, a.slug
          FROM award_winners w JOIN awards a ON a.id = w.award_id
         WHERE w.id = ${r.id}
      `;
      expect(raw).toBeDefined();
      expect(raw.category).toBe('award');
      expect(raw.slug).not.toBe('brownlow-medal');
      expect(raw.clubId).not.toBeNull();
      expect(lineage.has(raw.clubId!), `${r.awardName} ${r.season} attribution outside lineage`).toBe(true);
    }
  });

  it("an award won at another club does not appear on this club's page", async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = await lineageIds(clubId);
    const [elsewhere] = await sql<{ id: number }[]>`
      SELECT w.id
        FROM award_winners w JOIN awards a ON a.id = w.award_id
       WHERE a.category = 'award' AND a.slug <> 'brownlow-medal'
         AND w.club_id IS NOT NULL AND w.club_id <> ALL(${lineage})
       LIMIT 1
    `;
    expect(elsewhere, 'no away-club award winner in this DB').toBeDefined();

    const rows = await getClubHonours(clubId);
    expect(rows.some((r) => r.id === elsewhere.id)).toBe(false);
  });

  it('is ordered newest first', async () => {
    const rows = await getClubHonours(await clubIdBySlug('richmond'));
    for (let i = 1; i < rows.length; i++) {
      expect((rows[i - 1].season ?? 0)).toBeGreaterThanOrEqual(rows[i].season ?? 0);
    }
  });

  it('a renamed club reports the same honours under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c WHERE c.current_identity_id <> c.id LIMIT 1
    `;
    if (!pair) return;
    const era = await getClubHonours(pair.eraId);
    const current = await getClubHonours(pair.currentId);
    expect(new Set(era.map((r) => r.id))).toEqual(new Set(current.map((r) => r.id)));
  });

  it('an unknown club id returns an empty list', async () => {
    expect(await getClubHonours(-1)).toEqual([]);
  });
});
