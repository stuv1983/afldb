import 'server-only';

import { sql } from '@/db/client';

export type VenueSummary = {
  id: number;
  slug: string;
  canonicalName: string;
  firstSeason: number | null;
  lastSeason: number | null;
  matches: number;
};

export type VenueFilters = { q?: string; state?: string };

export async function listVenues(filters: VenueFilters = {}): Promise<VenueSummary[]> {
  const conditions: ReturnType<typeof sql>[] = [sql`TRUE`];
  if (filters.q) conditions.push(sql`v.canonical_name ILIKE ${`%${filters.q}%`}`);
  if (filters.state) conditions.push(sql`v.state = ${filters.state}`);
  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);

  return sql<VenueSummary[]>`
    SELECT v.id, v.slug, v.canonical_name AS "canonicalName",
           v.first_season AS "firstSeason", v.last_season AS "lastSeason",
           count(m.id)::int AS matches
      FROM venues v
      LEFT JOIN matches m ON m.venue_id = v.id
     WHERE ${where}
     GROUP BY v.id
     ORDER BY count(m.id) DESC, v.canonical_name
  `;
}

export async function getVenueStates(): Promise<string[]> {
  const rows = await sql<{ state: string }[]>`
    SELECT DISTINCT state FROM venues WHERE state IS NOT NULL ORDER BY state
  `;
  return rows.map((r) => r.state);
}
