import './guard';

import { afterAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { runQueryBuilder } from '@/db/queries/query-builder';
import type { QueryBuilderState } from '@/search/query-builder-spec';

afterAll(async () => {
  await sql.end();
});

describe('query builder compiler', () => {
  it('reproduces the "debuted in the 1960s, exactly two clubs" regression case (110 players)', async () => {
    // Same known-answer case docs/search.md and release-gates.test.ts assert
    // through runAdvancedSearch -- an independent compiler agreeing on 110
    // is a strong cross-check that the card AST compiles correctly.
    const state: QueryBuilderState = {
      table: 'player_career_stats',
      cards: [{
        join: 'AND',
        card: {
          match: 'AND',
          conditions: [
            { column: 'debut_season', op: 'between', lo: 1960, hi: 1969 },
            { column: 'clubs_played', op: '=', value: 2 },
          ],
        },
      }],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    expect(result.total).toBe(110);
  });

  it('a card\'s AND vs OR match rule changes the result set as expected', async () => {
    const base = (match: 'AND' | 'OR'): QueryBuilderState => ({
      table: 'player_career_stats',
      cards: [{
        join: 'AND',
        card: {
          match,
          conditions: [
            { column: 'games', op: '>=', value: 300 },
            { column: 'premierships', op: '>=', value: 3 },
          ],
        },
      }],
      page: 1,
    });
    const and = await runQueryBuilder(base('AND'));
    const or = await runQueryBuilder(base('OR'));
    expect(and.total).toBeGreaterThan(0);
    // Every player satisfying both conditions also satisfies either one.
    expect(or.total).toBeGreaterThanOrEqual(and.total);
  });

  it('joins two cards with OR and matches a direct SQL count', async () => {
    const state: QueryBuilderState = {
      table: 'player_career_stats',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'games', op: 'between', lo: 0, hi: 5 }] } },
        { join: 'OR', card: { match: 'AND', conditions: [{ column: 'games', op: '>=', value: 300 }] } },
      ],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    const [row] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM player_career_stats
       WHERE (games BETWEEN 0 AND 5) OR (games >= 300)
    `;
    expect(result.total).toBe(Number(row.n));
  });

  it('an empty card (no conditions yet) filters nothing rather than erroring', async () => {
    const state: QueryBuilderState = {
      table: 'clubs',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [] } }],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    const [row] = await sql<{ n: string }[]>`SELECT count(*)::text AS n FROM clubs`;
    expect(result.total).toBe(Number(row.n));
  });

  it('rejects an unknown table', async () => {
    const state = { table: 'auth_users', cards: [], page: 1 } as unknown as QueryBuilderState;
    await expect(runQueryBuilder(state)).rejects.toThrow();
  });

  it('rejects a column that is not in the table\'s catalogue', async () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [{ column: 'password_hash', op: 'equals', value: 'x' }] } }],
      page: 1,
    };
    await expect(runQueryBuilder(state)).rejects.toThrow();
  });

  it('rejects an operator not valid for the column\'s kind', async () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [{ column: 'height_cm', op: 'contains', value: '1' }] } }],
      page: 1,
    };
    await expect(runQueryBuilder(state)).rejects.toThrow();
  });

  it('escapes LIKE wildcards in a "contains" match', async () => {
    // A search for a literal "%" must not become an unbounded wildcard match.
    const state: QueryBuilderState = {
      table: 'clubs',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [{ column: 'name', op: 'contains', value: '%' }] } }],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    expect(result.total).toBe(0);
  });
});
