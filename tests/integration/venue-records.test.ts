/**
 * The AFLDB-ISSUE-150 venue-record query layer
 * (src/db/queries/venues.ts), against afldb_test.
 *
 * Truth is re-derived here directly from the raw tables — `matches`
 * scorelines and `player_match_stats` — never from the function under
 * test. Venues are discovered dynamically (the busiest venue; a
 * deliberately small one; one with a genuine recorded 0 crowd if the
 * data has one), so the suite does not hard-code an id that a rebuild
 * could move.
 *
 * Mirrors ISSUE-150-venue-evidence.sql, which is the semantic contract.
 */
import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  getVenueClubRecords,
  getVenueMatches,
  getVenueOverview,
  getVenuePlayerLeaders,
  getVenueRecords,
} from '@/db/queries/venues';

afterAll(async () => {
  await sql.end();
});

type RawMatch = {
  id: number; season: number; matchDate: Date;
  homeClubId: number; awayClubId: number;
  homeScore: number; awayScore: number;
  attendance: number | null;
};

async function rawMatches(venueId: number): Promise<RawMatch[]> {
  return sql<RawMatch[]>`
    SELECT m.id, m.season, m.match_date AS "matchDate",
           m.home_club_id AS "homeClubId", m.away_club_id AS "awayClubId",
           m.home_score AS "homeScore", m.away_score AS "awayScore",
           m.attendance
      FROM matches m
     WHERE m.venue_id = ${venueId}
  `;
}

async function busiestVenueId(): Promise<number> {
  const [row] = await sql<{ venueId: number }[]>`
    SELECT venue_id AS "venueId"
      FROM matches
     WHERE venue_id IS NOT NULL
     GROUP BY venue_id
     ORDER BY count(*) DESC, venue_id
     LIMIT 1
  `;
  return row.venueId;
}

async function smallVenueId(): Promise<number> {
  const [row] = await sql<{ venueId: number }[]>`
    SELECT venue_id AS "venueId"
      FROM matches
     WHERE venue_id IS NOT NULL
     GROUP BY venue_id
    HAVING count(*) BETWEEN 2 AND 6
     ORDER BY count(*), venue_id
     LIMIT 1
  `;
  return row.venueId;
}

describe('getVenueOverview', () => {
  it('busiest venue: match count and first/latest match agree with the raw table', async () => {
    const venueId = await busiestVenueId();
    const rows = await rawMatches(venueId);
    expect(rows.length).toBeGreaterThan(100);

    const overview = await getVenueOverview(venueId);
    expect(overview.matches).toBe(rows.length);
    expect(overview.matchesWithAttendance)
      .toBe(rows.filter((r) => r.attendance !== null).length);

    const byDateThenId = [...rows].sort(
      (a, b) => a.matchDate.getTime() - b.matchDate.getTime() || a.id - b.id,
    );
    expect(overview.firstMatch?.id).toBe(byDateThenId[0].id);
    expect(overview.latestMatch?.id).toBe(byDateThenId[byDateThenId.length - 1].id);
  });

  it('an unknown venue id yields zeroes and nulls, never throws', async () => {
    const overview = await getVenueOverview(-1);
    expect(overview).toEqual({
      matches: 0, matchesWithAttendance: 0, avgAttendance: null,
      firstMatch: null, latestMatch: null,
    });
  });
});

describe('getVenueClubRecords', () => {
  it('W-D-L, win % and order re-derive from the raw scorelines', async () => {
    const venueId = await busiestVenueId();
    const rows = await rawMatches(venueId);

    // Truth: tally every club id from BOTH sides of every venue match.
    type Tally = { games: number; wins: number; draws: number; losses: number };
    const tally = new Map<number, Tally>();
    const bump = (id: number, forScore: number, againstScore: number) => {
      const t = tally.get(id) ?? { games: 0, wins: 0, draws: 0, losses: 0 };
      t.games += 1;
      if (forScore > againstScore) t.wins += 1;
      else if (forScore === againstScore) t.draws += 1;
      else t.losses += 1;
      tally.set(id, t);
    };
    for (const m of rows) {
      bump(m.homeClubId, m.homeScore, m.awayScore);
      bump(m.awayClubId, m.awayScore, m.homeScore);
    }

    const records = await getVenueClubRecords(venueId);
    expect(records.length).toBe(tally.size);

    for (const r of records) {
      const t = tally.get(r.clubId);
      expect(t, `club ${r.clubId} missing from raw tally`).toBeDefined();
      expect(r.games).toBe(t!.games);
      expect(r.wins).toBe(t!.wins);
      expect(r.draws).toBe(t!.draws);
      expect(r.losses).toBe(t!.losses);
      expect(r.wins + r.draws + r.losses).toBe(r.games);
      // Plain win %, draws are NOT half-wins.
      expect(r.winPct).toBeCloseTo(Math.round((r.wins / r.games) * 10000) / 100, 5);
    }

    // Order: games DESC, wins DESC, name ASC, id ASC — total and stable.
    for (let i = 1; i < records.length; i += 1) {
      const a = records[i - 1];
      const b = records[i];
      const ordered =
        a.games > b.games
        || (a.games === b.games && a.wins > b.wins)
        || (a.games === b.games && a.wins === b.wins && a.clubName < b.clubName)
        || (a.games === b.games && a.wins === b.wins && a.clubName === b.clubName && a.clubId < b.clubId);
      expect(ordered, `rows ${i - 1}->${i} out of order`).toBe(true);
    }
  });

  it('keeps historical club identities separate (does not fold to the modern club)', async () => {
    // A venue where two identities that share an organization_id both played.
    const [pair] = await sql<{ venueId: number; a: number; b: number }[]>`
      SELECT m.venue_id AS "venueId", c1.id AS a, c2.id AS b
        FROM clubs c1
        JOIN clubs c2
          ON c2.organization_id = c1.organization_id AND c2.id <> c1.id
        JOIN matches m
          ON (m.home_club_id = c1.id OR m.away_club_id = c1.id)
       WHERE EXISTS (
         SELECT 1 FROM matches m2
          WHERE m2.venue_id = m.venue_id
            AND (m2.home_club_id = c2.id OR m2.away_club_id = c2.id)
       )
       LIMIT 1
    `;
    if (!pair) return; // no such venue in this dataset — nothing to assert

    const records = await getVenueClubRecords(pair.venueId);
    const ids = records.map((r) => r.clubId);
    expect(ids).toContain(pair.a);
    expect(ids).toContain(pair.b);
  });

  it('an unknown venue id returns an empty list', async () => {
    expect(await getVenueClubRecords(-1)).toEqual([]);
  });
});

describe('getVenueRecords', () => {
  it('attendance and score records re-derive from the raw table; NULL attendance never wins', async () => {
    const venueId = await busiestVenueId();
    const rows = await rawMatches(venueId);
    const withCrowd = rows.filter((r) => r.attendance !== null) as (RawMatch & { attendance: number })[];

    const records = await getVenueRecords(venueId);

    const maxCrowd = Math.max(...withCrowd.map((r) => r.attendance));
    const minCrowd = Math.min(...withCrowd.map((r) => r.attendance));
    expect(records.highestAttendance?.attendance).toBe(maxCrowd);
    expect(records.lowestAttendance?.attendance).toBe(minCrowd);
    // The picked matches genuinely carry a recorded crowd.
    expect(records.highestAttendance?.attendance).not.toBeNull();
    expect(records.lowestAttendance?.attendance).not.toBeNull();

    const maxTeamScore = Math.max(
      ...rows.map((r) => Math.max(r.homeScore, r.awayScore)),
    );
    expect(records.highestScore?.score).toBe(maxTeamScore);
    expect(records.highestScore!.score).toBeGreaterThanOrEqual(records.highestScore!.opponentScore);

    const maxMargin = Math.max(
      ...rows.filter((r) => r.homeScore !== r.awayScore)
        .map((r) => Math.abs(r.homeScore - r.awayScore)),
    );
    expect(records.biggestMargin?.margin).toBe(maxMargin);
  });

  it('a genuine recorded attendance of 0 is a valid minimum', async () => {
    const [row] = await sql<{ venueId: number }[]>`
      SELECT venue_id AS "venueId"
        FROM matches
       WHERE venue_id IS NOT NULL AND attendance = 0
       GROUP BY venue_id
       ORDER BY venue_id
       LIMIT 1
    `;
    if (!row) return; // no recorded-zero crowd anywhere in this dataset

    const records = await getVenueRecords(row.venueId);
    expect(records.lowestAttendance?.attendance).toBe(0);
  });

  it('an unknown venue id returns all-null records', async () => {
    expect(await getVenueRecords(-1)).toEqual({
      highestAttendance: null, lowestAttendance: null,
      highestScore: null, biggestMargin: null,
    });
  });
});

describe('getVenuePlayerLeaders', () => {
  it('small venue: every board re-derives from raw player_match_stats, NULLs excluded', async () => {
    const venueId = await smallVenueId();

    const raw = await sql<{
      playerId: number; goals: number | null; marks: number | null;
      kicks: number | null; handballs: number | null;
    }[]>`
      SELECT pms.player_id AS "playerId",
             pms.goals, pms.marks, pms.kicks, pms.handballs
        FROM player_match_stats pms
        JOIN matches m ON m.id = pms.match_id
       WHERE m.venue_id = ${venueId}
    `;
    if (raw.length === 0) return;

    type Agg = { value: number; recorded: number };
    const aggregate = (pick: (r: typeof raw[number]) => number | null) => {
      const by = new Map<number, Agg>();
      for (const r of raw) {
        const v = pick(r);
        const a = by.get(r.playerId) ?? { value: 0, recorded: 0 };
        if (v !== null) { a.value += v; a.recorded += 1; }
        by.set(r.playerId, a);
      }
      return by;
    };
    const top5 = (entries: [number, number][]) =>
      entries
        .sort((a, b) => b[1] - a[1] || a[0] - b[0]) // value DESC, player_id ASC
        .slice(0, 5);

    const gamesBy = new Map<number, number>();
    for (const r of raw) gamesBy.set(r.playerId, (gamesBy.get(r.playerId) ?? 0) + 1);

    const leaders = await getVenuePlayerLeaders(venueId);

    // games — one row per player-match at the venue
    expect(leaders.games.map((r) => [r.playerId, r.value]))
      .toEqual(top5([...gamesBy.entries()]));
    for (const r of leaders.games) expect(r.recordedGames).toBe(r.value);

    // statistical boards — only rows where the stat is recorded contribute;
    // a NULL is never summed as 0.
    for (const cat of ['goals', 'marks', 'kicks', 'handballs'] as const) {
      const by = aggregate((r) => r[cat]);
      const expected = top5(
        [...by.entries()]
          .filter(([, a]) => a.recorded > 0)
          .map(([id, a]) => [id, a.value] as [number, number]),
      );
      expect(leaders[cat].map((r) => [r.playerId, r.value]), `${cat} board`).toEqual(expected);
      for (const r of leaders[cat]) {
        expect(r.recordedGames).toBe(by.get(r.playerId)!.recorded);
        expect(r.recordedGames).toBeLessThanOrEqual(gamesBy.get(r.playerId)!);
      }
    }
  });

  it('busiest venue: boards are capped at 5, ranked, and deterministic', async () => {
    const venueId = await busiestVenueId();
    const a = await getVenuePlayerLeaders(venueId);
    const b = await getVenuePlayerLeaders(venueId);

    for (const cat of ['games', 'goals', 'marks', 'kicks', 'handballs'] as const) {
      expect(a[cat].length).toBeLessThanOrEqual(5);
      expect(a[cat].map((r) => r.rank)).toEqual(a[cat].map((_, i) => i + 1));
      for (let i = 1; i < a[cat].length; i += 1) {
        const x = a[cat][i - 1];
        const y = a[cat][i];
        expect(x.value > y.value || (x.value === y.value && x.playerId < y.playerId)).toBe(true);
      }
      expect(a[cat].map((r) => r.playerId)).toEqual(b[cat].map((r) => r.playerId));
    }
  });

  it('an unknown venue id returns five empty boards', async () => {
    expect(await getVenuePlayerLeaders(-1)).toEqual({
      games: [], goals: [], marks: [], kicks: [], handballs: [],
    });
  });
});

describe('getVenueMatches', () => {
  it('busiest venue: the complete history is reachable by paging, not capped at 50', async () => {
    const venueId = await busiestVenueId();
    const [{ total: rawTotal }] = await sql<{ total: string }[]>`
      SELECT count(*) AS total FROM matches WHERE venue_id = ${venueId}
    `;
    const total = Number(rawTotal);
    expect(total).toBeGreaterThan(50); // the old page truncated here

    const page1 = await getVenueMatches(venueId, { limit: 50, offset: 0 });
    const page2 = await getVenueMatches(venueId, { limit: 50, offset: 50 });
    expect(page1.total).toBe(total);
    expect(page2.total).toBe(total);
    expect(page1.rows).toHaveLength(50);
    expect(page2.rows.length).toBeGreaterThan(0);

    const ids1 = new Set(page1.rows.map((r) => r.id));
    for (const r of page2.rows) expect(ids1.has(r.id)).toBe(false);

    // Newest first, id breaking a shared date — total and stable.
    const all = [...page1.rows, ...page2.rows];
    for (let i = 1; i < all.length; i += 1) {
      const a = all[i - 1];
      const b = all[i];
      const t = (d: Date) => d.getTime();
      expect(t(a.matchDate) > t(b.matchDate)
        || (t(a.matchDate) === t(b.matchDate) && a.id > b.id)).toBe(true);
    }
  });

  it('walking every page returns each match exactly once', async () => {
    const venueId = await smallVenueId();
    const { total } = await getVenueMatches(venueId, { limit: 1, offset: 0 });
    const seen = new Set<number>();
    for (let offset = 0; offset < total; offset += 2) {
      const { rows } = await getVenueMatches(venueId, { limit: 2, offset });
      for (const r of rows) {
        expect(seen.has(r.id)).toBe(false);
        seen.add(r.id);
      }
    }
    expect(seen.size).toBe(total);
  });

  it('an offset past the end still reports the true total', async () => {
    const venueId = await smallVenueId();
    const { rows, total } = await getVenueMatches(venueId, { limit: 10, offset: 100_000 });
    expect(rows).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  it('an unknown venue id returns no rows and a zero total', async () => {
    expect(await getVenueMatches(-1, { limit: 10, offset: 0 })).toEqual({ rows: [], total: 0 });
  });
});
