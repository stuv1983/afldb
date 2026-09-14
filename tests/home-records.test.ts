import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { HomeRecordPanel } from '@/components/HomeRecordPanel';
import { getHomeRecordDefinition } from '@/lib/home-records';

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
    expect(mocks.career).toHaveBeenCalledWith('most-goals', 5);
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
