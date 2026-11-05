import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  UNICODE_SPACE_REPLACEMENTS,
  UNICODE_SPACE_SEPARATORS,
  canonicalSpaces,
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

/*
 * AFLDB-ISSUE-337: DraftGuru raw names separate words with U+00A0, so `Jake Long` typed with an
 * ordinary space missed an unlinked pick stored as `Jake<U+00A0>Long`. The separator list must
 * stay exactly the one migration 099 gives afldb_normalise_name, or the two notions of "a space"
 * drift apart again.
 */
describe('AFLDB-ISSUE-337 Unicode space separators', () => {
  it('maps every separator to an ordinary space and leaves everything else alone', () => {
    expect(canonicalSpaces('Jake Long')).toBe('Jake Long');
    expect(canonicalSpaces('a b c　d')).toBe('a b c d');
    expect(canonicalSpaces('Jake Long')).toBe('Jake Long');
    // Zero-width characters are not separators (migration 099): untouched, as there.
    expect(canonicalSpaces('Jake​Long﻿')).toBe('Jake​Long﻿');
    expect(canonicalSpaces("O'Brien-Smith")).toBe("O'Brien-Smith");
    expect(canonicalSpaces(`x${UNICODE_SPACE_SEPARATORS}y`)).toBe(`x${' '.repeat(UNICODE_SPACE_SEPARATORS.length)}y`);
  });

  it('gives translate() a replacement of equal length', () => {
    expect(UNICODE_SPACE_REPLACEMENTS).toMatch(/^ +$/);
    expect(UNICODE_SPACE_REPLACEMENTS.length).toBe(UNICODE_SPACE_SEPARATORS.length);
  });

  it('is exactly the code-point list of migration 099', () => {
    const migration = readFileSync(
      join(process.cwd(), 'src', 'db', 'migrations', '099_normalise_unicode_whitespace.sql'), 'utf8',
    );
    const literal = /U&'((?:\\[0-9A-Fa-f]{4})+)'/.exec(migration);
    expect(literal, 'migration 099 translate() literal').not.toBeNull();
    const fromMigration = literal![1].split('\\').filter(Boolean).map((hex) => String.fromCharCode(parseInt(hex, 16)));
    expect([...UNICODE_SPACE_SEPARATORS]).toEqual(fromMigration);
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
