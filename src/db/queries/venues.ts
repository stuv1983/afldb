import 'server-only';

import { sql } from '@/db/client';
import {
  type SqlFragment,
  allOf,
  containsPattern,
  rangeConditions,
} from '@/db/queries/filters';
import type { FilterValues } from '@/search/table-filters';

export type VenueSummary = {
  id: number;
  slug: string;
  canonicalName: string;
  firstSeason: number | null;
  lastSeason: number | null;
  matches: number;
};

/**
 * Venue columns the index may be filtered on.
 *
 * `matches` is an aggregate, so its conditions belong in HAVING rather
 * than WHERE; it is kept out of this map and applied separately.
 */
export const VENUE_FILTER_COLUMNS: Record<string, string> = {
  first_season: 'v.first_season',
  last_season: 'v.last_season',
};

export type VenueFilters = { q?: string; state?: string; ranges?: FilterValues };

export async function listVenues(filters: VenueFilters = {}): Promise<VenueSummary[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, VENUE_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`v.canonical_name ILIKE ${containsPattern(filters.q)}`);
  if (filters.state) conditions.push(sql`v.state = ${filters.state}`);
  const where = allOf(conditions);

  const matches = filters.ranges?.range.matches;
  const havingConditions: SqlFragment[] = [];
  if (matches?.min !== undefined) havingConditions.push(sql`count(m.id) >= ${matches.min}`);
  if (matches?.max !== undefined) havingConditions.push(sql`count(m.id) <= ${matches.max}`);
  const having = allOf(havingConditions);

  return sql<VenueSummary[]>`
    SELECT v.id, v.slug, v.canonical_name AS "canonicalName",
           v.first_season AS "firstSeason", v.last_season AS "lastSeason",
           count(m.id)::int AS matches
      FROM venues v
      LEFT JOIN matches m ON m.venue_id = v.id
     WHERE ${where}
     GROUP BY v.id
    HAVING ${having}
     ORDER BY count(m.id) DESC, v.canonical_name
  `;
}

export async function getVenueStates(): Promise<string[]> {
  const rows = await sql<{ state: string }[]>`
    SELECT DISTINCT state FROM venues WHERE state IS NOT NULL ORDER BY state
  `;
  return rows.map((r) => r.state);
}
