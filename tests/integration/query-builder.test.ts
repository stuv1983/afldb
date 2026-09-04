import './guard';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { sql } from '@/db/client';
import { runQueryBuilder } from '@/db/queries/query-builder';
import {
  QB_LIMITS, QUERYABLE_TABLES, RELATIONSHIP_KEYS, relationshipForCard, relationshipsForAnchor,
  type CardGroup, type CardQuantifier, type ConditionSpec, type QueryBuilderState,
} from '@/search/query-builder-spec';

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

  it('folds three cards left-to-right, so an OR join before an AND join binds first', async () => {
    // The regression this exists for: the compiler joined each card to the
    // accumulated result without parenthesising it, so these three cards
    // emitted `A OR B AND C`. SQL binds AND tighter, making that
    // `A OR (B AND C)` -- a different question from the left fold the
    // spec promises, and one that quietly returns different players.
    //
    // The two readings are chosen to give genuinely different counts:
    // every player with 0-5 games has 0 premierships, so the wrong
    // reading collapses the first card away entirely.
    const state: QueryBuilderState = {
      table: 'player_career_stats',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'games', op: 'between', lo: 0, hi: 5 }] } },
        { join: 'OR', card: { match: 'AND', conditions: [{ column: 'games', op: '>=', value: 300 }] } },
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'premierships', op: '>=', value: 1 }] } },
      ],
      page: 1,
    };
    const result = await runQueryBuilder(state);

    const [correct] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM player_career_stats
       WHERE ((games BETWEEN 0 AND 5) OR (games >= 300)) AND (premierships >= 1)
    `;
    const [wrong] = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM player_career_stats
       WHERE (games BETWEEN 0 AND 5) OR ((games >= 300) AND (premierships >= 1))
    `;

    expect(result.total).toBe(Number(correct.n));
    // Guards the test itself: if these ever coincide the case proves nothing.
    expect(Number(correct.n)).not.toBe(Number(wrong.n));
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

/**
 * AFLDB-ISSUE-115 Stage 3 -- semantic proof of multi-domain composition.
 *
 * Every case is proved against an independently written SQL oracle over
 * the same afldb_test snapshot (the pattern the cases above already use).
 * The oracles deliberately use a DIFFERENT formulation from the compiler
 * (JOIN on the 1:1 career row, `IN (subquery)`, `LEFT JOIN ... IS NULL`
 * over a DISTINCT set) so that agreement is evidence, not tautology.
 */
describe('query builder compiler -- multi-domain cards (ISSUE-115)', () => {
  const count = async (query: Promise<{ n: string }[]>): Promise<number> => {
    const [row] = await query;
    return Number(row.n);
  };

  it('T-C1: two-domain AND matches an independent JOIN-based count', async () => {
    // Players debuting in the 1960s whose career row shows 100+ games.
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'debut_season', op: 'between', lo: 1960, hi: 1969 }] } },
        { join: 'AND', card: { domain: 'player.career', match: 'AND', conditions: [{ column: 'games', op: '>=', value: 100 }] } },
      ],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    const oracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.debut_season BETWEEN 1960 AND 1969 AND c.games >= 100
    `);
    expect(oracle).toBeGreaterThan(0);
    expect(result.total).toBe(oracle);
    expect(result.columns).toEqual(['display_name', 'debut_season', 'final_season', 'dob', 'height_cm']);
  });

  it('T-C2: two-domain OR matches an independent IN-based count', async () => {
    // Players who debuted in the 1960s (the anchor operand, known populated
    // from the 110-player regression case) OR with a 300-game career -- both
    // operands are scalar booleans on the player row, so OR needs no
    // special handling (§6.5). The two sets overlap (some 300-game players
    // debuted in the 1960s) without either containing the other.
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'debut_season', op: 'between', lo: 1960, hi: 1969 }] } },
        { join: 'OR', card: { domain: 'player.career', match: 'AND', conditions: [{ column: 'games', op: '>=', value: 300 }] } },
      ],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    const oracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players p
       WHERE p.debut_season BETWEEN 1960 AND 1969
          OR p.id IN (SELECT player_id FROM player_career_stats WHERE games >= 300)
    `);
    expect(result.total).toBe(oracle);

    // Guards the test by inclusion-exclusion rather than by assuming the
    // dataset keeps the two operands from nesting: both operands must be
    // non-empty, the OR total must be exactly |A| + |B| - |A AND B|, and
    // neither operand may swallow the other.
    const sixties = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players WHERE debut_season BETWEEN 1960 AND 1969
    `);
    const longCareer = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players p
       WHERE p.id IN (SELECT player_id FROM player_career_stats WHERE games >= 300)
    `);
    const both = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players p
       WHERE p.debut_season BETWEEN 1960 AND 1969
         AND p.id IN (SELECT player_id FROM player_career_stats WHERE games >= 300)
    `);
    expect(sixties).toBeGreaterThan(0);
    expect(longCareer).toBeGreaterThan(0);
    expect(result.total).toBe(sixties + longCareer - both);
    expect(result.total).toBeGreaterThan(sixties);
    expect(result.total).toBeGreaterThan(longCareer);
  });

  it('T-C3: three-domain composition (Players + career + match stats) matches an independent count', async () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'debut_season', op: 'between', lo: 1990, hi: 1999 }] } },
        { join: 'AND', card: { domain: 'player.career', match: 'AND', conditions: [{ column: 'games', op: '>=', value: 200 }] } },
        { join: 'AND', card: { domain: 'player.match_stats', match: 'AND', conditions: [{ column: 'goals', op: '>=', value: 8 }] } },
      ],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    const oracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.debut_season BETWEEN 1990 AND 1999
         AND c.games >= 200
         AND p.id IN (SELECT player_id FROM player_match_stats WHERE goals >= 8)
    `);
    expect(oracle).toBeGreaterThan(0);
    expect(result.total).toBe(oracle);
  });

  it('T-C4: "no such row" compiles as NOT EXISTS and equals an independent absence oracle', async () => {
    // Motivating question 1: 100+ career games but no player-match rows.
    // The oracle is a LEFT JOIN over the DISTINCT player set -- a different
    // formulation from the compiler's NOT EXISTS.
    const withNone: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { domain: 'player.career', match: 'AND', conditions: [{ column: 'games', op: '>=', value: 100 }] } },
        { join: 'AND', card: { domain: 'player.match_stats', quantifier: 'none', match: 'AND', conditions: [] } },
      ],
      page: 1,
    };
    const careerOnly: QueryBuilderState = { ...withNone, cards: [withNone.cards[0]] };

    const result = await runQueryBuilder(withNone);
    const superset = await runQueryBuilder(careerOnly);
    const oracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n
        FROM players p
        JOIN player_career_stats c ON c.player_id = p.id
        LEFT JOIN (SELECT DISTINCT player_id FROM player_match_stats) s ON s.player_id = p.id
       WHERE c.games >= 100 AND s.player_id IS NULL
    `);
    expect(result.total).toBe(oracle);
    // Strict subset of the games >= 100 set.
    expect(superset.total).toBeGreaterThan(0);
    expect(result.total).toBeLessThan(superset.total);

    // The complementary "has at least one such row" (empty related card,
    // quantifier any -- §6.2) partitions the superset exactly.
    const withAny: QueryBuilderState = {
      ...withNone,
      cards: [withNone.cards[0], { join: 'AND', card: { domain: 'player.match_stats', match: 'AND', conditions: [] } }],
    };
    const any = await runQueryBuilder(withAny);
    expect(any.total + result.total).toBe(superset.total);
  });

  it('T-C5: a one-to-many card produces no duplicate anchor rows', async () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'player.match_stats', match: 'AND', conditions: [{ column: 'goals', op: '>=', value: 5 }] } }],
      page: 1,
    };
    const result = await runQueryBuilder(state);
    const inOracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players p
       WHERE p.id IN (SELECT player_id FROM player_match_stats WHERE goals >= 5)
    `);
    const distinctOracle = await count(sql<{ n: string }[]>`
      SELECT count(DISTINCT p.id)::text AS n
        FROM players p JOIN player_match_stats s ON s.player_id = p.id
       WHERE s.goals >= 5
    `);
    const multiplied = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n
        FROM players p JOIN player_match_stats s ON s.player_id = p.id
       WHERE s.goals >= 5
    `);
    expect(result.total).toBe(inOracle);
    expect(result.total).toBe(distinctOracle);
    // Guards the test: a naive JOIN WOULD multiply, so agreement is meaningful.
    expect(multiplied).toBeGreaterThan(result.total);
  });

  it('T-C6: an unreachable anchor/domain pair fails closed at runQueryBuilder', async () => {
    // Bypasses parseQueryState entirely: the compiler must reject on its own.
    const clubSeasonsFromPlayers: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'club.club_seasons', match: 'AND', conditions: [] } }],
      page: 1,
    };
    await expect(runQueryBuilder(clubSeasonsFromPlayers)).rejects.toThrow(/cannot be queried/);

    // `matches` deliberately declares no `club` subject (§5.1).
    const clubMatchesFromMatches: QueryBuilderState = {
      table: 'matches',
      cards: [{ join: 'AND', card: { domain: 'club.matches', match: 'AND', conditions: [] } }],
      page: 1,
    };
    await expect(runQueryBuilder(clubMatchesFromMatches)).rejects.toThrow(/cannot be queried/);

    const unknownDomain: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'player.auth_users', match: 'AND', conditions: [] } }],
      page: 1,
    };
    await expect(runQueryBuilder(unknownDomain)).rejects.toThrow();
  });

  it('T-C7: a column from another domain inside a card is rejected', async () => {
    // An anchor column inside a related card ...
    const anchorColumnInRelated: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'player.career', match: 'AND', conditions: [{ column: 'display_name', op: 'equals', value: 'x' }] } }],
      page: 1,
    };
    await expect(runQueryBuilder(anchorColumnInRelated)).rejects.toThrow(/Unknown column/);

    // ... a related column inside an anchor card ...
    const relatedColumnInAnchor: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [{ column: 'games', op: '>=', value: 1 }] } }],
      page: 1,
    };
    await expect(runQueryBuilder(relatedColumnInAnchor)).rejects.toThrow(/Unknown column/);

    // ... and the existing password_hash case, on the related-card path.
    const secretInRelated: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'player.link_candidates', match: 'AND', conditions: [{ column: 'password_hash', op: 'equals', value: 'x' }] } }],
      page: 1,
    };
    await expect(runQueryBuilder(secretInRelated)).rejects.toThrow(/Unknown column/);
  });

  it('T-C8: LIKE wildcards are still escaped inside a related-domain subquery', async () => {
    const wildcard: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'player.clubs', match: 'AND', conditions: [{ column: 'club', op: 'contains', value: '%' }] } }],
      page: 1,
    };
    const result = await runQueryBuilder(wildcard);
    expect(result.total).toBe(0);

    // Positive control: the same subquery path with a real value does match.
    const literal: QueryBuilderState = {
      table: 'players',
      cards: [{ join: 'AND', card: { domain: 'player.clubs', match: 'AND', conditions: [{ column: 'club', op: 'contains', value: 'Carlton' }] } }],
      page: 1,
    };
    const control = await runQueryBuilder(literal);
    const oracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players p
       WHERE p.id IN (SELECT pc.player_id FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
                       WHERE cl.name ILIKE '%Carlton%')
    `);
    expect(control.total).toBe(oracle);
    expect(control.total).toBeGreaterThan(0);
  });

  it('T-C9: the anchor alone decides the returned grain and columns for the same card set', async () => {
    // Same related card under two anchors that both provide the `player`
    // subject. (player.career is not used: it is self-equivalent under the
    // career anchor -- see T-C12.)
    const card = { join: 'AND' as const, card: { domain: 'player.match_stats', match: 'AND' as const, conditions: [{ column: 'goals', op: '>=', value: 8 }] } };
    const players = await runQueryBuilder({ table: 'players', cards: [card], page: 1 });
    const career = await runQueryBuilder({ table: 'player_career_stats', cards: [card], page: 1 });

    expect(players.columns).toEqual(['display_name', 'debut_season', 'final_season', 'dob', 'height_cm']);
    expect(career.columns).toEqual(['display_name', 'games', 'goals', 'finals', 'premierships', 'brownlow_votes']);
    expect(Object.keys(players.rows[0]).sort()).toEqual([...players.columns].sort());
    expect(Object.keys(career.rows[0]).sort()).toEqual([...career.columns].sort());

    const playersOracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM players p
       WHERE p.id IN (SELECT player_id FROM player_match_stats WHERE goals >= 8)
    `);
    const careerOracle = await count(sql<{ n: string }[]>`
      SELECT count(*)::text AS n
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE p.id IN (SELECT player_id FROM player_match_stats WHERE goals >= 8)
    `);
    expect(players.total).toBe(playersOracle);
    expect(career.total).toBe(careerOracle);
    expect(career.total).toBeLessThanOrEqual(players.total);
  });

  it('T-C10: the curated club_is_participant predicate under the Matches anchor equals an independent oracle', async () => {
    // Motivating question 7: matches containing a player row whose club is
    // neither participating club.
    const isFalse: QueryBuilderState = {
      table: 'matches',
      cards: [{ join: 'AND', card: { domain: 'match.player_stats', match: 'AND', conditions: [{ column: 'club_is_participant', op: 'is false' }] } }],
      page: 1,
    };
    const result = await runQueryBuilder(isFalse);
    // `(x IN (a, b)) IS FALSE` is false for a NULL club_id, so the oracle
    // requires a non-null club that differs from both participants. Written
    // as a plain join + count(DISTINCT match) -- a different (and cheap,
    // hash-joinable) formulation from the compiler's correlated EXISTS.
    const oracle = await count(sql<{ n: string }[]>`
      SELECT count(DISTINCT s.match_id)::text AS n
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE s.club_id IS NOT NULL
         AND s.club_id <> m.home_club_id
         AND s.club_id <> m.away_club_id
    `);
    expect(result.total).toBe(oracle);

    // Positive control on the same predicate: "is true" is the ordinary case.
    const isTrue: QueryBuilderState = {
      ...isFalse,
      cards: [{ join: 'AND', card: { domain: 'match.player_stats', match: 'AND', conditions: [{ column: 'club_is_participant', op: 'is true' }] } }],
    };
    const control = await runQueryBuilder(isTrue);
    const controlOracle = await count(sql<{ n: string }[]>`
      SELECT count(DISTINCT s.match_id)::text AS n
        FROM player_match_stats s JOIN matches m ON m.id = s.match_id
       WHERE s.club_id IN (m.home_club_id, m.away_club_id)
    `);
    expect(control.total).toBe(controlOracle);
    expect(control.total).toBeGreaterThan(0);
    expect(result.columns).toEqual(['season', 'round_code', 'match_date', 'home_score', 'away_score', 'venue_raw']);
  });

  it('T-C12: a self-equivalent domain fails closed at runQueryBuilder, not only at parse', async () => {
    // player.career targets the very row the player_career_stats anchor returns (§5.9).
    const selfEquivalent: QueryBuilderState = {
      table: 'player_career_stats',
      cards: [{ join: 'AND', card: { domain: 'player.career', match: 'AND', conditions: [{ column: 'games', op: '>=', value: 100 }] } }],
      page: 1,
    };
    await expect(runQueryBuilder(selfEquivalent)).rejects.toThrow(/cannot be queried/);

    expect(relationshipForCard('player_career_stats', 'player.career')).toBeNull();

    // player.match_stats under the player_match_stats anchor was reachable
    // through Stage 4 (the §5.9 rule does not fire on a cardinality-many
    // relationship). Stage 5 measured every related shape under that
    // anchor RED -- this one exceeded the 5 s statement timeout in both
    // forms -- and the operator approved the §9.3 final branch: the anchor
    // hosts no related cards in V1 (runbook §20.5). It must now fail closed
    // at the compiler, before any SQL, exactly like a self-equivalent pair.
    const excludedUnderPms: QueryBuilderState = {
      table: 'player_match_stats',
      cards: [{ join: 'AND', card: { domain: 'player.match_stats', match: 'AND', conditions: [{ column: 'goals', op: '>=', value: 8 }] } }],
      page: 1,
    };
    expect(relationshipForCard('player_match_stats', 'player.match_stats')).toBeNull();
    await expect(runQueryBuilder(excludedUnderPms)).rejects.toThrow(/cannot be queried/);
    // The anchor itself is untouched: an anchor-domain card still runs.
    const anchorOnly: QueryBuilderState = {
      table: 'player_match_stats',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [{ column: 'goals', op: '>=', value: 10 }] } }],
      page: 1,
    };
    const rows = await runQueryBuilder(anchorOnly);
    expect(rows.total).toBeGreaterThan(0);
    expect(rows.columns).toEqual(['display_name', 'match_date', 'club', 'kicks', 'disposals', 'goals']);
  });
});

/**
 * AFLDB-ISSUE-116 -- the page/total split.
 *
 * runQueryBuilder used to carry the total on every page row as
 * `count(*) OVER ()`. The planner costs that as a fast-start ordered walk
 * but the window aggregate must consume every qualifying row before the
 * first one can be emitted, so the LIMIT bought nothing and the
 * player_match_stats anchor cost 1.0-1.4 s with no card at all. The page
 * and the total are now two statements read inside one REPEATABLE READ
 * READ ONLY transaction -- one snapshot, so the total still describes
 * exactly the relation the page was drawn from.
 *
 * These cases pin the semantics the split must not change (exact total,
 * exact rows, exact order, exact OFFSET, bound values in BOTH statements)
 * and the one it deliberately corrects: a page past the end used to report
 * total 0, because the total rode on a row that did not exist.
 */
describe('query builder compiler -- page/total split (ISSUE-116)', () => {
  // The 110-row known-answer set the first case in this file already uses.
  // Its default sort (`c.games DESC, p.sort_name`) is a TOTAL order over
  // these rows -- no (games, sort_name) pair repeats within the set -- so
  // the page slices asserted below are deterministic rather than
  // tie-break-dependent.
  const sixtiesTwoClubs = (page: number): QueryBuilderState => ({
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
    page,
  });

  it('T-E1: the total is the whole match count on every page, including a page past the end', async () => {
    const p1 = await runQueryBuilder(sixtiesTwoClubs(1));
    const p3 = await runQueryBuilder(sixtiesTwoClubs(3));
    const p4 = await runQueryBuilder(sixtiesTwoClubs(4));

    expect(p1.total).toBe(110);
    expect(p1.rows).toHaveLength(QB_LIMITS.defaultPageSize);
    expect(p3.total).toBe(110);
    expect(p3.rows).toHaveLength(10);

    // RED before ISSUE-116: the total was read off the page's first row, so
    // an out-of-range page reported total 0 and the page said "No rows
    // match" for a query with 110 matches.
    expect(p4.rows).toHaveLength(0);
    expect(p4.total).toBe(110);
  });

  it('T-E2: the pages partition the ordered result set exactly, in the same order', async () => {
    const paged: Record<string, unknown>[] = [];
    for (const page of [1, 2, 3]) {
      const result = await runQueryBuilder(sixtiesTwoClubs(page));
      expect(result.total).toBe(110);
      paged.push(...result.rows);
    }

    const oracle = await sql<{ display_name: string; games: number }[]>`
      SELECT p.display_name, c.games
        FROM players p JOIN player_career_stats c ON c.player_id = p.id
       WHERE c.debut_season BETWEEN 1960 AND 1969 AND c.clubs_played = 2
       ORDER BY c.games DESC, p.sort_name
    `;

    expect(paged).toHaveLength(oracle.length);
    expect(paged.map((row) => row.display_name)).toEqual(oracle.map((row) => row.display_name));
    expect(paged.map((row) => row.games)).toEqual(oracle.map((row) => row.games));
    // OFFSET is exact: no anchor row is repeated or skipped across pages.
    expect(new Set(paged.map((row) => `${row.display_name}|${row.games}`)).size).toBe(oracle.length);
  });

  it('T-E3: a related-domain NOT EXISTS total equals an independent count, and the page is its ordered head', async () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [{
        join: 'AND',
        card: {
          domain: 'player.captaincies',
          quantifier: 'none',
          match: 'AND',
          conditions: [{ column: 'link_status', op: 'equals', value: 'unique' }],
        },
      }],
      page: 1,
    };
    const result = await runQueryBuilder(state);

    const [oracle] = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n
        FROM players p
       WHERE NOT EXISTS (
         SELECT 1 FROM captaincies r_cap JOIN clubs r_ccl ON r_ccl.id = r_cap.club_id
          WHERE r_cap.player_id = p.id AND r_cap.link_status_value::text = 'unique'
       )
    `;
    expect(result.total).toBe(oracle.n);
    expect(result.total).toBeGreaterThan(QB_LIMITS.defaultPageSize);
    expect(result.rows).toHaveLength(QB_LIMITS.defaultPageSize);

    const head = await sql<{ display_name: string }[]>`
      SELECT p.display_name
        FROM players p
       WHERE NOT EXISTS (
         SELECT 1 FROM captaincies r_cap JOIN clubs r_ccl ON r_ccl.id = r_cap.club_id
          WHERE r_cap.player_id = p.id AND r_cap.link_status_value::text = 'unique'
       )
       ORDER BY p.sort_name
       LIMIT ${QB_LIMITS.defaultPageSize}
    `;
    expect(result.rows.map((row) => row.display_name)).toEqual(head.map((row) => row.display_name));
  });

  it('T-E4: the count statement binds its values too, so nothing typed reaches it as SQL', async () => {
    // The total is now its own statement, so the parameterisation wall has
    // to stand there as well: SQL punctuation must be matched literally.
    // Unbound, this value would flip the predicate open and total every club.
    const injected = (page: number): QueryBuilderState => ({
      table: 'clubs',
      cards: [{
        join: 'AND',
        card: { match: 'AND', conditions: [{ column: 'name', op: 'contains', value: "%' OR '1'='1" }] },
      }],
      page,
    });

    // Page 1 takes the short-page path -- the page itself proves total 0.
    const first = await runQueryBuilder(injected(1));
    expect(first.total).toBe(0);
    expect(first.rows).toHaveLength(0);

    // Page 2 is an empty page at a non-zero offset, the one case that must
    // ask the count statement. If that statement spliced the value instead
    // of binding it, the predicate would open and the total would be every
    // club rather than none.
    const second = await runQueryBuilder(injected(2));
    expect(second.total).toBe(0);
    expect(second.rows).toHaveLength(0);

    const [all] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM clubs`;
    expect(all.n).toBeGreaterThan(0);
  });
});

describe('query builder compiler -- cost gate (ISSUE-115 T-C11)', () => {
  // Runbook §9.3. Obligation A is the normal 5 s statement timeout
  // (AFLDB_STATEMENT_TIMEOUT_MS, default 5000 -- never raised): a query that
  // hits it surfaces here as a thrown error, not as a slow pass. Obligation B
  // is the acceptance target: every V1 relationship, as EXISTS and as NOT
  // EXISTS, comfortably under 1 s as a single compiled query. The timing
  // shape is the one grid-solver.test.ts:392-395 already uses. A case that
  // measures close to the bound may have ITS bound widened, below 5 s, with
  // the measured value recorded in the issue -- the gate is never deleted.
  const BOUND_MS = 1000;
  const CEILING_MS = 5000;
  // Vitest's own per-test limit, NOT a query bound: a case measures many
  // queries in sequence and must be allowed to finish measuring and print
  // every timing even when several of them hit the 5 s statement timeout
  // (the first Stage 5 run lost its assertions to the 30 s default).
  const HARNESS_TIMEOUT_MS = 300_000;

  type Timed = { label: string; ms: number; boundMs: number; total: number | null; error?: string };

  const related = (
    domain: string,
    quantifier: CardQuantifier,
    conditions: ConditionSpec[] = [],
    join: 'AND' | 'OR' = 'AND',
  ): CardGroup => ({
    join,
    card: quantifier === 'none'
      ? { domain, quantifier, match: 'AND', conditions }
      : { domain, match: 'AND', conditions },
  });

  // Every case is measured before any is asserted, so one slow shape cannot
  // hide the others' timings; a statement timeout is recorded as that case's
  // error for the same reason, and fails it below.
  const timed = async (label: string, state: QueryBuilderState, boundMs = BOUND_MS): Promise<Timed> => {
    const started = performance.now();
    try {
      const result = await runQueryBuilder(state);
      return { label, ms: performance.now() - started, boundMs, total: result.total };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { label, ms: performance.now() - started, boundMs, total: null, error };
    }
  };

  const assertAll = (rows: Timed[]) => {
    // Printed so the measured values can be recorded in the issue (§9.3).
    console.info(rows.map((r) => (
      `${r.ms.toFixed(1).padStart(8)} ms  total=${String(r.total ?? 'ERROR').padStart(7)}  ${r.label}${r.error ? `  -- ${r.error}` : ''}`
    )).join('\n'));
    for (const r of rows) {
      expect(r.error, `${r.label} failed: ${r.error}`).toBeUndefined();
      expect(r.ms, `${r.label} took ${r.ms.toFixed(1)} ms`).toBeLessThan(r.boundMs);
    }
  };

  beforeAll(async () => {
    // Open the pool connection before the first measurement, so the first
    // case is charged for its query and not for the handshake.
    await sql`SELECT 1`;
  });

  it('cost: every reachable anchor x relationship pair as a bare related card, EXISTS and NOT EXISTS', async () => {
    // Supported V1 = every pair relationshipsForAnchor offers. The
    // player_match_stats anchor offers none (Stage 5 §9.3 exclusion; its
    // measured shapes are preserved in runbook §20.5), so it contributes no
    // pair here while remaining a valid anchor.
    expect(relationshipsForAnchor('player_match_stats')).toEqual([]);
    const rows: Timed[] = [];
    const covered = new Set<string>();
    for (const anchorKey of Object.keys(QUERYABLE_TABLES)) {
      for (const rel of relationshipsForAnchor(anchorKey)) {
        covered.add(rel.key);
        for (const quantifier of ['any', 'none'] as const) {
          rows.push(await timed(
            `${anchorKey} x ${rel.key} ${quantifier === 'none' ? 'NOT EXISTS' : 'EXISTS'}`,
            { table: anchorKey, cards: [related(rel.key, quantifier)], page: 1 },
          ));
        }
      }
    }
    // Every V1 relationship was exercised, from every anchor it is reachable from.
    expect([...covered].sort()).toEqual([...RELATIONSHIP_KEYS].sort());
    assertAll(rows);
  }, HARNESS_TIMEOUT_MS);

  it('cost: the player_match_stats-target shapes with a related condition, and the partial-index relationships', async () => {
    const goals8: ConditionSpec = { column: 'goals', op: '>=', value: 8 };
    const disposals30: ConditionSpec = { column: 'disposals', op: '>=', value: 30 };
    const notParticipant: ConditionSpec = { column: 'club_is_participant', op: 'is false' };
    const linkUnique: ConditionSpec = { column: 'link_status', op: 'equals', value: 'unique' };
    const one = (table: string, group: CardGroup): QueryBuilderState => ({ table, cards: [group], page: 1 });
    const rows: Timed[] = [
      // Reference points: the anchors alone, so a related card's cost can be
      // read as the difference. player_match_stats alone measured 1072 ms in
      // ISSUE-115 Stage 5 and 1144 ms at the start of ISSUE-116 -- above the
      // related-card target with no card at all, which is why that anchor
      // hosts none (runbook §20.5). ISSUE-116 split the total off the page
      // query, so this anchor is now held to the same BOUND_MS target as
      // every other shape here rather than to the 5 s ceiling: it is the
      // regression gate for that fix, and the reason the two other anchors
      // stay on CEILING_MS is only that they were never the defect.
      await timed('players (anchor alone)', { table: 'players', cards: [], page: 1 }, CEILING_MS),
      await timed('matches (anchor alone)', { table: 'matches', cards: [], page: 1 }, CEILING_MS),
      await timed('player_match_stats (anchor alone)', { table: 'player_match_stats', cards: [], page: 1 }),
      // Every relationship whose target is player_match_stats (685k rows),
      // conditioned, under each anchor that offers it.
      await timed('players x player.match_stats EXISTS goals>=8', one('players', related('player.match_stats', 'any', [goals8]))),
      await timed('players x player.match_stats NOT EXISTS goals>=8', one('players', related('player.match_stats', 'none', [goals8]))),
      await timed('player_career_stats x player.match_stats EXISTS goals>=8', one('player_career_stats', related('player.match_stats', 'any', [goals8]))),
      await timed('player_career_stats x player.match_stats NOT EXISTS goals>=8', one('player_career_stats', related('player.match_stats', 'none', [goals8]))),
      await timed('matches x match.player_stats EXISTS club_is_participant IS FALSE', one('matches', related('match.player_stats', 'any', [notParticipant]))),
      await timed('matches x match.player_stats NOT EXISTS club_is_participant IS FALSE', one('matches', related('match.player_stats', 'none', [notParticipant]))),
      await timed('matches x match.player_stats EXISTS disposals>=30', one('matches', related('match.player_stats', 'any', [disposals30]))),
      await timed('matches x match.player_stats NOT EXISTS disposals>=30', one('matches', related('match.player_stats', 'none', [disposals30]))),
      // ix_draft_player / ix_captaincies_player are partial on
      // `player_id IS NOT NULL`, which the correlation implies (§9.4, §20.5).
      await timed('players x player.draft_picks NOT EXISTS link_status=unique', one('players', related('player.draft_picks', 'none', [linkUnique]))),
      await timed('players x player.captaincies NOT EXISTS link_status=unique', one('players', related('player.captaincies', 'none', [linkUnique]))),
    ];
    assertAll(rows);
  }, HARNESS_TIMEOUT_MS);

  it('cost: QB_LIMITS.maxRelatedCards concurrent related cards over player_match_stats-target relationships', async () => {
    // §9.1: maxRelatedCards is provisional and evidence-gated by this case.
    // If these shapes cannot meet the acceptance target the limit is reduced
    // -- the timeout is never raised. Built from the limit itself, so a
    // reduced limit re-scopes the case rather than contradicting it.
    const n = QB_LIMITS.maxRelatedCards;
    const pms = (q: CardQuantifier, c: ConditionSpec, join: 'AND' | 'OR' = 'AND') => related('player.match_stats', q, [c], join);

    // Four player.match_stats cards under the Players anchor, mixed
    // quantifiers and one OR join: (((A AND B) AND NOT C) OR D).
    const playersMax: QueryBuilderState = {
      table: 'players',
      cards: [
        pms('any', { column: 'goals', op: '>=', value: 5 }),
        pms('any', { column: 'disposals', op: '>=', value: 30 }),
        pms('none', { column: 'goals', op: '>=', value: 10 }),
        pms('any', { column: 'brownlow_votes', op: '>=', value: 1 }, 'OR'),
      ].slice(0, n),
      page: 1,
    };
    // The maximal supported query: maxCards cards -- two anchor cards on the
    // career anchor and the whole related budget spent on the 685k-row
    // player_match_stats target, all AND-joined so every subquery must run.
    const careerMax: QueryBuilderState = {
      table: 'player_career_stats',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'games', op: '>=', value: 50 }] } },
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'debut_season', op: 'between', lo: 1990, hi: 2010 }] } },
        ...[
          pms('any', { column: 'goals', op: '>=', value: 5 }),
          pms('any', { column: 'disposals', op: '>=', value: 30 }),
          pms('none', { column: 'goals', op: '>=', value: 10 }),
          pms('none', { column: 'brownlow_votes', op: '>=', value: 3 }),
        ].slice(0, n),
      ],
      page: 1,
    };
    expect(careerMax.cards.length).toBeLessThanOrEqual(QB_LIMITS.maxCards);

    assertAll([
      await timed(`players x ${n} related player.match_stats cards`, playersMax),
      await timed(`player_career_stats x 2 anchor cards + ${n} related player.match_stats cards`, careerMax),
    ]);
  }, HARNESS_TIMEOUT_MS);
});
