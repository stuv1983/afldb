/**
 * AFLDB-ISSUE-144 Stages 1-4 -- head-to-head core, connected players,
 * H2H player leaders and Brownlow, and the season-generic
 * selected-season comparison.
 *
 * Runs against real `afldb_test` data, because the whole point of these
 * queries is that historical club identities resolve to organisations
 * through `clubs.organization_id`. Fixtures could not prove that.
 *
 * Every count assertion is checked against an INDEPENDENT SQL oracle
 * defined in this file: plain joins and plain aggregates, no CTEs, no
 * perspective columns, no shared fragment. Calling the implementation
 * twice would prove nothing.
 *
 * The named witnesses (Adelaide/Brisbane Lions 41-19-21-1, matches
 * 16486/12275/12463, Carlton/Collingwood 268) come from the measured
 * ISSUE-144 test-database evidence pack and the approved runbook.
 */
import './guard';

import { readFileSync } from 'node:fs';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import {
  CLUB_BROWNLOW_LEADER_RANK_LIMIT,
  CLUB_SEASON_LEADER_RANK_LIMIT,
  getClubBrownlowHistory,
  getClubSeasonBrownlowSummary,
  getClubSeasonComparison,
  getClubSeasonPlayerLeaders,
  getClubSeasonRecord,
  getClubSeasonTeamMetrics,
  getComparisonSeason,
  getComparisonSeasons,
  getHeadToHeadBrownlow,
  getHeadToHeadByDecade,
  getHeadToHeadMeetings,
  getHeadToHeadPeriodRecords,
  getHeadToHeadPlayerAverages,
  getHeadToHeadPlayerLeaders,
  getHeadToHeadRecords,
  getHeadToHeadStreaks,
  getHeadToHeadSummary,
  getHeadToHeadVenueRecords,
  getCrossoverPlayers,
  getCrossoverSummary,
  getMaximumComparisonSeason,
  getOrganizationBySlug,
  getSeasonIdentity,
  getSeasonParticipants,
  H2H_AVERAGE_METRICS,
  H2H_AVERAGE_MINIMUM_RECORDED_GAMES,
  H2H_AVERAGE_RANK_LIMIT,
  H2H_LEADER_RANK_LIMIT,
  MEETINGS_PAGE_SIZE,
  TEAM_METRICS,
} from '@/db/queries/club-comparison';
import type {
  H2HPeriodRecordKind,
  H2HTurnaroundSegment,
} from '@/db/queries/club-comparison';

afterAll(async () => {
  await sql.end();
});

// --- Independent SQL oracle ---

type OracleSummary = {
  meetings: number;
  aWins: number;
  bWins: number;
  drawsByWinnerNull: number;
  drawsByEqualScore: number;
  finalsSeries: number;
  grandFinals: number;
  firstDate: Date | null;
  latestDate: Date | null;
};

/** Plain aggregate over the two-way organisation join. No CTE, no reuse. */
async function oracleSummary(orgA: number, orgB: number): Promise<OracleSummary> {
  const [row] = await sql<OracleSummary[]>`
    SELECT count(*)::int AS meetings,
           count(*) FILTER (WHERE wc.organization_id = ${orgA})::int AS "aWins",
           count(*) FILTER (WHERE wc.organization_id = ${orgB})::int AS "bWins",
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS "drawsByWinnerNull",
           count(*) FILTER (WHERE m.home_score = m.away_score)::int AS "drawsByEqualScore",
           count(*) FILTER (WHERE m.is_finals_series)::int AS "finalsSeries",
           count(*) FILTER (WHERE m.round_type = 'grand_final')::int AS "grandFinals",
           min(m.match_date) AS "firstDate",
           max(m.match_date) AS "latestDate"
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN clubs wc ON wc.id = m.winner_club_id
     WHERE (hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
        OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA})
  `;
  return row;
}

type OracleMeeting = {
  id: number;
  season: number;
  matchDate: Date | null;
  roundType: string;
  isFinalsSeries: boolean | null;
  venueId: number | null;
  venueRaw: string | null;
  venueName: string | null;
  homeClubId: number;
  awayClubId: number;
  homeOrgId: number;
  awayOrgId: number;
  winnerOrgId: number | null;
  homeScore: number | null;
  awayScore: number | null;
};

/** Every meeting, unaggregated and unordered by the implementation's rules. */
async function oracleMeetings(orgA: number, orgB: number): Promise<OracleMeeting[]> {
  const rows = await sql<OracleMeeting[]>`
    SELECT m.id, m.season, m.match_date AS "matchDate", m.round_type::text AS "roundType",
           m.is_finals_series AS "isFinalsSeries",
           m.venue_id AS "venueId", m.venue_raw AS "venueRaw", v.canonical_name AS "venueName",
           m.home_club_id AS "homeClubId", m.away_club_id AS "awayClubId",
           hc.organization_id AS "homeOrgId", ac.organization_id AS "awayOrgId",
           wc.organization_id AS "winnerOrgId",
           m.home_score AS "homeScore", m.away_score AS "awayScore"
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN clubs wc ON wc.id = m.winner_club_id
      LEFT JOIN venues v ON v.id = m.venue_id
     WHERE (hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
        OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA})
  `;
  return [...rows];
}

/** Organisation A's score in an oracle row, without touching the implementation. */
function perspective(row: OracleMeeting, orgA: number) {
  const aScore = row.homeOrgId === orgA ? row.homeScore : row.awayScore;
  const bScore = row.homeOrgId === orgA ? row.awayScore : row.homeScore;
  return { aScore, bScore };
}

async function clubIdBySlug(slug: string): Promise<number> {
  const [row] = await sql<{ id: number }[]>`SELECT id FROM clubs WHERE slug = ${slug}`;
  expect(row, `club identity '${slug}' is missing from afldb_test`).toBeDefined();
  return row.id;
}

async function orgIdBySlug(slug: string): Promise<number> {
  const org = await getOrganizationBySlug(slug);
  expect(org, `organisation '${slug}' is missing from afldb_test`).not.toBeNull();
  return (org as { id: number }).id;
}

// --- Tests ---

describe('club comparison: head-to-head core', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;
  let collingwood = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton, collingwood] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
      orgIdBySlug('collingwood'),
    ]);
  });

  it('summarises Adelaide vs Brisbane Lions to the canonical witness and to independent SQL', async () => {
    const [summary, oracle] = await Promise.all([
      getHeadToHeadSummary(adelaide, lions),
      oracleSummary(adelaide, lions),
    ]);

    // The measured canonical witness.
    expect(summary.meetings).toBe(41);
    expect(summary.aWins).toBe(19);
    expect(summary.bWins).toBe(21);
    expect(summary.draws).toBe(1);
    expect(summary.finalsSeriesMeetings).toBe(2);
    expect(summary.grandFinalMeetings).toBe(0);

    // ...and the same numbers reached by structurally simpler SQL.
    expect(summary.meetings).toBe(oracle.meetings);
    expect(summary.aWins).toBe(oracle.aWins);
    expect(summary.bWins).toBe(oracle.bWins);
    expect(summary.draws).toBe(oracle.drawsByWinnerNull);
    expect(oracle.drawsByWinnerNull).toBe(oracle.drawsByEqualScore);
    expect(summary.finalsSeriesMeetings).toBe(oracle.finalsSeries);
    expect(summary.grandFinalMeetings).toBe(oracle.grandFinals);
    expect(summary.aWins + summary.bWins + summary.draws).toBe(summary.meetings);

    // Half-draw win percentages.
    expect(summary.aWinPercentage).toBeCloseTo((100 * (19 + 0.5)) / 41, 10);
    expect(summary.bWinPercentage).toBeCloseTo((100 * (21 + 0.5)) / 41, 10);
    expect((summary.aWinPercentage as number) + (summary.bWinPercentage as number)).toBeCloseTo(100, 10);

    // First and latest meeting, by chronology rather than by id alone.
    expect(summary.firstMeeting?.matchId).toBe(11178);
    expect(summary.firstMeeting?.season).toBe(1997);
    expect(summary.firstMeeting?.matchDate?.getTime()).toBe(oracle.firstDate?.getTime());
    expect(summary.latestMeeting?.matchId).toBe(16729);
    expect(summary.latestMeeting?.season).toBe(2025);
    expect(summary.latestMeeting?.matchDate?.getTime()).toBe(oracle.latestDate?.getTime());
  });

  it('filters by match type so that home-and-away and finals partition the complete history', async () => {
    const [all, homeAndAway, finals, oracle] = await Promise.all([
      getHeadToHeadMeetings(adelaide, lions, { matchType: 'all' }),
      getHeadToHeadMeetings(adelaide, lions, { matchType: 'home-and-away' }),
      getHeadToHeadMeetings(adelaide, lions, { matchType: 'finals' }),
      oracleMeetings(adelaide, lions),
    ]);

    expect(all.totalMeetings).toBe(41);
    expect(finals.totalMeetings).toBe(2);
    expect(homeAndAway.totalMeetings).toBe(39);
    expect(homeAndAway.totalMeetings + finals.totalMeetings).toBe(all.totalMeetings);

    expect(all.totalMeetings).toBe(oracle.length);
    expect(finals.totalMeetings).toBe(oracle.filter((m) => m.isFinalsSeries === true).length);
    expect(homeAndAway.totalMeetings).toBe(oracle.filter((m) => m.isFinalsSeries !== true).length);

    // The two finals witnesses, and finals derived from is_finals_series only.
    expect(finals.meetings.map((m) => m.matchId).sort((x, y) => x - y)).toEqual([12275, 12463]);
    expect(finals.meetings.every((m) => m.isFinalsSeries)).toBe(true);
    expect(finals.meetings.map((m) => m.roundType).sort()).toEqual(['qualifying_final', 'semi_final']);
    expect(finals.meetings.some((m) => m.isGrandFinal)).toBe(false);

    // The 2024 draw witness, carried on the complete list.
    const draw = all.meetings.find((m) => m.matchId === 16486);
    expect(draw).toBeDefined();
    expect(draw?.season).toBe(2024);
    expect(draw?.outcome).toBe('draw');
    expect(draw?.homeScore).toBe(draw?.awayScore);
    expect(draw?.isFinalsSeries).toBe(false);
  });

  it('paginates the complete meetings list deterministically at 25 rows per page', async () => {
    expect(MEETINGS_PAGE_SIZE).toBe(25);

    const [page1, page2, page3] = await Promise.all([
      getHeadToHeadMeetings(adelaide, lions, { page: 1 }),
      getHeadToHeadMeetings(adelaide, lions, { page: 2 }),
      getHeadToHeadMeetings(adelaide, lions, { page: 3 }),
    ]);

    expect(page1.meetings).toHaveLength(25);
    expect(page2.meetings).toHaveLength(16);
    expect(page3.meetings).toHaveLength(0);
    expect(page1.totalPages).toBe(2);
    expect(page1.hasPreviousPage).toBe(false);
    expect(page1.hasNextPage).toBe(true);
    expect(page2.hasPreviousPage).toBe(true);
    expect(page2.hasNextPage).toBe(false);
    expect(page3.totalMeetings).toBe(41);

    const ids = [...page1.meetings, ...page2.meetings].map((m) => m.matchId);
    expect(new Set(ids).size).toBe(41);

    // match_date DESC, season DESC, id DESC.
    const keys = [...page1.meetings, ...page2.meetings].map(
      (m) => [m.matchDate?.getTime() ?? 0, m.season, m.matchId] as [number, number, number],
    );
    for (let i = 1; i < keys.length; i += 1) {
      const [prev, next] = [keys[i - 1], keys[i]];
      const descending = prev[0] !== next[0]
        ? prev[0] > next[0]
        : prev[1] !== next[1]
          ? prev[1] > next[1]
          : prev[2] > next[2];
      expect(descending, `rows ${i - 1} and ${i} are out of order`).toBe(true);
    }
    expect(page1.meetings[0].matchId).toBe(16729);
    expect(page2.meetings[page2.meetings.length - 1].matchId).toBe(11178);
  });

  it('groups venue records by canonical venue and agrees with an independent grouping', async () => {
    const [venues, oracle] = await Promise.all([
      getHeadToHeadVenueRecords(adelaide, lions),
      oracleMeetings(adelaide, lions),
    ]);

    const expected = new Map<string, { meetings: number; aWins: number; bWins: number; draws: number }>();
    for (const row of oracle) {
      const key = row.venueId === null ? `raw:${row.venueRaw ?? ''}` : `id:${row.venueId}`;
      const bucket = expected.get(key) ?? { meetings: 0, aWins: 0, bWins: 0, draws: 0 };
      bucket.meetings += 1;
      if (row.winnerOrgId === adelaide) bucket.aWins += 1;
      else if (row.winnerOrgId === lions) bucket.bWins += 1;
      else bucket.draws += 1;
      expected.set(key, bucket);
    }

    expect(venues).toHaveLength(expected.size);
    expect(venues.reduce((n, v) => n + v.meetings, 0)).toBe(41);
    for (const venue of venues) {
      const key = venue.venueId === null ? `raw:${venue.venueName ?? ''}` : `id:${venue.venueId}`;
      const want = expected.get(key);
      expect(want, `venue group ${key} was not produced by the oracle`).toBeDefined();
      expect(venue.meetings).toBe(want?.meetings);
      expect(venue.aWins).toBe(want?.aWins);
      expect(venue.bWins).toBe(want?.bWins);
      expect(venue.draws).toBe(want?.draws);
      expect(venue.aWins + venue.bWins + venue.draws).toBe(venue.meetings);
    }

    // Measured witness: the Gabba is the most-used ground of this rivalry.
    const gabba = venues.find((v) => v.venueName === 'Gabba');
    expect(gabba?.meetings).toBe(25);
    expect(gabba?.aWins).toBe(11);
    expect(gabba?.bWins).toBe(14);
    expect(gabba?.draws).toBe(0);
    const adelaideOval = venues.find((v) => v.venueName === 'Adelaide Oval');
    expect(adelaideOval?.meetings).toBe(7);
    expect(adelaideOval?.draws).toBe(1);
  });

  it('derives every head-to-head record from independent extremes and keeps ties', async () => {
    const [records, oracle] = await Promise.all([
      getHeadToHeadRecords(adelaide, lions),
      oracleMeetings(adelaide, lions),
    ]);

    const scored = oracle
      .map((row) => ({ id: row.id, ...perspective(row, adelaide) }))
      .filter((row): row is { id: number; aScore: number; bScore: number } =>
        row.aScore !== null && row.bScore !== null);

    const idsOf = (kind: keyof typeof records) => records[kind].map((r) => r.matchId).sort((x, y) => x - y);
    const pick = (values: number[], want: number) => values.filter((v) => v === want).length;

    const biggestA = Math.max(...scored.filter((r) => r.aScore > r.bScore).map((r) => r.aScore - r.bScore));
    const biggestB = Math.max(...scored.filter((r) => r.bScore > r.aScore).map((r) => r.bScore - r.aScore));
    const closest = Math.min(...scored.filter((r) => r.aScore !== r.bScore).map((r) => Math.abs(r.aScore - r.bScore)));
    const highestA = Math.max(...scored.map((r) => r.aScore));
    const highestB = Math.max(...scored.map((r) => r.bScore));
    const lowestA = Math.min(...scored.map((r) => r.aScore));
    const lowestB = Math.min(...scored.map((r) => r.bScore));
    const combined = Math.max(...scored.map((r) => r.aScore + r.bScore));

    expect(records['biggest-win-a'].every((r) => r.value === biggestA)).toBe(true);
    expect(records['biggest-win-b'].every((r) => r.value === biggestB)).toBe(true);
    expect(records['closest-game'].every((r) => r.value === closest)).toBe(true);
    expect(records['highest-score-a'].every((r) => r.value === highestA)).toBe(true);
    expect(records['highest-score-b'].every((r) => r.value === highestB)).toBe(true);
    expect(records['lowest-score-a'].every((r) => r.value === lowestA)).toBe(true);
    expect(records['lowest-score-b'].every((r) => r.value === lowestB)).toBe(true);
    expect(records['highest-combined-score'].every((r) => r.value === combined)).toBe(true);

    // Every tied witness is returned, not one arbitrary row.
    expect(idsOf('biggest-win-a')).toEqual(
      scored.filter((r) => r.aScore - r.bScore === biggestA).map((r) => r.id).sort((x, y) => x - y));
    expect(idsOf('lowest-score-a')).toEqual(
      scored.filter((r) => r.aScore === lowestA).map((r) => r.id).sort((x, y) => x - y));
    expect(idsOf('highest-combined-score')).toEqual(
      scored.filter((r) => r.aScore + r.bScore === combined).map((r) => r.id).sort((x, y) => x - y));

    // Measured witnesses.
    expect(biggestA).toBe(138);
    expect(idsOf('biggest-win-a')).toEqual([14950]);
    expect(biggestB).toBe(141);
    expect(idsOf('biggest-win-b')).toEqual([12597]);
    expect(closest).toBe(1);
    expect(idsOf('closest-game')).toEqual([15481]);
    expect(highestA).toBe(177);
    expect(highestB).toBe(189);
    expect(lowestB).toBe(39);
    expect(combined).toBe(249);
    expect(idsOf('highest-combined-score')).toEqual([11978]);

    // Adelaide's lowest score against Brisbane Lions is a genuine two-way
    // tie: collapsing it would silently drop the 2002 qualifying final.
    expect(lowestA).toBe(44);
    expect(pick(scored.map((r) => r.aScore), 44)).toBe(2);
    expect(idsOf('lowest-score-a')).toEqual([11692, 12275]);

    // The draw is never the closest game, and never a record win.
    expect(records['closest-game'].some((r) => r.matchId === 16486)).toBe(false);
    expect(records['biggest-win-a'].some((r) => r.outcome === 'draw')).toBe(false);
    expect(records['biggest-win-b'].some((r) => r.outcome === 'draw')).toBe(false);
  });

  it('reads streaks from chronological order, with a draw breaking a winning streak', async () => {
    const streaks = await getHeadToHeadStreaks(adelaide, lions);

    // Adelaide 2013 round 2 through 2018 round 18: seven straight.
    expect(streaks.longestA?.outcome).toBe('a-win');
    expect(streaks.longestA?.length).toBe(7);
    expect(streaks.longestA?.fromMatchId).toBe(14177);
    expect(streaks.longestA?.toMatchId).toBe(15346);
    expect(streaks.longestA?.fromSeason).toBe(2013);
    expect(streaks.longestA?.toSeason).toBe(2018);

    // Brisbane Lions 2002 qualifying final through 2005: six straight,
    // finals included -- the streak population is every meeting.
    expect(streaks.longestB?.outcome).toBe('b-win');
    expect(streaks.longestB?.length).toBe(6);
    expect(streaks.longestB?.fromMatchId).toBe(12275);
    expect(streaks.longestB?.toMatchId).toBe(12710);

    // The 2024 draw broke Brisbane Lions' run, so the current streak is
    // Adelaide's single 2025 win rather than anything longer.
    expect(streaks.current?.outcome).toBe('a-win');
    expect(streaks.current?.length).toBe(1);
    expect(streaks.current?.fromMatchId).toBe(16729);
    expect(streaks.current?.toMatchId).toBe(16729);
  });

  it('includes Footscray and South Melbourne meetings through organization_id', async () => {
    const [bulldogs, sydney, footscray, southMelbourne] = await Promise.all([
      orgIdBySlug('western-bulldogs'),
      orgIdBySlug('sydney'),
      clubIdBySlug('footscray'),
      clubIdBySlug('south-melbourne'),
    ]);

    const [bulldogsSummary, bulldogsOracle] = await Promise.all([
      getHeadToHeadSummary(bulldogs, carlton),
      oracleMeetings(bulldogs, carlton),
    ]);
    const footscrayMeetings = bulldogsOracle.filter(
      (m) => m.homeClubId === footscray || m.awayClubId === footscray);
    expect(footscrayMeetings.length).toBeGreaterThan(0);
    expect(bulldogsSummary.meetings).toBe(bulldogsOracle.length);
    expect(bulldogsSummary.meetings).toBeGreaterThan(bulldogsOracle.length - footscrayMeetings.length);
    // Historical rows keep the identity that played.
    const bulldogsMeetings = await getHeadToHeadMeetings(bulldogs, carlton, { page: bulldogsSummary.meetings > 25 ? Math.ceil(bulldogsSummary.meetings / 25) : 1 });
    expect(bulldogsMeetings.meetings.some((m) => m.homeClubSlug === 'footscray' || m.awayClubSlug === 'footscray')).toBe(true);

    const [sydneySummary, sydneyOracle] = await Promise.all([
      getHeadToHeadSummary(sydney, carlton),
      oracleMeetings(sydney, carlton),
    ]);
    const southMelbourneMeetings = sydneyOracle.filter(
      (m) => m.homeClubId === southMelbourne || m.awayClubId === southMelbourne);
    expect(southMelbourneMeetings.length).toBeGreaterThan(0);
    expect(sydneySummary.meetings).toBe(sydneyOracle.length);
    expect(sydneySummary.meetings).toBeGreaterThan(sydneyOracle.length - southMelbourneMeetings.length);
  });

  it('keeps Brisbane Bears and Fitzroy out of Brisbane Lions head-to-head totals', async () => {
    const [bears, fitzroy] = await Promise.all([
      orgIdBySlug('brisbane-bears'),
      orgIdBySlug('fitzroy'),
    ]);

    const [lionsMeetings, bearsSummary, fitzroySummary] = await Promise.all([
      oracleMeetings(adelaide, lions),
      getHeadToHeadSummary(adelaide, bears),
      getHeadToHeadSummary(adelaide, fitzroy),
    ]);

    // The two merged organisations really did play Adelaide...
    expect(bearsSummary.meetings).toBeGreaterThan(0);
    expect(fitzroySummary.meetings).toBeGreaterThan(0);

    // ...and none of those meetings is inside the Brisbane Lions total.
    const lionsOrgs = new Set(lionsMeetings.flatMap((m) => [m.homeOrgId, m.awayOrgId]));
    expect(lionsOrgs.has(bears)).toBe(false);
    expect(lionsOrgs.has(fitzroy)).toBe(false);
    expect(lionsMeetings).toHaveLength(41);

    const [bearsMeetings, fitzroyMeetings] = await Promise.all([
      oracleMeetings(adelaide, bears),
      oracleMeetings(adelaide, fitzroy),
    ]);
    const lionsIds = new Set(lionsMeetings.map((m) => m.id));
    expect(bearsMeetings.some((m) => lionsIds.has(m.id))).toBe(false);
    expect(fitzroyMeetings.some((m) => lionsIds.has(m.id))).toBe(false);
  });

  it('handles the Carlton vs Collingwood long rivalry, including Grand Finals', async () => {
    const [summary, oracle, all, finals] = await Promise.all([
      getHeadToHeadSummary(carlton, collingwood),
      oracleSummary(carlton, collingwood),
      getHeadToHeadMeetings(carlton, collingwood, { matchType: 'all' }),
      getHeadToHeadMeetings(carlton, collingwood, { matchType: 'finals' }),
    ]);

    expect(summary.meetings).toBe(268);
    expect(summary.meetings).toBe(oracle.meetings);
    expect(summary.aWins).toBe(oracle.aWins);
    expect(summary.bWins).toBe(oracle.bWins);
    expect(summary.draws).toBe(oracle.drawsByWinnerNull);
    expect(summary.aWins + summary.bWins + summary.draws).toBe(summary.meetings);
    expect(summary.finalsSeriesMeetings).toBe(oracle.finalsSeries);
    expect(all.totalMeetings).toBe(oracle.meetings);
    expect(finals.totalMeetings).toBe(oracle.finalsSeries);

    // Grand Finals come from round_type only, and there is at least one.
    expect(summary.grandFinalMeetings).toBe(oracle.grandFinals);
    expect(summary.grandFinalMeetings).toBeGreaterThan(0);
    const grandFinals = finals.meetings.filter((m) => m.isGrandFinal);
    expect(grandFinals.length).toBeGreaterThan(0);
    expect(grandFinals.every((m) => m.roundType === 'grand_final')).toBe(true);
    expect(grandFinals.every((m) => m.isFinalsSeries)).toBe(true);

    const streaks = await getHeadToHeadStreaks(carlton, collingwood);
    expect((streaks.longestA?.length ?? 0)).toBeGreaterThan(0);
    expect((streaks.longestB?.length ?? 0)).toBeGreaterThan(0);
    expect(streaks.current).not.toBeNull();
  });

  it('refuses to compare an organisation with itself', async () => {
    await expect(getHeadToHeadSummary(carlton, carlton)).rejects.toThrow(/cannot be compared with itself/);
    await expect(getHeadToHeadMeetings(carlton, carlton)).rejects.toThrow(/cannot be compared with itself/);
    await expect(getHeadToHeadRecords(carlton, carlton)).rejects.toThrow(/cannot be compared with itself/);
    await expect(getHeadToHeadStreaks(carlton, carlton)).rejects.toThrow(/cannot be compared with itself/);
    await expect(getHeadToHeadVenueRecords(carlton, carlton)).rejects.toThrow(/cannot be compared with itself/);
  });
});

// --- Stage 2: independent crossover oracle ---
//
// Deliberately simpler than the implementation: plain GROUP BY, no
// DISTINCT ON, no row-value comparison, no jsonb, no shared fragment,
// no self-join on a derived pair CTE. It reaches "who played for both,
// when, and how often" by the shortest route available, so agreement is
// evidence rather than a restatement.

type OracleRepresentation = {
  playerId: number;
  aGames: number;
  aGoals: number;
  aFirst: Date | null;
  aLast: Date | null;
  bGames: number;
  bGoals: number;
  bFirst: Date | null;
  bLast: Date | null;
};

async function oracleCrossover(orgA: number, orgB: number): Promise<OracleRepresentation[]> {
  const rows = await sql<OracleRepresentation[]>`
    WITH per_org AS (
      SELECT pc.player_id,
             c.organization_id AS org_id,
             sum(pc.games)::int AS games,
             sum(pc.goals)::int AS goals,
             min(fm.match_date) AS first_date,
             max(lm.match_date) AS last_date
        FROM player_clubs pc
        JOIN clubs c ON c.id = pc.club_id
        LEFT JOIN matches fm ON fm.id = pc.first_match_id
        LEFT JOIN matches lm ON lm.id = pc.last_match_id
       GROUP BY pc.player_id, c.organization_id
    )
    SELECT x.player_id AS "playerId",
           x.games AS "aGames", x.goals AS "aGoals",
           x.first_date AS "aFirst", x.last_date AS "aLast",
           y.games AS "bGames", y.goals AS "bGoals",
           y.first_date AS "bFirst", y.last_date AS "bLast"
      FROM per_org x
      JOIN per_org y ON y.player_id = x.player_id AND y.org_id = ${orgB}
     WHERE x.org_id = ${orgA}
  `;
  return [...rows];
}

/** Third organisations first represented strictly between the two target debuts. */
async function oracleIntervening(playerId: number, orgA: number, orgB: number): Promise<string[]> {
  const rows = await sql<{ slug: string }[]>`
    WITH per_org AS (
      SELECT pc.player_id,
             c.organization_id AS org_id,
             min(fm.match_date) AS first_date
        FROM player_clubs pc
        JOIN clubs c ON c.id = pc.club_id
        LEFT JOIN matches fm ON fm.id = pc.first_match_id
       WHERE pc.player_id = ${playerId}
       GROUP BY pc.player_id, c.organization_id
    ),
    bounds AS (
      SELECT min(first_date) AS lo, max(first_date) AS hi
        FROM per_org
       WHERE org_id IN (${orgA}, ${orgB})
    )
    SELECT o.slug
      FROM per_org r
      JOIN club_organizations o ON o.id = r.org_id
      CROSS JOIN bounds
     WHERE r.org_id NOT IN (${orgA}, ${orgB})
       AND r.first_date > bounds.lo
       AND r.first_date < bounds.hi
     ORDER BY r.first_date
  `;
  return rows.map((r) => r.slug);
}

const day = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));

describe('club comparison: crossover players', () => {
  let adelaide = 0;
  let lions = 0;
  let bears = 0;
  let fitzroy = 0;
  let carlton = 0;
  let bulldogs = 0;

  beforeAll(async () => {
    [adelaide, lions, bears, fitzroy, carlton, bulldogs] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('brisbane-bears'),
      orgIdBySlug('fitzroy'),
      orgIdBySlug('carlton'),
      orgIdBySlug('western-bulldogs'),
    ]);
  });

  it('lists everyone who represented both organisations, agreeing with independent SQL', async () => {
    const [players, oracle] = await Promise.all([
      getCrossoverPlayers(adelaide, lions),
      oracleCrossover(adelaide, lions),
    ]);

    // The measured witness for this pair.
    expect(players).toHaveLength(11);
    expect(players).toHaveLength(oracle.length);
    expect(new Set(players.map((p) => p.playerId)))
      .toEqual(new Set(oracle.map((o) => o.playerId)));

    // Per-organisation aggregation and chronology, row for row.
    const byId = new Map(oracle.map((o) => [o.playerId, o]));
    for (const p of players) {
      const o = byId.get(p.playerId) as OracleRepresentation;
      expect(p.a.games, p.displayName).toBe(o.aGames);
      expect(p.a.goals, p.displayName).toBe(o.aGoals);
      expect(p.b.games, p.displayName).toBe(o.bGames);
      expect(p.b.goals, p.displayName).toBe(o.bGoals);
      expect(day(p.a.firstMatchDate), p.displayName).toBe(day(o.aFirst));
      expect(day(p.a.lastMatchDate), p.displayName).toBe(day(o.aLast));
      expect(day(p.b.firstMatchDate), p.displayName).toBe(day(o.bFirst));
      expect(day(p.b.lastMatchDate), p.displayName).toBe(day(o.bLast));
      expect(p.combinedGames, p.displayName).toBe(o.aGames + o.bGames);
      expect(p.combinedGoals, p.displayName).toBe(o.aGoals + o.bGoals);
      // Completion is the LATER of the two debuts, never the career debut.
      expect(day(p.completionDate), p.displayName)
        .toBe(day(new Date(Math.max((o.aFirst as Date).getTime(), (o.bFirst as Date).getTime()))));
    }

    // Career totals come from player_career_stats, and are at least the
    // two selected organisations' games -- a player with a third club has
    // strictly more.
    for (const p of players) {
      expect(p.careerGames, p.displayName).not.toBeNull();
      expect(p.careerGames as number, p.displayName).toBeGreaterThanOrEqual(p.combinedGames);
    }
    const lyons = players.find((p) => p.displayName === 'Jarryd Lyons');
    expect(lyons?.careerGames).toBe(194);
    expect(lyons?.careerGoals).toBe(86);
    expect(lyons?.careerGames).toBeGreaterThan(lyons?.combinedGames as number);

    // Default ordering: combined games DESC, then sort name, then id.
    for (let i = 1; i < players.length; i += 1) {
      const [prev, next] = [players[i - 1], players[i]];
      const ordered = prev.combinedGames !== next.combinedGames
        ? prev.combinedGames > next.combinedGames
        : prev.sortName !== next.sortName
          ? prev.sortName < next.sortName
          : prev.playerId < next.playerId;
      expect(ordered, `rows ${i - 1} and ${i} are out of order`).toBe(true);
    }
    expect(players[0].displayName).toBe('Charlie Cameron');
    expect(players[0].combinedGames).toBe(254);
  });

  it('reports Ben Keays as Brisbane Lions first, then Adelaide, in both argument orders', async () => {
    const [fromAdelaide, fromLions] = await Promise.all([
      getCrossoverPlayers(adelaide, lions),
      getCrossoverPlayers(lions, adelaide),
    ]);

    const a = fromAdelaide.find((p) => p.displayName === 'Ben Keays');
    const b = fromLions.find((p) => p.displayName === 'Ben Keays');
    expect(a).toBeDefined();
    expect(b).toBeDefined();

    // A = Adelaide, B = Brisbane Lions: the Lions came first, so B -> A.
    expect(a?.direction).toBe('b-to-a');
    expect(day(a?.b.firstMatchDate ?? null)).toBe('2016-05-01');
    expect(day(a?.a.firstMatchDate ?? null)).toBe('2020-06-13');
    expect(a?.b.games).toBe(30);
    expect(a?.a.games).toBe(131);

    // Swapping the arguments swaps the label and nothing else.
    expect(b?.direction).toBe('a-to-b');
    expect(b?.a.games).toBe(a?.b.games);
    expect(b?.b.games).toBe(a?.a.games);
    expect(day(b?.completionDate ?? null)).toBe(day(a?.completionDate ?? null));
    expect(day(a?.completionDate ?? null)).toBe('2020-06-13');

    // Direction is first representation only; he went to Adelaide directly,
    // and either way no third organisation is claimed.
    expect(a?.interveningOrganizations).toEqual([]);
    expect(b?.interveningOrganizations).toEqual([]);
  });

  it('reports Jarryd Lyons as Adelaide first, then Brisbane Lions, with Gold Coast in between', async () => {
    const [fromAdelaide, fromLions, oracleSlugs] = await Promise.all([
      getCrossoverPlayers(adelaide, lions),
      getCrossoverPlayers(lions, adelaide),
      oracleIntervening(6818, adelaide, lions),
    ]);

    const a = fromAdelaide.find((p) => p.displayName === 'Jarryd Lyons');
    const b = fromLions.find((p) => p.displayName === 'Jarryd Lyons');
    expect(a?.playerId).toBe(6818);

    expect(a?.direction).toBe('a-to-b');
    expect(b?.direction).toBe('b-to-a');
    expect(day(a?.a.firstMatchDate ?? null)).toBe('2012-04-29');
    expect(day(a?.a.lastMatchDate ?? null)).toBe('2016-09-17');
    expect(day(a?.b.firstMatchDate ?? null)).toBe('2019-03-23');
    expect(day(a?.b.lastMatchDate ?? null)).toBe('2024-04-20');
    expect(a?.a.games).toBe(55);
    expect(a?.b.games).toBe(102);
    expect(a?.combinedGames).toBe(157);
    expect(day(a?.completionDate ?? null)).toBe('2019-03-23');

    // Gold Coast: first represented 2017, inside the 2012 -> 2019 interval.
    expect(a?.interveningOrganizations.map((o) => o.slug)).toEqual(['gold-coast']);
    expect(a?.interveningOrganizations.map((o) => o.slug)).toEqual(oracleSlugs);
    expect(oracleSlugs).toEqual(['gold-coast']);
    // Argument order does not change which third organisation intervened.
    expect(b?.interveningOrganizations.map((o) => o.slug)).toEqual(['gold-coast']);
    const gc = a?.interveningOrganizations[0];
    expect(gc?.organizationId).toBe(await orgIdBySlug('gold-coast'));
    expect(gc?.name).toBe('Gold Coast');

    // Neither target organisation may ever appear as an intervening one.
    for (const p of fromAdelaide) {
      const ids = p.interveningOrganizations.map((o) => o.organizationId);
      expect(ids).not.toContain(adelaide);
      expect(ids).not.toContain(lions);
      expect(new Set(ids).size, p.displayName).toBe(ids.length);
      expect(p.interveningOrganizations.map((o) => o.slug))
        .toEqual(await oracleIntervening(p.playerId, adelaide, lions));
    }
  });

  it('treats Footscray and Western Bulldogs as one continuing organisation', async () => {
    const [players, oracle] = await Promise.all([
      getCrossoverPlayers(carlton, bulldogs),
      oracleCrossover(carlton, bulldogs),
    ]);

    expect(players).toHaveLength(40);
    expect(players).toHaveLength(oracle.length);

    // James Cook played 5 games as Footscray and 44 as Western Bulldogs.
    // That is ONE representation of 49, not two clubs.
    const cook = players.find((p) => p.playerId === 6711);
    expect(cook?.displayName).toBe('James Cook');
    expect(cook?.b.games).toBe(49);
    expect(cook?.b.goals).toBe(96);
    expect(day(cook?.b.firstMatchDate ?? null)).toBe('1996-04-06'); // Footscray identity
    expect(day(cook?.b.lastMatchDate ?? null)).toBe('1999-08-28');  // Western Bulldogs identity
    expect(cook?.a.games).toBe(25);
    expect(cook?.direction).toBe('a-to-b');
    expect(day(cook?.completionDate ?? null)).toBe('1996-04-06');
    // Melbourne came AFTER the second debut, so it is not intervening.
    expect(cook?.interveningOrganizations).toEqual([]);
    expect(await oracleIntervening(6711, carlton, bulldogs)).toEqual([]);
    // He appears exactly once, not once per identity.
    expect(players.filter((p) => p.playerId === 6711)).toHaveLength(1);

    // Brad Johnson played 52 games as Footscray and 312 as Western
    // Bulldogs and nothing else. Two identities, one organisation, so he
    // is not a crossover player with anyone.
    expect(players.some((p) => p.playerId === 2068)).toBe(false);
    const [johnsonIdentities] = await sql<{ identities: number; games: number }[]>`
      SELECT count(*)::int AS identities, sum(pc.games)::int AS games
        FROM player_clubs pc JOIN clubs c ON c.id = pc.club_id
       WHERE pc.player_id = 2068 AND c.organization_id = ${bulldogs}
    `;
    expect(johnsonIdentities.identities).toBe(2);
    expect(johnsonIdentities.games).toBe(364);
    const [johnsonOrgs] = await sql<{ orgs: number }[]>`
      SELECT count(DISTINCT c.organization_id)::int AS orgs
        FROM player_clubs pc JOIN clubs c ON c.id = pc.club_id
       WHERE pc.player_id = 2068
    `;
    expect(johnsonOrgs.orgs).toBe(1);

    // No crossover row may pair an organisation with itself by identity.
    for (const p of players) {
      expect(p.a.games + p.b.games).toBe(p.combinedGames);
      expect(p.careerGames as number, p.displayName).toBeGreaterThanOrEqual(p.combinedGames);
    }
  });

  it('keeps Brisbane Bears, Fitzroy and Brisbane Lions as three distinct organisations', async () => {
    expect(new Set([bears, fitzroy, lions]).size).toBe(3);

    const [bearsLions, fitzroyLions, bearsFitzroy] = await Promise.all([
      getCrossoverPlayers(bears, lions),
      getCrossoverPlayers(fitzroy, lions),
      getCrossoverPlayers(bears, fitzroy),
    ]);
    const [oBearsLions, oFitzroyLions, oBearsFitzroy] = await Promise.all([
      oracleCrossover(bears, lions),
      oracleCrossover(fitzroy, lions),
      oracleCrossover(bears, fitzroy),
    ]);

    // If relations collapsed these into one organisation, every one of
    // these pairs would be empty (or rejected outright).
    expect(bearsLions).toHaveLength(29);
    expect(fitzroyLions).toHaveLength(10);
    expect(bearsFitzroy).toHaveLength(14);
    expect(bearsLions).toHaveLength(oBearsLions.length);
    expect(fitzroyLions).toHaveLength(oFitzroyLions.length);
    expect(bearsFitzroy).toHaveLength(oBearsFitzroy.length);

    // A Bears -> Lions player carries separate per-organisation games.
    for (const p of bearsLions) {
      expect(p.a.games, p.displayName).toBeGreaterThan(0);
      expect(p.b.games, p.displayName).toBeGreaterThan(0);
      expect(p.interveningOrganizations.map((o) => o.organizationId), p.displayName)
        .not.toContain(bears);
      expect(p.interveningOrganizations.map((o) => o.organizationId), p.displayName)
        .not.toContain(lions);
    }

    // ...and Fitzroy is never folded into the Lions total.
    const [fitzroyClubs] = await sql<{ orgs: number }[]>`
      SELECT count(DISTINCT organization_id)::int AS orgs FROM clubs WHERE organization_id IN (${bears}, ${fitzroy}, ${lions})
    `;
    expect(fitzroyClubs.orgs).toBe(3);
  });

  it('summarises the first and most recent players to complete both representations', async () => {
    const [summary, players, oracle] = await Promise.all([
      getCrossoverSummary(adelaide, lions),
      getCrossoverPlayers(adelaide, lions),
      oracleCrossover(adelaide, lions),
    ]);

    expect(summary.players).toBe(11);
    expect(summary.players).toBe(players.length);
    expect(summary.players).toBe(oracle.length);

    // Completion = the later of the two first-representation dates.
    const completions = oracle.map((o) => ({
      playerId: o.playerId,
      completion: Math.max((o.aFirst as Date).getTime(), (o.bFirst as Date).getTime()),
    }));
    const earliest = Math.min(...completions.map((c) => c.completion));
    const latest = Math.max(...completions.map((c) => c.completion));

    expect(summary.firstToRepresentBoth.map((p) => p.playerId).sort((x, y) => x - y))
      .toEqual(completions.filter((c) => c.completion === earliest).map((c) => c.playerId).sort((x, y) => x - y));
    expect(summary.mostRecentToRepresentBoth.map((p) => p.playerId).sort((x, y) => x - y))
      .toEqual(completions.filter((c) => c.completion === latest).map((c) => c.playerId).sort((x, y) => x - y));

    // The measured witnesses.
    expect(summary.firstToRepresentBoth.map((p) => p.displayName)).toEqual(['Martin McKinnon']);
    expect(day(summary.firstToRepresentBoth[0].completionDate)).toBe('1999-05-01');
    expect(summary.mostRecentToRepresentBoth.map((p) => p.displayName)).toEqual(['Tom Doedee']);
    expect(day(summary.mostRecentToRepresentBoth[0].completionDate)).toBe('2025-08-09');

    // Completion is NOT the career debut or the first stint start:
    // McKinnon first played for Adelaide in 1994 and only completed the
    // pair five years later.
    const mckinnon = summary.firstToRepresentBoth[0];
    expect(day(mckinnon.a.firstMatchDate)).toBe('1994-07-10');
    expect(day(mckinnon.b.firstMatchDate)).toBe('1999-05-01');
    expect(mckinnon.direction).toBe('a-to-b');
    const earliestDebut = Math.min(
      ...players.map((p) => (p.a.firstMatchDate as Date).getTime()),
      ...players.map((p) => (p.b.firstMatchDate as Date).getTime()),
    );
    expect((mckinnon.completionDate as Date).getTime()).toBeGreaterThan(earliestDebut);
  });

  it('refuses to look for crossover players inside one organisation', async () => {
    await expect(getCrossoverPlayers(lions, lions)).rejects.toThrow(/cannot be compared with itself/);
    await expect(getCrossoverSummary(lions, lions)).rejects.toThrow(/cannot be compared with itself/);
  });
});

// --- Stage 3 independent SQL oracles ---
//
// Deliberately dumber than the implementation: no shared fragment, no
// window functions, no coverage abstraction, no CTE chain. Plain joins
// and plain aggregates, so agreement is evidence rather than tautology.

type OracleH2HPlayer = {
  playerId: number;
  displayName: string;
  games: number;
  goals: number | null;
  goalRows: number;
  aGames: number;
  bGames: number;
};

/** Every player appearance in the pair, aggregated with one GROUP BY. */
async function oracleH2HPlayers(orgA: number, orgB: number): Promise<OracleH2HPlayer[]> {
  return sql<OracleH2HPlayer[]>`
    SELECT pms.player_id AS "playerId",
           p.display_name AS "displayName",
           count(*)::int AS games,
           sum(pms.goals)::int AS goals,
           count(pms.goals)::int AS "goalRows",
           count(*) FILTER (WHERE c.organization_id = ${orgA})::int AS "aGames",
           count(*) FILTER (WHERE c.organization_id = ${orgB})::int AS "bGames"
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      JOIN clubs c ON c.id = pms.club_id
      JOIN players p ON p.id = pms.player_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
     GROUP BY pms.player_id, p.display_name
  `;
}

type OracleStatRow = { playerId: number; value: number; matchId: number };

/** Every recorded value of one statistic in the pair. Ordering is done in JS. */
async function oracleH2HStatRows(
  orgA: number,
  orgB: number,
  stat: 'goals' | 'disposals',
): Promise<OracleStatRow[]> {
  const column = stat === 'goals' ? sql`pms.goals` : sql`pms.disposals`;
  return sql<OracleStatRow[]>`
    SELECT pms.player_id AS "playerId", ${column} AS value, m.id AS "matchId"
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
       AND ${column} IS NOT NULL
  `;
}

type OracleBrownlowRow = {
  season: number;
  playerId: number;
  votes: number;
  isWinner: boolean;
  isIneligible: boolean;
  explicitClubId: number | null;
  clubCount: number | null;
  primaryClubId: number | null;
  primaryOrgId: number | null;
  seasonCoverage: string | null;
};

/**
 * Raw season vote rows with the two attribution inputs sitting next to
 * each other, unresolved. The test does the COALESCE in TypeScript, so
 * the SQL cannot be the same SQL the implementation runs.
 */
async function oracleBrownlowRows(): Promise<OracleBrownlowRow[]> {
  return sql<OracleBrownlowRow[]>`
    SELECT b.season, b.player_id AS "playerId", b.votes::int AS votes,
           b.is_winner AS "isWinner", b.is_ineligible AS "isIneligible",
           b.club_id AS "explicitClubId",
           pss.club_count::int AS "clubCount",
           pss.primary_club_id AS "primaryClubId",
           pc.organization_id AS "primaryOrgId",
           sa.coverage::text AS "seasonCoverage"
      FROM brownlow_season_votes b
      LEFT JOIN player_season_stats pss
        ON pss.player_id = b.player_id AND pss.season = b.season
      LEFT JOIN clubs pc ON pc.id = pss.primary_club_id
      LEFT JOIN stat_availability sa
        ON sa.stat_key = 'brownlow_season_total' AND sa.season = b.season
  `;
}

type OracleH2HMatchVotes = {
  matchId: number;
  season: number;
  isFinal: boolean;
  votes: number;
  coverage: string | null;
};

/** Every meeting of the pair with its raw recorded vote total. No filtering. */
async function oracleH2HMatchVotes(orgA: number, orgB: number): Promise<OracleH2HMatchVotes[]> {
  return sql<OracleH2HMatchVotes[]>`
    SELECT m.id AS "matchId", m.season,
           COALESCE(m.is_finals_series, false) AS "isFinal",
           COALESCE((SELECT sum(pms.brownlow_votes)
                       FROM player_match_stats pms
                      WHERE pms.match_id = m.id), 0)::int AS votes,
           sa.coverage::text AS coverage
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN stat_availability sa
        ON sa.stat_key = 'brownlow_match_votes' AND sa.season = m.season
     WHERE (hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
        OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA})
  `;
}

type OracleH2HVotePlayer = { playerId: number; displayName: string; votes: number; matchId: number };

/** Every non-null match vote row in the pair, unaggregated. */
async function oracleH2HVoteRows(orgA: number, orgB: number): Promise<OracleH2HVotePlayer[]> {
  return sql<OracleH2HVotePlayer[]>`
    SELECT pms.player_id AS "playerId", p.display_name AS "displayName",
           pms.brownlow_votes::int AS votes, m.id AS "matchId"
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      JOIN players p ON p.id = pms.player_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
       AND pms.brownlow_votes IS NOT NULL
  `;
}

describe('club comparison: head-to-head player leaders', () => {
  let adelaide = 0;
  let lions = 0;
  let bulldogs = 0;
  let carlton = 0;

  beforeAll(async () => {
    [adelaide, lions, bulldogs, carlton] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('western-bulldogs'),
      orgIdBySlug('carlton'),
    ]);
  });

  it('ranks H2H games leaders against independent SQL and the measured witnesses', async () => {
    const [leaders, oracle] = await Promise.all([
      getHeadToHeadPlayerLeaders(adelaide, lions),
      oracleH2HPlayers(adelaide, lions),
    ]);

    const byGames = [...oracle].sort((x, y) => y.games - x.games);
    const topGames = byGames[0].games;
    expect(topGames).toBe(23);

    // Dense rank 1 is exactly the oracle's maximum, ties included.
    const rank1 = leaders.games.filter((l) => l.rank === 1).map((l) => l.playerId).sort();
    const oracleRank1 = byGames.filter((r) => r.games === topGames).map((r) => r.playerId).sort();
    expect(rank1).toEqual(oracleRank1);
    expect(leaders.games[0].displayName).toBe('Simon Black');
    expect(leaders.games[0].games).toBe(23);

    // Every returned row agrees with the oracle on games and on the
    // per-organisation split.
    const index = new Map(oracle.map((r) => [r.playerId, r]));
    for (const leader of leaders.games) {
      const row = index.get(leader.playerId);
      expect(row).toBeDefined();
      expect(leader.games).toBe(row?.games);
      expect(leader.a.games).toBe(row?.aGames);
      expect(leader.b.games).toBe(row?.bGames);
      expect(leader.a.games + leader.b.games).toBe(leader.games);
    }

    // Dense rank: contiguous from 1, no gaps, cut at 10 with ties kept.
    const ranks = [...new Set(leaders.games.map((l) => l.rank))].sort((x, y) => x - y);
    expect(ranks[0]).toBe(1);
    expect(ranks[ranks.length - 1]).toBeLessThanOrEqual(H2H_LEADER_RANK_LIMIT);
    ranks.forEach((r, i) => expect(r).toBe(i + 1));
    // A dense-ranked board keeps every player tied at the cut.
    const distinctGames = [...new Set(byGames.map((r) => r.games))].sort((x, y) => y - x);
    const expectedRows = byGames.filter(
      (r) => distinctGames.indexOf(r.games) < H2H_LEADER_RANK_LIMIT,
    );
    expect(leaders.games).toHaveLength(expectedRows.length);
    for (const leader of leaders.games) {
      expect(leader.rank).toBe(distinctGames.indexOf(leader.games) + 1);
    }

    // Measured witnesses from the evidence pack.
    const named = (name: string) => leaders.games.find((l) => l.displayName === name);
    expect(named('Taylor Walker')?.games).toBe(20);
    expect(named('Michael Voss')?.games).toBe(16);
  });

  it('ranks H2H goals leaders without ever treating an unrecorded goal as nought', async () => {
    const [leaders, oracle] = await Promise.all([
      getHeadToHeadPlayerLeaders(adelaide, lions),
      oracleH2HPlayers(adelaide, lions),
    ]);

    const scored = oracle.filter((r) => r.goalRows > 0);
    const topGoals = Math.max(...scored.map((r) => r.goals as number));
    expect(topGoals).toBe(54);
    expect(leaders.goals[0].displayName).toBe('Taylor Walker');
    expect(leaders.goals[0].goals).toBe(54);
    expect(leaders.goals[0].rank).toBe(1);

    const index = new Map(oracle.map((r) => [r.playerId, r]));
    for (const leader of leaders.goals) {
      const row = index.get(leader.playerId);
      expect(leader.goals).toBe(row?.goals);
      expect(leader.goalsRecordedGames).toBe(row?.goalRows);
      // The denominator is real games, never assumed.
      expect(leader.goalsRecordedGames).toBeLessThanOrEqual(leader.games);
      // A player with no recorded goal row anywhere cannot be on the board.
      expect(leader.goalsRecordedGames).toBeGreaterThan(0);
    }

    // Alastair Lynch played only for Brisbane Lions in this rivalry:
    // 45 goals on the B side and NULL, not 0, on the A side.
    const lynch = leaders.goals.find((l) => l.displayName === 'Alastair Lynch');
    expect(lynch?.goals).toBe(45);
    expect(lynch?.b.goals).toBe(45);
    expect(lynch?.a.games).toBe(0);
    expect(lynch?.a.goals).toBeNull();
    expect(lynch?.a.goalsRecordedGames).toBe(0);
  });

  it('consolidates a player who represented both organisations into one row', async () => {
    const [leaders, oracle] = await Promise.all([
      getHeadToHeadPlayerLeaders(adelaide, lions),
      oracleH2HPlayers(adelaide, lions),
    ]);

    const dualOrg = oracle.filter((r) => r.aGames > 0 && r.bGames > 0);
    expect(dualOrg.length).toBeGreaterThan(0);

    const cameron = leaders.goals.filter((l) => l.displayName === 'Charlie Cameron');
    expect(cameron).toHaveLength(1);
    expect(cameron[0].games).toBe(14);
    expect(cameron[0].a.games).toBe(5);
    expect(cameron[0].b.games).toBe(9);
    expect(cameron[0].goals).toBe(32);
    expect(cameron[0].a.goals).toBe(8);
    expect(cameron[0].b.goals).toBe(24);
    expect((cameron[0].a.goals ?? 0) + (cameron[0].b.goals ?? 0)).toBe(cameron[0].goals);

    // No player appears twice on either board.
    for (const board of [leaders.games, leaders.goals]) {
      const ids = board.map((l) => l.playerId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps every tied holder of the single-match goals and disposals records', async () => {
    const [leaders, goalRows, disposalRows] = await Promise.all([
      getHeadToHeadPlayerLeaders(adelaide, lions),
      oracleH2HStatRows(adelaide, lions, 'goals'),
      oracleH2HStatRows(adelaide, lions, 'disposals'),
    ]);

    const maxGoals = Math.max(...goalRows.map((r) => r.value));
    const tiedGoals = goalRows.filter((r) => r.value === maxGoals);
    expect(maxGoals).toBe(7);
    expect(tiedGoals).toHaveLength(5);
    expect(leaders.singleMatchGoals.value).toBe(maxGoals);
    expect(leaders.singleMatchGoals.holders).toHaveLength(tiedGoals.length);
    expect(leaders.singleMatchGoals.recordedRows).toBe(goalRows.length);
    expect(
      leaders.singleMatchGoals.holders.map((h) => `${h.playerId}:${h.matchId}`).sort(),
    ).toEqual(tiedGoals.map((r) => `${r.playerId}:${r.matchId}`).sort());
    // Deterministic order: by meeting date, then match id.
    const dates = leaders.singleMatchGoals.holders.map((h) => h.matchDate?.getTime() ?? 0);
    expect([...dates].sort((x, y) => x - y)).toEqual(dates);
    // Each holder carries the identity actually represented on the day.
    for (const holder of leaders.singleMatchGoals.holders) {
      expect([adelaide, lions]).toContain(holder.organizationId);
      expect(holder.clubSlug).toBeTruthy();
    }

    const maxDisposals = Math.max(...disposalRows.map((r) => r.value));
    const tiedDisposals = disposalRows.filter((r) => r.value === maxDisposals);
    expect(maxDisposals).toBe(40);
    expect(tiedDisposals).toHaveLength(4);
    expect(leaders.singleMatchDisposals.value).toBe(maxDisposals);
    expect(leaders.singleMatchDisposals.recordedRows).toBe(disposalRows.length);
    expect(
      leaders.singleMatchDisposals.holders.map((h) => `${h.playerId}:${h.matchId}`).sort(),
    ).toEqual(tiedDisposals.map((r) => `${r.playerId}:${r.matchId}`).sort());
  });

  it('reports an unrecorded single-match statistic as unavailable rather than nought', async () => {
    // Footscray-era meetings predate disposal recording, so the pair's
    // record must come from recorded rows only and the recorded-row count
    // must be smaller than the appearance count.
    const [leaders, disposalRows, appearances] = await Promise.all([
      getHeadToHeadPlayerLeaders(bulldogs, carlton),
      oracleH2HStatRows(bulldogs, carlton, 'disposals'),
      oracleH2HPlayers(bulldogs, carlton),
    ]);
    const totalAppearances = appearances.reduce((sum, r) => sum + r.games, 0);

    expect(leaders.singleMatchDisposals.recordedRows).toBe(disposalRows.length);
    expect(leaders.singleMatchDisposals.recordedRows).toBeLessThan(totalAppearances);
    if (disposalRows.length === 0) {
      expect(leaders.singleMatchDisposals.value).toBeNull();
      expect(leaders.singleMatchDisposals.holders).toHaveLength(0);
    } else {
      expect(leaders.singleMatchDisposals.value).toBe(
        Math.max(...disposalRows.map((r) => r.value)),
      );
    }

    // Goals leaders in a pair with partial goal coverage still carry an
    // honest recorded-game denominator.
    for (const leader of leaders.goals) {
      expect(leader.goalsRecordedGames).toBeGreaterThan(0);
      expect(leader.goalsRecordedGames).toBeLessThanOrEqual(leader.games);
    }
  });

  it('refuses to build leaders for an organisation against itself', async () => {
    await expect(getHeadToHeadPlayerLeaders(adelaide, adelaide)).rejects.toThrow(
      /cannot be compared with itself/,
    );
  });
});

describe('club comparison: club Brownlow history', () => {
  let adelaide = 0;
  let lions = 0;
  let sydney = 0;

  beforeAll(async () => {
    [adelaide, lions, sydney] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('sydney'),
    ]);
  });

  /** The approved attribution contract, applied in TypeScript. */
  function attribute(row: OracleBrownlowRow): number | null {
    if (row.explicitClubId !== null) return row.explicitClubId;
    if (row.clubCount === 1 && row.primaryClubId !== null) return row.primaryClubId;
    return null;
  }

  it('attributes season Brownlow votes through the nullable club_id contract', async () => {
    const [history, oracleRows, clubOrgs] = await Promise.all([
      getClubBrownlowHistory(adelaide),
      oracleBrownlowRows(),
      sql<{ id: number; organizationId: number }[]>`
        SELECT id, organization_id AS "organizationId" FROM clubs
      `,
    ]);
    const orgOf = new Map(clubOrgs.map((c) => [c.id, c.organizationId]));

    // The nullable column is the whole point: an inner join here returns
    // nothing at all, which is what the supplied evidence probe did.
    const explicit = oracleRows.filter((r) => r.explicitClubId !== null).length;
    const viaPrimary = oracleRows.filter(
      (r) => r.explicitClubId === null && r.clubCount === 1 && r.primaryClubId !== null,
    ).length;
    expect(explicit + viaPrimary).toBeGreaterThan(0);
    // The fallback path is genuinely exercised by canonical data.
    expect(viaPrimary).toBeGreaterThan(0);

    const mine = oracleRows.filter((r) => {
      const clubId = attribute(r);
      return clubId !== null && orgOf.get(clubId) === adelaide && r.seasonCoverage === 'complete';
    });
    const expectedVotes = mine.reduce((sum, r) => sum + r.votes, 0);
    const expectedSeasons = new Set(mine.map((r) => r.season)).size;

    expect(history.totalVotes).toBe(expectedVotes);
    expect(history.seasonsCovered).toBe(expectedSeasons);
    expect(history.seasons).toHaveLength(expectedSeasons);
    expect(history.seasons.reduce((sum, s) => sum + s.votes, 0)).toBe(expectedVotes);
    // Ascending, no duplicates.
    const years = history.seasons.map((s) => s.season);
    expect([...years].sort((x, y) => x - y)).toEqual(years);
    expect(new Set(years).size).toBe(years.length);
  });

  it('takes winners only from is_winner, never from vote rank or maximum votes', async () => {
    const [adelaideHistory, lionsHistory, oracleRows, clubOrgs] = await Promise.all([
      getClubBrownlowHistory(adelaide),
      getClubBrownlowHistory(lions),
      oracleBrownlowRows(),
      sql<{ id: number; organizationId: number }[]>`
        SELECT id, organization_id AS "organizationId" FROM clubs
      `,
    ]);
    const orgOf = new Map(clubOrgs.map((c) => [c.id, c.organizationId]));
    const winnersFor = (org: number) => oracleRows.filter((r) => {
      const clubId = attribute(r);
      return r.isWinner && clubId !== null && orgOf.get(clubId) === org
        && r.seasonCoverage === 'complete';
    });

    const adelaideWinners = winnersFor(adelaide);
    const lionsWinners = winnersFor(lions);
    expect(adelaideHistory.winners).toHaveLength(adelaideWinners.length);
    expect(lionsHistory.winners).toHaveLength(lionsWinners.length);
    expect(adelaideHistory.winners.map((w) => w.season)).toEqual([2003]);
    expect(adelaideHistory.winners[0].displayName).toBe('Mark Ricciuto');
    expect(lionsHistory.winners.map((w) => w.season)).toEqual([2001, 2002, 2020, 2023]);

    // A season's top vote-getter for a club is not automatically a winner:
    // the club's largest single-season attributed total exists in seasons
    // that produced no medallist.
    const winningSeasons = new Set(adelaideHistory.winners.map((w) => w.season));
    const nonWinningSeasonsWithVotes = adelaideHistory.seasons.filter(
      (s) => s.votes > 0 && !winningSeasons.has(s.season),
    );
    expect(nonWinningSeasonsWithVotes.length).toBeGreaterThan(0);
    for (const season of nonWinningSeasonsWithVotes) expect(season.winners).toBe(0);
  });

  it('includes only complete-coverage seasons and ranks all-time vote leaders', async () => {
    const [history, oracleRows, clubOrgs, coverage] = await Promise.all([
      getClubBrownlowHistory(lions),
      oracleBrownlowRows(),
      sql<{ id: number; organizationId: number }[]>`
        SELECT id, organization_id AS "organizationId" FROM clubs
      `,
      sql<{ season: number; coverage: string }[]>`
        SELECT season, coverage::text AS coverage FROM stat_availability
         WHERE stat_key = 'brownlow_season_total' AND coverage <> 'complete'
      `,
    ]);
    const orgOf = new Map(clubOrgs.map((c) => [c.id, c.organizationId]));
    const incomplete = new Set(coverage.map((c) => c.season));

    // Not one incomplete-coverage season leaks into the history.
    for (const season of history.seasons) expect(incomplete.has(season.season)).toBe(false);

    const mine = oracleRows.filter((r) => {
      const clubId = attribute(r);
      return clubId !== null && orgOf.get(clubId) === lions && r.seasonCoverage === 'complete';
    });
    const byPlayer = new Map<number, number>();
    for (const row of mine) byPlayer.set(row.playerId, (byPlayer.get(row.playerId) ?? 0) + row.votes);
    const ordered = [...byPlayer.entries()].filter(([, v]) => v > 0).sort((x, y) => y[1] - x[1]);
    const distinct = [...new Set(ordered.map(([, v]) => v))].sort((x, y) => y - x);
    const expectedLeaders = ordered.filter(
      ([, v]) => distinct.indexOf(v) < CLUB_BROWNLOW_LEADER_RANK_LIMIT,
    );

    expect(history.voteLeaders).toHaveLength(expectedLeaders.length);
    expect(history.voteLeaders[0].votes).toBe(ordered[0][1]);
    expect(history.voteLeaders[0].playerId).toBe(ordered[0][0]);
    for (const leader of history.voteLeaders) {
      expect(leader.votes).toBe(byPlayer.get(leader.playerId));
      expect(leader.rank).toBe(distinct.indexOf(leader.votes) + 1);
      expect(leader.rank).toBeLessThanOrEqual(CLUB_BROWNLOW_LEADER_RANK_LIMIT);
    }
  });

  it('excludes ambiguous multi-club seasons and discloses them instead of forcing them', async () => {
    const [sydneyHistory, adelaideHistory, oracleRows, clubOrgs] = await Promise.all([
      getClubBrownlowHistory(sydney),
      getClubBrownlowHistory(adelaide),
      oracleBrownlowRows(),
      sql<{ id: number; organizationId: number }[]>`
        SELECT id, organization_id AS "organizationId" FROM clubs
      `,
    ]);
    const orgOf = new Map(clubOrgs.map((c) => [c.id, c.organizationId]));

    const unattributed = oracleRows.filter((r) => attribute(r) === null);
    expect(unattributed.length).toBeGreaterThan(0);
    // Every unattributed row is a genuine multi-club season, not a
    // missing-data accident.
    for (const row of unattributed) expect((row.clubCount ?? 0) > 1).toBe(true);

    const sydneyUnattributed = unattributed.filter(
      (r) => r.primaryOrgId !== null && orgOf.get(r.primaryClubId as number) === sydney
        && r.seasonCoverage === 'complete',
    );
    expect(sydneyUnattributed.length).toBeGreaterThan(0);
    expect(sydneyHistory.unattributed.rows).toBe(sydneyUnattributed.length);
    expect(sydneyHistory.unattributed.votes).toBe(
      sydneyUnattributed.reduce((sum, r) => sum + r.votes, 0),
    );

    // Disclosed, never added: the excluded votes are absent from the total.
    const attributedSydney = oracleRows.filter((r) => {
      const clubId = attribute(r);
      return clubId !== null && orgOf.get(clubId) === sydney && r.seasonCoverage === 'complete';
    });
    expect(sydneyHistory.totalVotes).toBe(
      attributedSydney.reduce((sum, r) => sum + r.votes, 0),
    );
    expect(sydneyHistory.unattributed.votes).toBeGreaterThan(0);

    // Adelaide has no ambiguous season in canonical data, and says so
    // with a zero rather than with a silent omission.
    expect(adelaideHistory.unattributed).toEqual({ rows: 0, votes: 0 });
  });

  it('exposes selected-season Brownlow coverage without presenting a partial total', async () => {
    const [complete, notApplicable, pending, missing, coverageRows] = await Promise.all([
      getClubSeasonBrownlowSummary(lions, 2002),
      getClubSeasonBrownlowSummary(lions, 1943),
      getClubSeasonBrownlowSummary(lions, 2026),
      getClubSeasonBrownlowSummary(lions, 1850),
      sql<{ season: number; coverage: string }[]>`
        SELECT season, coverage::text AS coverage FROM stat_availability
         WHERE stat_key = 'brownlow_season_total' AND season IN (2002, 1943, 2026)
      `,
    ]);
    const coverageOf = new Map(coverageRows.map((c) => [c.season, c.coverage]));

    // The states come from stat_availability, not from a year branch.
    expect(complete.coverage).toBe(coverageOf.get(2002));
    expect(notApplicable.coverage).toBe(coverageOf.get(1943));
    expect(pending.coverage).toBe(coverageOf.get(2026));
    expect(complete.coverage).toBe('complete');
    expect(notApplicable.coverage).toBe('not_applicable');
    expect(pending.coverage).toBe('pending');
    expect(missing.coverage).toBe('missing');

    expect(complete.isAuthoritative).toBe(true);
    expect(complete.totalVotes).toBeGreaterThan(0);
    expect(complete.winners.map((w) => w.displayName)).toEqual(['Simon Black']);
    expect(complete.leaders[0].rank).toBe(1);
    // The fallback attribution path is what put these players here.
    expect(complete.leaders.every((l) => l.attributionSource === 'primary')).toBe(true);

    for (const summary of [notApplicable, pending, missing]) {
      expect(summary.isAuthoritative).toBe(false);
      expect(summary.totalVotes).toBeNull();
      expect(summary.playersWithVotes).toBeNull();
      expect(summary.leaders).toHaveLength(0);
      expect(summary.winners).toHaveLength(0);
    }
  });

  it('agrees with the all-time history when a season is read on its own', async () => {
    const history = await getClubBrownlowHistory(adelaide);
    const sampled = history.seasons.slice(0, 6);
    const summaries = await Promise.all(
      sampled.map((s) => getClubSeasonBrownlowSummary(adelaide, s.season)),
    );
    summaries.forEach((summary, i) => {
      expect(summary.totalVotes).toBe(sampled[i].votes);
      expect(summary.playersWithVotes).toBe(sampled[i].playersWithVotes);
      expect(summary.winners).toHaveLength(sampled[i].winners);
      expect(summary.unattributedRows).toBe(sampled[i].unattributedRows);
    });
  });
});

describe('club comparison: head-to-head Brownlow', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;
  let collingwood = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton, collingwood] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
      orgIdBySlug('collingwood'),
    ]);
  });

  const isCovered = (row: OracleH2HMatchVotes) =>
    (row.coverage === 'complete' || row.coverage === 'partial') && row.votes === 6;

  it('counts eligible and covered meetings from home-and-away matches only', async () => {
    const [brownlow, matches, summary] = await Promise.all([
      getHeadToHeadBrownlow(adelaide, lions),
      oracleH2HMatchVotes(adelaide, lions),
      getHeadToHeadSummary(adelaide, lions),
    ]);

    const eligible = matches.filter((m) => !m.isFinal);
    const covered = eligible.filter(isCovered);
    expect(eligible).toHaveLength(39);
    expect(covered).toHaveLength(39);
    expect(brownlow.eligibleMeetings).toBe(eligible.length);
    expect(brownlow.coveredMeetings).toBe(covered.length);
    expect(brownlow.coverage).toBe('complete');

    // Eligible meetings are exactly the rivalry minus its finals.
    expect(brownlow.eligibleMeetings).toBe(summary.meetings - summary.finalsSeriesMeetings);
    expect(summary.meetings).toBe(41);
    expect(summary.finalsSeriesMeetings).toBe(2);
    expect(brownlow.partiallyPolledMeetings).toBe(0);
  });

  it('never lets a finals meeting contribute to the H2H Brownlow population', async () => {
    const [brownlow, matches, finals] = await Promise.all([
      getHeadToHeadBrownlow(adelaide, lions),
      oracleH2HMatchVotes(adelaide, lions),
      sql<{ id: number; isFinalsSeries: boolean; votes: number }[]>`
        SELECT m.id, m.is_finals_series AS "isFinalsSeries",
               COALESCE((SELECT sum(pms.brownlow_votes) FROM player_match_stats pms
                          WHERE pms.match_id = m.id), 0)::int AS votes
          FROM matches m WHERE m.id IN (12275, 12463)
      `,
    ]);

    // The two named finals witnesses are in the rivalry, are finals, and
    // carry no recorded votes at all.
    expect(finals).toHaveLength(2);
    for (const f of finals) {
      expect(f.isFinalsSeries).toBe(true);
      expect(f.votes).toBe(0);
      expect(matches.some((m) => m.matchId === f.id)).toBe(true);
    }

    // Adding the finals back could not change the answer either way.
    const finalsVotes = matches.filter((m) => m.isFinal).reduce((sum, m) => sum + m.votes, 0);
    expect(finalsVotes).toBe(0);
    expect(brownlow.eligibleMeetings).toBe(matches.filter((m) => !m.isFinal).length);
    expect(brownlow.eligibleMeetings).toBeLessThan(matches.length);
  });

  it('totals H2H votes per player against independent SQL over covered meetings', async () => {
    const [brownlow, matches, voteRows] = await Promise.all([
      getHeadToHeadBrownlow(adelaide, lions),
      oracleH2HMatchVotes(adelaide, lions),
      oracleH2HVoteRows(adelaide, lions),
    ]);

    const coveredIds = new Set(matches.filter((m) => !m.isFinal).filter(isCovered).map((m) => m.matchId));
    const expected = new Map<number, number>();
    const expectedThrees = new Map<number, number>();
    for (const row of voteRows) {
      if (!coveredIds.has(row.matchId)) continue;
      expected.set(row.playerId, (expected.get(row.playerId) ?? 0) + row.votes);
      if (row.votes === 3) expectedThrees.set(row.playerId, (expectedThrees.get(row.playerId) ?? 0) + 1);
    }

    const scored = [...expected.entries()].filter(([, v]) => v > 0);
    expect(brownlow.players).toHaveLength(scored.length);
    expect(brownlow.totalVotes).toBe(scored.reduce((sum, [, v]) => sum + v, 0));
    // Six votes per covered meeting, no more and no less.
    expect(brownlow.totalVotes).toBe(brownlow.coveredMeetings * 6);

    for (const player of brownlow.players) {
      expect(player.votes).toBe(expected.get(player.playerId));
      expect(player.threeVoteGames).toBe(expectedThrees.get(player.playerId) ?? 0);
      expect(player.votes).toBe(
        player.threeVoteGames * 3 + player.twoVoteGames * 2 + player.oneVoteGames,
      );
      expect(player.pollingGames).toBe(
        player.threeVoteGames + player.twoVoteGames + player.oneVoteGames,
      );
      expect(player.aVotes + player.bVotes).toBe(player.votes);
    }

    // Measured witnesses from the evidence pack.
    const named = (name: string) => brownlow.players.find((p) => p.displayName === name);
    expect(named('Scott Thompson')?.votes).toBe(16);
    expect(named('Michael Voss')?.votes).toBe(14);
    expect(named('Simon Black')?.votes).toBe(11);
    // Voss polled entirely for Brisbane Lions in this rivalry.
    expect(named('Michael Voss')?.aVotes).toBe(0);
    expect(named('Michael Voss')?.bVotes).toBe(14);
    expect(brownlow.players[0].votes).toBeGreaterThanOrEqual(brownlow.players[1].votes);
  });

  it('reports partial coverage for a rivalry that predates match-vote recording', async () => {
    const [brownlow, matches] = await Promise.all([
      getHeadToHeadBrownlow(carlton, collingwood),
      oracleH2HMatchVotes(carlton, collingwood),
    ]);

    const eligible = matches.filter((m) => !m.isFinal);
    const covered = eligible.filter(isCovered);
    expect(brownlow.eligibleMeetings).toBe(eligible.length);
    expect(brownlow.coveredMeetings).toBe(covered.length);
    expect(brownlow.coveredMeetings).toBeLessThan(brownlow.eligibleMeetings);
    expect(brownlow.coverage).toBe('partial');

    // Meetings in a season whose match-vote coverage is itself 'partial'
    // are still counted when the full 3-2-1 allocation is recorded, so
    // 'partial' is not used as a blanket exclusion.
    const inPartialSeasons = eligible.filter((m) => m.coverage === 'partial');
    expect(inPartialSeasons.length).toBeGreaterThan(0);
    expect(inPartialSeasons.filter((m) => m.votes === 6).length).toBeGreaterThan(0);

    // Missing meetings contribute neither votes nor zeros.
    expect(brownlow.totalVotes).toBe(brownlow.coveredMeetings * 6);
    const uncovered = eligible.filter((m) => !isCovered(m));
    expect(uncovered.every((m) => m.votes === 0)).toBe(true);
    expect(brownlow.evaluableMeetings).toBe(
      eligible.filter((m) => m.coverage === 'complete' || m.coverage === 'partial').length,
    );
  });

  it('refuses to build H2H Brownlow for an organisation against itself', async () => {
    await expect(getHeadToHeadBrownlow(adelaide, adelaide)).rejects.toThrow(
      /cannot be compared with itself/,
    );
  });
});

// --- Stage 4 independent SQL oracles ---

type OracleSeasonRow = {
  season: number;
  competition: string;
  league: string;
  status: string;
  isComplete: boolean | null;
  dataThroughDate: Date | null;
  completedAt: Date | null;
};

/** Every canonical season row, unfiltered and unaliased by the implementation. */
async function oracleSeasons(): Promise<OracleSeasonRow[]> {
  return sql<OracleSeasonRow[]>`
    SELECT year::int AS season, competition, league, status::text AS status,
           is_complete AS "isComplete", data_through_date AS "dataThroughDate",
           completed_at AS "completedAt"
      FROM seasons
     ORDER BY year DESC
  `;
}

type OracleClubRow = {
  clubId: number;
  name: string;
  slug: string;
  firstSeason: number | null;
  lastSeason: number | null;
};

/**
 * Every historical identity of an organisation with its lifespan. The
 * test picks the identity-at-season in TypeScript, so the assertion is
 * not `afldb_identity_for_season` checked against itself.
 */
async function oracleClubIdentities(organizationId: number): Promise<OracleClubRow[]> {
  return sql<OracleClubRow[]>`
    SELECT id AS "clubId", name, slug,
           first_season::int AS "firstSeason", last_season::int AS "lastSeason"
      FROM clubs
     WHERE organization_id = ${organizationId}
     ORDER BY first_season DESC NULLS LAST
  `;
}

/** The narrower, later-starting identity wins, as the canonical function documents. */
function pickIdentity(rows: OracleClubRow[], season: number): OracleClubRow | null {
  const eligible = rows.filter(
    (r) => season >= (r.firstSeason ?? season) && season <= (r.lastSeason ?? season),
  );
  return eligible[0] ?? null;
}

type OracleLadderRow = {
  clubId: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  premiershipPoints: number | null;
  percentage: number | null;
  ladderRank: number | null;
  finalsPlayed: number | null;
  isPremier: boolean;
  woodenSpoon: boolean;
};

/** The raw ladder row, read by club id rather than by organisation. */
async function oracleLadderRow(clubId: number, season: number): Promise<OracleLadderRow | null> {
  const [row] = await sql<OracleLadderRow[]>`
    SELECT club_id AS "clubId", played::int AS played, wins::int AS wins,
           draws::int AS draws, losses::int AS losses,
           points_for::int AS "pointsFor", points_against::int AS "pointsAgainst",
           premiership_points::int AS "premiershipPoints",
           percentage::float8 AS percentage, ladder_rank::int AS "ladderRank",
           finals_played::int AS "finalsPlayed",
           is_premier AS "isPremier", wooden_spoon AS "woodenSpoon"
      FROM club_seasons
     WHERE club_id = ${clubId} AND season = ${season}
  `;
  return row ?? null;
}

type OracleTeamStatRow = { matchId: number; value: number | null };

/**
 * Every player stat row of a club-season for one column, UNAGGREGATED.
 * The grouping, the eligibility rule and the average are all done in
 * TypeScript below, so no part of the implementation's SQL is reused.
 */
async function oracleTeamStatRows(
  organizationId: number,
  season: number,
  column: string,
): Promise<OracleTeamStatRow[]> {
  return sql<OracleTeamStatRow[]>`
    SELECT m.id AS "matchId", pms.${sql(column)}::int AS value
      FROM matches m
      JOIN clubs c ON c.id IN (m.home_club_id, m.away_club_id)
      JOIN player_match_stats pms ON pms.match_id = m.id AND pms.club_id = c.id
     WHERE m.season = ${season} AND c.organization_id = ${organizationId}
  `;
}

/** Team-matches for a club-season, finals included, counted from matches alone. */
async function oracleTeamMatchCount(organizationId: number, season: number): Promise<number> {
  const [row] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
      FROM matches m
      JOIN clubs c ON c.id IN (m.home_club_id, m.away_club_id)
     WHERE m.season = ${season} AND c.organization_id = ${organizationId}
  `;
  return row.n;
}

type OracleMetricAggregate = { eligible: number; average: number | null; withRows: number };

/** Sum per team-match, then average the eligible team-match totals. */
function aggregateTeamStat(rows: OracleTeamStatRow[]): OracleMetricAggregate {
  const byMatch = new Map<number, { sum: number; nulls: number }>();
  for (const row of rows) {
    const entry = byMatch.get(row.matchId) ?? { sum: 0, nulls: 0 };
    if (row.value === null) entry.nulls += 1;
    else entry.sum += row.value;
    byMatch.set(row.matchId, entry);
  }
  const eligible = [...byMatch.values()].filter((e) => e.nulls === 0);
  return {
    withRows: byMatch.size,
    eligible: eligible.length,
    average: eligible.length === 0
      ? null
      : eligible.reduce((sum, e) => sum + e.sum, 0) / eligible.length,
  };
}

type OracleSeasonPlayerRow = {
  playerId: number;
  displayName: string;
  games: number;
  goals: number | null;
  disposals: number | null;
  disposalsRecordedGames: number;
};

/** Raw per-club season rows; the test sums across identities itself. */
async function oracleSeasonPlayerRows(
  organizationId: number,
  season: number,
): Promise<OracleSeasonPlayerRow[]> {
  return sql<OracleSeasonPlayerRow[]>`
    SELECT pcs.player_id AS "playerId", p.display_name AS "displayName",
           pcs.games::int AS games, pcs.goals::int AS goals,
           pcs.disposals::int AS disposals,
           pcs.disposals_recorded_games::int AS "disposalsRecordedGames"
      FROM player_club_season_stats pcs
      JOIN clubs c ON c.id = pcs.club_id
      JOIN players p ON p.id = pcs.player_id
     WHERE pcs.season = ${season} AND c.organization_id = ${organizationId}
  `;
}

/** The raw coverage rows for a season. No seasons join, no `missing` state. */
async function oracleCoverage(season: number): Promise<Map<string, string>> {
  const rows = await sql<{ statKey: string; coverage: string }[]>`
    SELECT stat_key AS "statKey", coverage::text AS coverage
      FROM stat_availability
     WHERE season = ${season}
  `;
  return new Map(rows.map((r) => [r.statKey, r.coverage]));
}

/**
 * Deterministic witness seasons. They appear ONLY in tests: the
 * implementation discovers every season it uses, and the dynamic
 * maximum-season test below names no year at all.
 */
const COMPLETED_SEASON = 2025;
/** Pre-1965: goals recorded, no disposals collected anywhere. */
const PRE_1965_SEASON = 1950;
/** Mixed coverage: goals complete, disposals and hit-outs partial, tackles not collected. */
const MIXED_COVERAGE_SEASON = 1975;

describe('club comparison: selected season identity and record', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;
  let bulldogs = 0;
  let sydney = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton, bulldogs, sydney] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
      orgIdBySlug('western-bulldogs'),
      orgIdBySlug('sydney'),
    ]);
  });

  it('discovers canonical seasons and defaults to the maximum one', async () => {
    const [seasons, max, oracle] = await Promise.all([
      getComparisonSeasons(),
      getMaximumComparisonSeason(),
      oracleSeasons(),
    ]);

    expect(seasons).toHaveLength(oracle.length);
    expect(seasons.map((s) => s.season)).toEqual(oracle.map((s) => s.season));
    // Descending, so the head IS the default.
    expect(max?.season).toBe(oracle[0].season);
    expect(max?.season).toBe(Math.max(...oracle.map((s) => s.season)));
    expect(max?.status).toBe(oracle[0].status);
    expect(max?.isProvisional).toBe(oracle[0].status !== 'complete');
  });

  it('resolves the selected season identity through the canonical lineage function', async () => {
    const cases: Array<[number, number]> = [
      [adelaide, COMPLETED_SEASON],
      [carlton, PRE_1965_SEASON],
      [bulldogs, PRE_1965_SEASON],
      [sydney, PRE_1965_SEASON],
      [bulldogs, COMPLETED_SEASON],
      [sydney, COMPLETED_SEASON],
    ];

    for (const [org, season] of cases) {
      const [identity, clubs] = await Promise.all([
        getSeasonIdentity(org, season),
        oracleClubIdentities(org),
      ]);
      const expected = pickIdentity(clubs, season);
      expect(identity?.clubId ?? null).toBe(expected?.clubId ?? null);
      expect(identity?.clubName ?? null).toBe(expected?.name ?? null);
    }

    // The rename witnesses, spelled out: a historical season resolves to
    // the historical identity, not to the current one.
    const [footscray, bulldogsNow, southMelbourne] = await Promise.all([
      getSeasonIdentity(bulldogs, PRE_1965_SEASON),
      getSeasonIdentity(bulldogs, COMPLETED_SEASON),
      getSeasonIdentity(sydney, PRE_1965_SEASON),
    ]);
    expect(footscray?.clubName).toBe('Footscray');
    expect(bulldogsNow?.clubName).toBe('Western Bulldogs');
    expect(southMelbourne?.clubName).toBe('South Melbourne');
    expect(footscray?.clubId).not.toBe(bulldogsNow?.clubId);
  });

  it('returns an explicit no-participation state rather than borrowing a season or identity', async () => {
    const comparison = await getClubSeasonComparison(adelaide, PRE_1965_SEASON);

    expect(comparison.identity?.clubId).toBeNull();
    expect(comparison.identity?.participated).toBe(false);
    expect(comparison.participated).toBe(false);
    expect(comparison.identity?.matchesPlayed).toBe(0);
    expect(comparison.record).toBeNull();
    expect(comparison.leaders.games).toEqual([]);
    expect(comparison.leaders.goals).toEqual([]);
    expect(comparison.leaders.disposals).toEqual([]);
    expect(comparison.teamMetrics.totalTeamMatches).toBe(0);
    for (const metric of comparison.teamMetrics.metrics) {
      expect(metric.average).toBeNull();
      expect(metric.total).toBeNull();
      expect(metric.isAvailable).toBe(false);
    }
    // The organisation DOES exist in a later season -- so this is a
    // genuine no-participation answer, not a missing organisation.
    const later = await getSeasonIdentity(adelaide, COMPLETED_SEASON);
    expect(later?.participated).toBe(true);
  });

  it('computes the selected season home-and-away record against independent SQL', async () => {
    for (const org of [adelaide, lions]) {
      const identity = await getSeasonIdentity(org, COMPLETED_SEASON);
      const [record, oracle] = await Promise.all([
        getClubSeasonRecord(org, COMPLETED_SEASON),
        oracleLadderRow(identity!.clubId!, COMPLETED_SEASON),
      ]);

      expect(record).not.toBeNull();
      expect(record!.clubId).toBe(oracle!.clubId);
      expect(record!.played).toBe(oracle!.played);
      expect(record!.wins).toBe(oracle!.wins);
      expect(record!.draws).toBe(oracle!.draws);
      expect(record!.losses).toBe(oracle!.losses);
      expect(record!.pointsFor).toBe(oracle!.pointsFor);
      expect(record!.pointsAgainst).toBe(oracle!.pointsAgainst);
      expect(record!.premiershipPoints).toBe(oracle!.premiershipPoints);
      expect(record!.percentage).toBeCloseTo(oracle!.percentage!, 4);
      expect(record!.ladderRank).toBe(oracle!.ladderRank);
      expect(record!.finalsPlayed).toBe(oracle!.finalsPlayed);
      expect(record!.isPremier).toBe(oracle!.isPremier);

      // The contracted formulas, recomputed from the oracle's own numbers.
      expect(record!.winPercentage).toBeCloseTo(
        (100 * (oracle!.wins + 0.5 * oracle!.draws)) / oracle!.played, 10,
      );
      expect(record!.averagePointsFor).toBeCloseTo(oracle!.pointsFor / oracle!.played, 10);
      expect(record!.averagePointsAgainst).toBeCloseTo(oracle!.pointsAgainst / oracle!.played, 10);
      // Percentage is the canonical points ratio, NOT the win percentage.
      expect(record!.percentage).toBeCloseTo(
        (100 * oracle!.pointsFor) / oracle!.pointsAgainst, 2,
      );
    }

    // The measured completed-season witnesses.
    const adelaideRecord = await getClubSeasonRecord(adelaide, COMPLETED_SEASON);
    expect(adelaideRecord!.played).toBe(23);
    expect(adelaideRecord!.wins).toBe(18);
    expect(adelaideRecord!.draws).toBe(0);
    expect(adelaideRecord!.losses).toBe(5);
    expect(adelaideRecord!.premiershipPoints).toBe(72);
    expect(adelaideRecord!.ladderRank).toBe(1);
    expect(adelaideRecord!.winPercentage).toBeCloseTo(78.2609, 4);
    expect(adelaideRecord!.averagePointsFor).toBeCloseTo(99.0435, 4);
    expect(adelaideRecord!.averagePointsAgainst).toBeCloseTo(71.087, 3);

    const lionsRecord = await getClubSeasonRecord(lions, COMPLETED_SEASON);
    expect(lionsRecord!.played).toBe(23);
    expect(lionsRecord!.wins).toBe(16);
    expect(lionsRecord!.draws).toBe(1);
    expect(lionsRecord!.losses).toBe(6);
    expect(lionsRecord!.isPremier).toBe(true);
    expect(lionsRecord!.finalsPlayed).toBe(4);
    // The draw counts a half, which a wins/played ratio would lose.
    expect(lionsRecord!.winPercentage).toBeCloseTo(71.7391, 4);
  });

  it('reports the selected season completed state from canonical metadata', async () => {
    const [meta, oracle] = await Promise.all([
      getComparisonSeason(COMPLETED_SEASON),
      oracleSeasons(),
    ]);
    const oracleRow = oracle.find((s) => s.season === COMPLETED_SEASON)!;

    expect(meta!.status).toBe(oracleRow.status);
    expect(meta!.status).toBe('complete');
    expect(meta!.isProvisional).toBe(false);
    expect(meta!.isComplete).toBe(true);
    expect(meta!.dataThroughDate).toEqual(oracleRow.dataThroughDate);
    expect(meta!.dataThroughDate).not.toBeNull();
  });

  it('ranks selected season player leaders densely and keeps every tie at the cut', async () => {
    const [leaders, rows] = await Promise.all([
      getClubSeasonPlayerLeaders(adelaide, COMPLETED_SEASON),
      oracleSeasonPlayerRows(adelaide, COMPLETED_SEASON),
    ]);

    // Sum the raw per-club rows in TypeScript, then rank them.
    const totals = new Map<number, { games: number; goals: number; disposals: number;
      recorded: number; name: string }>();
    for (const row of rows) {
      const t = totals.get(row.playerId)
        ?? { games: 0, goals: 0, disposals: 0, recorded: 0, name: row.displayName };
      t.games += row.games;
      t.goals += row.goals ?? 0;
      t.disposals += row.disposals ?? 0;
      t.recorded += row.disposalsRecordedGames;
      totals.set(row.playerId, t);
    }
    const board = (pick: (t: { games: number; goals: number; disposals: number }) => number) =>
      [...totals.values()].map(pick).filter((v) => v > 0).sort((a, b) => b - a);

    const gamesValues = board((t) => t.games);
    const goalsValues = board((t) => t.goals);
    const disposalValues = board((t) => t.disposals);

    expect(leaders.games[0].value).toBe(gamesValues[0]);
    expect(leaders.goals[0].value).toBe(goalsValues[0]);
    expect(leaders.disposals[0].value).toBe(disposalValues[0]);

    for (const boardRows of [leaders.games, leaders.goals, leaders.disposals]) {
      expect(boardRows.length).toBeGreaterThan(0);
      // Dense rank 1..5, contiguous, and every tie retained.
      const ranks = [...new Set(boardRows.map((r) => r.rank))].sort((a, b) => a - b);
      expect(ranks[0]).toBe(1);
      expect(Math.max(...ranks)).toBeLessThanOrEqual(CLUB_SEASON_LEADER_RANK_LIMIT);
      expect(ranks).toEqual(ranks.map((_, i) => i + 1));
      const distinctValues = [...new Set(boardRows.map((r) => r.value))];
      expect(distinctValues).toHaveLength(ranks.length);
      // Deterministic after rank: sort name, then player id.
      const ordered = [...boardRows].sort(
        (a, b) => a.rank - b.rank || a.sortName.localeCompare(b.sortName) || a.playerId - b.playerId,
      );
      expect(boardRows.map((r) => r.playerId)).toEqual(ordered.map((r) => r.playerId));
    }

    // Ties at the cut are kept, not truncated: the games board is a wall
    // of equal-value players in a modern season.
    const rankOneGames = leaders.games.filter((r) => r.rank === 1);
    expect(rankOneGames.length).toBeGreaterThan(1);
    expect(new Set(rankOneGames.map((r) => r.value)).size).toBe(1);

    // Disposals carry their recorded-game denominator; games and goals
    // have no such canonical column and must not invent one.
    for (const row of leaders.disposals) {
      expect(row.recordedGames).toBe(totals.get(row.playerId)!.recorded);
    }
    expect(leaders.games.every((r) => r.recordedGames === null)).toBe(true);
    expect(leaders.goals.every((r) => r.recordedGames === null)).toBe(true);

    // The measured witnesses.
    expect(leaders.goals[0].displayName).toBe('Riley Thilthorpe');
    expect(leaders.goals[0].value).toBe(60);
    expect(leaders.disposals[0].displayName).toBe('Jordan Dawson');
    expect(leaders.disposals[0].value).toBe(584);
    expect(leaders.games[0].value).toBe(25);
  });

  it('reads the selected season Brownlow through the Stage 3 attribution primitive', async () => {
    const [summary, rows] = await Promise.all([
      getClubSeasonBrownlowSummary(adelaide, COMPLETED_SEASON),
      oracleBrownlowRows(),
    ]);

    // Resolve attribution independently, in TypeScript.
    const seasonRows = rows.filter((r) => r.season === COMPLETED_SEASON);
    const clubs = await oracleClubIdentities(adelaide);
    const clubIds = new Set(clubs.map((c) => c.clubId));
    const attributed = seasonRows.filter((r) => {
      const id = r.explicitClubId ?? (r.clubCount === 1 ? r.primaryClubId : null);
      return id !== null && clubIds.has(id);
    });

    expect(summary.coverage).toBe('complete');
    expect(summary.isAuthoritative).toBe(true);
    expect(summary.totalVotes).toBe(attributed.reduce((sum, r) => sum + r.votes, 0));
    expect(summary.playersWithVotes).toBe(attributed.filter((r) => r.votes > 0).length);
    // Measured witness.
    expect(summary.totalVotes).toBe(93);
    expect(summary.leaders[0].displayName).toBe('Jordan Dawson');
    expect(summary.leaders[0].votes).toBe(27);

    const lionsSummary = await getClubSeasonBrownlowSummary(lions, COMPLETED_SEASON);
    expect(lionsSummary.totalVotes).toBe(98);
  });
});

describe('club comparison: selected season stat coverage', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
    ]);
  });

  it('aggregates team metrics match by match, never by averaging player rows', async () => {
    for (const org of [adelaide, lions]) {
      const [metrics, teamMatches] = await Promise.all([
        getClubSeasonTeamMetrics(org, COMPLETED_SEASON),
        oracleTeamMatchCount(org, COMPLETED_SEASON),
      ]);
      expect(metrics.totalTeamMatches).toBe(teamMatches);

      for (const key of ['goals', 'disposals', 'marks_i50', 'tackles', 'clearances']) {
        const metric = metrics.metrics.find((m) => m.key === key)!;
        const definition = TEAM_METRICS.find((m) => m.key === key)!;
        const oracle = aggregateTeamStat(
          await oracleTeamStatRows(org, COMPLETED_SEASON, definition.column),
        );
        expect(metric.eligibleMatches).toBe(oracle.eligible);
        expect(metric.totalTeamMatches).toBe(teamMatches);
        expect(metric.average).not.toBeNull();
        expect(metric.average!).toBeCloseTo(oracle.average!, 8);
        // The grain really is the team-match: a mean of player rows,
        // which the contract forbids, is a different and much smaller
        // number.
        const rows = (await oracleTeamStatRows(org, COMPLETED_SEASON, definition.column))
          .filter((r) => r.value !== null);
        const playerRowMean = rows.reduce((sum, r) => sum + r.value!, 0) / rows.length;
        expect(metric.average!).toBeGreaterThan(playerRowMean * 5);
      }
    }

    // The measured completed-season witnesses. The team-match
    // denominator is finals-inclusive and so exceeds the home-and-away
    // `played` on the record.
    const adelaideMetrics = await getClubSeasonTeamMetrics(adelaide, COMPLETED_SEASON);
    const adelaideRecord = await getClubSeasonRecord(adelaide, COMPLETED_SEASON);
    expect(adelaideMetrics.totalTeamMatches).toBe(25);
    expect(adelaideMetrics.totalTeamMatches)
      .toBe(adelaideRecord!.played + adelaideRecord!.finalsPlayed!);
    expect(adelaideMetrics.metrics.find((m) => m.key === 'goals')!.average)
      .toBeCloseTo(14.28, 4);
    expect(adelaideMetrics.metrics.find((m) => m.key === 'disposals')!.average)
      .toBeCloseTo(349.48, 4);
    expect(adelaideMetrics.metrics.find((m) => m.key === 'marks_i50')!.average)
      .toBeCloseTo(11.68, 4);

    const lionsMetrics = await getClubSeasonTeamMetrics(lions, COMPLETED_SEASON);
    expect(lionsMetrics.totalTeamMatches).toBe(27);
    expect(lionsMetrics.metrics.find((m) => m.key === 'goals')!.average)
      .toBeCloseTo(13.1481, 4);
    expect(lionsMetrics.metrics.find((m) => m.key === 'disposals')!.average)
      .toBeCloseTo(371.5926, 4);
  });

  it('covers every approved metric family and maps marks inside 50 to its canonical column', () => {
    expect(TEAM_METRICS).toHaveLength(21);
    expect(new Set(TEAM_METRICS.map((m) => m.key)).size).toBe(21);
    expect(TEAM_METRICS.find((m) => m.key === 'marks_i50')!.column).toBe('marks_inside_50');
    expect(TEAM_METRICS.find((m) => m.key === 'marks_i50')!.statKey).toBe('marks_i50');
    expect(TEAM_METRICS.find((m) => m.key === 'inside50s')!.column).toBe('inside_50s');
    // The registry is identity only: no season, no year, no availability.
    for (const metric of TEAM_METRICS) {
      expect(Object.keys(metric).sort()).toEqual(['column', 'key', 'label', 'statKey']);
    }
  });

  it('keeps a pre-1965 uncollected metric unavailable instead of reporting zero', async () => {
    const [metrics, coverage, matchCount] = await Promise.all([
      getClubSeasonTeamMetrics(carlton, PRE_1965_SEASON),
      oracleCoverage(PRE_1965_SEASON),
      oracleTeamMatchCount(carlton, PRE_1965_SEASON),
    ]);

    expect(metrics.totalTeamMatches).toBe(matchCount);
    expect(metrics.participated).toBe(true);

    for (const metric of metrics.metrics) {
      // Every state comes from the coverage row, not from the year.
      expect(metric.coverage).toBe(coverage.get(metric.statKey) ?? 'missing');
      if (metric.coverage === 'complete' || metric.coverage === 'partial') continue;
      expect(metric.isAvailable).toBe(false);
      expect(metric.average).toBeNull();
      expect(metric.total).toBeNull();
      // The point of the whole exercise: not zero.
      expect(metric.average).not.toBe(0);
    }

    const goals = metrics.metrics.find((m) => m.key === 'goals')!;
    const disposals = metrics.metrics.find((m) => m.key === 'disposals')!;
    expect(goals.coverage).toBe('complete');
    expect(goals.isAvailable).toBe(true);
    expect(goals.eligibleMatches).toBe(matchCount);
    expect(disposals.coverage).toBe('not_collected');
    expect(disposals.isAvailable).toBe(false);
    expect(disposals.average).toBeNull();

    // Independent SQL agrees the goals number is real and the disposals
    // number is genuinely absent rather than suppressed.
    const goalsOracle = aggregateTeamStat(
      await oracleTeamStatRows(carlton, PRE_1965_SEASON, 'goals'),
    );
    const disposalsOracle = aggregateTeamStat(
      await oracleTeamStatRows(carlton, PRE_1965_SEASON, 'disposals'),
    );
    expect(goals.average!).toBeCloseTo(goalsOracle.average!, 8);
    expect(goals.average!).toBeCloseTo(12.2778, 4);
    expect(disposalsOracle.eligible).toBe(0);

    // The player leaders follow the same runtime coverage.
    const leaders = await getClubSeasonPlayerLeaders(carlton, PRE_1965_SEASON);
    expect(leaders.disposalsCoverage).toBe('not_collected');
    expect(leaders.disposalsAvailable).toBe(false);
    expect(leaders.disposals).toEqual([]);
    expect(leaders.goalsAvailable).toBe(true);
    expect(leaders.goals.length).toBeGreaterThan(0);
    expect(leaders.games.length).toBeGreaterThan(0);
  });

  it('reports a mixed-coverage historical season as partial with an honest denominator', async () => {
    const [metrics, coverage, matchCount] = await Promise.all([
      getClubSeasonTeamMetrics(carlton, MIXED_COVERAGE_SEASON),
      oracleCoverage(MIXED_COVERAGE_SEASON),
      oracleTeamMatchCount(carlton, MIXED_COVERAGE_SEASON),
    ]);

    // The same season carries three different coverage states at once,
    // which no year branch could express.
    const states = new Set(metrics.metrics.map((m) => m.coverage));
    expect(states.size).toBeGreaterThan(1);
    for (const metric of metrics.metrics) {
      expect(metric.coverage).toBe(coverage.get(metric.statKey) ?? 'missing');
    }

    const goals = metrics.metrics.find((m) => m.key === 'goals')!;
    const disposals = metrics.metrics.find((m) => m.key === 'disposals')!;
    const hitouts = metrics.metrics.find((m) => m.key === 'hitouts')!;
    const tackles = metrics.metrics.find((m) => m.key === 'tackles')!;

    expect(goals.coverage).toBe('complete');
    expect(goals.eligibleMatches).toBe(matchCount);
    expect(goals.hasDenominatorDiscrepancy).toBe(false);

    expect(disposals.coverage).toBe('partial');
    expect(disposals.isPartial).toBe(true);
    expect(disposals.isAvailable).toBe(true);
    expect(disposals.eligibleMatches).toBeLessThan(disposals.totalTeamMatches);
    expect(disposals.hasDenominatorDiscrepancy).toBe(true);

    expect(hitouts.coverage).toBe('partial');
    expect(hitouts.eligibleMatches).toBeLessThan(hitouts.totalTeamMatches);

    expect(tackles.coverage).toBe('not_collected');
    expect(tackles.isAvailable).toBe(false);
    expect(tackles.average).toBeNull();

    // Independent SQL, aggregated in TypeScript, reaches the same
    // recorded-match averages and the same denominators.
    for (const metric of [goals, disposals, hitouts]) {
      const definition = TEAM_METRICS.find((m) => m.key === metric.key)!;
      const oracle = aggregateTeamStat(
        await oracleTeamStatRows(carlton, MIXED_COVERAGE_SEASON, definition.column),
      );
      expect(metric.eligibleMatches).toBe(oracle.eligible);
      expect(metric.average!).toBeCloseTo(oracle.average!, 8);
    }

    // The measured witnesses.
    expect(matchCount).toBe(24);
    expect(goals.average!).toBeCloseTo(15.0833, 4);
    expect(disposals.eligibleMatches).toBe(23);
    expect(disposals.average!).toBeCloseTo(267.3913, 4);
    expect(hitouts.eligibleMatches).toBe(11);
    expect(hitouts.average!).toBeCloseTo(30.2727, 4);
  });

  it('fails safely to unavailable when a selected season has no coverage metadata at all', async () => {
    // A year with no `seasons` row and therefore no coverage rows. It is
    // an argument, not a branch: the code path is the ordinary one.
    const absent = Math.min(...(await oracleSeasons()).map((s) => s.season)) - 1;
    const comparison = await getClubSeasonComparison(carlton, absent);

    expect(comparison.seasonMeta).toBeNull();
    expect(comparison.participated).toBe(false);
    for (const metric of comparison.teamMetrics.metrics) {
      expect(metric.coverage).toBe('missing');
      expect(metric.isAvailable).toBe(false);
      expect(metric.average).toBeNull();
    }
    expect(comparison.brownlow.coverage).toBe('missing');
    expect(comparison.brownlow.isAuthoritative).toBe(false);
    expect(comparison.brownlow.totalVotes).toBeNull();
  });

  it('contains no hard-coded season year in the selected season code path', () => {
    const source = readFileSync('src/db/queries/club-comparison.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
    const years = source.match(/\b(1[89]\d{2}|2[01]\d{2})\b/g) ?? [];
    expect(years).toEqual([]);
  });
});

describe('club comparison: maximum canonical season', () => {
  it('runs the complete selected season path for the maximum canonical season without naming it', async () => {
    const [max, seasons, oracle] = await Promise.all([
      getMaximumComparisonSeason(),
      getComparisonSeasons(),
      oracleSeasons(),
    ]);

    expect(max).not.toBeNull();
    const maxOracle = oracle[0];
    expect(max!.season).toBe(maxOracle.season);
    expect(max!.status).toBe(maxOracle.status);
    expect(max!.isProvisional).toBe(maxOracle.status !== 'complete');
    expect(max!.dataThroughDate).toEqual(maxOracle.dataThroughDate);

    // Choose the newest canonical season that actually has two or more
    // participating organisations. On a database whose newest season has
    // been created but not yet loaded, that is an earlier season -- and
    // the walk finds it without naming any year.
    let contested = max!;
    let participants = await getSeasonParticipants(contested.season);
    for (const season of seasons) {
      if (participants.length >= 2) break;
      contested = season;
      participants = await getSeasonParticipants(season.season);
    }
    expect(participants.length).toBeGreaterThanOrEqual(2);

    // The maximum season's own state is asserted exactly as canonical
    // metadata reports it, loaded or not.
    const maxSide = await getClubSeasonComparison(participants[0].id, max!.season);
    expect(maxSide.seasonMeta!.status).toBe(maxOracle.status);
    expect(maxSide.seasonMeta!.isProvisional).toBe(maxOracle.status !== 'complete');
    const maxCoverage = await oracleCoverage(max!.season);
    for (const metric of maxSide.teamMetrics.metrics) {
      expect(metric.coverage).toBe(maxCoverage.get(metric.statKey) ?? 'missing');
      // Coverage may permit a number; with no eligible team-match there
      // is still nothing to report, and nothing is invented.
      if (maxSide.teamMetrics.totalTeamMatches === 0) {
        expect(metric.isAvailable).toBe(false);
        expect(metric.average).toBeNull();
      }
    }
    expect(maxSide.brownlow.coverage)
      .toBe(maxCoverage.get('brownlow_season_total') ?? 'missing');
    expect(maxSide.brownlow.isAuthoritative)
      .toBe(maxSide.brownlow.coverage === 'complete');
    expect(maxSide.participated).toBe(maxSide.identity!.matchesPlayed > 0
      || maxSide.identity!.ladderRows > 0);

    // The complete comparison path, for two dynamically chosen
    // organisations in a dynamically chosen season.
    const [a, b] = participants;
    const seasonCoverage = await oracleCoverage(contested.season);
    const oracleRow = oracle.find((s) => s.season === contested.season)!;

    for (const org of [a, b]) {
      const side = await getClubSeasonComparison(org.id, contested.season);

      expect(side.season).toBe(contested.season);
      expect(side.seasonMeta!.status).toBe(oracleRow.status);
      expect(side.seasonMeta!.isProvisional).toBe(oracleRow.status !== 'complete');
      expect(side.seasonMeta!.dataThroughDate).toEqual(oracleRow.dataThroughDate);

      // Identity resolves to a real club of that organisation.
      const identities = await oracleClubIdentities(org.id);
      expect(side.identity!.clubId).toBe(pickIdentity(identities, contested.season)!.clubId);
      expect(side.participated).toBe(true);

      // Record, from the ladder row of that identity.
      const ladder = await oracleLadderRow(side.identity!.clubId!, contested.season);
      expect(side.record!.played).toBe(ladder!.played);
      expect(side.record!.wins).toBe(ladder!.wins);
      expect(side.record!.winPercentage).toBeCloseTo(
        (100 * (ladder!.wins + 0.5 * ladder!.draws)) / ladder!.played, 10,
      );

      // Every metric's state equals its canonical coverage row.
      const teamMatches = await oracleTeamMatchCount(org.id, contested.season);
      expect(side.teamMetrics.totalTeamMatches).toBe(teamMatches);
      for (const metric of side.teamMetrics.metrics) {
        expect(metric.coverage).toBe(seasonCoverage.get(metric.statKey) ?? 'missing');
        if (metric.coverage !== 'complete' && metric.coverage !== 'partial') {
          expect(metric.isAvailable).toBe(false);
          expect(metric.average).toBeNull();
        }
      }

      // Leaders and Brownlow follow the same runtime coverage.
      expect(side.leaders.disposalsCoverage)
        .toBe(seasonCoverage.get('disposals') ?? 'missing');
      if (!side.leaders.disposalsAvailable) expect(side.leaders.disposals).toEqual([]);
      expect(side.brownlow.coverage)
        .toBe(seasonCoverage.get('brownlow_season_total') ?? 'missing');
      expect(side.brownlow.isAuthoritative).toBe(side.brownlow.coverage === 'complete');
      if (!side.brownlow.isAuthoritative) expect(side.brownlow.totalVotes).toBeNull();
    }
  });
});

// --- Stage 5: performance gate ---

/**
 * AFLDB-ISSUE-144 Stage 5. These tests measure the EXPORTED query
 * functions above -- not a reimplementation of their SQL -- against real
 * `afldb_test` data, warm, and assert only the runbook's stated ceilings:
 * each query under 250 ms, each independent parallel group under 750 ms,
 * and a route-equivalent composed load under 1.5 s.
 *
 * They live in this file rather than a separate performance suite because
 * the runbook's Stage 5 validation command targets it by name, and because
 * these measurements must exercise the same imports, connection pool and
 * database the semantic tests prove. Every assertion is a generous
 * ceiling, never an exact or sub-millisecond value, so ordinary CI does
 * not depend on a one-off cold timing: warmups are discarded and the
 * median of five measured runs is the acceptance value.
 *
 * No year and no club-specific shortcut is hard-coded: the measured
 * season is discovered as the newest complete season all four witness
 * organisations participated in.
 */
const PERF_WARMUP_RUNS = 2;
const PERF_MEASURED_RUNS = 5;
const PERF_QUERY_CEILING_MS = 250;
const PERF_GROUP_CEILING_MS = 750;
const PERF_ROUTE_CEILING_MS = 1_500;

type PerfTiming = {
  group: string;
  label: string;
  runs: number;
  min: number;
  median: number;
  max: number;
};

const perfTimings: PerfTiming[] = [];

function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Warm, then time `runs` executions; records and returns min/median/max in ms. */
async function measure(
  group: string,
  label: string,
  run: () => Promise<unknown>,
  runs: number = PERF_MEASURED_RUNS,
): Promise<PerfTiming> {
  for (let i = 0; i < PERF_WARMUP_RUNS; i += 1) await run();
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const started = performance.now();
    await run();
    samples.push(performance.now() - started);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const timing: PerfTiming = {
    group,
    label,
    runs,
    min: sorted[0],
    median: medianOf(sorted),
    max: sorted[sorted.length - 1],
  };
  perfTimings.push(timing);
  return timing;
}

function reportTimings(): void {
  if (perfTimings.length === 0) return;
  const rows = perfTimings.map((t) => ({
    group: t.group,
    label: t.label,
    runs: t.runs,
    min_ms: Number(t.min.toFixed(1)),
    median_ms: Number(t.median.toFixed(1)),
    max_ms: Number(t.max.toFixed(1)),
  }));
  // eslint-disable-next-line no-console
  console.table(rows);
}

// =====================================================================
// Stage 6 -- Extended rivalry analytics
// =====================================================================

// --- Independent SQL oracle: decades ---

type OracleDecade = {
  decade: number;
  meetings: number;
  aWins: number;
  bWins: number;
  draws: number;
  aPointsFor: number | null;
  bPointsFor: number | null;
};

/**
 * Plain two-way organisation join, grouped by integer-divided season.
 * No CTE, no shared fragment, no perspective column: this is the number
 * `getHeadToHeadByDecade` has to reach independently.
 */
async function oracleDecades(orgA: number, orgB: number): Promise<OracleDecade[]> {
  const rows = await sql<OracleDecade[]>`
    SELECT ((m.season / 10) * 10)::int AS decade,
           count(*)::int AS meetings,
           count(*) FILTER (WHERE wc.organization_id = ${orgA})::int AS "aWins",
           count(*) FILTER (WHERE wc.organization_id = ${orgB})::int AS "bWins",
           count(*) FILTER (WHERE m.winner_club_id IS NULL)::int AS draws,
           sum(CASE WHEN hc.organization_id = ${orgA} THEN m.home_score ELSE m.away_score END)::int
             AS "aPointsFor",
           sum(CASE WHEN hc.organization_id = ${orgA} THEN m.away_score ELSE m.home_score END)::int
             AS "bPointsFor"
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN clubs wc ON wc.id = m.winner_club_id
     WHERE (hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
        OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA})
     GROUP BY 1
     ORDER BY 1
  `;
  return [...rows];
}

// --- Independent SQL oracle: period-score breaks ---

type OraclePeriodMatch = {
  matchId: number;
  season: number;
  a1: number; a2: number; a3: number;
  b1: number; b2: number; b3: number;
  aScore: number; bScore: number;
  winner: 'A' | 'B' | 'D';
};

/**
 * Every usable meeting with its cumulative break totals, assembled by
 * six plain correlated scalar subqueries rather than by the production
 * FILTER aggregate. Ranking, comeback and turnaround expectations are
 * then computed in TypeScript, so no SQL shape is shared with the
 * implementation.
 */
async function oraclePeriodMatches(orgA: number, orgB: number): Promise<OraclePeriodMatch[]> {
  const points = (org: number, period: number) => sql`
    (SELECT ps.points FROM match_period_scores ps
       JOIN clubs pc ON pc.id = ps.club_id
      WHERE ps.match_id = m.id AND ps.period = ${period} AND pc.organization_id = ${org})
  `;
  const rows = await sql<OraclePeriodMatch[]>`
    SELECT m.id AS "matchId", m.season,
           ${points(orgA, 1)}::int AS a1,
           ${points(orgA, 2)}::int AS a2,
           ${points(orgA, 3)}::int AS a3,
           ${points(orgB, 1)}::int AS b1,
           ${points(orgB, 2)}::int AS b2,
           ${points(orgB, 3)}::int AS b3,
           (CASE WHEN hc.organization_id = ${orgA} THEN m.home_score ELSE m.away_score END)::int
             AS "aScore",
           (CASE WHEN hc.organization_id = ${orgA} THEN m.away_score ELSE m.home_score END)::int
             AS "bScore",
           (CASE WHEN wc.organization_id = ${orgA} THEN 'A'
                 WHEN wc.organization_id = ${orgB} THEN 'B' ELSE 'D' END) AS winner
      FROM matches m
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      LEFT JOIN clubs wc ON wc.id = m.winner_club_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
     ORDER BY m.id
  `;
  return [...rows].filter(
    (r) => r.a1 !== null && r.a2 !== null && r.a3 !== null
      && r.b1 !== null && r.b2 !== null && r.b3 !== null
      && r.aScore !== null && r.bScore !== null,
  );
}

/** The set of match ids holding the maximum of `value` over `eligible` rows. */
function oracleExtreme(
  rows: OraclePeriodMatch[],
  eligible: (r: OraclePeriodMatch) => boolean,
  value: (r: OraclePeriodMatch) => number,
): { value: number | null; matchIds: number[] } {
  const candidates = rows.filter(eligible);
  if (candidates.length === 0) return { value: null, matchIds: [] };
  const best = Math.max(...candidates.map(value));
  return {
    value: best,
    matchIds: candidates.filter((r) => value(r) === best).map((r) => r.matchId).sort((x, y) => x - y),
  };
}

// --- Independent SQL oracle: H2H player averages ---

type OracleAverage = {
  playerId: number;
  displayName: string;
  recordedGames: number;
  total: number;
  average: number;
};

/**
 * One metric's average board by plain join, plain GROUP BY and a plain
 * HAVING. The dense ranking and the rank-ten cut are applied in
 * TypeScript below, so the window function is not borrowed either.
 */
async function oracleAverages(
  orgA: number,
  orgB: number,
  column: string,
  minimumRecordedGames: number,
): Promise<OracleAverage[]> {
  const rows = await sql<OracleAverage[]>`
    SELECT pms.player_id AS "playerId",
           p.display_name AS "displayName",
           count(pms.${sql(column)})::int AS "recordedGames",
           sum(pms.${sql(column)})::float8 AS total,
           avg(pms.${sql(column)})::float8 AS average
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      JOIN clubs c ON c.id = pms.club_id
      JOIN players p ON p.id = pms.player_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
       AND c.organization_id IN (${orgA}, ${orgB})
     GROUP BY pms.player_id, p.display_name
    HAVING count(pms.${sql(column)}) >= ${minimumRecordedGames}
     ORDER BY avg(pms.${sql(column)}) DESC
  `;
  return [...rows];
}

/** Recorded H2H games for one player and one metric column. */
async function oracleRecordedGames(
  orgA: number,
  orgB: number,
  playerId: number,
  column: string,
): Promise<number> {
  const [row] = await sql<{ recordedGames: number }[]>`
    SELECT count(pms.${sql(column)})::int AS "recordedGames"
      FROM player_match_stats pms
      JOIN matches m ON m.id = pms.match_id
      JOIN clubs hc ON hc.id = m.home_club_id
      JOIN clubs ac ON ac.id = m.away_club_id
      JOIN clubs c ON c.id = pms.club_id
     WHERE ((hc.organization_id = ${orgA} AND ac.organization_id = ${orgB})
         OR (hc.organization_id = ${orgB} AND ac.organization_id = ${orgA}))
       AND c.organization_id IN (${orgA}, ${orgB})
       AND pms.player_id = ${playerId}
  `;
  return row.recordedGames;
}

describe('club comparison: head-to-head by decade', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;
  let collingwood = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton, collingwood] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
      orgIdBySlug('collingwood'),
    ]);
  });

  it('reproduces the Adelaide vs Brisbane Lions decade witness and independent SQL', async () => {
    const [decades, oracle] = await Promise.all([
      getHeadToHeadByDecade(adelaide, lions),
      oracleDecades(adelaide, lions),
    ]);

    // The measured V1.7 witness: decade, meetings, A wins, B wins, draws.
    expect(decades.map((d) => [d.decade, d.meetings, d.aWins, d.bWins, d.draws])).toEqual([
      [1990, 5, 2, 3, 0],
      [2000, 15, 5, 10, 0],
      [2010, 13, 10, 3, 0],
      [2020, 8, 2, 5, 1],
    ]);

    // ...and the same table reached by structurally simpler SQL,
    // points included.
    expect(oracle.length).toBe(decades.length);
    decades.forEach((d, i) => {
      expect(d.decade).toBe(oracle[i].decade);
      expect(d.meetings).toBe(oracle[i].meetings);
      expect(d.aWins).toBe(oracle[i].aWins);
      expect(d.bWins).toBe(oracle[i].bWins);
      expect(d.draws).toBe(oracle[i].draws);
      expect(d.aPointsFor).toBe(oracle[i].aPointsFor);
      expect(d.bPointsFor).toBe(oracle[i].bPointsFor);
      // For-and-against are mirror images of one another by definition.
      expect(d.aPointsAgainst).toBe(oracle[i].bPointsFor);
      expect(d.bPointsAgainst).toBe(oracle[i].aPointsFor);
      // Half-draw formula, and the two percentages partition 100.
      expect(d.aWinPercentage).toBeCloseTo(
        (100 * (d.aWins + 0.5 * d.draws)) / d.meetings, 10,
      );
      expect((d.aWinPercentage as number) + (d.bWinPercentage as number)).toBeCloseTo(100, 10);
      expect(d.aWins + d.bWins + d.draws).toBe(d.meetings);
    });

    // The measured points witness, stated once explicitly.
    expect(decades.map((d) => [d.aPointsFor, d.bPointsFor])).toEqual([
      [415, 462], [1221, 1555], [1432, 1012], [603, 723],
    ]);
  });

  it('sums every Carlton vs Collingwood decade back to the complete 268-meeting population', async () => {
    const [decades, oracle, summary] = await Promise.all([
      getHeadToHeadByDecade(carlton, collingwood),
      oracleDecades(carlton, collingwood),
      getHeadToHeadSummary(carlton, collingwood),
    ]);

    // Decades are DISCOVERED, not enumerated: the 1890s appear because
    // the pair met then, and no decade without a meeting is invented.
    expect(decades.map((d) => d.decade)).toEqual([
      1890, 1900, 1910, 1920, 1930, 1940, 1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020,
    ]);
    expect(decades.map((d) => d.decade)).toEqual(oracle.map((d) => d.decade));
    expect(decades.every((d) => d.meetings > 0)).toBe(true);

    // Ascending, strictly, so the table reads as a timeline.
    for (let i = 1; i < decades.length; i += 1) {
      expect(decades[i].decade).toBeGreaterThan(decades[i - 1].decade);
    }

    // Every decade closes back onto the Stage 1 population -- which is
    // the check that no historical identity leaked in or out.
    const total = (pick: (d: (typeof decades)[number]) => number) =>
      decades.reduce((sum, d) => sum + pick(d), 0);
    expect(total((d) => d.meetings)).toBe(268);
    expect(total((d) => d.meetings)).toBe(summary.meetings);
    expect(total((d) => d.aWins)).toBe(summary.aWins);
    expect(total((d) => d.bWins)).toBe(summary.bWins);
    expect(total((d) => d.draws)).toBe(summary.draws);

    decades.forEach((d, i) => {
      expect(d.meetings).toBe(oracle[i].meetings);
      expect(d.aWins).toBe(oracle[i].aWins);
      expect(d.bWins).toBe(oracle[i].bWins);
      expect(d.draws).toBe(oracle[i].draws);
      expect(d.aPointsFor).toBe(oracle[i].aPointsFor);
      expect(d.bPointsFor).toBe(oracle[i].bPointsFor);
    });
  });
});

describe('club comparison: period-score rivalry records', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;
  let collingwood = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton, collingwood] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
      orgIdBySlug('collingwood'),
    ]);
  });

  it('exposes pair-level period-score coverage for both witness rivalries', async () => {
    const [short, long] = await Promise.all([
      getHeadToHeadPeriodRecords(adelaide, lions),
      getHeadToHeadPeriodRecords(carlton, collingwood),
    ]);

    // "Period-score data available for X of Y rivalry meetings" is
    // answerable for both pairs -- which is the contract, whatever the
    // numbers happen to be today.
    expect(short.coverage.meetings).toBe(41);
    expect(short.coverage.usableMeetings).toBe(41);
    expect(short.coverage.incompleteMeetings).toBe(0);
    expect(short.coverage.state).toBe('complete');

    expect(long.coverage.meetings).toBe(268);
    expect(long.coverage.usableMeetings).toBe(268);
    expect(long.coverage.incompleteMeetings).toBe(0);
    expect(long.coverage.state).toBe('complete');

    for (const result of [short, long]) {
      expect(result.coverage.meetingsWithPeriodRows).toBe(result.coverage.meetings);
      expect(result.coverage.usableMeetings + result.coverage.incompleteMeetings)
        .toBe(result.coverage.meetings);
    }

    // Why there is no live incomplete witness: EVERY canonical match in
    // afldb_test carries period-score rows, so no pair can be chosen to
    // exercise the incomplete path with real data. The defensive
    // behaviour is proved by the next test instead.
    const [{ withoutPeriodRows }] = await sql<{ withoutPeriodRows: number }[]>`
      SELECT count(*)::int AS "withoutPeriodRows"
        FROM matches m
       WHERE NOT EXISTS (SELECT 1 FROM match_period_scores ps WHERE ps.match_id = m.id)
    `;
    expect(withoutPeriodRows).toBe(0);
  });

  it('drops a meeting whose period structure is incomplete rather than reading a gap as nought', async () => {
    const records = await getHeadToHeadPeriodRecords(adelaide, lions);
    const complete = records.coverage.usableMeetings;
    const [victim] = await sql<{ id: number }[]>`
      SELECT m.id
        FROM matches m
        JOIN clubs hc ON hc.id = m.home_club_id
        JOIN clubs ac ON ac.id = m.away_club_id
       WHERE (hc.organization_id = ${adelaide} AND ac.organization_id = ${lions})
          OR (hc.organization_id = ${lions} AND ac.organization_id = ${adelaide})
       ORDER BY m.id
       LIMIT 1
    `;

    // The usability predicate, applied read-only to a population in
    // which ONE club's three-quarter-time row has been withheld. No row
    // is written; the hole is simulated in the SELECT itself.
    const [{ usable }] = await sql<{ usable: number }[]>`
      WITH meetings AS (
        SELECT m.id,
               (CASE WHEN hc.organization_id = ${adelaide} THEN m.home_score ELSE m.away_score END)
                 AS a_score,
               (CASE WHEN hc.organization_id = ${adelaide} THEN m.away_score ELSE m.home_score END)
                 AS b_score
          FROM matches m
          JOIN clubs hc ON hc.id = m.home_club_id
          JOIN clubs ac ON ac.id = m.away_club_id
         WHERE (hc.organization_id = ${adelaide} AND ac.organization_id = ${lions})
            OR (hc.organization_id = ${lions} AND ac.organization_id = ${adelaide})
      ),
      breaks AS (
        SELECT mt.id,
               max(ps.points) FILTER (WHERE c.organization_id = ${adelaide} AND ps.period = 1) AS a1,
               max(ps.points) FILTER (WHERE c.organization_id = ${adelaide} AND ps.period = 2) AS a2,
               max(ps.points) FILTER (WHERE c.organization_id = ${adelaide} AND ps.period = 3) AS a3,
               max(ps.points) FILTER (WHERE c.organization_id = ${lions} AND ps.period = 1) AS b1,
               max(ps.points) FILTER (WHERE c.organization_id = ${lions} AND ps.period = 2) AS b2,
               max(ps.points) FILTER (WHERE c.organization_id = ${lions} AND ps.period = 3) AS b3
          FROM meetings mt
          JOIN match_period_scores ps ON ps.match_id = mt.id
          JOIN clubs c ON c.id = ps.club_id
         WHERE ps.period BETWEEN 1 AND 3
           AND ps.points IS NOT NULL
           AND NOT (mt.id = ${victim.id} AND ps.period = 3 AND c.organization_id = ${adelaide})
         GROUP BY mt.id
      )
      SELECT count(*)::int AS usable
        FROM meetings mt
        JOIN breaks b ON b.id = mt.id
       WHERE b.a1 IS NOT NULL AND b.a2 IS NOT NULL AND b.a3 IS NOT NULL
         AND b.b1 IS NOT NULL AND b.b2 IS NOT NULL AND b.b3 IS NOT NULL
         AND mt.a_score IS NOT NULL AND mt.b_score IS NOT NULL
    `;

    // One withheld break row removes exactly one meeting from the usable
    // population. It is not silently completed with a nought.
    expect(usable).toBe(complete - 1);
  });

  it('matches independent SQL on the biggest lead at every named break', async () => {
    const [result, oracle] = await Promise.all([
      getHeadToHeadPeriodRecords(adelaide, lions),
      oraclePeriodMatches(adelaide, lions),
    ]);
    expect(oracle.length).toBe(result.coverage.usableMeetings);

    const cases: Array<[H2HPeriodRecordKind, (r: OraclePeriodMatch) => number]> = [
      ['biggest-quarter-time-lead-a', (r) => r.a1 - r.b1],
      ['biggest-quarter-time-lead-b', (r) => r.b1 - r.a1],
      ['biggest-half-time-lead-a', (r) => r.a2 - r.b2],
      ['biggest-half-time-lead-b', (r) => r.b2 - r.a2],
      ['biggest-three-quarter-time-lead-a', (r) => r.a3 - r.b3],
      ['biggest-three-quarter-time-lead-b', (r) => r.b3 - r.a3],
    ];

    for (const [kind, margin] of cases) {
      const expected = oracleExtreme(oracle, (r) => margin(r) > 0, margin);
      const entries = result.records[kind];
      expect(entries.length, kind).toBe(expected.matchIds.length);
      expect(entries.map((e) => e.matchId).sort((x, y) => x - y), kind).toEqual(expected.matchIds);
      for (const entry of entries) {
        expect(entry.value, kind).toBe(expected.value);
        expect(entry.segment, kind).toBeNull();
        // The break totals travel with the record, so a route need not
        // fetch them again.
        const row = oracle.find((r) => r.matchId === entry.matchId)!;
        expect([entry.aQuarterTime, entry.aHalfTime, entry.aThreeQuarterTime])
          .toEqual([row.a1, row.a2, row.a3]);
        expect([entry.bQuarterTime, entry.bHalfTime, entry.bThreeQuarterTime])
          .toEqual([row.b1, row.b2, row.b3]);
      }
    }

    // The measured witnesses, and the half-time tie that a single-row
    // record would have thrown away.
    expect(result.records['biggest-quarter-time-lead-b'][0].value).toBe(46);
    expect(result.records['biggest-half-time-lead-a'][0].value).toBe(64);
    expect(result.records['biggest-three-quarter-time-lead-a'][0].value).toBe(108);
    expect(result.records['biggest-half-time-lead-b'].map((e) => e.matchId)).toEqual([12275, 15647]);
    expect(result.records['biggest-half-time-lead-b'].every((e) => e.value === 40)).toBe(true);
  });

  it('defines a comeback as trailing at the break and winning on the canonical result', async () => {
    const [result, oracle] = await Promise.all([
      getHeadToHeadPeriodRecords(adelaide, lions),
      oraclePeriodMatches(adelaide, lions),
    ]);

    const cases: Array<[H2HPeriodRecordKind, 'A' | 'B', (r: OraclePeriodMatch) => number]> = [
      ['biggest-comeback-from-quarter-time-a', 'A', (r) => r.b1 - r.a1],
      ['biggest-comeback-from-quarter-time-b', 'B', (r) => r.a1 - r.b1],
      ['biggest-comeback-from-half-time-a', 'A', (r) => r.b2 - r.a2],
      ['biggest-comeback-from-half-time-b', 'B', (r) => r.a2 - r.b2],
      ['biggest-comeback-from-three-quarter-time-a', 'A', (r) => r.b3 - r.a3],
      ['biggest-comeback-from-three-quarter-time-b', 'B', (r) => r.a3 - r.b3],
    ];

    for (const [kind, winner, deficit] of cases) {
      // Trailing at the break AND the canonical winner. A draw can never
      // qualify, and neither can a level break.
      const expected = oracleExtreme(
        oracle,
        (r) => r.winner === winner && deficit(r) > 0,
        deficit,
      );
      const entries = result.records[kind];
      expect(entries.map((e) => e.matchId).sort((x, y) => x - y), kind).toEqual(expected.matchIds);
      for (const entry of entries) {
        expect(entry.value, kind).toBe(expected.value);
        expect(entry.outcome, kind).toBe(winner === 'A' ? 'a-win' : 'b-win');
      }
    }

    // The measured witnesses. 14132 is the load-bearing one: Adelaide
    // led by 38 at quarter time -- it is simultaneously the biggest
    // quarter-time lead A holds -- and Brisbane Lions still won, so
    // sorting the evidence pack by break margin alone would have called
    // the record the wrong way round.
    expect(result.records['biggest-comeback-from-quarter-time-b'].map((e) => e.matchId)).toEqual([14132]);
    expect(result.records['biggest-comeback-from-quarter-time-b'][0].value).toBe(38);
    expect(result.records['biggest-quarter-time-lead-a'].map((e) => e.matchId)).toEqual([14132]);
    expect(result.records['biggest-comeback-from-quarter-time-a'][0].value).toBe(17);
    expect(result.records['biggest-comeback-from-half-time-a'][0].value).toBe(17);
    expect(result.records['biggest-comeback-from-three-quarter-time-a'][0].value).toBe(24);
    // A retained tie at half time from Brisbane Lions' side.
    expect(result.records['biggest-comeback-from-half-time-b'].map((e) => e.matchId)).toEqual([12340, 13305]);

    // No comeback entry is ever a drawn match.
    for (const [kind] of cases) {
      expect(result.records[kind].every((e) => e.outcome !== 'draw'), kind).toBe(true);
    }
  });

  it('computes the largest consecutive-break turnaround from the canonical full-time score, never period 4', async () => {
    // The reason full time cannot come from period 4: the historical
    // importer imports no extra-time period, so period 4 is the end of
    // REGULATION. These three finals prove it in afldb_test.
    const extraTime = await sql<{ matchId: number; period4: number; finalScore: number }[]>`
      SELECT ps.match_id AS "matchId", ps.points::int AS "period4", m.home_score::int AS "finalScore"
        FROM match_period_scores ps
        JOIN matches m ON m.id = ps.match_id AND ps.club_id = m.home_club_id
       WHERE ps.period = 4 AND ps.points IS DISTINCT FROM m.home_score
       ORDER BY ps.match_id
    `;
    expect(extraTime.map((r) => r.matchId)).toEqual([10795, 13203, 15194]);
    expect(extraTime.every((r) => r.period4 < r.finalScore)).toBe(true);

    const [result, oracle] = await Promise.all([
      getHeadToHeadPeriodRecords(adelaide, lions),
      oraclePeriodMatches(adelaide, lions),
    ]);

    // M(t) = own - other at QT, HT, 3QT and FT; the swing is
    // M(t+1) - M(t) over the three consecutive pairs. FT is the
    // canonical match score.
    type Swing = { matchId: number; value: number; segment: H2HTurnaroundSegment };
    const swingsFor = (side: 'A' | 'B'): Swing[] => {
      const margins = (r: OraclePeriodMatch) => side === 'A'
        ? [r.a1 - r.b1, r.a2 - r.b2, r.a3 - r.b3, r.aScore - r.bScore]
        : [r.b1 - r.a1, r.b2 - r.a2, r.b3 - r.a3, r.bScore - r.aScore];
      const segments: H2HTurnaroundSegment[] = [
        'quarter-time-to-half-time',
        'half-time-to-three-quarter-time',
        'three-quarter-time-to-full-time',
      ];
      return oracle.flatMap((r) => {
        const m = margins(r);
        return segments.map((segment, i) => ({
          matchId: r.matchId, value: m[i + 1] - m[i], segment,
        }));
      });
    };

    for (const [kind, side] of [
      ['largest-turnaround-a', 'A'],
      ['largest-turnaround-b', 'B'],
    ] as Array<[H2HPeriodRecordKind, 'A' | 'B']>) {
      const positive = swingsFor(side).filter((s) => s.value > 0);
      const best = Math.max(...positive.map((s) => s.value));
      const expected = positive.filter((s) => s.value === best)
        .sort((x, y) => x.matchId - y.matchId);
      const entries = result.records[kind];
      expect(entries.length, kind).toBe(expected.length);
      expect(entries.map((e) => e.matchId).sort((x, y) => x - y), kind)
        .toEqual(expected.map((s) => s.matchId));
      for (const entry of entries) {
        expect(entry.value, kind).toBe(best);
        expect(entry.segment, kind).toBe(
          expected.find((s) => s.matchId === entry.matchId)!.segment,
        );
      }
    }

    // The measured witnesses, each naming its segment objectively.
    expect(result.records['largest-turnaround-a'].map((e) => [e.matchId, e.value, e.segment]))
      .toEqual([[14752, 49, 'quarter-time-to-half-time']]);
    expect(result.records['largest-turnaround-b'].map((e) => [e.matchId, e.value, e.segment]))
      .toEqual([[12597, 67, 'three-quarter-time-to-full-time']]);
  });
});

describe('club comparison: head-to-head player averages', () => {
  let adelaide = 0;
  let lions = 0;

  beforeAll(async () => {
    [adelaide, lions] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
    ]);
  });

  it('reuses the comparison metric registry rather than defining a second one', async () => {
    // The average boards are a filtered view of TEAM_METRICS: the same
    // objects, never a copy and never a year-based registry.
    expect(H2H_AVERAGE_METRICS.every((m) => TEAM_METRICS.includes(m))).toBe(true);
    expect(H2H_AVERAGE_METRICS.map((m) => m.key)).toEqual([
      'goals', 'kicks', 'handballs', 'disposals', 'marks', 'tackles', 'hitouts',
      'rebounds', 'inside50s', 'clearances', 'clangers', 'contested', 'uncontested',
      'contested_marks', 'marks_i50', 'one_percenters', 'bounces', 'goal_assists',
    ]);

    const averages = await getHeadToHeadPlayerAverages(adelaide, lions);
    expect(averages.boards.map((b) => b.key)).toEqual(H2H_AVERAGE_METRICS.map((m) => m.key));
    expect(averages.meetings).toBe(41);
    expect(averages.minimumRecordedGames).toBe(5);
    expect(averages.rankLimit).toBe(H2H_AVERAGE_RANK_LIMIT);
  });

  it('ranks the disposals average board on recorded games and matches independent SQL', async () => {
    const [averages, oracle] = await Promise.all([
      getHeadToHeadPlayerAverages(adelaide, lions),
      oracleAverages(adelaide, lions, 'disposals', H2H_AVERAGE_MINIMUM_RECORDED_GAMES),
    ]);
    const board = averages.boards.find((b) => b.key === 'disposals')!;

    // The measured V1.7 witness.
    expect(board.leaders.slice(0, 3).map((l) => [
      l.displayName, l.recordedGames, Number(l.average.toFixed(2)),
    ])).toEqual([
      ['Matt Crouch', 7, 30.71],
      ['Lachie Neale', 8, 29.75],
      ['Rory Laird', 14, 28.86],
    ]);

    // Dense rank applied to the independent oracle, cut at ten with
    // every tie at the cut retained.
    const ordered = [...oracle].sort((x, y) => y.average - x.average);
    const distinct = [...new Set(ordered.map((r) => r.average))];
    const expected = ordered.filter((r) => distinct.indexOf(r.average) + 1 <= H2H_AVERAGE_RANK_LIMIT);
    expect(board.leaders.length).toBe(expected.length);
    expect(new Set(board.leaders.map((l) => l.playerId)))
      .toEqual(new Set(expected.map((r) => r.playerId)));

    for (const leader of board.leaders) {
      const row = expected.find((r) => r.playerId === leader.playerId)!;
      expect(leader.recordedGames).toBe(row.recordedGames);
      expect(leader.total).toBe(row.total);
      expect(leader.average).toBeCloseTo(row.average, 10);
      // The average IS total over recorded games -- never over rivalry
      // appearances.
      expect(leader.average).toBeCloseTo(leader.total / leader.recordedGames, 10);
      expect(leader.rank).toBe(distinct.indexOf(row.average) + 1);
      // A/B contributions partition the recorded games.
      expect(leader.a.recordedGames + leader.b.recordedGames).toBe(leader.recordedGames);
      expect((leader.a.total ?? 0) + (leader.b.total ?? 0)).toBe(leader.total);
      // Nothing recorded for a side is null, not nought.
      if (leader.a.recordedGames === 0) expect(leader.a.average).toBeNull();
      if (leader.b.recordedGames === 0) expect(leader.b.average).toBeNull();
    }

    // Ranks are non-decreasing, and ordering after a rank is by sort name.
    for (let i = 1; i < board.leaders.length; i += 1) {
      expect(board.leaders[i].rank).toBeGreaterThanOrEqual(board.leaders[i - 1].rank);
      if (board.leaders[i].rank === board.leaders[i - 1].rank) {
        expect(board.leaders[i].sortName >= board.leaders[i - 1].sortName).toBe(true);
      }
    }
  });

  it('applies the five-recorded-game minimum, per metric and never per rivalry appearance', async () => {
    const averages = await getHeadToHeadPlayerAverages(adelaide, lions);
    const disposals = averages.boards.find((b) => b.key === 'disposals')!;
    const goalAssists = averages.boards.find((b) => b.key === 'goal_assists')!;

    // Every eligible row on every board clears the threshold.
    for (const board of averages.boards) {
      expect(board.minimumRecordedGames).toBe(5);
      expect(board.leaders.every((l) => l.recordedGames >= 5), board.key).toBe(true);
    }

    // EXACTLY five is eligible: Josh Dunkley's five recorded disposal
    // games put him on the board.
    const dunkley = disposals.leaders.find((l) => l.displayName === 'Josh Dunkley');
    expect(dunkley).toBeDefined();
    expect(dunkley!.recordedGames).toBe(5);
    expect(await oracleRecordedGames(adelaide, lions, dunkley!.playerId, 'disposals')).toBe(5);

    // FOUR is not: Izak Rankine averaged 20.25 over four recorded
    // disposal games, which would have placed him inside the top ten.
    const [rankine] = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE display_name = 'Izak Rankine'
    `;
    expect(await oracleRecordedGames(adelaide, lions, rankine.id, 'disposals')).toBe(4);
    expect(disposals.leaders.some((l) => l.playerId === rankine.id)).toBe(false);

    // The threshold is METRIC-SPECIFIC: Alastair Lynch has twelve
    // recorded disposal games in the rivalry but only three recorded
    // goal-assist games, so he is eligible for one board and not the
    // other. Total rivalry appearances decide neither.
    const [lynch] = await sql<{ id: number }[]>`
      SELECT id FROM players WHERE display_name = 'Alastair Lynch'
    `;
    expect(await oracleRecordedGames(adelaide, lions, lynch.id, 'disposals')).toBe(12);
    expect(await oracleRecordedGames(adelaide, lions, lynch.id, 'goal_assists')).toBe(3);
    expect(goalAssists.leaders.some((l) => l.playerId === lynch.id)).toBe(false);
    const lynchDisposals = await oracleAverages(
      adelaide, lions, 'disposals', H2H_AVERAGE_MINIMUM_RECORDED_GAMES,
    );
    expect(lynchDisposals.some((r) => r.playerId === lynch.id)).toBe(true);
  });

  it('retains every tie at the rank-ten boundary and reports the recorded-game denominator', async () => {
    const [averages, oracle] = await Promise.all([
      getHeadToHeadPlayerAverages(adelaide, lions),
      oracleAverages(adelaide, lions, 'goal_assists', H2H_AVERAGE_MINIMUM_RECORDED_GAMES),
    ]);
    const board = averages.boards.find((b) => b.key === 'goal_assists')!;

    // Two players tie on 9 assists from 11 recorded games, and BOTH are
    // kept at rank ten -- the board is therefore longer than ten rows.
    const atCut = board.leaders.filter((l) => l.rank === H2H_AVERAGE_RANK_LIMIT);
    expect(atCut.length).toBe(2);
    expect(atCut.map((l) => l.displayName).sort()).toEqual(['Andrew McLeod', 'Hugh McCluggage']);
    expect(atCut.every((l) => l.recordedGames === 11 && l.total === 9)).toBe(true);
    expect(board.leaders.length).toBeGreaterThan(H2H_AVERAGE_RANK_LIMIT);
    expect(Math.max(...board.leaders.map((l) => l.rank))).toBe(H2H_AVERAGE_RANK_LIMIT);

    // ...and independent SQL agrees on every retained row.
    for (const leader of board.leaders) {
      const row = oracle.find((r) => r.playerId === leader.playerId)!;
      expect(leader.recordedGames).toBe(row.recordedGames);
      expect(leader.total).toBe(row.total);
      expect(leader.average).toBeCloseTo(row.average, 10);
    }
  });

  it('reads average availability from runtime stat_availability over the rivalry seasons', async () => {
    const averages = await getHeadToHeadPlayerAverages(adelaide, lions);

    // The rivalry's own seasons, discovered -- not a hard-coded span.
    const [{ seasons }] = await sql<{ seasons: number }[]>`
      SELECT count(DISTINCT m.season)::int AS seasons
        FROM matches m
        JOIN clubs hc ON hc.id = m.home_club_id
        JOIN clubs ac ON ac.id = m.away_club_id
       WHERE (hc.organization_id = ${adelaide} AND ac.organization_id = ${lions})
          OR (hc.organization_id = ${lions} AND ac.organization_id = ${adelaide})
    `;
    expect(averages.rivalrySeasons).toBe(seasons);

    // The limited-coverage witness: goal assists are not collected for
    // part of this rivalry, so the board is available but declares its
    // gap. A UI can therefore avoid implying era-wide comparability.
    const goalAssists = averages.boards.find((b) => b.key === 'goal_assists')!;
    const disposals = averages.boards.find((b) => b.key === 'disposals')!;

    const coverageOracle = async (statKey: string) => {
      const rows = await sql<{ coverage: string; seasons: number }[]>`
        SELECT COALESCE(sa.coverage::text, 'missing') AS coverage, count(*)::int AS seasons
          FROM (SELECT DISTINCT m.season
                  FROM matches m
                  JOIN clubs hc ON hc.id = m.home_club_id
                  JOIN clubs ac ON ac.id = m.away_club_id
                 WHERE (hc.organization_id = ${adelaide} AND ac.organization_id = ${lions})
                    OR (hc.organization_id = ${lions} AND ac.organization_id = ${adelaide})) rs
          LEFT JOIN stat_availability sa
            ON sa.stat_key = ${statKey} AND sa.season = rs.season
         GROUP BY 1
      `;
      return new Map(rows.map((r) => [r.coverage, r.seasons]));
    };

    const gaCoverage = await coverageOracle('goal_assists');
    expect(goalAssists.seasonsByCoverage.complete).toBe(gaCoverage.get('complete') ?? 0);
    expect(goalAssists.seasonsByCoverage.not_collected).toBe(gaCoverage.get('not_collected') ?? 0);
    expect(goalAssists.coveredSeasons).toBe(gaCoverage.get('complete') ?? 0);
    expect(goalAssists.coveredSeasons).toBeLessThan(goalAssists.rivalrySeasons);
    expect(goalAssists.uncoveredSeasons)
      .toBe(goalAssists.rivalrySeasons - goalAssists.coveredSeasons);
    expect(goalAssists.isAvailable).toBe(true);
    expect(goalAssists.hasCoverageGap).toBe(true);
    // The averages behind the gap are still honest: they are over
    // recorded rows only, and the denominator says so.
    expect(goalAssists.leaders.every((l) => l.recordedGames >= 5)).toBe(true);

    // A fully covered metric declares no gap.
    const dCoverage = await coverageOracle('disposals');
    expect(disposals.coveredSeasons).toBe(dCoverage.get('complete') ?? 0);
    expect(disposals.coveredSeasons).toBe(disposals.rivalrySeasons);
    expect(disposals.hasCoverageGap).toBe(false);

    // Every board's season states partition the rivalry's seasons, so
    // no availability decision anywhere depends on a year.
    for (const board of averages.boards) {
      const total = Object.values(board.seasonsByCoverage).reduce((a, b) => a + b, 0);
      expect(total, board.key).toBe(averages.rivalrySeasons);
      expect(board.coveredSeasons + board.uncoveredSeasons, board.key).toBe(board.rivalrySeasons);
    }
  });

  it('splits a crossover player average across both organisations', async () => {
    const averages = await getHeadToHeadPlayerAverages(adelaide, lions);
    const board = averages.boards.find((b) => b.key === 'goal_assists')!;

    // Charlie Cameron has played this rivalry for BOTH organisations, so
    // he is one row with two contributions, never two ambiguous rows.
    const cameron = board.leaders.filter((l) => l.displayName === 'Charlie Cameron');
    expect(cameron.length).toBe(1);
    const [row] = cameron;
    expect(row.recordedGames).toBe(14);
    expect(row.a.recordedGames).toBe(5);
    expect(row.b.recordedGames).toBe(9);
    expect(row.a.total).toBe(9);
    expect(row.b.total).toBe(8);
    expect(row.total).toBe(17);
    expect(row.average).toBeCloseTo(17 / 14, 10);
    expect(row.a.average).toBeCloseTo(9 / 5, 10);
    expect(row.b.average).toBeCloseTo(8 / 9, 10);
  });
});

describe('club comparison: long rivalry performance', () => {
  let adelaide = 0;
  let lions = 0;
  let carlton = 0;
  let collingwood = 0;
  /** Newest COMPLETE season all four witness organisations played in. */
  let measuredSeason = 0;
  let maximumSeason = 0;
  let maximumSeasonParticipants = 0;

  beforeAll(async () => {
    [adelaide, lions, carlton, collingwood] = await Promise.all([
      orgIdBySlug('adelaide'),
      orgIdBySlug('brisbane-lions'),
      orgIdBySlug('carlton'),
      orgIdBySlug('collingwood'),
    ]);

    const maximum = await getMaximumComparisonSeason();
    expect(maximum, 'afldb_test has no canonical seasons').not.toBeNull();
    maximumSeason = maximum!.season;
    maximumSeasonParticipants = (await getSeasonParticipants(maximumSeason)).length;

    const wanted = [adelaide, lions, carlton, collingwood];
    for (const season of await getComparisonSeasons()) {
      if (season.status !== 'complete') continue;
      const participants = await getSeasonParticipants(season.season);
      const ids = new Set(participants.map((p) => p.id));
      if (wanted.every((id) => ids.has(id))) {
        measuredSeason = season.season;
        break;
      }
    }
    expect(measuredSeason, 'no complete season has all four witness organisations')
      .toBeGreaterThan(0);
  }, 120_000);

  afterAll(() => {
    reportTimings();
  });

  it('keeps every warm H2H query under the query ceiling for both rivalry scales', async () => {
    const pairs: Array<[string, number, number]> = [
      ['adelaide/brisbane-lions', adelaide, lions],
      ['carlton/collingwood', carlton, collingwood],
    ];

    for (const [name, a, b] of pairs) {
      const measured = [
        await measure(name, 'getHeadToHeadSummary', () => getHeadToHeadSummary(a, b)),
        await measure(name, 'getHeadToHeadMeetings (page 1)', () => getHeadToHeadMeetings(a, b)),
        await measure(name, 'getHeadToHeadMeetings (finals)', () =>
          getHeadToHeadMeetings(a, b, { matchType: 'finals' })),
        await measure(name, 'getHeadToHeadVenueRecords', () => getHeadToHeadVenueRecords(a, b)),
        await measure(name, 'getHeadToHeadRecords', () => getHeadToHeadRecords(a, b)),
        await measure(name, 'getHeadToHeadStreaks', () => getHeadToHeadStreaks(a, b)),
        await measure(name, 'getCrossoverPlayers', () => getCrossoverPlayers(a, b)),
        await measure(name, 'getCrossoverSummary', () => getCrossoverSummary(a, b)),
        await measure(name, 'getHeadToHeadPlayerLeaders', () => getHeadToHeadPlayerLeaders(a, b)),
        await measure(name, 'getHeadToHeadBrownlow', () => getHeadToHeadBrownlow(a, b)),
        await measure(name, 'getClubBrownlowHistory (A)', () => getClubBrownlowHistory(a)),
        await measure(name, 'getClubBrownlowHistory (B)', () => getClubBrownlowHistory(b)),
      ];

      for (const timing of measured) {
        expect(
          timing.median,
          `${name} ${timing.label} warm median ${timing.median.toFixed(1)} ms`,
        ).toBeLessThan(PERF_QUERY_CEILING_MS);
      }
    }
  }, 300_000);

  it('keeps every warm selected-season query under the query ceiling', async () => {
    const sides: Array<[string, number]> = [
      [`adelaide ${measuredSeason}`, adelaide],
      [`brisbane-lions ${measuredSeason}`, lions],
    ];

    for (const [name, org] of sides) {
      const measured = [
        await measure(name, 'getSeasonIdentity', () => getSeasonIdentity(org, measuredSeason)),
        await measure(name, 'getClubSeasonRecord', () => getClubSeasonRecord(org, measuredSeason)),
        await measure(name, 'getClubSeasonTeamMetrics', () =>
          getClubSeasonTeamMetrics(org, measuredSeason)),
        await measure(name, 'getClubSeasonPlayerLeaders', () =>
          getClubSeasonPlayerLeaders(org, measuredSeason)),
        await measure(name, 'getClubSeasonBrownlowSummary', () =>
          getClubSeasonBrownlowSummary(org, measuredSeason)),
        await measure(name, 'getClubSeasonComparison (composed)', () =>
          getClubSeasonComparison(org, measuredSeason)),
      ];

      for (const timing of measured) {
        expect(
          timing.median,
          `${name} ${timing.label} warm median ${timing.median.toFixed(1)} ms`,
        ).toBeLessThan(PERF_QUERY_CEILING_MS);
      }
    }
  }, 300_000);

  it('keeps the maximum canonical season path under the query ceiling', async () => {
    const name = `max season ${maximumSeason} (${maximumSeasonParticipants} participants)`;
    const measured = [
      await measure(name, 'getMaximumComparisonSeason', () => getMaximumComparisonSeason()),
      await measure(name, 'getComparisonSeasons', () => getComparisonSeasons()),
      await measure(name, 'getSeasonParticipants', () => getSeasonParticipants(maximumSeason)),
    ];

    // Whether or not the maximum season has participation, the composed
    // path must still be measured: with none, this is the structural
    // no-participation path, which is exactly what a route would load.
    const org = maximumSeasonParticipants > 0
      ? (await getSeasonParticipants(maximumSeason))[0].id
      : adelaide;
    measured.push(
      await measure(name, 'getClubSeasonComparison (composed)', () =>
        getClubSeasonComparison(org, maximumSeason)),
    );

    for (const timing of measured) {
      expect(
        timing.median,
        `${timing.label} warm median ${timing.median.toFixed(1)} ms`,
      ).toBeLessThan(PERF_QUERY_CEILING_MS);
    }
  }, 300_000);

  it('keeps every warm Stage 6 extended-rivalry query under the query ceiling', async () => {
    const pairs: Array<[string, number, number]> = [
      ['adelaide/brisbane-lions', adelaide, lions],
      ['carlton/collingwood', carlton, collingwood],
    ];

    for (const [name, a, b] of pairs) {
      const measured = [
        await measure(name, 'getHeadToHeadByDecade', () => getHeadToHeadByDecade(a, b)),
        await measure(name, 'getHeadToHeadPeriodRecords', () => getHeadToHeadPeriodRecords(a, b)),
        await measure(name, 'getHeadToHeadPlayerAverages', () => getHeadToHeadPlayerAverages(a, b)),
      ];

      for (const timing of measured) {
        expect(
          timing.median,
          `${name} ${timing.label} warm median ${timing.median.toFixed(1)} ms`,
        ).toBeLessThan(PERF_QUERY_CEILING_MS);
      }
    }
  }, 300_000);

  it('keeps the parallel Stage 6 extended-rivalry group under the group ceiling', async () => {
    const pairs: Array<[string, number, number]> = [
      ['adelaide/brisbane-lions', adelaide, lions],
      ['carlton/collingwood', carlton, collingwood],
    ];

    for (const [name, a, b] of pairs) {
      const group = await measure(name, 'extended-rivalry parallel group', () => Promise.all([
        getHeadToHeadByDecade(a, b),
        getHeadToHeadPeriodRecords(a, b),
        getHeadToHeadPlayerAverages(a, b),
      ]));
      expect(
        group.median,
        `${name} extended-rivalry group warm median ${group.median.toFixed(1)} ms`,
      ).toBeLessThan(PERF_GROUP_CEILING_MS);
    }
  }, 300_000);

  it('keeps each independent parallel query group under the group ceiling', async () => {
    const pairs: Array<[string, number, number]> = [
      ['adelaide/brisbane-lions', adelaide, lions],
      ['carlton/collingwood', carlton, collingwood],
    ];

    for (const [name, a, b] of pairs) {
      const h2hGroup = await measure(name, 'H2H parallel group', () => Promise.all([
        getHeadToHeadSummary(a, b),
        getHeadToHeadMeetings(a, b),
        getHeadToHeadVenueRecords(a, b),
        getHeadToHeadRecords(a, b),
        getHeadToHeadStreaks(a, b),
        getCrossoverSummary(a, b),
        getCrossoverPlayers(a, b),
        getHeadToHeadPlayerLeaders(a, b),
        getHeadToHeadBrownlow(a, b),
      ]));
      expect(
        h2hGroup.median,
        `${name} H2H group warm median ${h2hGroup.median.toFixed(1)} ms`,
      ).toBeLessThan(PERF_GROUP_CEILING_MS);

      const seasonGroup = await measure(name, 'selected-season parallel group', () => Promise.all([
        getClubSeasonComparison(a, measuredSeason),
        getClubSeasonComparison(b, measuredSeason),
      ]));
      expect(
        seasonGroup.median,
        `${name} season group warm median ${seasonGroup.median.toFixed(1)} ms`,
      ).toBeLessThan(PERF_GROUP_CEILING_MS);
    }
  }, 300_000);

  it('keeps the route-equivalent composed data load under the route ceiling', async () => {
    const pairs: Array<[string, string, string]> = [
      ['adelaide/brisbane-lions', 'adelaide', 'brisbane-lions'],
      ['carlton/collingwood', 'carlton', 'collingwood'],
    ];

    for (const [name, slugA, slugB] of pairs) {
      const timing = await measure(name, 'route-equivalent composed load', async () => {
        // What a route resolves first: the two organisations and the
        // canonical season list. Everything else depends on those ids.
        const [orgA, orgB, seasons] = await Promise.all([
          getOrganizationBySlug(slugA),
          getOrganizationBySlug(slugB),
          getComparisonSeasons(),
        ]);
        expect(orgA).not.toBeNull();
        expect(orgB).not.toBeNull();
        expect(seasons.length).toBeGreaterThan(0);
        const a = orgA!.id;
        const b = orgB!.id;

        // Then every independent section concurrently, as the route will.
        await Promise.all([
          getHeadToHeadSummary(a, b),
          getHeadToHeadMeetings(a, b),
          getHeadToHeadVenueRecords(a, b),
          getHeadToHeadRecords(a, b),
          getHeadToHeadStreaks(a, b),
          getCrossoverSummary(a, b),
          getCrossoverPlayers(a, b),
          getHeadToHeadPlayerLeaders(a, b),
          getHeadToHeadBrownlow(a, b),
          getClubBrownlowHistory(a),
          getClubBrownlowHistory(b),
          getClubSeasonComparison(a, measuredSeason),
          getClubSeasonComparison(b, measuredSeason),
        ]);
      });

      expect(
        timing.median,
        `${name} route-equivalent warm median ${timing.median.toFixed(1)} ms`,
      ).toBeLessThan(PERF_ROUTE_CEILING_MS);
    }
  }, 300_000);
});
