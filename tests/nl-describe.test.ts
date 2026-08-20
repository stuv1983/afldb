/**
 * Headline wording, above all tie handling.
 *
 * Every grain's SQL already returns every row tied at the lead rank
 * (rank() with no PARTITION BY, WHERE rnk <= rankCutoff), so a shared
 * record was always IN the payload -- the headline just named the first
 * row and silently dropped the rest. "most goals in a grand final" read
 * as "Gordon Coventry — 9 goals" with Gary Ablett Snr visible only if
 * the reader expanded the table underneath. For a record that is
 * genuinely shared, naming one holder is not a shorter truth, it is a
 * wrong one.
 *
 * Database-free: src/search/nl/describe.ts takes a payload and returns
 * two strings, which is exactly what makes these rules testable without
 * a query behind them.
 */
import { describe, expect, it } from 'vitest';

import { dedupeByIdentity, describeAnswer, tiedSubject } from '../src/search/nl/describe';
import type {
  NlClubSeasonRow, NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow,
  NlTeamAggregateRow, NlTeamMatchRow, NlTeamStreakRow,
} from '../src/search/nl/answer-types';
import type { NlQueryPlan } from '../src/search/nl/plan';

// ------------------------------------------------------------------ helpers

function plan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return {
    v: 1,
    grain: 'player_game',
    metric: 'goals',
    mode: 'single',
    agg: { kind: 'max' },
    scope: {},
    careerConditions: [],
    careerPredicates: [],
    clubSeasonConditions: [],
    tiePolicy: 'all',
    limit: 25,
    ...overrides,
  };
}

function gameRow(overrides: Partial<NlPlayerGameRow> = {}): NlPlayerGameRow {
  return {
    playerId: 1, playerSlug: 'gordon-coventry', playerName: 'Gordon Coventry',
    value: 9,
    matchId: 100, season: 1928, roundType: 'grand_final', roundNumber: null,
    matchDate: new Date('1928-09-29'),
    clubName: 'Collingwood', opponentName: 'Richmond', venueName: 'Melbourne Cricket Ground',
    homeScore: 0, awayScore: 0, games: null,
    ...overrides,
  };
}

function careerRow(overrides: Partial<NlPlayerCareerRow> = {}): NlPlayerCareerRow {
  return {
    playerId: 1, slug: 'a-player', displayName: 'A Player',
    value: 100, games: 200, debutSeason: 1990, finalSeason: 2005, clubNames: 'Carlton',
    ...overrides,
  };
}

function seasonRow(overrides: Partial<NlPlayerSeasonRow> = {}): NlPlayerSeasonRow {
  return {
    playerId: 1, slug: 'a-player', displayName: 'A Player',
    value: 50, season: 2017, games: 22, clubName: 'Richmond', clubSlug: 'richmond',
    ...overrides,
  };
}

function matchRow(overrides: Partial<NlTeamMatchRow> = {}): NlTeamMatchRow {
  return {
    matchId: 1, season: 1979, roundType: 'home_and_away', roundNumber: 5,
    matchDate: new Date('1979-05-01'),
    clubName: 'Richmond', clubSlug: 'richmond', opponentName: 'Carlton', opponentSlug: 'carlton',
    value: 115, clubScore: 200, opponentScore: 85, venueName: 'Melbourne Cricket Ground',
    ...overrides,
  };
}

function clubSeasonRow(overrides: Partial<NlClubSeasonRow> = {}): NlClubSeasonRow {
  return {
    clubId: 1, clubSlug: 'carlton', clubName: 'Carlton',
    season: 1995, played: 22, wins: 20, draws: 0, losses: 2, ladderRank: 1, value: 20,
    ...overrides,
  };
}

// -------------------------------------------------------------- tiedSubject

describe('tiedSubject', () => {
  it('names a sole holder without calling it a tie', () => {
    expect(tiedSubject(['Gordon Coventry'])).toEqual({ subject: 'Gordon Coventry', tied: false });
  });

  it('names both holders of a two-way tie in full', () => {
    // The case from the reported bug. Two names is short enough to print
    // outright, and printing them is the whole point.
    expect(tiedSubject(['Gordon Coventry', 'Gary Ablett Snr'])).toEqual({
      subject: 'Gordon Coventry and Gary Ablett Snr', tied: true,
    });
  });

  it('summarises a tie too wide to name in a headline', () => {
    expect(tiedSubject(['A', 'B', 'C'])).toEqual({ subject: 'A and 2 others', tied: true });
    expect(tiedSubject(['A', 'B', 'C', 'D'])).toEqual({ subject: 'A and 3 others', tied: true });
  });

  it('does not produce a dangling subject when there are no rows', () => {
    expect(tiedSubject([])).toEqual({ subject: '', tied: false });
  });
});

// --------------------------------------------------------- dedupeByIdentity

describe('dedupeByIdentity', () => {
  const id = (r: { playerId: number }) => r.playerId;
  const name = (r: { playerName: string }) => r.playerName;

  it('keeps only rows at the lead value', () => {
    const rows = [gameRow({ value: 9 }), gameRow({ playerId: 2, playerName: 'Other', value: 8 })];
    expect(dedupeByIdentity(rows, 9, id, name)).toEqual(['Gordon Coventry']);
  });

  it('counts one holder once even when they hold the record twice', () => {
    // A player who kicked the record total in two different matches is one
    // record holder, not a two-way tie with himself.
    const rows = [
      gameRow({ matchId: 100, value: 9 }),
      gameRow({ matchId: 101, value: 9 }),
    ];
    expect(dedupeByIdentity(rows, 9, id, name)).toEqual(['Gordon Coventry']);
  });

  it('preserves the order the query ranked them in', () => {
    const rows = [
      gameRow({ playerId: 1, playerName: 'First' }),
      gameRow({ playerId: 2, playerName: 'Second' }),
    ];
    expect(dedupeByIdentity(rows, 9, id, name)).toEqual(['First', 'Second']);
  });

  it('treats a null lead value as matching only null rows', () => {
    const rows = [careerRow({ value: null }), careerRow({ playerId: 2, value: 5 })];
    expect(dedupeByIdentity(rows, null, (r) => r.playerId, (r) => r.displayName))
      .toEqual(['A Player']);
  });
});

// ------------------------------------------------------------- player_game

describe('describeAnswer — player_game', () => {
  it('names both holders of a shared single-game record', () => {
    const rows = [
      gameRow(),
      gameRow({ playerId: 2, playerSlug: 'gary-ablett-snr', playerName: 'Gary Ablett Snr', matchId: 200, season: 1989 }),
    ];
    const { headline } = describeAnswer(
      plan({ scope: { matchType: 'grand_final' } }),
      { kind: 'player_game', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toBe('Gordon Coventry and Gary Ablett Snr — 9 goals (tied)');
  });

  it('leaves an outright record unmarked', () => {
    const rows = [gameRow(), gameRow({ playerId: 2, playerName: 'Runner Up', value: 8 })];
    const { headline } = describeAnswer(plan(), { kind: 'player_game', lead: rows[0], rows, total: 2 });
    expect(headline).toBe('Gordon Coventry — 9 goals');
    expect(headline).not.toContain('tied');
  });

  it('keeps the sum-mode interpretation while still marking a tie', () => {
    const rows = [
      gameRow({ value: 24, games: 12 }),
      gameRow({ playerId: 2, playerName: 'Other Player', value: 24, games: 12 }),
    ];
    const { headline, interpretation } = describeAnswer(
      plan({ mode: 'sum' }),
      { kind: 'player_game', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toBe('Gordon Coventry and Other Player — 24 goals (tied)');
    expect(interpretation).toBe('Total across 12 games in scope.');
  });

  it('still reports no match found when there is no lead', () => {
    const { headline } = describeAnswer(plan(), { kind: 'player_game', lead: null, rows: [], total: 0 });
    expect(headline).toBe('No matching performance found');
  });
});

// ----------------------------------------------------------- other grains

describe('describeAnswer — ties across the remaining grains', () => {
  it('marks a shared career record', () => {
    const rows = [
      careerRow({ playerId: 1, displayName: 'Tony Lockett', value: 97 }),
      careerRow({ playerId: 2, displayName: 'Doug Wade', value: 97 }),
    ];
    const { headline } = describeAnswer(
      plan({ grain: 'player_career', mode: undefined }),
      { kind: 'player_career', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toBe('Tony Lockett and Doug Wade — 97 goals (tied)');
  });

  it('marks a shared player-season record without mangling the season suffix', () => {
    const rows = [
      seasonRow({ playerId: 1, displayName: 'One', value: 50 }),
      seasonRow({ playerId: 2, displayName: 'Two', value: 50 }),
    ];
    const { headline } = describeAnswer(
      plan({ grain: 'player_season', mode: undefined }),
      { kind: 'player_season', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toBe('One and Two — 50 goals (2017), tied');
  });

  it('marks two different matches tied on the same margin', () => {
    const rows = [
      matchRow({ matchId: 1, season: 1979 }),
      matchRow({ matchId: 2, season: 1982 }),
    ];
    const { headline } = describeAnswer(
      plan({ grain: 'team_match', metric: 'margin', mode: undefined }),
      { kind: 'team_match', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toBe('Richmond vs Carlton (1979) and Richmond vs Carlton (1982) — 115 margin (tied)');
  });

  it('marks a shared club-season record', () => {
    const rows = [
      clubSeasonRow({ clubId: 1, clubName: 'Carlton', season: 1995, value: 20 }),
      clubSeasonRow({ clubId: 2, clubName: 'Essendon', season: 2000, value: 20 }),
    ];
    const { headline } = describeAnswer(
      plan({ grain: 'club_season', metric: 'wins', mode: undefined }),
      { kind: 'club_season', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toBe('Carlton (1995) and Essendon (2000) — 20 wins (tied)');
  });

  it('leaves the condition-list headline alone, which has no lead to tie', () => {
    // "players with 300 games and no premiership" is a list, not a record;
    // there is no single value for anything to be tied at.
    const rows = [careerRow({ value: null })];
    const { headline } = describeAnswer(
      plan({ grain: 'player_career', metric: null, mode: undefined, agg: { kind: 'list' } }),
      { kind: 'player_career', lead: rows[0], rows, total: 320 },
    );
    expect(headline).toBe('320 players match');
  });
});

describe('describeAnswer - team grouped and streak grains', () => {
  it('describes a HAVING result as grouped clubs, never as Highest with a blank metric', () => {
    const rows: NlTeamAggregateRow[] = [
      { organizationId: 1, clubName: 'Carlton', clubSlug: 'carlton', value: 12 },
      { organizationId: 2, clubName: 'Richmond', clubSlug: 'richmond', value: 8 },
    ];
    const result = describeAnswer(
      plan({
        grain: 'team_match', metric: null, mode: undefined, agg: { kind: 'list' },
        havingClause: { metric: 'wins', op: 'gt', value: 3 },
      }),
      { kind: 'team_aggregate', rows, total: 2 },
    );
    expect(result.headline).toBe('2 clubs qualify');
    expect(result.interpretation).toBe('Clubs with more than 3 wins.');
    expect(`${result.headline} ${result.interpretation}`).not.toMatch(/Highest\s*\./);
  });

  it('names the real streak grain and tied club organizations', () => {
    const rows: NlTeamStreakRow[] = [
      { clubId: 1, clubName: 'Sydney', clubSlug: 'sydney', streakLength: 12, startDate: null, endDate: null },
      { clubId: 2, clubName: 'Richmond', clubSlug: 'richmond', streakLength: 12, startDate: null, endDate: null },
    ];
    const result = describeAnswer(
      plan({
        grain: 'team_streak', metric: null, mode: undefined,
        streakDefinition: { kind: 'win' },
      }),
      { kind: 'team_streak', lead: rows[0], rows, total: 2 },
    );
    expect(result.headline).toContain('Sydney and Richmond');
    expect(result.headline).toContain('12-match win streak (tied)');
    expect(result.interpretation).toBe('Longest win streak.');
  });

  it('rejects a payload whose kind cannot represent the plan grain', () => {
    expect(() => describeAnswer(
      plan({ grain: 'team_match', metric: 'team_score', mode: undefined }),
      { kind: 'player_game', lead: null, rows: [], total: 0 },
    )).toThrow(/incompatible/);
  });
});

// ----------------------------------------------- achievement_summary

describe('describeAnswer — achievement summary distributions', () => {
  const summaryPlan = plan({ grain: 'achievement_summary', metric: null, mode: undefined, agg: { kind: 'list' } });

  it('a by-decade headline names the decade with the most, not the earliest row', () => {
    // by_decade rows arrive in CHRONOLOGICAL order, unlike by_club and
    // by_season (count-descending) -- the leader must be found by value.
    const rows = [
      { label: '1890s', value: 3, href: null },
      { label: '1920s', value: 41, href: null },
      { label: '2020s', value: 12, href: null },
    ];
    const { headline } = describeAnswer(
      summaryPlan,
      { kind: 'achievement_summary', groupBy: 'decade', achievementLabel: 'Scored a goal with their first kick', rows, total: 56 },
    );
    expect(headline).toBe('1920s — 41');
  });

  it('a tied by-decade lead names every decade sharing the true maximum', () => {
    const rows = [
      { label: '1890s', value: 3, href: null },
      { label: '1920s', value: 41, href: null },
      { label: '1960s', value: 41, href: null },
    ];
    const { headline } = describeAnswer(
      summaryPlan,
      { kind: 'achievement_summary', groupBy: 'decade', achievementLabel: 'Scored a goal with their first kick', rows, total: 85 },
    );
    expect(headline).toBe('1920s, 1960s — 41 each (tied)');
  });
});
