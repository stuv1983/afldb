import { describe, expect, it } from 'vitest';

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
