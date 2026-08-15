import 'server-only';

import { sql } from '@/db/client';
import type { FilterValues } from '@/search/table-filters';

export type SqlFragment = ReturnType<typeof sql>;

/**
 * Turn validated filter values into SQL conditions.
 *
 * The `columns` map is the allowlist: it is written in the query module,
 * never derived from a request. That is what lets `sql.unsafe` be used
 * for the column fragment while every value still travels as a bound
 * parameter.
 *
 * A key only reaches here because a page declared a field for it, so a
 * key with no column is a page and a query that disagree — the panel
 * counts the filter as applied and says so above the table while the SQL
 * ignores it, which is the one failure this layer must not hide. It is a
 * wiring mistake rather than bad input, so it fails loudly where that is
 * cheap and is reported where it is not.
 */
export function rangeConditions(
  values: FilterValues,
  columns: Record<string, string>,
): SqlFragment[] {
  const conditions: SqlFragment[] = [];
  for (const [key, range] of Object.entries(values.range)) {
    const column = columns[key];
    if (!column) {
      reportUnmappedFilter(key);
      continue;
    }
    const identifier = sql.unsafe(column);
    if (range.min !== undefined) conditions.push(sql`${identifier} >= ${range.min}`);
    if (range.max !== undefined) conditions.push(sql`${identifier} <= ${range.max}`);
  }
  return conditions;
}

function reportUnmappedFilter(key: string): void {
  const message =
    `Range filter "${key}" has no column in this query's allowlist, so it would `
    + 'narrow nothing while the page reports it as applied. Add it to the map, or '
    + 'remove the field from the panel.';
  if (process.env.NODE_ENV !== 'production') throw new Error(message);
  console.error(message);
}

/** `TRUE` for an empty list, so a WHERE clause is always well formed. */
export function allOf(conditions: SqlFragment[]): SqlFragment {
  if (conditions.length === 0) return sql`TRUE`;
  return conditions.reduce((acc, condition) => sql`${acc} AND ${condition}`);
}

/**
 * Pattern builders live in lib/like.ts — they are string functions with
 * no database dependency, which is what lets them be unit tested — and
 * are re-exported here because this is where the query modules already
 * look for them.
 */
export { containsPattern, prefixPattern } from '@/lib/like';
