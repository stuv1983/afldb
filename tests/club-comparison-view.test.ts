import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ClubComparisonView } from '@/components/ClubComparisonView';
import type {
  ClubComparisonData,
  ClubComparisonRouteState,
  ComparisonEffectiveParams,
  ComparisonOptions,
} from '@/app/clubs/compare/state';
import type {
  ClubBrownlowHistory,
  ComparisonOrganization,
  CrossoverPlayer,
  H2HMeeting,
  H2HPeriodRecordEntry,
  H2HPeriodRecordKind,
  H2HRecordEntry,
  H2HRecordKind,
  H2HRecords,
  MatchType,
} from '@/db/queries/club-comparison';
import {
  canonicalClubComparePath,
  clubComparePath,
  swapClubComparePath,
} from '@/lib/club-comparison-url';

/**
 * Presentation tests for /clubs/compare (AFLDB-ISSUE-144 Stage 8).
 *
 * Deliberately database-free: the route's own state resolution is proved
 * against real canonical rows by `tests/integration/club-comparison-route.test.ts`,
 * and the statistical contracts by `tests/integration/club-comparison.test.ts`.
 * What is left to prove — and what these tests exist for — is that the
 * view renders every route state, and that it never turns an honest
 * "not recorded", "pending" or "partial" from the query layer into a
 * number, a zero, or silence.
 *
 * The fixtures are hand-built route states, so a test can assert a state
 * the test database does not currently happen to contain (unequal metric
 * coverage, a tied record). The comparison is all-time only (Club Rivalry
 * Explorer follow-up, FR-1) — there is no per-season club record here.
 */

const ADELAIDE: ComparisonOrganization = {
  id: 1, name: 'Adelaide', slug: 'adelaide',
  firstSeason: 1991, lastSeason: 2026, isActive: true,
};
const BRISBANE: ComparisonOrganization = {
  id: 2, name: 'Brisbane Lions', slug: 'brisbane-lions',
  firstSeason: 1987, lastSeason: 2026, isActive: true,
};
const FITZROY: ComparisonOrganization = {
  id: 3, name: 'Fitzroy', slug: 'fitzroy',
  firstSeason: 1897, lastSeason: 1996, isActive: false,
};

const OPTIONS: ComparisonOptions = {
  organizations: [ADELAIDE, BRISBANE, FITZROY],
};

function params(overrides: Partial<ComparisonEffectiveParams> = {}): ComparisonEffectiveParams {
  return {
    club1: 'adelaide',
    club2: 'brisbane-lions',
    matchType: 'all' as MatchType,
    era: null,
    page: 1,
    ...overrides,
  };
}

function meeting(overrides: Partial<H2HMeeting> = {}): H2HMeeting {
  return {
    matchId: 14132,
    season: 2019,
    matchDate: new Date(Date.UTC(2019, 4, 18)),
    roundCode: null,
    roundNumber: 9,
    roundType: 'home_and_away',
    isFinalsSeries: false,
    isGrandFinal: false,
    venueId: 7,
    venueName: 'Adelaide Oval',
    homeClubId: 1,
    homeClubName: 'Adelaide',
    homeClubSlug: 'adelaide',
    homeScore: 90,
    awayClubId: 2,
    awayClubName: 'Brisbane Lions',
    awayClubSlug: 'brisbane-lions',
    awayScore: 100,
    aScore: 90,
    bScore: 100,
    margin: 10,
    attendance: 41000,
    outcome: 'b-win',
    ...overrides,
  };
}

function emptyRecords(): H2HRecords {
  const kinds: H2HRecordKind[] = [
    'biggest-win-a', 'biggest-win-b', 'closest-game',
    'highest-score-a', 'highest-score-b', 'lowest-score-a', 'lowest-score-b',
    'highest-combined-score',
  ];
  return Object.fromEntries(kinds.map((k) => [k, [] as H2HRecordEntry[]])) as H2HRecords;
}

function emptyPeriodRecords(): Record<H2HPeriodRecordKind, H2HPeriodRecordEntry[]> {
  const kinds: H2HPeriodRecordKind[] = [
    'biggest-quarter-time-lead-a', 'biggest-quarter-time-lead-b',
    'biggest-half-time-lead-a', 'biggest-half-time-lead-b',
    'biggest-three-quarter-time-lead-a', 'biggest-three-quarter-time-lead-b',
    'biggest-comeback-from-quarter-time-a', 'biggest-comeback-from-quarter-time-b',
    'biggest-comeback-from-half-time-a', 'biggest-comeback-from-half-time-b',
    'biggest-comeback-from-three-quarter-time-a', 'biggest-comeback-from-three-quarter-time-b',
    'largest-turnaround-a', 'largest-turnaround-b',
  ];
  return Object.fromEntries(kinds.map((k) => [k, [] as H2HPeriodRecordEntry[]])) as Record<
    H2HPeriodRecordKind, H2HPeriodRecordEntry[]
  >;
}

function periodEntry(overrides: Partial<H2HPeriodRecordEntry> = {}): H2HPeriodRecordEntry {
  return {
    ...meeting(),
    value: 41,
    segment: null,
    aQuarterTime: 45,
    aHalfTime: 60,
    aThreeQuarterTime: 75,
    bQuarterTime: 4,
    bHalfTime: 30,
    bThreeQuarterTime: 70,
    ...overrides,
  };
}

function emptyBrownlowHistory(organizationId: number): ClubBrownlowHistory {
  return {
    organizationId,
    seasons: [],
    totalVotes: 0,
    seasonsCovered: 0,
    winners: [],
    voteLeaders: [],
    unattributed: { rows: 0, votes: 0 },
    excludedSeasons: [],
  };
}

function crossover(overrides: Partial<CrossoverPlayer> = {}): CrossoverPlayer {
  return {
    playerId: 900,
    displayName: 'Charlie Cameron',
    sortName: 'Cameron, Charlie',
    slug: 'charlie-cameron',
    a: {
      games: 76, goals: 100,
      firstMatchId: 1, firstMatchDate: new Date(Date.UTC(2014, 2, 1)),
      lastMatchId: 2, lastMatchDate: new Date(Date.UTC(2017, 7, 1)),
    },
    b: {
      games: 150, goals: 300,
      firstMatchId: 3, firstMatchDate: new Date(Date.UTC(2018, 2, 1)),
      lastMatchId: 4, lastMatchDate: new Date(Date.UTC(2025, 7, 1)),
    },
    combinedGames: 226,
    combinedGoals: 400,
    careerGames: 226,
    careerGoals: 400,
    direction: 'a-to-b',
    completionDate: new Date(Date.UTC(2018, 2, 1)),
    completionMatchId: 3,
    interveningOrganizations: [],
    ...overrides,
  };
}

function comparisonData(overrides: Partial<ClubComparisonData> = {}): ClubComparisonData {
  return {
    summary: {
      meetings: 60,
      aWins: 28,
      bWins: 31,
      draws: 1,
      aWinPercentage: 47.5,
      bWinPercentage: 52.5,
      firstMeeting: { matchId: 100, season: 1991, matchDate: new Date(Date.UTC(1991, 3, 6)) },
      latestMeeting: { matchId: 900, season: 2025, matchDate: new Date(Date.UTC(2025, 6, 12)) },
      finalsSeriesMeetings: 3,
      grandFinalMeetings: 0,
    },
    meetings: {
      meetings: [meeting()],
      matchType: 'all',
      era: null,
      page: 1,
      pageSize: 25,
      totalMeetings: 60,
      totalPages: 3,
      hasPreviousPage: false,
      hasNextPage: true,
    },
    venues: [{
      venueId: 7, venueName: 'Adelaide Oval', meetings: 12, aWins: 7, bWins: 5, draws: 0,
      firstMeeting: new Date(Date.UTC(2014, 3, 1)),
      latestMeeting: new Date(Date.UTC(2025, 6, 12)),
    }],
    records: emptyRecords(),
    streaks: { longestA: null, longestB: null, current: null },
    crossoverSummary: {
      players: 1,
      firstToRepresentBoth: [crossover()],
      mostRecentToRepresentBoth: [crossover()],
    },
    crossoverPlayers: [crossover()],
    playerLeaders: {
      games: [{
        rank: 1, playerId: 900, displayName: 'Charlie Cameron', sortName: 'Cameron, Charlie',
        slug: 'charlie-cameron', games: 14, goals: 22, goalsRecordedGames: 14,
        a: { games: 4, goals: 5, goalsRecordedGames: 4 },
        b: { games: 10, goals: 17, goalsRecordedGames: 10 },
      }],
      goals: [],
      singleMatchGoals: { stat: 'goals', recordedRows: 1200, value: 7, holders: [] },
      singleMatchDisposals: { stat: 'disposals', recordedRows: 0, value: null, holders: [] },
    },
    brownlowA: emptyBrownlowHistory(1),
    brownlowB: emptyBrownlowHistory(2),
    h2hBrownlow: {
      eligibleMeetings: 120,
      evaluableMeetings: 110,
      coveredMeetings: 100,
      partiallyPolledMeetings: 4,
      coverage: 'partial',
      totalVotes: 300,
      players: [],
    },
    decades: [{
      decade: 1990,
      meetings: 20, aWins: 9, bWins: 11, draws: 0,
      aWinPercentage: 45, bWinPercentage: 55,
      scoredMeetings: 20,
      aPointsFor: 1800, aPointsAgainst: 1900, bPointsFor: 1900, bPointsAgainst: 1800,
    }],
    periodRecords: {
      coverage: {
        meetings: 5, meetingsWithPeriodRows: 4, usableMeetings: 3, incompleteMeetings: 2,
        state: 'partial',
      },
      records: emptyPeriodRecords(),
    },
    playerAverages: {
      meetings: 60,
      rivalrySeasons: 35,
      minimumRecordedGames: 5,
      rankLimit: 10,
      boards: [{
        key: 'disposals', statKey: 'disposals', label: 'Disposals',
        rivalrySeasons: 35, coveredSeasons: 30, uncoveredSeasons: 5,
        seasonsByCoverage: {
          complete: 30, partial: 0, pending: 0, not_collected: 5, not_applicable: 0, missing: 0,
        },
        isAvailable: true,
        hasCoverageGap: true,
        minimumRecordedGames: 5,
        leaders: [{
          rank: 1, playerId: 501, displayName: 'Jordan Dawson', sortName: 'Dawson, Jordan',
          slug: 'jordan-dawson', recordedGames: 8, total: 240, average: 30,
          a: { recordedGames: 8, total: 240, average: 30 },
          b: { recordedGames: 0, total: null, average: null },
        }],
      }],
    },
    ...overrides,
  };
}

function comparisonState(
  overrides: {
    params?: Partial<ComparisonEffectiveParams>;
    data?: Partial<ClubComparisonData>;
    organizationB?: ComparisonOrganization;
    notices?: ClubComparisonRouteState['notices'];
  } = {},
): ClubComparisonRouteState {
  const effective = params(overrides.params);
  const organizationB = overrides.organizationB ?? BRISBANE;
  return {
    kind: 'comparison',
    params: effective,
    notices: overrides.notices ?? [],
    options: OPTIONS,
    canonicalPath: canonicalClubComparePath(ADELAIDE.slug, organizationB.slug),
    sharePath: clubComparePath(effective),
    noindex: false,
    organizationA: ADELAIDE,
    organizationB,
    swapPath: swapClubComparePath(effective),
    data: comparisonData(overrides.data),
  };
}

function landingState(): ClubComparisonRouteState {
  const effective = params({ club1: null, club2: null });
  return {
    kind: 'unselected',
    params: effective,
    notices: [],
    options: OPTIONS,
    canonicalPath: '/clubs/compare',
    sharePath: clubComparePath(effective),
    noindex: false,
  };
}

function render(state: ClubComparisonRouteState): string {
  return renderToStaticMarkup(ClubComparisonView({ state }));
}

describe('landing state', () => {
  const html = render(landingState());

  it('renders every selector, database-driven, with nothing chosen', () => {
    expect(html).toContain('name="club1"');
    expect(html).toContain('name="club2"');
    expect(html).toContain('Choose a club…');
    expect(html).toContain('Adelaide');
    expect(html).toContain('Fitzroy');
  });

  it('has no match-type control until a comparison exists (FR-3: it is local to Match History)', () => {
    expect(html).not.toContain('name="matchType"');
  });

  it('auto-selects no club', () => {
    // The only pre-selected club option is the empty prompt.
    expect(html).not.toMatch(/<option value="(adelaide|brisbane-lions|fitzroy)" selected/);
    expect(html).toContain('<option value="" selected="">Choose a club…</option>');
    expect(html).toContain('<h2>Choose two clubs</h2>');
  });

  it('renders no comparison section', () => {
    for (const id of [
      'head-to-head', 'rivalry-records', 'match-history',
      'player-leaders', 'connected-players', 'brownlow', 'by-decade', 'period-records',
      'player-averages',
    ]) {
      expect(html).not.toContain(`id="${id}"`);
    }
  });
});

describe('invalid and same-organisation states', () => {
  it('names the unresolvable slug and renders no comparison', () => {
    const html = render({
      ...landingState(),
      kind: 'invalid-club',
      invalidSlugs: ['footscray'],
      noindex: true,
      notices: [{ field: 'club', message: 'footscray is not a club on record.' }],
    });
    expect(html).toContain('That club could not be found');
    expect(html).toContain('footscray');
    expect(html).not.toContain('id="head-to-head"');
  });

  it('asks for two different clubs rather than an empty head-to-head', () => {
    const html = render({
      ...landingState(),
      kind: 'same-organization',
      organization: ADELAIDE,
      noindex: true,
      notices: [{ field: 'club', message: 'Choose two different clubs.' }],
    });
    expect(html).toContain('Choose two different clubs');
    expect(html).not.toContain('id="head-to-head"');
    expect(html).not.toContain('id="match-history"');
  });
});

describe('comparison state', () => {
  const html = render(comparisonState());

  it('renders every major section (FR-3: some are collapsed top-level disclosures, not plain sections)', () => {
    // Always-expanded plain sections keep a bare <h2>.
    expect(html).toContain('<h2>Head-to-head</h2>');
    expect(html).toContain('<h2>Rivalry records</h2>');
    // Collapsed top-level sections are a CollapsiblePanel/CollapsibleTable,
    // whose own <h2> carries the "table-details-title" class.
    expect(html).toContain('table-details-title">Venues</h2>');
    expect(html).toContain('table-details-title">Players</h2>');
    expect(html).toContain('table-details-title">Brownlow</h2>');
    expect(html).toContain('table-details-title">Match history</h2>');
    // Subsections that used to be their own <h2> are now <h3>, nested
    // under the one collapsed or expanded section that contains them.
    expect(html).toContain('<h3>Player rivalry leaders</h3>');
    expect(html).toContain('<h3>Connected players</h3>');
    expect(html).toContain('<h3>By decade</h3>');
    expect(html).toContain('<h3>Period records</h3>');
    expect(html).toContain('<h3>Player averages in this rivalry</h3>');
  });

  it('heads the page with both organisations and the current filter state', () => {
    expect(html).toContain('Adelaide v Brisbane Lions');
    expect(html).toContain('All time');
    expect(html).toContain('All matches');
  });

  it('states the summary is all-time rather than filtered', () => {
    expect(html).toContain('not narrowed by the match-type filter');
  });

  it('uses repository entity paths for players, clubs and matches', () => {
    expect(html).toContain('href="/players/charlie-cameron-900"');
    expect(html).toContain('href="/clubs/adelaide"');
    expect(html).toContain('href="/matches/14132"');
  });

  it('describes crossover order without claiming a trade or transfer', () => {
    expect(html).toContain('Adelaide first');
    expect(html).not.toContain('traded');
    expect(html).not.toContain('transferred');
    expect(html).not.toContain('moved directly');
  });

  it('renders a decade from the returned rows', () => {
    expect(html).toContain('1990s');
  });

  it('reports an unrecorded single-match statistic as coverage, not zero', () => {
    expect(html).toContain('Most disposals in one match: not recorded in any meeting');
  });
});

describe('coverage presentation', () => {
  const html = render(comparisonState());

  it('discloses head-to-head Brownlow coverage as X of Y eligible meetings', () => {
    expect(html).toContain('Recorded H2H Brownlow votes from 100 of 120 eligible meetings.');
    expect(html).toContain('finals are never polled');
  });

  it('discloses period-score coverage as X of Y rivalry meetings', () => {
    expect(html).toContain('Period-score data available for 3 of 5 rivalry meetings.');
  });

  it('discloses that an average board does not span the whole rivalry', () => {
    expect(html).toContain('Minimum 5 recorded rivalry games for this stat.');
    expect(html).toContain('Recorded in 30 of 35 rivalry seasons');
  });
});

describe('ties', () => {
  it('lists every witness of a shared record rather than one of them', () => {
    const tied: H2HRecordEntry[] = [
      { ...meeting({ matchId: 501, season: 1991, aScore: 44 }), value: 44 },
      { ...meeting({ matchId: 502, season: 1994, aScore: 44 }), value: 44 },
    ];
    const html = render(comparisonState({
      data: { records: { ...emptyRecords(), 'lowest-score-a': tied } },
    }));
    expect(html).toContain('href="/matches/501"');
    expect(html).toContain('href="/matches/502"');
    expect(html).toContain('Tied 1 of 2');
    expect(html).toContain('Tied 2 of 2');
  });

  it('keeps both clubs’ period records distinguishable on one shared match', () => {
    const entry = periodEntry({ matchId: 14132, value: 41 });
    const html = render(comparisonState({
      data: {
        periodRecords: {
          coverage: {
            meetings: 5, meetingsWithPeriodRows: 5, usableMeetings: 5, incompleteMeetings: 0,
            state: 'complete',
          },
          records: {
            ...emptyPeriodRecords(),
            'biggest-quarter-time-lead-a': [entry],
            'biggest-comeback-from-quarter-time-b': [entry],
          },
        },
      },
    }));
    expect(html).toContain('Biggest quarter-time lead — Adelaide');
    expect(html).toContain('Biggest comeback from quarter time — Brisbane Lions');
    // Both clubs' break scores are on the row, so a bare margin cannot
    // misattribute the record.
    expect(html).toContain('45/60/75');
    expect(html).toContain('4/30/70');
  });
});

describe('shareable controls', () => {
  it('swaps the presentation order while preserving the filter and page', () => {
    const html = render(comparisonState({ params: { matchType: 'finals', page: 3 } }));
    expect(html).toContain(
      'href="/clubs/compare?club1=brisbane-lions&amp;club2=adelaide'
      + '&amp;matchType=finals&amp;page=3"',
    );
    expect(html).toContain('Swap the order of the two clubs');
  });

  it('keeps the club and filter state on every pagination link', () => {
    const html = render(comparisonState({
      params: { matchType: 'finals', page: 2 },
      data: {
        meetings: {
          meetings: [meeting()],
          matchType: 'finals',
          era: null,
          page: 2,
          pageSize: 25,
          totalMeetings: 60,
          totalPages: 3,
          hasPreviousPage: true,
          hasNextPage: true,
        },
      },
    }));
    expect(html).toContain(
      'href="/clubs/compare?club1=adelaide&amp;club2=brisbane-lions'
      + '&amp;matchType=finals&amp;page=3"',
    );
    expect(html).toContain(
      'href="/clubs/compare?club1=adelaide&amp;club2=brisbane-lions'
      + '&amp;matchType=finals"',
    );
  });
});

describe('era explorer', () => {
  it('renders a chip for every decade in the rivalry, plus all time, with the current era marked', () => {
    const html = render(comparisonState({ params: { era: null } }));
    expect(html).toContain('aria-label="Filter rivalry records and match history by era"');
    expect(html).toContain('>All time</a>');
    expect(html).toContain('aria-current="true"');
    expect(html).toContain('1990s');
  });

  it('scopes rivalry records and match history to the chosen era, but leaves streaks and venues all-time', () => {
    const html = render(comparisonState({
      params: { era: 1990 },
      data: {
        meetings: {
          meetings: [meeting()],
          matchType: 'all',
          era: 1990,
          page: 1,
          pageSize: 25,
          totalMeetings: 20,
          totalPages: 1,
          hasPreviousPage: false,
          hasNextPage: false,
        },
      },
    }));
    expect(html).toContain('Rivalry records — Adelaide and Brisbane Lions (1990s)');
    expect(html).toContain('The 1990s only, over meetings from that decade of the rivalry.');
    expect(html).toContain('Streaks are always all-time');
    expect(html).toContain('Venue records are always all-time.');
  });

  it('does not claim streaks or venues are era-scoped when no era is chosen', () => {
    const html = render(comparisonState({ params: { era: null } }));
    expect(html).not.toContain('Streaks are always all-time');
    expect(html).not.toContain('Venue records are always all-time.');
  });
});

describe('notices', () => {
  it('states a normalisation rather than silently applying it', () => {
    const html = render(comparisonState({
      notices: [{ field: 'matchType', message: 'That match filter is not one of all, home-and-away or finals; showing all matches.' }],
    }));
    expect(html).toContain('That match filter is not one of all, home-and-away or finals; showing all matches.');
  });
});

describe('empty states', () => {
  it('explains an empty section instead of rendering a bare table', () => {
    const html = render(comparisonState({
      data: {
        crossoverPlayers: [],
        crossoverSummary: { players: 0, firstToRepresentBoth: [], mostRecentToRepresentBoth: [] },
        venues: [],
        decades: [],
      },
    }));
    expect(html).toContain('No player is recorded as representing both clubs.');
    expect(html).toContain('No venue is recorded for any meeting of these two clubs.');
    expect(html).toContain('There is no meeting to break down by decade.');
  });
});

/**
 * AFLDB-ISSUE-144 Stage 9 — accessibility semantics of the rendered view.
 *
 * These pin the structure a screen reader navigates by, which nothing else
 * asserts: Stage 8 built it, and a heading level or a `scope` is exactly
 * the kind of detail a later presentation edit drops silently. The audit
 * that found the one real defect (an h2 -> h4 jump in the Brownlow history
 * panel) was run in a browser; this is the part of it that can be proved
 * without one.
 */
describe('Stage 9 accessibility semantics', () => {
  const states: [string, ClubComparisonRouteState][] = [
    ['landing', landingState()],
    ['comparison', comparisonState()],
  ];

  for (const [label, state] of states) {
    const html = render(state);

    it(`gives ${label} exactly one h1`, () => {
      expect(html.match(/<h1[\s>]/g)?.length ?? 0).toBe(1);
    });

    it(`never skips a heading level on ${label}`, () => {
      const levels = [...html.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
      expect(levels[0]).toBe(1);
      let previous = 1;
      for (const level of levels) {
        expect(level, `h${previous} -> h${level}`).toBeLessThanOrEqual(previous + 1);
        previous = level;
      }
    });

    it(`labels every control on ${label}`, () => {
      const ids = [...html.matchAll(/<select id="([^"]+)"/g)].map((m) => m[1]);
      // Landing has only the two club selects; a comparison additionally
      // has Match History's own local match-type select (FR-3).
      expect(ids.length).toBe(label === 'landing' ? 2 : 3);
      for (const id of ids) expect(html).toContain(`<label for="${id}"`);
      expect(html).toContain('<legend>');
    });
  }

  it('captions every table and scopes every header cell', () => {
    const html = render(comparisonState());
    const tables = html.split('<table>').slice(1);
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table.slice(0, 200)).toContain('<caption>');
    }
    // No bare <th>: every header cell says which axis it heads.
    expect(html).not.toMatch(/<th>/);
    expect(html).not.toMatch(/<th class="[^"]*">/);
  });

  it('exposes every collapsed section through a named summary', () => {
    const html = render(comparisonState());
    const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)];
    expect(summaries.length).toBeGreaterThan(0);
    for (const [, inner] of summaries) {
      expect(inner.replace(/<[^>]+>/g, '').trim().length).toBeGreaterThan(2);
    }
  });
});
