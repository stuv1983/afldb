import 'server-only';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
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
 * `matches` is a count, so it is pre-aggregated in the subquery below and
 * filtered as an ordinary column — the same shape `aflw.venues` gives the
 * AFLW side. Special-casing it here would leave one filter outside the
 * mechanism every other filter goes through.
 */
export const VENUE_FILTER_COLUMNS: Record<string, string> = {
  first_season: 'v.first_season',
  last_season: 'v.last_season',
  matches: 'v.matches',
};

export type VenueFilters = { q?: string; state?: string; ranges?: FilterValues };

export async function listVenues(filters: VenueFilters = {}): Promise<VenueSummary[]> {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, VENUE_FILTER_COLUMNS)
    : [];
  if (filters.q) conditions.push(sql`v.canonical_name ILIKE ${containsPattern(filters.q)}`);
  if (filters.state) conditions.push(sql`v.state = ${filters.state}`);
  const where = allOf(conditions);

  return sql<VenueSummary[]>`
    SELECT v.id, v.slug, v.canonical_name AS "canonicalName",
           v.first_season AS "firstSeason", v.last_season AS "lastSeason",
           v.matches
      FROM (
        SELECT v.id, v.slug, v.canonical_name, v.first_season, v.last_season, v.state,
               COALESCE(m.matches, 0) AS matches
          FROM venues v
          LEFT JOIN (
            SELECT venue_id, count(*)::int AS matches FROM matches GROUP BY venue_id
          ) m ON m.venue_id = v.id
      ) v
     WHERE ${where}
     ORDER BY v.matches DESC, v.canonical_name
  `;
}

export async function getVenueStates(): Promise<string[]> {
  const rows = await sql<{ state: string }[]>`
    SELECT DISTINCT state FROM venues WHERE state IS NOT NULL ORDER BY state
  `;
  return rows.map((r) => r.state);
}
