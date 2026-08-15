import { describe, expect, it } from 'vitest';

import type { PlayerProfile } from '@/db/queries/players';
import { comparableStats, eraGaps, ERA_LIMITED_STATS } from '@/lib/player-compare';

function makeProfile(overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: 1,
    slug: 'test-player',
    displayName: 'Test Player',
    dob: null,
    dobConfidence: 'unknown',
    dobDisputed: false,
    birthYear: null,
    birthYearConfidence: 'unknown',
    games: 200,
    goals: 100,
    behinds: 50,
    behindsRecordedGames: 200,
    kicks: 1000,
    kicksRecordedGames: 200,
    handballs: 500,
    handballsRecordedGames: 200,
    disposals: 1500,
    disposalsRecordedGames: 200,
    marks: 400,
    marksRecordedGames: 200,
    tackles: 300,
    tacklesRecordedGames: 200,
    hitouts: null,
    hitoutsRecordedGames: 0,
    finals: 10,
    premierships: 1,
    wins: 120,
    draws: 2,
    losses: 78,
    brownlowVotes: 20,
    brownlowMedals: 0,
    clubsPlayed: 1,
    seasonsPlayed: 12,
    debutSeason: 2000,
    finalSeason: 2012,
    debutDate: null,
    lastMatchDate: null,
    bestGoalsGame: 6,
    bestDisposalsGame: 35,
    ...overrides,
  };
}

describe('comparableStats', () => {
  it('includes every era-limited stat when both players recorded it', () => {
    const a = makeProfile();
    const b = makeProfile();
    expect(comparableStats(a, b)).toEqual(ERA_LIMITED_STATS.filter((s) => s !== 'hitouts'));
  });

  it('excludes a stat neither player has', () => {
    const a = makeProfile({ hitouts: null });
    const b = makeProfile({ hitouts: null });
    expect(comparableStats(a, b)).not.toContain('hitouts');
  });

  it('excludes a stat only one player has', () => {
    const a = makeProfile({ disposals: 1500 });
    const b = makeProfile({ disposals: null, disposalsRecordedGames: 0 });
    expect(comparableStats(a, b)).not.toContain('disposals');
  });

  it('is symmetric: order does not change the result', () => {
    const a = makeProfile({ tackles: null, tacklesRecordedGames: 0 });
    const b = makeProfile();
    expect(comparableStats(a, b)).toEqual(comparableStats(b, a));
  });
});

describe('eraGaps', () => {
  it('is empty when both players recorded the same stats', () => {
    const a = makeProfile();
    const b = makeProfile();
    expect(eraGaps(a, b)).toEqual([]);
  });

  it('reports a stat only the first player has, with the right side', () => {
    const a = makeProfile({ disposals: 1500 });
    const b = makeProfile({ disposals: null, disposalsRecordedGames: 0 });
    expect(eraGaps(a, b)).toEqual([{ stat: 'disposals', have: 'a' }]);
  });

  it('reports a stat only the second player has, with the right side', () => {
    const a = makeProfile({ disposals: null, disposalsRecordedGames: 0 });
    const b = makeProfile({ disposals: 1500 });
    expect(eraGaps(a, b)).toEqual([{ stat: 'disposals', have: 'b' }]);
  });

  it('does not report a stat neither player has as a gap', () => {
    const a = makeProfile({ hitouts: null });
    const b = makeProfile({ hitouts: null });
    expect(eraGaps(a, b).some((g) => g.stat === 'hitouts')).toBe(false);
  });
});
