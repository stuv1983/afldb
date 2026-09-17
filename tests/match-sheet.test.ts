import { describe, expect, it } from 'vitest';

import {
  BROWNLOW_MATCH_SHEET_REFUSAL,
  autoDisposalsFromComponents,
  deriveDisposals,
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
          brownlowVotes: null,
        }],
        removedPlayerIds: [11],
      },
    });
  });

  it.each([
    [{ players: [{ playerId: 1, clubId: 2, goals: -1 }] }, 'invalid goals'],
    [{ players: [{ playerId: 1, clubId: 2 }, { playerId: 1, clubId: 3 }] }, 'appears more than once'],
    [{ players: [{ playerId: 1, clubId: 2 }], removedPlayerIds: [1] }, 'cannot be both active and removed'],
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

  it('auto-fills disposals only from two recorded components', () => {
    expect(autoDisposalsFromComponents('10', '5')).toBe('15');
    expect(autoDisposalsFromComponents('11', '5')).toBe('16');
    expect(autoDisposalsFromComponents('0', '5')).toBe('5');
    expect(autoDisposalsFromComponents('10', '0')).toBe('10');
    expect(autoDisposalsFromComponents('', '5')).toBe('');
    expect(autoDisposalsFromComponents('10', '')).toBe('');
    expect(autoDisposalsFromComponents('', '')).toBe('');
  });

  // AFLDB-ISSUE-155 §27.15: the match sheet is no longer a Brownlow writer.
  // The previously accepted 3/2/1 allocation is now the primary refusal case.
  it.each([
    ['a complete 3-2-1 allocation', [
      { playerId: 1, clubId: 10, brownlowVotes: 3 },
      { playerId: 2, clubId: 10, brownlowVotes: 2 },
      { playerId: 3, clubId: 20, brownlowVotes: 1 },
      { playerId: 4, clubId: 20, brownlowVotes: 0 },
    ]],
    ['an explicit zero on its own', [{ playerId: 1, clubId: 10, brownlowVotes: 0 }]],
    ['a single 3-vote row', [{ playerId: 1, clubId: 10, brownlowVotes: 3 }]],
    ['a value outside the historical range', [{ playerId: 1, clubId: 10, brownlowVotes: 4 }]],
    ['a partial allocation', [
      { playerId: 1, clubId: 10, brownlowVotes: 3 },
      { playerId: 2, clubId: 20, brownlowVotes: 2 },
    ]],
  ])('refuses any Brownlow value from the match sheet: %s', (_label, players) => {
    const result = validateMatchSheetPayload({ players });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(BROWNLOW_MATCH_SHEET_REFUSAL);
  });

  it('names Brownlow administration in the refusal so the editor can redirect', () => {
    expect(BROWNLOW_MATCH_SHEET_REFUSAL).toContain('/admin/brownlow');
  });

  it('still accepts a sheet that carries no Brownlow value at all', () => {
    expect(validateMatchSheetPayload({
      players: [{ playerId: 1, clubId: 10 }, { playerId: 2, clubId: 20 }],
    }).ok).toBe(true);
    expect(validateMatchSheetPayload({
      players: [{ playerId: 1, clubId: 10, brownlowVotes: null }],
    }).ok).toBe(true);
  });

  it('normalises the mirror to null so the writer never carries a vote through', () => {
    const result = validateMatchSheetPayload({
      players: [{ playerId: 1, clubId: 10, goals: 2 }],
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.players[0].brownlowVotes).toBeNull();
  });
});
