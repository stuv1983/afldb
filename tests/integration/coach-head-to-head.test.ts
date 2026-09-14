/**
 * getCoachHeadToHead (AFLDB-ISSUE-170 Stage 2C): direct coach-v-coach
 * meetings, derived from match_coaches + matches + clubs + venues, never
 * from a stored aggregate.
 *
 * Every oracle query here is built independently from scratch -- never by
 * calling or re-running the production `coachHeadToHeadScope`/query logic
 * -- the same discipline tests/integration/player-family-and-coaching.test.ts
 * already applies to `getCoachCareer`. Pairs are discovered dynamically via
 * SQL rather than a hardcoded coach id, following
 * tests/integration/grid-solver.test.ts's convention.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { getCoachHeadToHead } from '@/db/queries/coaches';

afterAll(async () => {
  await sql.end();
});

/** The most-frequent coach-v-coach matchup on this database (Stage 0 §0.8: Malthouse v Sheedy, 47 meetings, on the discovery snapshot). */
async function mostFrequentMatchup(): Promise<[number, number]> {
  const [row] = await sql<{ a: number; b: number; meetings: number }[]>`
    SELECT mcA.coach_id AS a, mcB.coach_id AS b, count(*)::int AS meetings
      FROM match_coaches mcA
      JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
     WHERE mcA.coach_id < mcB.coach_id
     GROUP BY mcA.coach_id, mcB.coach_id
     ORDER BY count(*) DESC
     LIMIT 1
  `;
  expect(row, 'afldb_test needs at least one direct coach-v-coach matchup').toBeDefined();
  expect(row.meetings).toBeGreaterThan(1);
  return [row.a, row.b];
}

/** Two coaches, each with canonical games, who have never directly opposed each other. */
async function neverMetPair(): Promise<[number, number] | null> {
  const [row] = await sql<{ a: number; b: number }[]>`
    WITH candidates AS (
      SELECT DISTINCT coach_id FROM match_coaches ORDER BY coach_id LIMIT 50
    )
    SELECT c1.coach_id AS a, c2.coach_id AS b
      FROM candidates c1
      JOIN candidates c2 ON c2.coach_id > c1.coach_id
     WHERE NOT EXISTS (
       SELECT 1 FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
       WHERE mcA.coach_id = c1.coach_id AND mcB.coach_id = c2.coach_id
     )
     LIMIT 1
  `;
  return row ? [row.a, row.b] : null;
}

/** A pairing where coach A never won a single direct decided meeting (all draws and/or all losses). */
async function pairWhereACannotWin(): Promise<[number, number] | null> {
  const [row] = await sql<{ a: number; b: number }[]>`
    SELECT mcA.coach_id AS a, mcB.coach_id AS b
      FROM match_coaches mcA
      JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
      JOIN matches m ON m.id = mcA.match_id
     GROUP BY mcA.coach_id, mcB.coach_id
    HAVING count(*) FILTER (WHERE m.winner_club_id IS NOT NULL) > 0
       AND count(*) FILTER (WHERE m.winner_club_id = mcA.club_id) = 0
     LIMIT 1
  `;
  return row ? [row.a, row.b] : null;
}

/** An id no `coaches` row can hold. */
async function unusedCoachId(): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT max(id) + 1000000 AS id FROM coaches`;
  return row.id;
}

/** Two coaches whose careers never overlap in a single season (disjoint season ranges). */
async function noOverlapPair(): Promise<[number, number] | null> {
  const [row] = await sql<{ a: number; b: number }[]>`
    WITH spans AS (
      SELECT mc.coach_id, min(m.season) AS min_s, max(m.season) AS max_s
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
       GROUP BY mc.coach_id
    )
    SELECT a.coach_id AS a, b.coach_id AS b
      FROM spans a
      JOIN spans b ON a.coach_id <> b.coach_id
     WHERE a.max_s < b.min_s
     LIMIT 1
  `;
  return row ? [row.a, row.b] : null;
}

/**
 * A coach with a genuine mid-career gap (at least one season strictly
 * between their first and last coached season with NO canonical
 * assignment), paired with another coach whose own span fully covers that
 * gap -- so naively intersecting `[GREATEST(minA,minB), LEAST(maxA,maxB)]`
 * would credit the gap season as "overlapping" even though the gap coach
 * was not actually active then. Used to prove the production overlap
 * query is built from real season presence, never a min/max range
 * (AFLDB-ISSUE-170 Stage 2D).
 */
async function gapOverlapPair(): Promise<{ a: number; b: number; naiveRange: number; actualOverlap: number } | null> {
  const [row] = await sql<{ a: number; b: number; naiveRange: number; actualOverlap: number }[]>`
    WITH coach_seasons AS (
      SELECT DISTINCT mc.coach_id, m.season
        FROM match_coaches mc JOIN matches m ON m.id = mc.match_id
    ), spans AS (
      SELECT coach_id, min(season) AS min_s, max(season) AS max_s, count(*) AS n
        FROM coach_seasons GROUP BY coach_id
    ), gap_coaches AS (
      SELECT coach_id, min_s, max_s FROM spans WHERE n < (max_s - min_s + 1)
    ), candidates AS (
      SELECT g.coach_id AS gap_id, s.coach_id AS other_id,
             GREATEST(g.min_s, s.min_s) AS lo, LEAST(g.max_s, s.max_s) AS hi
        FROM gap_coaches g
        JOIN spans s ON s.coach_id <> g.coach_id
       WHERE GREATEST(g.min_s, s.min_s) <= LEAST(g.max_s, s.max_s)
    ), actual AS (
      SELECT c.gap_id, c.other_id, count(*)::int AS actual_overlap
        FROM candidates c
        JOIN coach_seasons sa ON sa.coach_id = c.gap_id AND sa.season BETWEEN c.lo AND c.hi
        JOIN coach_seasons sb ON sb.coach_id = c.other_id AND sb.season = sa.season
       GROUP BY c.gap_id, c.other_id
    )
    SELECT c.gap_id AS a, c.other_id AS b,
           (c.hi - c.lo + 1)::int AS "naiveRange",
           coalesce(a2.actual_overlap, 0) AS "actualOverlap"
      FROM candidates c
      LEFT JOIN actual a2 ON a2.gap_id = c.gap_id AND a2.other_id = c.other_id
     WHERE (c.hi - c.lo + 1) > coalesce(a2.actual_overlap, 0)
     ORDER BY (c.hi - c.lo + 1) - coalesce(a2.actual_overlap, 0) DESC
     LIMIT 1
  `;
  return row ?? null;
}

describe('getCoachHeadToHead — totals, biggest wins and venues, cross-checked against a direct-SQL oracle', () => {
  it('meetings, wins, draws, win %, finals and Grand Final counts match independent SQL', async () => {
    const [idA, idB] = await mostFrequentMatchup();

    const [truth] = await sql<{
      meetings: number; aWins: number; bWins: number; draws: number;
      finals: number; grandFinals: number;
    }[]>`
      SELECT count(*)::int AS meetings,
             count(*) FILTER (WHERE m.winner_club_id = mcA.club_id)::int AS "aWins",
             count(*) FILTER (WHERE m.winner_club_id = mcB.club_id)::int AS "bWins",
             count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
             count(*) FILTER (WHERE m.is_finals_series)::int AS finals,
             count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals"
        FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
        JOIN matches m ON m.id = mcA.match_id
       WHERE mcA.coach_id = ${idA} AND mcB.coach_id = ${idB}
    `;

    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.coachAId).toBe(idA);
    expect(h2h!.coachBId).toBe(idB);
    expect(h2h!.totals).toMatchObject({
      meetings: truth.meetings, aWins: truth.aWins, bWins: truth.bWins, draws: truth.draws,
      finals: truth.finals, grandFinals: truth.grandFinals,
    });
    expect(h2h!.totals.meetings).toBe(h2h!.totals.aWins + h2h!.totals.bWins + h2h!.totals.draws);

    // Win % is the site's draw-half formula, recomputed independently.
    const expectedAWinPct = ((truth.aWins + truth.draws * 0.5) / truth.meetings) * 100;
    const expectedBWinPct = ((truth.bWins + truth.draws * 0.5) / truth.meetings) * 100;
    expect(h2h!.totals.aWinPct).toBeCloseTo(expectedAWinPct, 9);
    expect(h2h!.totals.bWinPct).toBeCloseTo(expectedBWinPct, 9);
  });

  it("each coach's biggest direct win matches an independent deterministic SQL selection (greatest margin, earliest date, lowest match id)", async () => {
    const [idA, idB] = await mostFrequentMatchup();
    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();

    const [expectedWinA] = await sql<{ matchId: number; margin: number }[]>`
      SELECT m.id AS "matchId",
             (CASE WHEN mcA.club_id = m.home_club_id THEN m.home_score - m.away_score
                   ELSE m.away_score - m.home_score END)::int AS margin
        FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
        JOIN matches m ON m.id = mcA.match_id
       WHERE mcA.coach_id = ${idA} AND mcB.coach_id = ${idB} AND m.winner_club_id = mcA.club_id
       ORDER BY (CASE WHEN mcA.club_id = m.home_club_id THEN m.home_score - m.away_score
                      ELSE m.away_score - m.home_score END) DESC,
                m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    if (expectedWinA) {
      expect(h2h!.biggestWinA).toMatchObject({ matchId: expectedWinA.matchId, margin: expectedWinA.margin });
    } else {
      expect(h2h!.biggestWinA).toBeNull();
    }

    const [expectedWinB] = await sql<{ matchId: number; margin: number }[]>`
      SELECT m.id AS "matchId",
             (CASE WHEN mcB.club_id = m.home_club_id THEN m.home_score - m.away_score
                   ELSE m.away_score - m.home_score END)::int AS margin
        FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
        JOIN matches m ON m.id = mcA.match_id
       WHERE mcA.coach_id = ${idA} AND mcB.coach_id = ${idB} AND m.winner_club_id = mcB.club_id
       ORDER BY (CASE WHEN mcB.club_id = m.home_club_id THEN m.home_score - m.away_score
                      ELSE m.away_score - m.home_score END) DESC,
                m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    if (expectedWinB) {
      expect(h2h!.biggestWinB).toMatchObject({ matchId: expectedWinB.matchId, margin: expectedWinB.margin });
    } else {
      expect(h2h!.biggestWinB).toBeNull();
    }
  });

  it('direct-meeting venue history matches independent SQL and is ordered meetings DESC, venue name ASC, venue id ASC', async () => {
    const [idA, idB] = await mostFrequentMatchup();
    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.venues.length).toBeGreaterThan(0);

    const venueTruth = await sql<{
      venueId: number; meetings: number; aWins: number; bWins: number; draws: number;
      firstMeetingDate: Date; lastMeetingDate: Date;
    }[]>`
      SELECT m.venue_id AS "venueId",
             count(*)::int AS meetings,
             count(*) FILTER (WHERE m.winner_club_id = mcA.club_id)::int AS "aWins",
             count(*) FILTER (WHERE m.winner_club_id = mcB.club_id)::int AS "bWins",
             count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
             min(m.match_date) AS "firstMeetingDate",
             max(m.match_date) AS "lastMeetingDate"
        FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
        JOIN matches m ON m.id = mcA.match_id
       WHERE mcA.coach_id = ${idA} AND mcB.coach_id = ${idB}
       GROUP BY m.venue_id
    `;
    const truthByVenue = new Map(venueTruth.map((v) => [v.venueId, v]));

    expect(h2h!.venues.length).toBe(venueTruth.length);
    for (const v of h2h!.venues) {
      const t = truthByVenue.get(v.venueId);
      expect(t, `venue ${v.venueId}`).toBeDefined();
      expect(v).toMatchObject({ meetings: t!.meetings, aWins: t!.aWins, bWins: t!.bWins, draws: t!.draws });
      expect(v.firstMeetingDate.toISOString()).toBe(t!.firstMeetingDate.toISOString());
      expect(v.lastMeetingDate.toISOString()).toBe(t!.lastMeetingDate.toISOString());
    }

    // Deterministic ordering invariant, never incidental row order.
    for (let i = 1; i < h2h!.venues.length; i += 1) {
      const prev = h2h!.venues[i - 1];
      const cur = h2h!.venues[i];
      const outOfOrder = cur.meetings > prev.meetings
        || (cur.meetings === prev.meetings && cur.venueName < prev.venueName)
        || (cur.meetings === prev.meetings && cur.venueName === prev.venueName && cur.venueId < prev.venueId);
      expect(outOfOrder, `venues[${i - 1}] then venues[${i}]`).toBe(false);
    }
  });
});

describe('getCoachHeadToHead — orientation', () => {
  it('swapping A/B swaps every oriented value, without changing the underlying population', async () => {
    const [idA, idB] = await mostFrequentMatchup();
    const forward = await getCoachHeadToHead(idA, idB);
    const reversed = await getCoachHeadToHead(idB, idA);
    expect(forward).not.toBeNull();
    expect(reversed).not.toBeNull();

    expect(reversed!.coachAId).toBe(idB);
    expect(reversed!.coachBId).toBe(idA);
    expect(reversed!.totals.meetings).toBe(forward!.totals.meetings);
    expect(reversed!.totals.aWins).toBe(forward!.totals.bWins);
    expect(reversed!.totals.bWins).toBe(forward!.totals.aWins);
    expect(reversed!.totals.draws).toBe(forward!.totals.draws);
    expect(reversed!.totals.aWinPct).toBeCloseTo(forward!.totals.bWinPct as number, 9);
    expect(reversed!.totals.bWinPct).toBeCloseTo(forward!.totals.aWinPct as number, 9);
    expect(reversed!.biggestWinA).toEqual(forward!.biggestWinB);
    expect(reversed!.biggestWinB).toEqual(forward!.biggestWinA);

    const forwardByVenue = new Map(forward!.venues.map((v) => [v.venueId, v]));
    for (const v of reversed!.venues) {
      const f = forwardByVenue.get(v.venueId)!;
      expect(v.aWins).toBe(f.bWins);
      expect(v.bWins).toBe(f.aWins);
      expect(v.meetings).toBe(f.meetings);
    }
  });

  it("swapping A/B preserves the direct-meeting population/dates and overlap, while orientation-specific context (Stage 2D) stays correct", async () => {
    const [idA, idB] = await mostFrequentMatchup();
    const forward = await getCoachHeadToHead(idA, idB);
    const reversed = await getCoachHeadToHead(idB, idA);
    expect(forward).not.toBeNull();
    expect(reversed).not.toBeNull();

    // Overlap is symmetric -- the same two season sets, intersected --
    // so it must be identical regardless of requested order.
    expect(reversed!.overlap).toEqual(forward!.overlap);

    // Same underlying matches (same ids/dates), but coached/opponent club
    // is oriented to whichever coach is now "A".
    expect(reversed!.firstMeeting?.matchId).toBe(forward!.firstMeeting?.matchId);
    expect(reversed!.firstMeeting?.matchDate.getTime()).toBe(forward!.firstMeeting?.matchDate.getTime());
    expect(reversed!.firstMeeting?.coachedClubId).toBe(forward!.firstMeeting?.opponentClubId);
    expect(reversed!.firstMeeting?.opponentClubId).toBe(forward!.firstMeeting?.coachedClubId);

    expect(reversed!.lastMeeting?.matchId).toBe(forward!.lastMeeting?.matchId);
    expect(reversed!.lastMeeting?.matchDate.getTime()).toBe(forward!.lastMeeting?.matchDate.getTime());
    expect(reversed!.lastMeeting?.coachedClubId).toBe(forward!.lastMeeting?.opponentClubId);
    expect(reversed!.lastMeeting?.opponentClubId).toBe(forward!.lastMeeting?.coachedClubId);
  });
});

describe('getCoachHeadToHead — overlapping coaching seasons (Stage 2D)', () => {
  it('overlapping-season count, first overlapping season and last overlapping season match an independent SQL intersection of actual season presence', async () => {
    const [idA, idB] = await mostFrequentMatchup();

    const [truth] = await sql<{ firstSeason: number | null; lastSeason: number | null; seasons: number }[]>`
      WITH szn_a AS (
        SELECT DISTINCT m.season FROM match_coaches mc JOIN matches m ON m.id = mc.match_id WHERE mc.coach_id = ${idA}
      ), szn_b AS (
        SELECT DISTINCT m.season FROM match_coaches mc JOIN matches m ON m.id = mc.match_id WHERE mc.coach_id = ${idB}
      )
      SELECT min(a.season)::int AS "firstSeason", max(a.season)::int AS "lastSeason", count(*)::int AS seasons
        FROM szn_a a JOIN szn_b b ON a.season = b.season
    `;

    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.overlap).toEqual(truth);
    expect(h2h!.overlap.seasons).toBeGreaterThan(0);
  });

  it('a pair with disjoint career spans returns the deliberate no-overlap state, not a fabricated span', async () => {
    const pair = await noOverlapPair();
    if (pair === null) return; // no disjoint-span pair found; not this test's concern
    const [idA, idB] = pair;

    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.overlap).toEqual({ firstSeason: null, lastSeason: null, seasons: 0 });
  });

  it("a coach's real mid-career gap is excluded from overlap, proving the query uses actual season presence rather than intersecting min/max ranges", async () => {
    const gapPair = await gapOverlapPair();
    if (gapPair === null) return; // no such gap pair found on this database; not this test's concern
    const { a, b, naiveRange, actualOverlap } = gapPair;

    const h2h = await getCoachHeadToHead(a, b);
    expect(h2h).not.toBeNull();
    expect(h2h!.overlap.seasons).toBe(actualOverlap);
    // The proof: the naive min/max-range count is strictly larger than what
    // real season presence supports, and the production result must match
    // the smaller, correct figure -- never the naive one.
    expect(h2h!.overlap.seasons).toBeLessThan(naiveRange);
  });
});

describe('getCoachHeadToHead — first and most recent direct meeting (Stage 2D)', () => {
  it('firstMeeting and lastMeeting match an independent earliest/latest match-date selection over the FULL meeting population (draws included)', async () => {
    const [idA, idB] = await mostFrequentMatchup();
    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();

    const [expectedFirst] = await sql<{ matchId: number; matchDate: Date }[]>`
      SELECT m.id AS "matchId", m.match_date AS "matchDate"
        FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
        JOIN matches m ON m.id = mcA.match_id
       WHERE mcA.coach_id = ${idA} AND mcB.coach_id = ${idB}
       ORDER BY m.match_date ASC, m.id ASC
       LIMIT 1
    `;
    const [expectedLast] = await sql<{ matchId: number; matchDate: Date }[]>`
      SELECT m.id AS "matchId", m.match_date AS "matchDate"
        FROM match_coaches mcA
        JOIN match_coaches mcB ON mcB.match_id = mcA.match_id AND mcB.club_id <> mcA.club_id
        JOIN matches m ON m.id = mcA.match_id
       WHERE mcA.coach_id = ${idA} AND mcB.coach_id = ${idB}
       ORDER BY m.match_date DESC, m.id DESC
       LIMIT 1
    `;

    expect(h2h!.firstMeeting).not.toBeNull();
    expect(h2h!.firstMeeting!.matchId).toBe(expectedFirst.matchId);
    expect(h2h!.firstMeeting!.matchDate.toISOString()).toBe(expectedFirst.matchDate.toISOString());

    expect(h2h!.lastMeeting).not.toBeNull();
    expect(h2h!.lastMeeting!.matchId).toBe(expectedLast.matchId);
    expect(h2h!.lastMeeting!.matchDate.toISOString()).toBe(expectedLast.matchDate.toISOString());
  });

  it('a real, distinct pair who never met gets null firstMeeting and lastMeeting, never a fabricated date', async () => {
    const pair = await neverMetPair();
    if (pair === null) return; // no non-meeting pair found among the sampled candidates; not this test's concern
    const [idA, idB] = pair;

    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.totals.meetings).toBe(0);
    expect(h2h!.firstMeeting).toBeNull();
    expect(h2h!.lastMeeting).toBeNull();
  });
});

describe('getCoachHeadToHead — zero-meeting and asymmetric-win edge cases', () => {
  it('a real, distinct pair who never met returns a deliberate zero object, never null', async () => {
    const pair = await neverMetPair();
    if (pair === null) return; // no non-meeting pair found among the sampled candidates; not this test's concern
    const [idA, idB] = pair;

    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.totals).toEqual({
      meetings: 0, aWins: 0, bWins: 0, draws: 0, aWinPct: null, bWinPct: null, finals: 0, grandFinals: 0,
    });
    expect(h2h!.biggestWinA).toBeNull();
    expect(h2h!.biggestWinB).toBeNull();
    expect(h2h!.venues).toEqual([]);
  });

  it('a coach with zero direct wins against the other gets a null biggest win, never a fabricated result', async () => {
    const pair = await pairWhereACannotWin();
    if (pair === null) return; // no such asymmetric pairing found; not this test's concern
    const [idA, idB] = pair;

    const h2h = await getCoachHeadToHead(idA, idB);
    expect(h2h).not.toBeNull();
    expect(h2h!.totals.aWins).toBe(0);
    expect(h2h!.biggestWinA).toBeNull();
  });
});

describe('getCoachHeadToHead — invalid coach ids', () => {
  it('returns null when coach A does not exist', async () => {
    const staleId = await unusedCoachId();
    const [idB] = await mostFrequentMatchup();
    expect(await getCoachHeadToHead(staleId, idB)).toBeNull();
  });

  it('returns null when coach B does not exist', async () => {
    const [idA] = await mostFrequentMatchup();
    const staleId = await unusedCoachId();
    expect(await getCoachHeadToHead(idA, staleId)).toBeNull();
  });

  it('returns null when neither coach exists', async () => {
    const staleId = await unusedCoachId();
    expect(await getCoachHeadToHead(staleId, staleId + 1)).toBeNull();
  });
});
