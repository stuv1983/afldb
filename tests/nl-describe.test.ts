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

import { answerCaveats, dedupeByIdentity, describeAnswer, tiedSubject } from '../src/search/nl/describe';
import type {
  NlAfterSirenEventRow, NlAfterSirenPlayerRow,
  NlClubSeasonRow, NlCoachRecordRow, NlPlayerCareerRow, NlPlayerGameRow, NlPlayerSeasonRow,
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
  it('uses lowest wording for min-ranked answers instead of describing them as highest', () => {
    expect(describeAnswer(
      plan({ grain: 'team_match', metric: 'team_score', mode: undefined, agg: { kind: 'min' } }),
      { kind: 'team_match', lead: matchRow({ value: 0, clubScore: 0, opponentScore: 80 }), rows: [matchRow({ value: 0 })], total: 1 },
    ).interpretation).toBe('Lowest team score.');

    expect(describeAnswer(
      plan({ grain: 'player_game', metric: 'goals', agg: { kind: 'min' } }),
      { kind: 'player_game', lead: gameRow({ value: 0 }), rows: [gameRow({ value: 0 })], total: 1 },
    ).interpretation).toBe('Lowest single-game performance.');

    expect(describeAnswer(
      plan({ grain: 'club_season', metric: 'wins', mode: undefined, agg: { kind: 'min' } }),
      { kind: 'club_season', lead: clubSeasonRow({ value: 0 }), rows: [clubSeasonRow({ value: 0 })], total: 1 },
    ).interpretation).toBe('Lowest wins.');
  });

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

// ------------------------------------------- metric-threshold descriptions

describe('metric-threshold answers (AFLDB-ISSUE-110)', () => {
  it('describes a single-game threshold as a qualifying-performance count with the bound restated', () => {
    const rows = [
      gameRow({ value: 7 }),
      gameRow({ playerId: 2, playerName: 'Someone Else', value: 6, matchId: 101 }),
    ];
    const result = describeAnswer(
      plan({ agg: { kind: 'list' }, limit: 100, metricCondition: { op: 'gte', value: 6 } }),
      { kind: 'player_game', lead: rows[0], rows, total: 2 },
    );
    expect(result).toEqual({
      headline: '2 qualifying performances',
      interpretation: 'Single-game goals at least 6.',
    });
  });

  it('describes a scoped-sum threshold as players qualifying on the aggregate', () => {
    const rows = [gameRow({ value: 30, games: 10, matchId: null, matchDate: null, season: null })];
    const result = describeAnswer(
      plan({ mode: 'sum', agg: { kind: 'list' }, limit: 100, metricCondition: { op: 'gt', value: 25 } }),
      { kind: 'player_game', lead: rows[0], rows, total: 1 },
    );
    expect(result).toEqual({
      headline: '1 player qualifies',
      interpretation: 'Total goals more than 25 across the matches in scope.',
    });
  });

  it('describes a season threshold as qualifying player-seasons', () => {
    const rows = [seasonRow({ value: 8 }), seasonRow({ playerId: 2, value: 9 }), seasonRow({ playerId: 3, value: 10 })];
    const result = describeAnswer(
      plan({ grain: 'player_season', mode: undefined, agg: { kind: 'list' }, limit: 100, metricCondition: { op: 'lte', value: 10 } }),
      { kind: 'player_season', lead: rows[0], rows, total: 3 },
    );
    expect(result).toEqual({
      headline: '3 qualifying player-seasons',
      interpretation: 'Season goals at most 10.',
    });
  });
});

// -------------------------------------- coaching (AFLDB-ISSUE-152 Phase B)

function coachRow(overrides: Partial<NlCoachRecordRow> = {}): NlCoachRecordRow {
  return {
    coachId: 17, slug: 'damien-hardwick', displayName: 'Damien Hardwick',
    coachOnly: false, playerId: 900, playerSlug: 'damien-hardwick',
    firstSeason: 2010, lastSeason: 2023, seasons: 14, organizations: 1,
    games: 307, wins: 170, draws: 6, losses: 131,
    finals: 26, grandFinals: 3, premierships: 3,
    winPct: '56.35', value: null,
    ...overrides,
  };
}

const HARDWICK_REF = { id: 17, slug: 'damien-hardwick', name: 'Damien Hardwick', playerId: 900, playerSlug: 'damien-hardwick' };
const RICHMOND_REF = { organizationId: 1, slug: 'richmond', name: 'Richmond' };

function coachPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return plan({ grain: 'coach_record', metric: null, mode: undefined, agg: { kind: 'list' }, limit: 100, ...overrides });
}

describe('coaching answers', () => {
  it('a whole career and a record at one club do not produce the same sentence', () => {
    const row = coachRow();
    const career = describeAnswer(
      coachPlan({ coach: HARDWICK_REF }),
      { kind: 'coach_record', lead: row, rows: [row], total: 1 },
    );
    const atClub = describeAnswer(
      coachPlan({ coach: HARDWICK_REF, scope: { clubFor: RICHMOND_REF } }),
      { kind: 'coach_record', lead: row, rows: [row], total: 1 },
    );
    expect(career.interpretation).not.toBe(atClub.interpretation);
    expect(career.interpretation).toContain('whole coaching career, across every club');
    expect(atClub.interpretation).toContain("Damien Hardwick's record at Richmond only");
  });

  it('renders a split stint as seasons in charge, never as a continuous tenure', () => {
    // Jack Titus coached Richmond in 1937 and again in 1965.
    const row = coachRow({
      coachId: 285, slug: 'jack-titus', displayName: 'Jack Titus',
      firstSeason: 1937, lastSeason: 1965, seasons: 3, games: 17, wins: 5, draws: 0, losses: 12, winPct: '29.41',
    });
    const { interpretation } = describeAnswer(
      coachPlan({ coach: { id: 285, slug: 'jack-titus', name: 'Jack Titus', playerId: null, playerSlug: null }, scope: { clubFor: RICHMOND_REF } }),
      { kind: 'coach_record', lead: row, rows: [row], total: 1 },
    );
    expect(interpretation).toContain('3 seasons in charge, 1937\u20131965');
    expect(interpretation).not.toMatch(/coached from 1937 to 1965/);
  });

  it('names every coach tied at the lead value', () => {
    const rows = [
      coachRow({ coachId: 367, displayName: 'Max Hislop', value: 1 }),
      coachRow({ coachId: 370, displayName: 'Verdun Howell', value: 1 }),
    ];
    const { headline } = describeAnswer(
      coachPlan({ metric: 'games', agg: { kind: 'min' }, limit: 25, scope: { clubFor: RICHMOND_REF } }),
      { kind: 'coach_record', lead: rows[0], rows, total: 2 },
    );
    expect(headline).toContain('Max Hislop and Verdun Howell');
    expect(headline).toContain('(tied)');
  });

  it('states the qualifier verbatim on every win-percentage answer', () => {
    const row = coachRow({ coachId: 152, displayName: 'Cliff Rankin', coachOnly: true, playerId: null, playerSlug: null, games: 57, wins: 45, draws: 0, losses: 12, winPct: '78.95', value: 78.9473 });
    const { headline, interpretation } = describeAnswer(
      coachPlan({ metric: 'win_pct', agg: { kind: 'max' }, limit: 25, coachQualifier: { minGames: 50 } }),
      { kind: 'coach_record', lead: row, rows: [row], total: 1 },
    );
    expect(headline).toContain('78.95%');
    expect(interpretation).toContain(
      'Best coaching win percentage, minimum 50 games coached. '
      + 'Win percentage counts a draw as half a win — (wins + draws ÷ 2) ÷ games.',
    );
  });

  it('a club list is a count, and a threshold is a qualifying set', () => {
    const rows = [coachRow(), coachRow({ coachId: 5, displayName: 'Tom Hafey' })];
    const list = describeAnswer(
      coachPlan({ scope: { clubFor: RICHMOND_REF } }),
      { kind: 'coach_record', lead: rows[0], rows, total: 42 },
    );
    expect(list.headline).toBe('42 coaches');
    expect(list.interpretation).toBe('Every coach of Richmond.');

    const thresholded = describeAnswer(
      coachPlan({ metric: 'wins', metricCondition: { op: 'gte', value: 100 }, scope: { clubFor: RICHMOND_REF } }),
      { kind: 'coach_record', lead: rows[0], rows, total: 3 },
    );
    expect(thresholded.headline).toBe('3 coaches qualify');
    expect(thresholded.interpretation).toContain('with wins at least 100');
  });

  it('answers a count question with the count itself', () => {
    const { headline, interpretation } = describeAnswer(
      coachPlan({ agg: { kind: 'count' }, scope: { clubFor: RICHMOND_REF } }),
      { kind: 'count', value: 42 },
    );
    expect(headline).toBe('42 coaches');
    expect(interpretation).toBe('Every coach of Richmond.');
  });

  it('says a season scope out loud rather than answering a wider question silently', () => {
    const row = coachRow();
    const { interpretation } = describeAnswer(
      coachPlan({ scope: { clubFor: RICHMOND_REF, seasonMin: 2017, seasonMax: 2017 }, coach: HARDWICK_REF }),
      { kind: 'coach_record', lead: row, rows: [row], total: 1 },
    );
    expect(interpretation).toContain(', 2017');
  });
});

// ------------------------------- after the siren (AFLDB-ISSUE-152 Phase C)

function sirenPlanFor(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
  return plan({
    grain: 'after_siren',
    metric: 'siren_kicks',
    mode: undefined,
    agg: { kind: 'list' },
    afterSiren: { subject: 'event' },
    ...overrides,
  });
}

function sirenEvent(overrides: Partial<NlAfterSirenEventRow> = {}): NlAfterSirenEventRow {
  return {
    eventId: 121,
    season: 2025,
    roundRaw: 'round 19',
    competition: 'AFL',
    premiershipSeason: true,
    playerId: 5000,
    playerSlug: 'nasiah-wanganeen-milera',
    playerName: 'Nasiah Wanganeen-Milera',
    clubName: 'St Kilda',
    clubSlug: 'st-kilda',
    opponentName: 'Melbourne',
    opponentSlug: 'melbourne',
    kickScored: 'goal',
    kickEffect: 'won',
    kickerResult: 'win',
    siren: 'final',
    matchId: 16792,
    matchDate: new Date('2025-07-27T00:00:00Z'),
    roundType: 'home_and_away',
    cited: true,
    value: null,
    ...overrides,
  };
}

function sirenPlayer(overrides: Partial<NlAfterSirenPlayerRow> = {}): NlAfterSirenPlayerRow {
  return {
    playerId: 1001, slug: 'barry-hall', displayName: 'Barry Hall',
    value: 2, firstSeason: 2004, lastSeason: 2011, clubNames: 'Sydney, Western Bulldogs',
    ...overrides,
  };
}

const NO_EXCLUSIONS = { noPlayerLink: 0, noMatchLink: 0 };

describe('after-the-siren answers (AFLDB-ISSUE-152 Phase C)', () => {
  it('names every holder of a tied record rather than one of them', () => {
    const rows = [sirenPlayer(), sirenPlayer({ playerId: 4742, slug: 'gary-rohan', displayName: 'Gary Rohan' })];
    const { headline } = describeAnswer(
      sirenPlanFor({ agg: { kind: 'max' }, afterSiren: { subject: 'player', kickScored: 'goal' } }),
      { kind: 'after_siren_player', lead: rows[0], rows, total: 2, excluded: NO_EXCLUSIONS },
    );
    expect(headline).toContain('Barry Hall and Gary Rohan');
    expect(headline).toContain('(tied)');
    expect(headline).toContain('2');
  });

  /**
   * §15.12's binding distinction, in the reader's own words: 71 goals
   * after the siren and 62 goals after the siren TO WIN are different
   * populations, so they must not produce the same sentence.
   */
  it('"a goal after the siren" and "a goal after the siren to win" read differently', () => {
    const rows = [sirenEvent()];
    const goal = describeAnswer(
      sirenPlanFor({ afterSiren: { subject: 'event', kickScored: 'goal' } }),
      { kind: 'after_siren_event', lead: rows[0], rows, total: 71, excluded: NO_EXCLUSIONS },
    );
    const toWin = describeAnswer(
      sirenPlanFor({ afterSiren: { subject: 'event', kickScored: 'goal', kickEffect: 'won' } }),
      { kind: 'after_siren_event', lead: rows[0], rows, total: 62, excluded: NO_EXCLUSIONS },
    );
    expect(goal.interpretation).not.toBe(toWin.interpretation);
    expect(toWin.interpretation).toContain('won the match');
    expect(goal.interpretation).not.toContain('won the match');
  });

  it('a miss and a miss-and-lost read differently', () => {
    const rows = [sirenEvent({ kickScored: 'none', kickEffect: 'none', kickerResult: 'loss' })];
    const missed = describeAnswer(
      sirenPlanFor({ afterSiren: { subject: 'event', kickScored: 'none' } }),
      { kind: 'after_siren_event', lead: rows[0], rows, total: 25, excluded: NO_EXCLUSIONS },
    );
    const andLost = describeAnswer(
      sirenPlanFor({ afterSiren: { subject: 'event', kickScored: 'none', kickerResult: 'loss' } }),
      { kind: 'after_siren_event', lead: rows[0], rows, total: 18, excluded: NO_EXCLUSIONS },
    );
    expect(missed.interpretation).not.toBe(andLost.interpretation);
    expect(andLost.interpretation).toContain('lost');
  });

  it('an occurrence answer names the event, not a count', () => {
    const row = sirenEvent({
      eventId: 1, season: 1913, playerId: 2, playerSlug: 'billy-schmidt', playerName: 'Billy Schmidt',
      clubName: 'St Kilda', opponentName: 'Carlton', matchId: 1313,
      matchDate: new Date('1913-08-02T00:00:00Z'),
    });
    const { headline } = describeAnswer(
      sirenPlanFor({ afterSiren: { subject: 'event', occurrence: 'first' } }),
      { kind: 'after_siren_event', lead: row, rows: [row], total: 1, excluded: NO_EXCLUSIONS },
    );
    expect(headline).toContain('Billy Schmidt');
    expect(headline).toContain('1913');
  });

  it('an event count is worded as kicks, never as coaches', () => {
    const { headline } = describeAnswer(
      sirenPlanFor({ agg: { kind: 'count' }, afterSiren: { subject: 'event', kickScored: 'goal' } }),
      { kind: 'count', value: 71 },
    );
    expect(headline).toContain('71');
    expect(headline).not.toContain('coach');
  });

  it('an empty result is honest, not a decline', () => {
    const { headline } = describeAnswer(
      sirenPlanFor({ scope: { matchType: 'grand_final' } }),
      { kind: 'after_siren_event', lead: null, rows: [], total: 0, excluded: NO_EXCLUSIONS },
    );
    expect(headline.toLowerCase()).toContain('no');
  });

  it('always carries the curated-list caveat (D12)', () => {
    const rows = [sirenEvent()];
    const caveats = answerCaveats(
      sirenPlanFor(),
      { kind: 'after_siren_event', lead: rows[0], rows, total: 126, excluded: NO_EXCLUSIONS },
    );
    expect(caveats.join(' ')).toContain('curated');
    expect(caveats.join(' ')).toContain('not a systematic record');
  });

  it('names the excluded unlinked rows, and only when there are any', () => {
    const rows = [sirenPlayer()];
    const withExclusions = answerCaveats(
      sirenPlanFor({ agg: { kind: 'max' }, afterSiren: { subject: 'player' } }),
      { kind: 'after_siren_player', lead: rows[0], rows, total: 1, excluded: { noPlayerLink: 6, noMatchLink: 0 } },
    );
    expect(withExclusions.join(' ')).toContain('6');
    expect(withExclusions.join(' ')).toContain('not linked to a player');

    const none = answerCaveats(
      sirenPlanFor({ agg: { kind: 'max' }, afterSiren: { subject: 'player' } }),
      { kind: 'after_siren_player', lead: rows[0], rows, total: 1, excluded: NO_EXCLUSIONS },
    );
    expect(none.join(' ')).not.toContain('not linked to a player');
  });

  it('says what a match-link-required answer left out', () => {
    const rows = [sirenEvent()];
    const caveats = answerCaveats(
      sirenPlanFor({ afterSiren: { subject: 'event', occurrence: 'most_recent' } }),
      { kind: 'after_siren_event', lead: rows[0], rows, total: 1, excluded: { noPlayerLink: 0, noMatchLink: 10 } },
    );
    expect(caveats.join(' ')).toContain('10');
    expect(caveats.join(' ')).toContain('no match link');
  });

  it('carries no after-siren caveat on any other grain', () => {
    expect(answerCaveats(plan(), { kind: 'count', value: 1 })).toEqual([]);
  });
});

/**
 * AFLDB-ISSUE-152 Phase E, decision E-D1. "did Dustin Martin kick a goal
 * with his first kick" is a yes/no question about ONE player, and the
 * no-metric branch answered it with "1 player matches" / "0 players
 * match". The wording is gated narrowly -- a pinned player, conditions,
 * and no ranking metric -- so every unpinned list keeps the count.
 */
describe('a pinned player answering a condition question (AFLDB-ISSUE-152 Phase E)', () => {
  const martin = { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' };
  const firstKick = { builder: 'first_kick_goal_player', params: {} };

  function pinned(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
    return plan({
      grain: 'player_career', metric: null, mode: undefined, agg: { kind: 'list' },
      player: martin, careerPredicates: [firstKick], ...overrides,
    });
  }

  it('answers yes, and names the condition it answered', () => {
    const rows = [careerRow({ playerId: 100, displayName: 'Dustin Martin', value: null })];
    const { headline, interpretation } = describeAnswer(
      pinned(), { kind: 'player_career', lead: rows[0], rows, total: 1 },
    );
    expect(headline).toBe('Dustin Martin — yes');
    expect(interpretation).toContain('Goal with their first VFL/AFL kick');
  });

  it('answers no on an empty result rather than "0 players match"', () => {
    const { headline, interpretation } = describeAnswer(
      pinned(), { kind: 'player_career', lead: null, rows: [], total: 0 },
    );
    expect(headline).toBe('Dustin Martin — no');
    expect(interpretation).toContain('does not meet');
  });

  it('names both conditions when the question composed them', () => {
    const { interpretation } = describeAnswer(
      pinned({
        careerPredicates: [firstKick, { builder: 'first_kick_goal_consecutive_min', params: { kicks: '3' } }],
      }),
      { kind: 'player_career', lead: null, rows: [], total: 0 },
    );
    expect(interpretation).toContain('Goal with each of their first X kicks');
  });

  // §17.6: the NL answer is a SUBSET of /records/first-kick-goal, which
  // lists unlinked rows too. Said once, in the answer, rather than left
  // for the reader to discover.
  it('states the curated, linked-only boundary on this family only', () => {
    const curated = describeAnswer(
      pinned(), { kind: 'player_career', lead: null, rows: [], total: 0 },
    ).interpretation;
    expect(curated).toContain('curated');
    expect(curated).toContain('not counted');

    const other = describeAnswer(
      pinned({ careerPredicates: [{ builder: 'match_event_min', params: { event: 'Anzac Day', times: '1' } }] }),
      { kind: 'player_career', lead: null, rows: [], total: 0 },
    ).interpretation;
    expect(other).not.toContain('curated');
  });

  it('leaves an unpinned list on the count wording it has always had', () => {
    const rows = [careerRow({ value: null })];
    expect(describeAnswer(
      pinned({ player: undefined }), { kind: 'player_career', lead: rows[0], rows, total: 320 },
    ).headline).toBe('320 players match');
  });

  it('leaves a ranked answer for one player alone', () => {
    // The gate requires no metric: a pinned player WITH a ranking metric
    // is still "Dustin Martin — 4 goals", not a yes/no.
    const rows = [careerRow({ playerId: 100, displayName: 'Dustin Martin', value: 4 })];
    expect(describeAnswer(
      pinned({ metric: 'goals' }), { kind: 'player_career', lead: rows[0], rows, total: 1 },
    ).headline).toBe('Dustin Martin — 4 goals');
  });
});

/**
 * AFLDB-ISSUE-152 Phase D wording. The rule this block exists to hold:
 * a relationship answer NAMES the relationship. "Players meeting every
 * condition asked for" is true of every career list ever returned and
 * tells the reader nothing about which relationship they were shown, so
 * no Phase D answer may use it.
 */
describe('family-relationship answers (AFLDB-ISSUE-152 Phase D)', () => {
  const harvey = { id: 2164, slug: 'brent-harvey', name: 'Brent Harvey' };

  function relationshipPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
    return plan({
      grain: 'player_career', metric: null, mode: undefined, agg: { kind: 'list' },
      careerPredicates: [{ builder: 'has_brother', params: {} }],
      ...overrides,
    });
  }

  const rows = [careerRow({ value: null })];
  const listPayload = { kind: 'player_career' as const, lead: rows[0], rows, total: 658 };

  it.each([
    ['has_brother', 'a brother who played VFL/AFL'],
    ['has_afl_father', 'a father who played VFL/AFL'],
    ['has_afl_son', 'a son who played VFL/AFL'],
    ['has_afl_parent_or_child', 'a parent or child who played VFL/AFL'],
  ])('%s says which relationship it answered', (builder, phrase) => {
    const { headline, interpretation } = describeAnswer(
      relationshipPlan({ careerPredicates: [{ builder, params: {} }] }), listPayload,
    );
    expect(headline).toBe('658 players match');
    expect(interpretation).toBe(`Players with ${phrase}.`);
    expect(interpretation).not.toContain('every condition');
  });

  it('the father-son father wording names the RULE, not a parent-child link', () => {
    const { interpretation } = describeAnswer(
      relationshipPlan({ careerPredicates: [{ builder: 'father_son_father', params: {} }] }), listPayload,
    );
    expect(interpretation).toBe('Players whose son was selected under the father–son rule.');
  });

  it('a per-player answer names the person it is about', () => {
    const { interpretation } = describeAnswer(
      relationshipPlan({
        careerPredicates: [{ builder: 'brother_of_player', params: { player: '2164' } }],
        relationshipSubject: harvey,
      }),
      { kind: 'player_career', lead: rows[0], rows, total: 1 },
    );
    expect(interpretation).toBe('Brothers of Brent Harvey.');
  });

  it('a ranked relationship answer says what it ranked WITHIN', () => {
    const ranked = [careerRow({ displayName: 'Michael Tuck', value: 426, games: 426 })];
    const { headline, interpretation } = describeAnswer(
      relationshipPlan({ metric: 'games', agg: { kind: 'max' } }),
      { kind: 'player_career', lead: ranked[0], rows: ranked, total: 1 },
    );
    expect(headline).toBe('Michael Tuck — 426 games');
    expect(interpretation).toBe('Highest career games among players with a brother who played VFL/AFL.');
  });

  it('a pinned player answers yes/no in the relationship’s own words', () => {
    const pinnedPlan = relationshipPlan({ player: { id: 100, slug: 'dustin-martin', name: 'Dustin Martin' } });
    expect(describeAnswer(pinnedPlan, { kind: 'player_career', lead: null, rows: [], total: 0 }))
      .toEqual({
        headline: 'Dustin Martin — no',
        interpretation: 'Dustin Martin has no recorded brother who played VFL/AFL.',
      });
    const hit = [careerRow({ playerId: 100, displayName: 'Dustin Martin', value: null })];
    expect(describeAnswer(pinnedPlan, { kind: 'player_career', lead: hit[0], rows: hit, total: 1 }).interpretation)
      .toBe('Dustin Martin has a brother who played VFL/AFL.');
  });

  // --------------------------------------------------------- the caveats

  it('always states the linked-only boundary', () => {
    const caveats = answerCaveats(relationshipPlan(), listPayload);
    expect(caveats[0]).toContain('tracked, cited list');
    expect(caveats[0]).toContain('name only');
  });

  it('says out loud that an over-cap list is not the whole list', () => {
    const capped = { kind: 'player_career' as const, lead: rows[0], rows, total: 658 };
    const caveats = answerCaveats(relationshipPlan(), capped);
    expect(caveats.some((c) => c.includes('658 players qualify'))).toBe(true);
    expect(caveats.some((c) => c.includes('it is not the whole list'))).toBe(true);
  });

  /**
   * Operator decision D20, ACCEPTED 2026-09-09: an over-cap relationship
   * list uses AFLDB's existing capped-list disclosure contract -- true
   * total, capped table, explicit disclosure -- and never a Phase-D-only
   * refusal. Silent truncation is the thing prohibited, and these three
   * assertions are what "not silent" means in code.
   */
  it('D20: the headline is the TRUE total, not the number of rows shown', () => {
    const capped = { kind: 'player_career' as const, lead: rows[0], rows, total: 658 };
    expect(rows).toHaveLength(1);
    // 658 qualified, 1 row is carried in this payload: the headline reports
    // the qualifying set, so the count is never the page size.
    expect(describeAnswer(relationshipPlan(), capped).headline).toBe('658 players match');
  });

  it('D20: the disclosure names BOTH numbers, so the shortfall is visible', () => {
    const capped = { kind: 'player_career' as const, lead: rows[0], rows, total: 658 };
    const disclosure = answerCaveats(relationshipPlan(), capped).find((c) => c.includes('qualify'));
    expect(disclosure).toBeDefined();
    expect(disclosure).toContain('658 players qualify');
    expect(disclosure).toContain(`the first ${rows.length}`);
    expect(disclosure).toContain('it is not the whole list');
  });

  it.each([658, 181, 107])(
    'D20: %i answers with disclosure rather than refusing',
    (total) => {
      // The three measured over-cap populations (C2 658, C3 181, FS4 107).
      // None of them declines: a refusal here would make this one family
      // behave unlike every other capped list in the engine.
      const capped = { kind: 'player_career' as const, lead: rows[0], rows, total };
      const described = describeAnswer(relationshipPlan(), capped);
      expect(described.headline).toBe(`${total.toLocaleString('en-AU')} players match`);
      expect(described.interpretation).toBe('Players with a brother who played VFL/AFL.');
      expect(answerCaveats(relationshipPlan(), capped).some((c) => c.includes(`${total.toLocaleString('en-AU')} players qualify`)))
        .toBe(true);
    },
  );

  it('says nothing about a cap when nothing was capped', () => {
    const whole = { kind: 'player_career' as const, lead: rows[0], rows, total: 1 };
    expect(answerCaveats(relationshipPlan(), whole).some((c) => c.includes('qualify'))).toBe(false);
  });

  it('leaves every other family’s wording untouched', () => {
    const other = plan({
      grain: 'player_career', metric: null, mode: undefined, agg: { kind: 'list' },
      careerPredicates: [{ builder: 'match_event_min', params: { event: 'Anzac Day', times: '1' } }],
    });
    expect(describeAnswer(other, listPayload).interpretation)
      .toBe('Players meeting every condition asked for.');
    expect(answerCaveats(other, listPayload)).toEqual([]);
  });
});

/**
 * AFLDB-ISSUE-152 Phase F wording. Two rules this block exists to hold.
 *
 * The answer says "also", never "later": AFLDB does not own the order of
 * a person's playing and coaching careers, and a sentence that implied it
 * would claim a fact the SQL never checked (D9/F-D2).
 *
 * And the answer states its own cap out loud. 365 people both played and
 * coached; the list shows 100. A footer under a table is not the answer
 * saying so (D20).
 */
describe('played-and-coached answers (AFLDB-ISSUE-152 Phase F)', () => {
  const RICHMOND = { organizationId: 18, slug: 'richmond', name: 'Richmond' };
  const COLLINGWOOD = { organizationId: 4, slug: 'collingwood', name: 'Collingwood' };

  function crossDomainPlan(overrides: Partial<NlQueryPlan> = {}): NlQueryPlan {
    return plan({
      grain: 'player_career', metric: null, mode: undefined, agg: { kind: 'list' },
      careerPredicates: [{ builder: 'has_coached', params: {} }],
      ...overrides,
    });
  }

  const rows = [careerRow({ value: null })];
  const listPayload = { kind: 'player_career' as const, lead: rows[0], rows, total: 365 };

  it('X1 says what the composition was', () => {
    const { headline, interpretation } = describeAnswer(crossDomainPlan(), listPayload);
    expect(headline).toBe('365 players match');
    expect(interpretation).toBe('Players who played VFL/AFL and also coached.');
    expect(interpretation).not.toContain('every condition');
  });

  it('X2 names both clubs, each on its own side of the sentence', () => {
    const { interpretation } = describeAnswer(crossDomainPlan({
      careerPredicates: [
        { builder: 'played_for_club', params: { club: '18' } },
        { builder: 'coached_club', params: { club: '18' } },
      ],
      crossDomainClubs: { played: RICHMOND, coached: RICHMOND },
    }), { kind: 'player_career', lead: rows[0], rows, total: 27 });
    expect(interpretation).toBe('Players who played for Richmond and also coached Richmond.');
  });

  it('the asymmetric form keeps the two clubs apart', () => {
    const { interpretation } = describeAnswer(crossDomainPlan({
      careerPredicates: [
        { builder: 'played_for_club', params: { club: '18' } },
        { builder: 'coached_club', params: { club: '4' } },
      ],
      crossDomainClubs: { played: RICHMOND, coached: COLLINGWOOD },
    }), { kind: 'player_career', lead: rows[0], rows, total: 3 });
    expect(interpretation).toBe('Players who played for Richmond and also coached Collingwood.');
  });

  it('a ranked composition says what it ranked WITHIN', () => {
    const ranked = [careerRow({ displayName: 'Michael Tuck', value: 426, games: 426 })];
    const { headline, interpretation } = describeAnswer(
      crossDomainPlan({ metric: 'games', agg: { kind: 'max' } }),
      { kind: 'player_career', lead: ranked[0], rows: ranked, total: 1 },
    );
    expect(headline).toBe('Michael Tuck — 426 games');
    expect(interpretation).toBe('Highest career games among players who played VFL/AFL and also coached.');
  });

  it('never says "later", in any branch', () => {
    const sentences = [
      describeAnswer(crossDomainPlan(), listPayload),
      describeAnswer(crossDomainPlan({
        careerPredicates: [
          { builder: 'played_for_club', params: { club: '18' } },
          { builder: 'coached_club', params: { club: '4' } },
        ],
        crossDomainClubs: { played: RICHMOND, coached: COLLINGWOOD },
      }), listPayload),
      describeAnswer(crossDomainPlan({ metric: 'games', agg: { kind: 'max' } }), listPayload),
    ];
    for (const { headline, interpretation } of sentences) {
      expect(`${headline} ${interpretation}`.toLowerCase()).not.toContain('later');
    }
    expect(answerCaveats(crossDomainPlan(), listPayload).join(' ').toLowerCase()).not.toContain('later');
  });

  // --------------------------------------------------------- D20, reused

  it('states the cap in the answer itself: 100 of 365', () => {
    const hundred = Array.from({ length: 100 }, () => careerRow({ value: null }));
    const caveats = answerCaveats(crossDomainPlan(), {
      kind: 'player_career', lead: hundred[0], rows: hundred, total: 365,
    });
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toContain('365 players qualify');
    expect(caveats[0]).toContain('first 100 of them');
  });

  it('says nothing when the whole list is shown', () => {
    const twentySeven = Array.from({ length: 27 }, () => careerRow({ value: null }));
    expect(answerCaveats(crossDomainPlan({
      careerPredicates: [
        { builder: 'played_for_club', params: { club: '18' } },
        { builder: 'coached_club', params: { club: '18' } },
      ],
      crossDomainClubs: { played: RICHMOND, coached: RICHMOND },
    }), { kind: 'player_career', lead: twentySeven[0], rows: twentySeven, total: 27 })).toEqual([]);
  });

  it('invents no coaching-completeness claim in either direction', () => {
    const caveats = answerCaveats(crossDomainPlan(), listPayload).join(' ');
    expect(caveats).not.toContain('complete');
    expect(caveats).not.toContain('curated');
  });
});
