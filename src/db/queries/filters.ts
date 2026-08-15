import 'server-only';

import { sql } from '@/db/client';
import type { FilterValues } from '@/search/table-filters';

export type SqlFragment = ReturnType<typeof sql>;

/**
 * Turn validated filter values into SQL conditions.
 *
 * The `columns` map is the allowlist: it is written in the query module,
 * never derived from a request, and a key absent from it produces no
 * condition at all. That is what lets `sql.unsafe` be used for the column
 * fragment while every value still travels as a bound parameter.
 */
export function rangeConditions(
  values: FilterValues,
  columns: Record<string, string>,
): SqlFragment[] {
  const conditions: SqlFragment[] = [];
  for (const [key, range] of Object.entries(values.range)) {
    const column = columns[key];
    if (!column) continue;
    const identifier = sql.unsafe(column);
    if (range.min !== undefined) conditions.push(sql`${identifier} >= ${range.min}`);
    if (range.max !== undefined) conditions.push(sql`${identifier} <= ${range.max}`);
  }
  return conditions;
}

/** `TRUE` for an empty list, so a WHERE clause is always well formed. */
export function allOf(conditions: SqlFragment[]): SqlFragment {
  if (conditions.length === 0) return sql`TRUE`;
  return conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`);
}

/**
 * A case-insensitive contains match.
 *
 * `%` and `_` are escaped so a name containing them is searched for
 * literally rather than silently becoming a wildcard.
 */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
