import { describe, expect, it } from 'vitest';

import {
  deriveDisposals,
  scoreSyncCoverageError,
  validateMatchSheetPayload,
} from '@/lib/match-sheet';

describe('match-sheet write validation', () => {
  it('accepts and normalises a valid payload', () => {
    const result = validateMatchSheetPayload({
      players: [{
        playerId: 10,
        clubId: 2,
        jumperNumber: ' 7 ',
        kicks: 12,
        handballs: 8,
        disposals: 20,
        brownlowVotes: 3,
      }],
      removedPlayerIds: [11, 11],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        players: [{
          playerId: 10,
          clubId: 2,
          jumperNumber: '7',
          goals: null,
          behinds: null,
          kicks: 12,
          handballs: 8,
          disposals: 20,
          marks: null,
          tackles: null,
          hitouts: null,
          freesFor: null,
          freesAgainst: null,
          brownlowVotes: 3,
        }],
        removedPlayerIds: [11],
      },
    });
  });

  it.each([
    [{ players: [{ playerId: 1, clubId: 2, goals: -1 }] }, 'invalid goals'],
    [{ players: [{ playerId: 1, clubId: 2, brownlowVotes: 4 }] }, 'invalid brownlowVotes'],
    [{ players: [{ playerId: 1, clubId: 2 }, { playerId: 1, clubId: 3 }] }, 'appears more than once'],
    [{ players: [{ playerId: 1, clubId: 2, kicks: 4, handballs: 3, disposals: 8 }] }, 'do not equal'],
    [{ players: 'not-an-array' }, 'must be an array'],
  ])('rejects malformed or unsafe payloads', (payload, message) => {
    const result = validateMatchSheetPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain(message);
  });

  it('derives disposals only when both components are recorded', () => {
    expect(deriveDisposals(10, 5, null)).toBe(15);
    expect(deriveDisposals(10, null, null)).toBeNull();
    expect(deriveDisposals(null, 5, null)).toBeNull();
    expect(deriveDisposals(10, 5, 16)).toBe(16);
  });

  it('requires complete player scoring before synchronizing a match result', () => {
    expect(scoreSyncCoverageError({
      homePlayers: 0,
      awayPlayers: 0,
      homeGoalsRecorded: 0,
      homeBehindsRecorded: 0,
      awayGoalsRecorded: 0,
      awayBehindsRecorded: 0,
    })).toContain('both team lineups');

    expect(scoreSyncCoverageError({
      homePlayers: 2,
      awayPlayers: 2,
      homeGoalsRecorded: 2,
      homeBehindsRecorded: 1,
      awayGoalsRecorded: 2,
      awayBehindsRecorded: 2,
    })).toContain('every player');

    expect(scoreSyncCoverageError({
      homePlayers: 2,
      awayPlayers: 2,
      homeGoalsRecorded: 2,
      homeBehindsRecorded: 2,
      awayGoalsRecorded: 2,
      awayBehindsRecorded: 2,
    })).toBeNull();
  });
});
