import { describe, expect, it } from 'vitest';

import {
  QB_LIMITS,
  emptyState,
  parseQueryState,
  serializeQueryState,
  type QueryBuilderState,
} from '@/search/query-builder-spec';

function tokenFor(payload: unknown): string {
  const json = JSON.stringify(payload);
  let binary = '';
  for (const byte of new TextEncoder().encode(json)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('query builder URL state', () => {
  it('round-trips a populated state through serialize/parse', () => {
    const state = emptyState('matches');
    state.cards[0].card.conditions.push({ column: 'season', op: '=', value: 1989 });
    state.cards.push({ join: 'OR', card: { match: 'OR', conditions: [
      { column: 'venue_raw', op: 'contains', value: 'MCG' },
      { column: 'attendance', op: 'between', lo: 50000, hi: 100000 },
    ] } });

    const token = serializeQueryState(state);
    expect(parseQueryState(token)).toEqual(state);
  });

  it('rejects a token naming an unknown table', () => {
    expect(parseQueryState(tokenFor({ table: 'auth_users', cards: [], page: 1 }))).toBeNull();
  });

  it('rejects a token with more cards than the limit', () => {
    const cards = Array.from({ length: QB_LIMITS.maxCards + 1 }, () => (
      { join: 'AND', card: { match: 'AND', conditions: [] } }
    ));
    expect(parseQueryState(tokenFor({ table: 'players', cards, page: 1 }))).toBeNull();
  });

  it('rejects a card with more conditions than the limit', () => {
    const conditions = Array.from({ length: QB_LIMITS.maxConditionsPerCard + 1 }, () => (
      { column: 'display_name', op: 'equals', value: 'x' }
    ));
    const state = { table: 'players', cards: [{ join: 'AND', card: { match: 'AND', conditions } }], page: 1 };
    expect(parseQueryState(tokenFor(state))).toBeNull();
  });

  it('rejects garbage input rather than throwing', () => {
    expect(parseQueryState('not-valid-base64url!!!')).toBeNull();
    expect(parseQueryState('')).toBeNull();
    expect(parseQueryState(tokenFor('just a string'))).toBeNull();
    expect(parseQueryState(tokenFor(null))).toBeNull();
  });

  it('clamps an out-of-range page rather than failing', () => {
    const state = { table: 'players', cards: [{ join: 'AND', card: { match: 'AND', conditions: [] } }], page: 999999 };
    const restored = parseQueryState(tokenFor(state));
    expect(restored?.page).toBe(QB_LIMITS.maxPage);
  });

  it('emptyState starts with exactly one empty AND card', () => {
    const state: QueryBuilderState = emptyState('clubs');
    expect(state.cards).toEqual([{ join: 'AND', card: { match: 'AND', conditions: [] } }]);
  });
});
