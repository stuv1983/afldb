import { describe, expect, it } from 'vitest';

import { decodeUrlState } from '@/lib/urlState';
import {
  ANCHOR_ALIASES,
  QB_LIMITS,
  QUERYABLE_TABLES,
  RELATIONSHIPS,
  RELATIONSHIP_KEYS,
  SUBJECT_ALIASES,
  TABLE_KEYS,
  changeAnchor,
  describeCard,
  domainColumns,
  emptyState,
  parseQueryState,
  relationshipsForAnchor,
  serializeQueryState,
  setCardDomain,
  setCardQuantifier,
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

// ---------------------------------------------------------------------------
// AFLDB-ISSUE-115 — anchors, relationships and multi-domain cards.
// ---------------------------------------------------------------------------

/** `table alias` pairs a FROM fragment declares: the leading pair and every `JOIN table alias`. */
function declaredAliases(from: string): string[] {
  const aliases: string[] = [];
  for (const m of from.matchAll(/(?:^|\bJOIN\s+)(\w+)\s+(\w+)/g)) aliases.push(m[2]);
  return aliases;
}

/** Every `alias.` qualifier used in a SQL fragment. */
function qualifiers(sqlText: string): string[] {
  return [...new Set([...sqlText.matchAll(/\b([A-Za-z_]\w*)\./g)].map((m) => m[1]))];
}

describe('query builder relationship catalogue (AFLDB-ISSUE-115)', () => {
  it('T-A1: every anchor declares each of its subjects under the canonical alias in its own FROM', () => {
    for (const key of TABLE_KEYS) {
      const anchor = QUERYABLE_TABLES[key];
      const aliases = declaredAliases(anchor.from);
      if (key === 'player_match_stats') {
        // The one evidence-driven exception (Stage 5 §9.3, operator-approved,
        // runbook §20.5): this anchor deliberately declares NO subject, so it
        // hosts no related-domain cards in V1. Asserted exactly, not skipped,
        // so a silently re-added subject fails here too.
        expect(anchor.subjects, `${key} hosts no related cards in V1`).toEqual([]);
      } else {
        expect(anchor.subjects.length, `${key} declares at least one subject`).toBeGreaterThan(0);
      }
      for (const subject of anchor.subjects) {
        expect(aliases, `${key} FROM must alias subject ${subject} as ${SUBJECT_ALIASES[subject]}`)
          .toContain(SUBJECT_ALIASES[subject]);
      }
      // The anchor namespace really is the closed set the subqueries stay clear of.
      for (const alias of aliases) expect(ANCHOR_ALIASES).toContain(alias);
    }
  });

  it('T-A2: every subqueryFrom uses only r_-prefixed aliases, disjoint from the anchor namespace', () => {
    for (const key of RELATIONSHIP_KEYS) {
      const rel = RELATIONSHIPS[key];
      const aliases = declaredAliases(rel.subqueryFrom);
      expect(aliases.length, `${key} declares at least one alias`).toBeGreaterThan(0);
      for (const alias of aliases) {
        expect(alias, `${key} alias ${alias}`).toMatch(/^r_\w+$/);
        expect(ANCHOR_ALIASES as readonly string[]).not.toContain(alias);
      }
      // ON clauses may only reference aliases the fragment itself declares.
      for (const q of qualifiers(rel.subqueryFrom)) expect(aliases, `${key} qualifier ${q}`).toContain(q);
    }
  });

  it('T-A3: every correlation references its subject alias and otherwise only its own r_ aliases', () => {
    for (const key of RELATIONSHIP_KEYS) {
      const rel = RELATIONSHIPS[key];
      const subjectAlias = SUBJECT_ALIASES[rel.subject];
      const own = declaredAliases(rel.subqueryFrom);
      const used = qualifiers(rel.correlation);
      expect(used, `${key} correlation binds to ${subjectAlias}`).toContain(subjectAlias);
      for (const q of used) {
        expect(q === subjectAlias || own.includes(q), `${key} correlation qualifier ${q}`).toBe(true);
      }
      // Historical club identity: correlate on club_id, never organization_id.
      expect(rel.correlation + rel.subqueryFrom).not.toMatch(/organization_id/);
    }
  });

  it('T-A4: every relationship column is qualified with its own r_ aliases (a curated predicate may add the subject alias)', () => {
    for (const key of RELATIONSHIP_KEYS) {
      const rel = RELATIONSHIPS[key];
      const own = declaredAliases(rel.subqueryFrom);
      const subjectAlias = SUBJECT_ALIASES[rel.subject];
      for (const [colKey, col] of Object.entries(rel.columns)) {
        expect(col.key).toBe(colKey);
        const used = qualifiers(col.column);
        expect(used.length, `${key}.${colKey} is qualified`).toBeGreaterThan(0);
        for (const q of used) {
          expect(own.includes(q) || q === subjectAlias, `${key}.${colKey} qualifier ${q}`).toBe(true);
        }
      }
    }
    // The one curated relational predicate in V1 is where it was designed to be.
    expect(RELATIONSHIPS['match.player_stats'].columns.club_is_participant.kind).toBe('boolean');
  });

  it('T-B7: relationship depth is exactly one and no relationship names another', () => {
    expect(QB_LIMITS.maxRelationshipDepth).toBe(1);
    for (const key of RELATIONSHIP_KEYS) {
      const text = JSON.stringify(RELATIONSHIPS[key]);
      for (const other of RELATIONSHIP_KEYS) {
        if (other !== key) expect(text, `${key} must not reference ${other}`).not.toContain(`"${other}"`);
      }
    }
  });

  it('T-B8: self-equivalent domains are unreachable; genuinely different ones are offered', () => {
    const forCareer = relationshipsForAnchor('player_career_stats').map((r) => r.key);
    expect(forCareer).not.toContain('player.career');
    expect(forCareer).toContain('player.match_stats');

    const forPlayers = relationshipsForAnchor('players').map((r) => r.key);
    expect(forPlayers).toContain('player.career');

    // Stage 5 (§9.3, operator-approved): the player_match_stats anchor hosts
    // no related-domain cards in V1 -- excluded by evidence, not by the
    // self-equivalence rule (runbook §20.5). It remains an anchor.
    expect(relationshipsForAnchor('player_match_stats')).toEqual([]);
    expect(QUERYABLE_TABLES.player_match_stats.subjects).toEqual([]);

    // A match has two clubs, so club-subject relationships are refused under the matches anchor.
    const forMatches = relationshipsForAnchor('matches').map((r) => r.key);
    expect(forMatches).toEqual(['match.player_stats', 'match.clubs']);

    const token = tokenFor({
      table: 'player_career_stats',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], domain: 'player.career' } }],
      page: 1,
    });
    expect(parseQueryState(token)).toBeNull();
    expect(domainColumns('player_career_stats', 'player.career')).toBeNull();
    expect(domainColumns('players', 'player.career')).toBe(RELATIONSHIPS['player.career'].columns);
    expect(domainColumns('players', undefined)).toBe(QUERYABLE_TABLES.players.columns);
  });
});

describe('query builder multi-domain URL state (AFLDB-ISSUE-115)', () => {
  // Captured verbatim from a pre-ISSUE-115 build: players, one card,
  // debut_season >= 1960. Not regenerated, so a change to serialisation
  // cannot mask a change to what older links mean.
  const PRE_115_TOKEN = 'eyJ0YWJsZSI6InBsYXllcnMiLCJjYXJkcyI6W3siam9pbiI6IkFORCIsImNhcmQiOnsibWF0Y2giOiJBTkQiLCJjb25kaXRpb25zIjpbeyJjb2x1bW4iOiJkZWJ1dF9zZWFzb24iLCJvcCI6Ij49IiwidmFsdWUiOjE5NjB9XX19XSwicGFnZSI6MX0';

  it('T-B1: a literal pre-115 token parses to anchor-only cards with no domain or quantifier', () => {
    const state = parseQueryState(PRE_115_TOKEN);
    expect(state).not.toBeNull();
    expect(state!.table).toBe('players');
    expect(state!.cards).toHaveLength(1);
    for (const group of state!.cards) {
      expect(group.card).not.toHaveProperty('domain');
      expect(group.card).not.toHaveProperty('quantifier');
    }
    expect(state!.cards[0].card.conditions).toEqual([{ column: 'debut_season', op: '>=', value: 1960 }]);
    // And the token itself is exactly what the old code would have emitted.
    expect(serializeQueryState(state!)).toBe(PRE_115_TOKEN);
  });

  it('T-B2: round-trips a multi-domain state, omitting domain = anchor and quantifier = any', () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', domain: 'players', quantifier: 'any', conditions: [
          { column: 'debut_season', op: 'between', lo: 1960, hi: 1969 },
        ] } },
        { join: 'AND', card: { match: 'AND', domain: 'player.career', quantifier: 'any', conditions: [
          { column: 'games', op: '>=', value: 100 },
        ] } },
        { join: 'AND', card: { match: 'OR', domain: 'player.match_stats', quantifier: 'none', conditions: [
          { column: 'goals', op: '>=', value: 8 },
        ] } },
      ],
      page: 2,
    };

    const token = serializeQueryState(state);
    const payload = decodeUrlState(token, QB_LIMITS.maxStateChars) as { cards: { card: Record<string, unknown> }[] };
    expect(payload.cards[0].card).not.toHaveProperty('domain');
    expect(payload.cards[0].card).not.toHaveProperty('quantifier');
    expect(payload.cards[1].card.domain).toBe('player.career');
    expect(payload.cards[1].card).not.toHaveProperty('quantifier');
    expect(payload.cards[2].card).toMatchObject({ domain: 'player.match_stats', quantifier: 'none' });

    expect(parseQueryState(token)).toEqual({
      table: 'players',
      page: 2,
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'debut_season', op: 'between', lo: 1960, hi: 1969 }] } },
        { join: 'AND', card: { match: 'AND', domain: 'player.career', conditions: [{ column: 'games', op: '>=', value: 100 }] } },
        { join: 'AND', card: { match: 'OR', domain: 'player.match_stats', quantifier: 'none', conditions: [{ column: 'goals', op: '>=', value: 8 }] } },
      ],
    });
  });

  it('T-B3: rejects an unknown domain', () => {
    const token = tokenFor({
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], domain: 'auth.users' } }],
      page: 1,
    });
    expect(parseQueryState(token)).toBeNull();
  });

  it('T-B4: rejects a domain not reachable from the anchor subjects', () => {
    const token = tokenFor({
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], domain: 'club.club_seasons' } }],
      page: 1,
    });
    expect(parseQueryState(token)).toBeNull();
    // Reachable from the clubs anchor.
    expect(parseQueryState(tokenFor({
      table: 'clubs',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], domain: 'club.club_seasons' } }],
      page: 1,
    }))).not.toBeNull();
    // NOT reachable from player_match_stats: that anchor hosts no related
    // cards in V1 (Stage 5 §9.3 exclusion, runbook §20.5), so the same
    // hand-crafted token is rejected there.
    expect(parseQueryState(tokenFor({
      table: 'player_match_stats',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], domain: 'club.club_seasons' } }],
      page: 1,
    }))).toBeNull();
  });

  it('T-B5: rejects a quantifier outside the enum, and none on an anchor-domain card', () => {
    const related = (quantifier: unknown) => tokenFor({
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], domain: 'player.career', quantifier } }],
      page: 1,
    });
    expect(parseQueryState(related('all'))).toBeNull();
    expect(parseQueryState(related(1))).toBeNull();
    expect(parseQueryState(related('none'))?.cards[0].card.quantifier).toBe('none');
    expect(parseQueryState(related('any'))?.cards[0].card).not.toHaveProperty('quantifier');

    const anchorNone = tokenFor({
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: [], quantifier: 'none' } }],
      page: 1,
    });
    expect(parseQueryState(anchorNone)).toBeNull();
  });

  it('T-B6: maxCards, maxConditionsPerCard and maxRelatedCards are each rejected one over', () => {
    const anchorCard = { join: 'AND', card: { match: 'AND', conditions: [] } };
    const relatedCard = { join: 'AND', card: { match: 'AND', conditions: [], domain: 'player.career' } };

    const tooManyCards = Array.from({ length: QB_LIMITS.maxCards + 1 }, () => anchorCard);
    expect(parseQueryState(tokenFor({ table: 'players', cards: tooManyCards, page: 1 }))).toBeNull();

    const tooManyConditions = Array.from({ length: QB_LIMITS.maxConditionsPerCard + 1 }, () => (
      { column: 'games', op: '>=', value: 1 }
    ));
    expect(parseQueryState(tokenFor({
      table: 'players',
      cards: [{ join: 'AND', card: { match: 'AND', conditions: tooManyConditions, domain: 'player.career' } }],
      page: 1,
    }))).toBeNull();

    expect(QB_LIMITS.maxRelatedCards).toBeLessThan(QB_LIMITS.maxCards);
    const atLimit = Array.from({ length: QB_LIMITS.maxRelatedCards }, () => relatedCard);
    expect(parseQueryState(tokenFor({ table: 'players', cards: atLimit, page: 1 }))).not.toBeNull();
    const oneOver = [...atLimit, relatedCard];
    expect(parseQueryState(tokenFor({ table: 'players', cards: oneOver, page: 1 }))).toBeNull();
    // The related limit counts related cards only: anchor cards alongside are fine.
    expect(parseQueryState(tokenFor({ table: 'players', cards: [anchorCard, ...atLimit], page: 1 }))).not.toBeNull();
  });

  it('T-B6 (unchanged limits): the pre-115 limits are exactly what they were', () => {
    expect(QB_LIMITS).toMatchObject({
      maxCards: 6, maxConditionsPerCard: 8, defaultPageSize: 50, maxPage: 50, maxStateChars: 8_192,
    });
  });
});

describe('query builder pure state transitions (AFLDB-ISSUE-115)', () => {
  it('T-D1: changing the anchor resets to emptyState', () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'surname', op: 'equals', value: 'Ablett' }] } },
        { join: 'AND', card: { match: 'AND', domain: 'player.career', conditions: [{ column: 'games', op: '>=', value: 100 }] } },
      ],
      page: 3,
    };
    expect(changeAnchor(state, 'clubs')).toEqual(emptyState('clubs'));
  });

  it('T-D1: changing a card domain clears that card only and resets its quantifier', () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [{ column: 'surname', op: 'equals', value: 'Ablett' }] } },
        { join: 'OR', card: { match: 'OR', domain: 'player.career', quantifier: 'none', conditions: [{ column: 'games', op: '>=', value: 100 }] } },
      ],
      page: 1,
    };

    const next = setCardDomain(state, 1, 'player.match_stats');
    expect(next.cards[0]).toEqual(state.cards[0]);
    expect(next.cards[1]).toEqual({ join: 'OR', card: { match: 'OR', domain: 'player.match_stats', conditions: [] } });
    expect(next.cards[1].card).not.toHaveProperty('quantifier');
    expect(state.cards[1].card.conditions).toHaveLength(1); // input untouched

    // Back to the anchor's own domain: stored as absent, the pre-115 shape.
    const back = setCardDomain(next, 1, 'players');
    expect(back.cards[1].card).toEqual({ match: 'OR', conditions: [] });
    expect(back.cards[1].card).not.toHaveProperty('domain');
  });

  it('T-D1: quantifier is set only on related cards, with any stored as absent', () => {
    const state: QueryBuilderState = {
      table: 'players',
      cards: [
        { join: 'AND', card: { match: 'AND', conditions: [] } },
        { join: 'AND', card: { match: 'AND', domain: 'player.career', conditions: [] } },
      ],
      page: 1,
    };
    const none = setCardQuantifier(state, 1, 'none');
    expect(none.cards[1].card.quantifier).toBe('none');
    const any = setCardQuantifier(none, 1, 'any');
    expect(any.cards[1].card).not.toHaveProperty('quantifier');
    expect(setCardQuantifier(state, 0, 'none').cards[0].card).not.toHaveProperty('quantifier');
  });

  it('describeCard phrases anchor and related cards without SQL jargon', () => {
    expect(describeCard('players', { match: 'AND', conditions: [] }, 0)).toBe('Card 1');
    expect(describeCard('players', { match: 'AND', conditions: [], domain: 'player.match_stats' }, 1))
      .toBe('Card 2 — has a matching Player match stats row');
    expect(describeCard('players', { match: 'AND', conditions: [], domain: 'player.match_stats', quantifier: 'none' }, 1))
      .toBe('Card 2 — has no matching Player match stats row');
  });
});
