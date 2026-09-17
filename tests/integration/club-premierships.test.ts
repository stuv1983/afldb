/**
 * getClubPremierships (matches + venues + clubs), the club-page
 * Premierships section added for AFLDB-ISSUE-148.
 *
 * A premiership is a won Grand Final (`matches.round_type = 'grand_final'`
 * — not every final, never a Wildcard Final). The truth here is derived
 * two independent ways: the set of premiership seasons comes from
 * `club_seasons.is_premier` (a different table from the one the query
 * reads), and every per-row field is checked against the raw `matches`
 * row by id. Identities are discovered dynamically (Richmond by slug,
 * losing/other-club Grand Finals by query) — never a hardcoded match id.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getClubPremierships } from '@/db/queries/clubs';

afterAll(async () => {
  await sql.end();
});

async function clubIdBySlug(slug: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE slug = ${slug}`;
  expect(row, `club ${slug} is missing from afldb_test`).toBeDefined();
  return row.id;
}

/** Lineage ids for a club, the same set getClubPremierships scopes to. */
async function lineageIds(clubId: number): Promise<number[]> {
  const rows = await sql<{ id: number }[]>`
    SELECT id FROM clubs
     WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
  `;
  return rows.map((r) => r.id);
}

/** Premiership seasons from club_seasons.is_premier — an independent source. */
async function premiershipSeasons(clubId: number): Promise<Set<number>> {
  const rows = await sql<{ season: number }[]>`
    SELECT DISTINCT cs.season
      FROM club_seasons cs
     WHERE cs.is_premier = true
       AND cs.club_id IN (
         SELECT id FROM clubs
          WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
       )
  `;
  return new Set(rows.map((r) => r.season));
}

type RawMatch = {
  id: number; season: number; roundType: string;
  matchDate: Date; attendance: number | null;
  homeClubId: number; awayClubId: number;
  homeScore: number; awayScore: number; winnerClubId: number | null;
  venueName: string; venueSlug: string | null;
};

async function rawMatch(id: number): Promise<RawMatch> {
  const [m] = await sql<RawMatch[]>`
    SELECT m.id, m.season, m.round_type::text AS "roundType",
           m.match_date AS "matchDate", m.attendance,
           m.home_club_id AS "homeClubId", m.away_club_id AS "awayClubId",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           m.winner_club_id AS "winnerClubId",
           COALESCE(v.canonical_name, m.venue_raw) AS "venueName",
           v.slug AS "venueSlug"
      FROM matches m
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE m.id = ${id}
  `;
  expect(m, `match ${id}`).toBeDefined();
  return m;
}

describe('getClubPremierships', () => {
  it('Richmond: the premiership years equal club_seasons.is_premier, and every row is a won Grand Final', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = new Set(await lineageIds(clubId));
    const rows = await getClubPremierships(clubId);
    expect(rows.length, 'the Grand Final / premiership data has not loaded this database').toBeGreaterThan(5);

    // Independent set check against a different table.
    const truthYears = await premiershipSeasons(clubId);
    expect(new Set(rows.map((r) => r.year))).toEqual(truthYears);
    expect(rows.length).toBe(truthYears.size);

    for (const r of rows) {
      const m = await rawMatch(r.matchId);
      expect(m.roundType, `${r.year}`).toBe('grand_final');
      expect(m.winnerClubId, `${r.year}`).not.toBeNull();
      expect(lineage.has(m.winnerClubId!), `${r.year} winner in lineage`).toBe(true);

      // Opponent = the club in the match that is not the winner, home or away.
      const expectedOpponentId = m.homeClubId === m.winnerClubId ? m.awayClubId : m.homeClubId;
      expect(r.opponentId, `${r.year} opponent`).toBe(expectedOpponentId);
      expect(lineage.has(r.opponentId), `${r.year} opponent not in lineage`).toBe(false);

      // Score from the winner's perspective.
      const winnerScore = m.homeClubId === m.winnerClubId ? m.homeScore : m.awayScore;
      const loserScore = m.homeClubId === m.winnerClubId ? m.awayScore : m.homeScore;
      expect(r.clubScore, `${r.year} clubScore`).toBe(winnerScore);
      expect(r.opponentScore, `${r.year} opponentScore`).toBe(loserScore);
      expect(r.clubScore).toBeGreaterThan(r.opponentScore);

      expect(r.year).toBe(m.season);
      expect(r.matchDate?.getTime()).toBe(m.matchDate.getTime());
      expect(r.crowd).toBe(m.attendance);
      expect(r.venueName).toBe(m.venueName);
      expect(r.venueSlug).toBe(m.venueSlug);
    }
  });

  it('resolves the opponent whether the premiership club was home or away', async () => {
    const clubId = await clubIdBySlug('richmond');
    const lineage = await lineageIds(clubId);
    const rows = await getClubPremierships(clubId);

    let sawHome = false;
    let sawAway = false;
    for (const r of rows) {
      const m = await rawMatch(r.matchId);
      if (lineage.includes(m.homeClubId)) sawHome = true;
      if (lineage.includes(m.awayClubId)) sawAway = true;
      // Opponent is always the other side and never the premiership club.
      expect([m.homeClubId, m.awayClubId]).toContain(r.opponentId);
      expect(lineage).not.toContain(r.opponentId);
    }
    expect(sawHome, 'no premiership where the club was the home team').toBe(true);
    expect(sawAway, 'no premiership where the club was the away team').toBe(true);
  });

  it('excludes a finals match that is not a Grand Final', async () => {
    const clubId = await clubIdBySlug('richmond');
    const [nonGf] = await sql<{ id: number; season: number }[]>`
      WITH lineage AS (
        SELECT id FROM clubs
         WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
      )
      SELECT m.id, m.season
        FROM matches m
       WHERE m.is_finals_series = true
         AND m.round_type <> 'grand_final'
         AND m.winner_club_id IN (SELECT id FROM lineage)
       ORDER BY m.season DESC
       LIMIT 1
    `;
    expect(nonGf, 'no non-Grand-Final finals win in this DB').toBeDefined();

    const rows = await getClubPremierships(clubId);
    expect(rows.map((r) => r.matchId)).not.toContain(nonGf.id);
    // And nothing returned is anything other than a Grand Final.
    for (const r of rows) {
      expect((await rawMatch(r.matchId)).roundType).toBe('grand_final');
    }
  });

  it('excludes a Grand Final the club lost', async () => {
    const clubId = await clubIdBySlug('richmond');
    const [lost] = await sql<{ id: number; season: number }[]>`
      WITH lineage AS (
        SELECT id FROM clubs
         WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
      )
      SELECT m.id, m.season
        FROM matches m
       WHERE m.round_type = 'grand_final'
         AND (m.home_club_id IN (SELECT id FROM lineage) OR m.away_club_id IN (SELECT id FROM lineage))
         AND (m.winner_club_id IS NULL OR m.winner_club_id NOT IN (SELECT id FROM lineage))
       ORDER BY m.season DESC
       LIMIT 1
    `;
    expect(lost, 'Richmond has never lost a Grand Final in this DB?').toBeDefined();

    const rows = await getClubPremierships(clubId);
    expect(rows.map((r) => r.matchId)).not.toContain(lost.id);
    // A club never wins and loses a Grand Final in the same season.
    expect(rows.map((r) => r.year)).not.toContain(lost.season);
  });

  it('takes the replay, not the drawn Grand Final, as the premiership', async () => {
    // A drawn Grand Final has a null winner and equal scores. Find one,
    // take the club that won the replay that season, and check its
    // premiership row for that season points at the replay, not the draw.
    const [drawn] = await sql<{
      id: number; season: number; homeScore: number; awayScore: number;
      replayId: number; replayWinnerId: number;
    }[]>`
      SELECT d.id, d.season, d.home_score AS "homeScore", d.away_score AS "awayScore",
             r.id AS "replayId", r.winner_club_id AS "replayWinnerId"
        FROM matches d
        JOIN matches r
          ON r.round_type = 'grand_final'
         AND r.season = d.season
         AND r.id <> d.id
         AND r.winner_club_id IS NOT NULL
       WHERE d.round_type = 'grand_final'
         AND d.winner_club_id IS NULL
       LIMIT 1
    `;
    if (!drawn) return; // no drawn Grand Final with a replay in this DB

    expect(drawn.homeScore).toBe(drawn.awayScore);

    const rows = await getClubPremierships(drawn.replayWinnerId);
    const seasonRow = rows.find((r) => r.year === drawn.season);
    expect(seasonRow, `premiership row for ${drawn.season}`).toBeDefined();
    expect(seasonRow!.matchId).toBe(drawn.replayId);
    expect(seasonRow!.matchId).not.toBe(drawn.id);
  });

  it('returns one row per premiership, unique years, newest first', async () => {
    const clubId = await clubIdBySlug('richmond');
    const rows = await getClubPremierships(clubId);
    const years = rows.map((r) => r.year);
    expect(new Set(years).size).toBe(years.length);
    for (let i = 1; i < years.length; i++) {
      expect(years[i - 1]).toBeGreaterThan(years[i]);
    }
  });

  it('a renamed club reports the same premierships under either identity', async () => {
    const [pair] = await sql<{ eraId: number; currentId: number }[]>`
      SELECT c.id AS "eraId", c.current_identity_id AS "currentId"
        FROM clubs c
       WHERE c.current_identity_id <> c.id
         AND EXISTS (
           SELECT 1 FROM matches m
            WHERE m.round_type = 'grand_final' AND m.winner_club_id = c.id
         )
       LIMIT 1
    `;
    if (!pair) return; // no renamed club with a premiership in this DB

    const era = await getClubPremierships(pair.eraId);
    const current = await getClubPremierships(pair.currentId);
    expect(new Set(era.map((r) => r.matchId))).toEqual(new Set(current.map((r) => r.matchId)));
    expect(era.length).toBeGreaterThan(0);
  });

  it('a club with no premierships returns an empty list', async () => {
    const [none] = await sql<{ id: number }[]>`
      SELECT c.id
        FROM clubs c
       WHERE NOT EXISTS (
         SELECT 1 FROM matches m
          JOIN clubs w ON w.id = m.winner_club_id
         WHERE m.round_type = 'grand_final' AND w.organization_id = c.organization_id
       )
       LIMIT 1
    `;
    expect(none, 'every club in this DB has a premiership?').toBeDefined();
    expect(await getClubPremierships(none.id)).toEqual([]);
  });

  it('an unknown club id returns an empty list, never throws', async () => {
    expect(await getClubPremierships(-1)).toEqual([]);
  });
});
