import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  coachPerspectiveMargin,
  selectCareerRecordMatch,
  type CoachCareerMatch,
} from '@/db/queries/coaches';

/**
 * Pure-function coverage for the AFLDB-ISSUE-170 Stage 1A biggest-win/loss
 * read-model additions. These are unit-tested with plain fixtures rather
 * than a database (tests/integration/player-family-and-coaching.test.ts
 * covers getCoachCareer's end-to-end wiring against real canonical data)
 * because a real tied margin cannot be relied on to exist in historical
 * data, and the home/away formula is exact business logic worth pinning
 * directly.
 */
describe('coachPerspectiveMargin', () => {
  it('is home_score - away_score when the coached club is home', () => {
    expect(coachPerspectiveMargin({ coachedClubId: 1, homeClubId: 1, homeScore: 100, awayScore: 80 })).toBe(20);
  });

  it('is away_score - home_score when the coached club is away', () => {
    expect(coachPerspectiveMargin({ coachedClubId: 2, homeClubId: 1, homeScore: 80, awayScore: 100 })).toBe(20);
  });

  it('is negative for a loss, whether the coached club is home or away', () => {
    expect(coachPerspectiveMargin({ coachedClubId: 1, homeClubId: 1, homeScore: 60, awayScore: 90 })).toBe(-30);
    expect(coachPerspectiveMargin({ coachedClubId: 2, homeClubId: 1, homeScore: 90, awayScore: 60 })).toBe(-30);
  });
});

function careerMatch(overrides: Partial<CoachCareerMatch> = {}): CoachCareerMatch {
  return {
    matchId: 1,
    season: 2000,
    matchDate: new Date('2000-05-01'),
    roundType: 'home_and_away',
    isFinalsSeries: false,
    coachedClubId: 1,
    coachedClubName: 'Collingwood',
    coachedClubSlug: 'collingwood',
    opponentClubId: 2,
    opponentClubName: 'Carlton',
    opponentClubSlug: 'carlton',
    margin: 20,
    venueId: 1,
    venueName: 'M.C.G.',
    venueSlug: 'mcg',
    ...overrides,
  };
}

describe('selectCareerRecordMatch', () => {
  it('picks the win with the largest margin', () => {
    const matches = [
      careerMatch({ matchId: 1, margin: 20 }),
      careerMatch({ matchId: 2, margin: 50 }),
      careerMatch({ matchId: 3, margin: -90 }),
    ];
    expect(selectCareerRecordMatch(matches, 'win')?.matchId).toBe(2);
  });

  it('picks the loss with the largest margin of defeat', () => {
    const matches = [
      careerMatch({ matchId: 1, margin: -20 }),
      careerMatch({ matchId: 2, margin: -50 }),
      careerMatch({ matchId: 3, margin: 90 }),
    ];
    expect(selectCareerRecordMatch(matches, 'loss')?.matchId).toBe(2);
  });

  it('breaks a tied margin by the earliest match date', () => {
    const matches = [
      careerMatch({ matchId: 1, margin: 50, matchDate: new Date('2005-06-01') }),
      careerMatch({ matchId: 2, margin: 50, matchDate: new Date('2001-04-01') }),
    ];
    expect(selectCareerRecordMatch(matches, 'win')?.matchId).toBe(2);
  });

  it('breaks a tied margin and date by the lowest match id', () => {
    const sameDate = new Date('2001-04-01');
    const matches = [
      careerMatch({ matchId: 42, margin: 50, matchDate: sameDate }),
      careerMatch({ matchId: 7, margin: 50, matchDate: sameDate }),
    ];
    expect(selectCareerRecordMatch(matches, 'win')?.matchId).toBe(7);
  });

  it('never treats a zero-margin (drawn) match as a win or a loss', () => {
    const matches = [careerMatch({ matchId: 1, margin: 0 })];
    expect(selectCareerRecordMatch(matches, 'win')).toBeNull();
    expect(selectCareerRecordMatch(matches, 'loss')).toBeNull();
  });

  it('returns null for either direction when there are no qualifying matches (zero-game coach)', () => {
    expect(selectCareerRecordMatch([], 'win')).toBeNull();
    expect(selectCareerRecordMatch([], 'loss')).toBeNull();
  });
});

/**
 * AFLDB-ISSUE-174 §18 Phase 2 — the index's job is find/browse by name, not
 * rank by games (that is `/records/coaches`' job), so the default sort
 * changed from games-desc to name-asc. Fixture games are chosen so the two
 * orders disagree (name-asc: Adams, Zamboni; games-desc: Zamboni, Adams),
 * which is what actually pins the change rather than the label on the prop.
 */
const listCoachesMock = vi.hoisted(() => ({
  coaches: [] as { id: number; displayName: string; firstSeason: number | null; lastSeason: number | null; games: number }[],
}));

// src/db/queries/coaches.ts imports `sql` from here at module load, and the
// real client throws immediately if DATABASE_URL is not set (it is not, in
// a unit-test run) -- so the DB-facing dependency is stubbed here, never
// the queries module itself. This lets `importOriginal` below evaluate the
// REAL coaches.ts (keeping coachPerspectiveMargin/selectCareerRecordMatch
// genuine) without ever touching a database.
vi.mock('@/db/client', () => ({
  sql: () => { throw new Error('tests/coaches.test.ts must not execute real SQL'); },
}));

vi.mock('@/db/queries/coaches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/queries/coaches')>();
  return { ...actual, listCoaches: async () => listCoachesMock.coaches };
});

describe('/coaches index defaults to name-ascending, not games-descending', () => {
  beforeEach(() => {
    listCoachesMock.coaches = [
      { id: 1, displayName: 'Zed Zamboni', firstSeason: 2000, lastSeason: 2010, games: 50 },
      { id: 2, displayName: 'Amy Adams', firstSeason: 1990, lastSeason: 1995, games: 10 },
    ];
  });

  it('renders rows in name order (Amy Adams before Zed Zamboni), not games order', async () => {
    const CoachesPage = (await import('@/app/coaches/page')).default;
    const html = renderToStaticMarkup(await CoachesPage());

    expect(html.indexOf('Amy Adams')).toBeLessThan(html.indexOf('Zed Zamboni'));
  });

  it('marks the Name column, not Games, as the active ascending sort', async () => {
    const CoachesPage = (await import('@/app/coaches/page')).default;
    const html = renderToStaticMarkup(await CoachesPage());
    const headers = [...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)]
      .map((m) => ({ raw: m[0], text: m[1].replace(/<[^>]*>/g, '') }));

    const nameHeader = headers.find((h) => h.text.includes('Name'));
    const gamesHeader = headers.find((h) => h.text.includes('Games'));

    expect(nameHeader?.raw).toContain('aria-sort="ascending"');
    expect(gamesHeader?.raw).toContain('aria-sort="none"');
  });

  it('adds a cross-link to the records leaderboard', async () => {
    const CoachesPage = (await import('@/app/coaches/page')).default;
    const html = renderToStaticMarkup(await CoachesPage());

    expect(html).toContain('href="/records/coaches"');
    expect(html).toContain('Games and win-percentage leaderboards');
  });
});
