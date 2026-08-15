import { describe, expect, it } from 'vitest';

import {
  containsPattern,
  escapeLike,
  normalisedSearchTerm,
  prefixPattern,
} from '@/lib/like';

/**
 * The defect these guard: a search term is a bound parameter, so it can
 * never inject SQL — but it lands inside a LIKE pattern, where `%` and
 * `_` are wildcards. A visitor searching for "%" was asking the database
 * for every row in the table and a trigram ranking of the whole corpus.
 */
describe('LIKE pattern building', () => {
  it('leaves an ordinary name alone', () => {
    expect(containsPattern('Ablett')).toBe('%Ablett%');
    expect(prefixPattern('Ablett')).toBe('Ablett%');
  });

  it('escapes the wildcards rather than passing them through', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('back\\slash')).toBe('back\\\\slash');
    // The whole point: the pattern searches for a percent sign, and does
    // not become "match everything".
    expect(containsPattern('%')).toBe('%\\%%');
    expect(prefixPattern('%')).toBe('\\%%');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeLike('%a%b%')).toBe('\\%a\\%b\\%');
  });

  it('keeps the characters real names actually contain', () => {
    // Apostrophes, hyphens and accents must not be touched: they are
    // ordinary characters to LIKE and common in player names.
    expect(containsPattern("O'Brien-Smith")).toBe("%O'Brien-Smith%");
    expect(containsPattern('Krakouer')).toBe('%Krakouer%');
  });
});

describe('global search terms, which are normalised in SQL afterwards', () => {
  it('escapes the metacharacters that survive normalisation', () => {
    expect(normalisedSearchTerm('%')).toBe('\\%');
    expect(normalisedSearchTerm('back\\slash')).toBe('back\\\\slash');
  });

  it('leaves the underscore alone', () => {
    // afldb_normalise_name turns `_` into a space, so it never reaches
    // the pattern as a wildcard. Escaping it would normalise to "\ " and
    // the search would match nothing at all — the reason this differs
    // from escapeLike rather than reusing it.
    expect(normalisedSearchTerm('jack_dyer')).toBe('jack_dyer');
  });

  it('leaves an ordinary query untouched', () => {
    expect(normalisedSearchTerm('Gary Ablett')).toBe('Gary Ablett');
  });
});
