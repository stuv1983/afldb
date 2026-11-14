import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeRecordPanel } from '@/components/HomeRecordPanel';
import {
  getHomeRecordDefinition,
  HOME_RECORD_TIE_WINDOW,
  selectHomeRecordRows,
} from '@/lib/home-records';

const mocks = vi.hoisted(() => ({
  career: vi.fn(),
  match: vi.fn(),
  season: vi.fn(),
  coachGames: vi.fn(),
  coachMetric: vi.fn(),
  coachWinPct: vi.fn(),
  venue: vi.fn(),
  afterSiren: vi.fn(),
  firstKick: vi.fn(),
}));

vi.mock('@/db/queries/records', () => ({
  getCareerRecord: mocks.career,
  getMatchRecord: mocks.match,
  getSeasonRecord: mocks.season,
}));
vi.mock('@/db/queries/coaches', () => ({
  getCoachRecordsByGames: mocks.coachGames,
  getCoachRecordsByMetric: mocks.coachMetric,
  getCoachRecordsByWinPct: mocks.coachWinPct,
}));
vi.mock('@/db/queries/venues', () => ({ getVenueRecordLeaders: mocks.venue }));
vi.mock('@/db/queries/after-siren', () => ({ getAfterSirenRecords: mocks.afterSiren }));
vi.mock('@/db/queries/player-achievements', () => ({
  getFirstKickGoalRecordLeaders: mocks.firstKick,
}));

const providerMocks = Object.values(mocks);

describe('home record provider dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.career.mockResolvedValue([
      { playerId: 1, slug: 'tony-lockett', displayName: 'Tony Lockett', value: 1360 },
    ]);
    mocks.match.mockResolvedValue([
      {
        playerId: 2, slug: 'fred-fanning', displayName: 'Fred Fanning', value: 18,
        matchId: 10, season: 1947, roundType: 'home_away', roundNumber: 19,
        opponentName: 'St Kilda',
      },
    ]);
    mocks.season.mockResolvedValue([
      {
        playerId: 3, slug: 'bob-pratt', displayName: 'Bob Pratt', value: 150,
        season: 1934, clubName: 'South Melbourne',
      },
    ]);
    const coach = {
      coachId: 4, displayName: 'Jock McHale', games: 713, wins: 466,
      finals: 58, grandFinals: 16, premierships: 7, winPct: '66.06',
    };
    mocks.coachGames.mockResolvedValue([coach]);
    mocks.coachMetric.mockResolvedValue([coach]);
    mocks.coachWinPct.mockResolvedValue([{ ...coach, displayName: 'Cliff Rankin', winPct: '78.95' }]);
    mocks.venue.mockResolvedValue([
      { venueSlug: 'melbourne-cricket-ground', venueName: 'Melbourne Cricket Ground', value: 485 },
    ]);
    mocks.afterSiren.mockResolvedValue([
      {
        playerId: 5, slug: 'barry-hall', displayName: 'Barry Hall',
        attempts: 2, goals: 2, goalsToWin: 2,
      },
    ]);
    mocks.firstKick.mockResolvedValue([
      {
        playerId: 6, playerSlug: 'clen-denning', playerName: 'Clen Denning',
        consecutiveGoalKicks: 6, season: 1935,
      },
    ]);
  });

  it.each([
    ['most-goals', 'player-total', mocks.career],
    ['most-goals-in-a-game', 'player-match', mocks.match],
    ['most-goals-in-a-season', 'player-season', mocks.season],
    ['coach-most-wins', 'coach-total', mocks.coachMetric],
    ['venue-most-finals', 'venue-total', mocks.venue],
    ['after-siren-most-goals', 'special-player-total', mocks.afterSiren],
    ['first-kick-most-consecutive-goals', 'special-player-total', mocks.firstKick],
  ] as const)('executes only %s and returns its declared row kind', async (value, kind, selected) => {
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord(value, 5);

    expect(selected).toHaveBeenCalledTimes(1);
    expect(providerMocks.reduce((total, fn) => total + fn.mock.calls.length, 0)).toBe(1);
    expect(result.definition.value).toBe(value);
    expect(result.rows[0]?.kind).toBe(kind);
  });

  it('falls back before dispatching when the stored value is stale', async () => {
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('drop table players', 5);
    expect(result.definition.value).toBe('most-goals');
    // The provider is read through the tie window, not the bare panel limit
    // (AFLDB-ISSUE-360 FE-4), so a tie at the cutoff can be seen.
    expect(mocks.career).toHaveBeenCalledWith('most-goals', HOME_RECORD_TIE_WINDOW);
  });
});

/** A provider that honours its LIMIT the way the real queries do. */
function afterSirenHolders(values: number[]) {
  return values.map((attempts, i) => ({
    playerId: 100 + i, slug: `holder-${i}`, displayName: `Holder ${i}`,
    attempts, goals: attempts, goalsToWin: attempts,
  }));
}

describe('home record tied holders at the cutoff (AFLDB-ISSUE-360 FE-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  function provide(values: number[]) {
    const all = afterSirenHolders(values);
    mocks.afterSiren.mockImplementation(async ({ limit }: { limit?: number }) =>
      limit === undefined ? all : all.slice(0, limit));
  }

  it('lists every holder when nine are tied on the record (5 shown before the fix)', async () => {
    provide([2, 2, 2, 2, 2, 2, 2, 2, 2, 1, 1]);
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('after-siren-most-attempts', 5);
    expect(result.rows).toHaveLength(9);
    expect(result.rows.every((row) => row.value === 2)).toBe(true);
    expect(result.moreTied).toBeUndefined();
  });

  it('lists a short tie straddling the cutoff but not the places below it', async () => {
    provide([6, 5, 4, 3, 3, 3, 3, 2, 1]);
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('after-siren-most-attempts', 5);
    expect(result.rows.map((row) => row.value)).toEqual([6, 5, 4, 3, 3, 3, 3]);
    expect(result.moreTied).toBeUndefined();
  });

  it('discloses the true count of a long tie instead of implying five holders', async () => {
    provide([2, 2, ...Array<number>(64).fill(1), 0]);
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('after-siren-most-goals', 5);
    expect(result.rows).toHaveLength(5);
    expect(result.moreTied).toEqual({ count: 61, exact: true, value: 1 });
  });

  it('says "at least" when the provider window ends inside the tie', async () => {
    provide(Array<number>(HOME_RECORD_TIE_WINDOW + 50).fill(1));
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('after-siren-most-goals', 5);
    expect(result.moreTied).toEqual({
      count: HOME_RECORD_TIE_WINDOW - 5, exact: false, value: 1,
    });
  });

  // ISSUE-360, run 2: the panel prints what it printed before only when the tie fits in the window.
  // A tie LONGER than the window can never be counted from the window alone, so the count is
  // labelled a lower bound in the rendered text: tied holders are never truncated silently.
  it('a 260-way tie (longer than the window) renders "at least 195 more", never an exact count', async () => {
    provide([2, 2, ...Array<number>(260).fill(1)]);
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('after-siren-most-goals', 5);
    expect(result.rows).toHaveLength(5);
    expect(result.moreTied).toEqual({ count: HOME_RECORD_TIE_WINDOW - 5, exact: false, value: 1 });
    const html = renderToStaticMarkup(HomeRecordPanel({ result }));
    expect(html).toContain('and at least 195 more tied on 1 Goals');
    expect(html).toContain('see the full record');
    expect(html).not.toContain('and 195 more tied');
    expect(html).not.toContain('and 260 more tied');
  });

  it('a tie ending exactly one row inside the window is exact; one ending on the window edge is a lower bound', async () => {
    const { getHomeRecord } = await import('@/db/queries/home-records');
    // Two leaders, 197 tied on 1, then zeros: the tie occupies rows 3-199 of the 200-row window and a
    // 0 follows inside it, so nothing is cut: 199 rows through the tie minus the 5 shown = 194, exact.
    provide([2, 2, ...Array<number>(HOME_RECORD_TIE_WINDOW - 3).fill(1), 0, 0]);
    const inside = await getHomeRecord('after-siren-most-goals', 5);
    expect(inside.moreTied).toEqual({ count: 194, exact: true, value: 1 });
    // The tie fills the window to its last row: the provider cut it, so the count is only a lower bound.
    provide([2, 2, ...Array<number>(HOME_RECORD_TIE_WINDOW - 2).fill(1), 1, 1, 1]);
    const edge = await getHomeRecord('after-siren-most-goals', 5);
    expect(edge.moreTied).toEqual({ count: HOME_RECORD_TIE_WINDOW - 5, exact: false, value: 1 });
  });

  it('adds nothing when the fifth place is not tied', async () => {
    provide([9, 8, 7, 6, 5, 4, 4]);
    const { getHomeRecord } = await import('@/db/queries/home-records');
    const result = await getHomeRecord('after-siren-most-attempts', 5);
    expect(result.rows).toHaveLength(5);
    expect(result.moreTied).toBeUndefined();
  });
});

describe('selectHomeRecordRows', () => {
  const rows = (...values: number[]) => values.map((value) => ({ value }));

  it('never relabels or reorders, and never invents a tie below the cutoff', () => {
    const { rows: shown, moreTied } = selectHomeRecordRows(rows(5, 4, 3, 2, 1, 1, 0), 5);
    expect(shown.map((row) => row.value)).toEqual([5, 4, 3, 2, 1, 1]);
    expect(moreTied).toBeNull();
  });

  it('returns fewer rows than the limit untouched', () => {
    expect(selectHomeRecordRows(rows(3, 2), 5)).toEqual({ rows: rows(3, 2), moreTied: null });
  });
});

describe('HomeRecordPanel tied-holder marker', () => {
  it('states how many holders are not listed, the shared value, and links the full record', () => {
    const html = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('after-siren-most-goals'),
      rows: [{
        kind: 'special-player-total', playerId: 1, playerSlug: 'a-one', displayName: 'A One', value: 1,
      }],
      moreTied: { count: 61, exact: true, value: 1 },
    } }));
    expect(html).toContain('and 61 more tied on 1 Goals');
    expect(html).toContain('href="/records/after-the-siren">see the full record</a>');
  });

  it('flags a lower bound and omits the link when the record has no full page', () => {
    const html = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('venue-most-grand-finals'),
      rows: [{ kind: 'venue-total', venueSlug: 'mcg', venueName: 'MCG', value: 1 }],
      moreTied: { count: 195, exact: false, value: 1 },
    } }));
    expect(html).toContain('and at least 195 more tied on 1 Grand Finals');
    expect(html).not.toContain('see the full record');
  });

  it('renders no marker when nothing is hidden', () => {
    const html = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('most-goals'),
      rows: [{
        kind: 'player-total', playerId: 1, playerSlug: 'tony-lockett', displayName: 'Tony Lockett', value: 1360,
      }],
    } }));
    expect(html).not.toContain('more tied');
  });
});

describe('HomeRecordPanel', () => {
  it('renders player, coach and venue rows with the correct entity links', () => {
    const player = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('most-goals'),
      rows: [{
        kind: 'player-total', playerId: 1, playerSlug: 'tony-lockett',
        displayName: 'Tony Lockett', value: 1360,
      }],
    } }));
    const coach = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('coach-most-games'),
      rows: [{ kind: 'coach-total', coachId: 2, displayName: 'Jock McHale', value: 713 }],
    } }));
    const venue = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('venue-most-finals'),
      rows: [{ kind: 'venue-total', venueSlug: 'mcg', venueName: 'MCG', value: 485 }],
    } }));

    expect(player).toContain('href="/players/tony-lockett-1"');
    expect(coach).toContain('href="/coaches/jock-mchale-2"');
    expect(venue).toContain('href="/venues/mcg"');
    expect(venue).not.toContain('>All →</a>');
  });

  it('renders match context and visible units', () => {
    const html = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('most-goals-in-a-game'),
      rows: [{
        kind: 'player-match', playerId: 2, playerSlug: 'fred-fanning',
        displayName: 'Fred Fanning', value: 18, matchId: 10, season: 1947,
        roundType: 'home_away', roundNumber: 19, opponentName: 'St Kilda',
      }],
    } }));
    expect(html).toContain('href="/matches/10"');
    expect(html).toContain('18 Goals');
  });

  it('renders an empty selected provider without crashing', () => {
    const html = renderToStaticMarkup(HomeRecordPanel({ result: {
      definition: getHomeRecordDefinition('venue-most-finals'), rows: [],
    } }));
    expect(html).toContain('No record entries are available.');
  });
});
