/**
 * LIKE/ILIKE pattern building.
 *
 * Every search value reaches PostgreSQL as a bound parameter, so nothing
 * here is an injection guard. What it guards is meaning and cost: inside
 * a LIKE pattern `%` and `_` are wildcards, so a reader searching for a
 * literal percent sign was silently asking for "match anything", which
 * returns the whole table and makes the database rank a corpus it never
 * needed to look at.
 *
 * Deliberately free of `server-only` and of any database import: these
 * are string functions, and keeping them here means they can be unit
 * tested without a connection. The query layer imports them through
 * db/queries/filters, which is where callers already look for them.
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
