import { describe, expect, it } from 'vitest';

import { encodeUrlState } from '@/lib/urlState';
import {
  DEFAULT_BOARD_STATE,
  GRID_BUILDERS,
  GRID_LIMITS,
  isAxisComplete,
  parseBoardState,
  serializeBoardState,
  type GridBoardState,
} from '@/search/grid-solver-spec';

function tokenFor(payload: unknown): string {
  return encodeUrlState(payload, GRID_LIMITS.maxStateChars);
}

describe('grid solver URL state', () => {
  it('round-trips the default board through serialize/parse', () => {
    const token = serializeBoardState(DEFAULT_BOARD_STATE);
    expect(parseBoardState(token)).toEqual(DEFAULT_BOARD_STATE);
  });

  it('round-trips a board using every param kind at least once', () => {
    const state: GridBoardState = {
      rows: [
        { builder: 'played_for_club', params: { club: '3' } },
        { builder: 'played_at_venue', params: { venue: '7' } },
        { builder: 'teammate_of', params: { player: '12345' } },
      ],
      cols: [
        { builder: 'career_stat_total_min', params: { stat: 'disposals', x: '250' } },
        { builder: 'debuted_between', params: { from: '1990', to: '1999' } },
        { builder: 'one_club_player', params: {} },
      ],
      order: 'debut_desc',
    };
    const token = serializeBoardState(state);
    expect(parseBoardState(token)).toEqual(state);
  });

  it('round-trips the decimal param kind (career average builders)', () => {
    const state: GridBoardState = {
      ...DEFAULT_BOARD_STATE,
      rows: [
        { builder: 'career_stat_avg_min', params: { stat: 'disposals', avg: '18.5', minGames: '50' } },
        DEFAULT_BOARD_STATE.rows[1],
        DEFAULT_BOARD_STATE.rows[2],
      ],
    };
    const token = serializeBoardState(state);
    expect(parseBoardState(token)).toEqual(state);
  });

  it('rejects a token naming an unknown builder', () => {
    const bad = { ...DEFAULT_BOARD_STATE, rows: [{ builder: 'delete_everything', params: {} }, DEFAULT_BOARD_STATE.rows[1], DEFAULT_BOARD_STATE.rows[2]] };
    expect(parseBoardState(tokenFor(bad))).toBeNull();
  });

  it('rejects a token with the wrong number of rows or columns', () => {
    const tooFewRows = { ...DEFAULT_BOARD_STATE, rows: [DEFAULT_BOARD_STATE.rows[0], DEFAULT_BOARD_STATE.rows[1]] };
    expect(parseBoardState(tokenFor(tooFewRows))).toBeNull();
  });

  it('rejects garbage input rather than throwing', () => {
    expect(parseBoardState('not-valid-base64url!!!')).toBeNull();
    expect(parseBoardState('')).toBeNull();
    expect(parseBoardState(tokenFor('just a string'))).toBeNull();
    expect(parseBoardState(tokenFor(null))).toBeNull();
    expect(parseBoardState(tokenFor({ rows: [], cols: [] }))).toBeNull();
  });

  it('falls back to games_asc for an invalid or missing order', () => {
    const state = { ...DEFAULT_BOARD_STATE, order: 'most_obscure_first' };
    expect(parseBoardState(tokenFor(state))?.order).toBe('games_asc');
  });

  it('truncates an oversized param value rather than failing the whole token', () => {
    // Long enough to exceed the per-value 200-char cap, short enough that
    // the whole encoded token still fits under GRID_LIMITS.maxStateChars --
    // that overall-size check is a separate guard, exercised above.
    const state = {
      ...DEFAULT_BOARD_STATE,
      rows: [{ builder: 'played_for_club', params: { club: 'x'.repeat(1000) } }, DEFAULT_BOARD_STATE.rows[1], DEFAULT_BOARD_STATE.rows[2]],
    };
    const restored = parseBoardState(tokenFor(state));
    expect(restored).not.toBeNull();
    expect(restored!.rows[0].params.club.length).toBe(200);
  });
});

describe('isAxisComplete', () => {
  it('is true for a zero-param builder regardless of params', () => {
    expect(isAxisComplete({ builder: 'one_club_player', params: {} })).toBe(true);
  });

  it('is false when a required param is missing', () => {
    expect(isAxisComplete({ builder: 'played_for_club', params: {} })).toBe(false);
  });

  it('is false when a required param is present but blank', () => {
    expect(isAxisComplete({ builder: 'debuted_between', params: { from: '1990', to: '  ' } })).toBe(false);
  });

  it('is true once every declared param has a non-blank value', () => {
    expect(isAxisComplete({ builder: 'debuted_between', params: { from: '1990', to: '1999' } })).toBe(true);
  });

  it('is false for an unknown builder', () => {
    expect(isAxisComplete({ builder: 'not_a_real_builder', params: {} })).toBe(false);
  });
});

describe('GRID_BUILDERS catalogue', () => {
  it('offers AFLPA 22Under22 selection as a dedicated fixed criterion', () => {
    // 108 before AFLDB-ISSUE-118, which added the 37 builders the Gridley
    // corpus needed (tests/gridley-compat.test.ts holds the mapping), then
    // 6 more when it was reopened: the All-Australian final team (3), the
    // 40-man squad in any season, and the two height bounds.
    expect(Object.keys(GRID_BUILDERS)).toHaveLength(151);
    expect(GRID_BUILDERS.under_22_selection).toEqual({
      key: 'under_22_selection',
      label: 'Selected in AFLPA 22Under22 team',
      group: 'Awards & honours',
      params: [],
    });
  });

  it('gives every builder a label and a group', () => {
    for (const [key, def] of Object.entries(GRID_BUILDERS)) {
      expect(def.key, key).toBe(key);
      expect(def.label.length, key).toBeGreaterThan(0);
      expect(def.group.length, key).toBeGreaterThan(0);
    }
  });

  it('gives every param a unique key within its builder', () => {
    for (const [key, def] of Object.entries(GRID_BUILDERS)) {
      const keys = def.params.map((p) => p.key);
      expect(new Set(keys).size, key).toBe(keys.length);
    }
  });
});
