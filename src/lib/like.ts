/**
 * LIKE/ILIKE pattern building.
 *
 * Every search value reaches PostgreSQL as a bound parameter, so nothing here
 * is an injection guard. It guards meaning and cost: unescaped, a literal `%`
 * typed by a reader becomes "match anything" and makes the database rank the
 * whole table.
 *
 * Deliberately free of `server-only` and of any database import so these stay
 * unit-testable without a connection.
 */

/** Escape the three characters LIKE treats specially. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** `%term%` — a case-insensitive contains match, wildcards neutralised. */
export function containsPattern(term: string): string {
  return `%${escapeLike(term)}%`;
}

/**
 * `term%` — a starts-with match, wildcards neutralised.
 *
 * Used where a prefix hit outranks a contains hit. An unescaped `%` here
 * does not widen a result set the WHERE clause has already bounded, but
 * it does score every row as a prefix match, which reorders a list the
 * reader is trying to read.
 */
export function prefixPattern(term: string): string {
  return `${escapeLike(term)}%`;
}

/**
 * The Unicode space separators that migration 099 maps to an ordinary space inside
 * `afldb_normalise_name`, in the same order: U+00A0, U+1680, U+2000..U+200A, U+2028, U+2029,
 * U+202F, U+205F, U+3000. Zero-width characters (U+200B, U+FEFF) are deliberately absent, as
 * there: they are not separators.
 */
export const UNICODE_SPACE_SEPARATORS =
  '                 　';

/** One ordinary space per separator: the `to` argument of SQL `translate(col, separators, spaces)`. */
export const UNICODE_SPACE_REPLACEMENTS = ' '.repeat(UNICODE_SPACE_SEPARATORS.length);

const SEPARATOR_CLASS = new RegExp(`[${UNICODE_SPACE_SEPARATORS}]`, 'g');

/**
 * Turns each Unicode space separator into an ordinary space (AFLDB-ISSUE-337). A raw source name
 * such as DraftGuru's `Jake<U+00A0>Long` matches a term typed as `Jake Long` only when both
 * sides are canonicalised the same way; the column side uses SQL `translate()` with the two
 * constants above. Nothing else (case, accents, punctuation) changes.
 */
export function canonicalSpaces(term: string): string {
  return term.replace(SEPARATOR_CLASS, ' ');
}

/**
 * Neutralise only the metacharacters that survive `afldb_normalise_name`.
 *
 * The global search normalises in SQL, after this runs, and that function
 * turns `_` into a space — so an underscore cannot reach the pattern as a
 * wildcard, and escaping it here would be actively wrong: the `\_` would
 * normalise to `\ ` and a name typed with an underscore would match
 * nothing. `%` and `\` pass through normalisation untouched, so they are
 * the two that must be escaped.
 */
export function normalisedSearchTerm(term: string): string {
  return term.replace(/[\\%]/g, (char) => `\\${char}`);
}
