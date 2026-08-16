import 'server-only';

import { sql } from '@/db/client';
import { FIELDS, SORTS, type AdvancedQuery } from '@/search/advanced-spec';

export type AdvancedResultRow = {
  id: number;
  slug: string;
  displayName: string;
  debutSeason: number | null;
  finalSeason: number | null;
  games: number;
  goals: number;
  finals: number;
  premierships: number;
  brownlowVotes: number;
  clubsPlayed: number;
  clubNames: string | null;
};

/**
 * Execute a validated Advanced Search specification.
 *
 * Every SQL identifier here comes from the FIELDS/SORTS allowlists in
 * advanced-spec.ts; user input only ever reaches the database as a bound
 * parameter. `sql.unsafe` is used solely for the fixed column and
 * ORDER BY fragments looked up in those tables.
 */
export async function runAdvancedSearch(
  query: AdvancedQuery,
): Promise<{ rows: AdvancedResultRow[]; total: number }> {
  const conditions: ReturnType<typeof sql>[] = [];

  for (const filter of query.filters) {
    const def = FIELDS[filter.field];
    // Defensive: parseAdvancedQuery already rejects unknown fields.
    if (!def) continue;
    const column = sql.unsafe(def.column);

    if (filter.min !== undefined) {
      conditions.push(sql`${column} >= ${filter.min}`);
    }
    if (filter.max !== undefined) {
      conditions.push(sql`${column} <= ${filter.max}`);
    }
  }

  if (query.clubSlugs.length > 0) {
    conditions.push(sql`
      EXISTS (
        SELECT 1 FROM player_clubs pc
          JOIN clubs cl ON cl.id = pc.club_id
         WHERE pc.player_id = p.id AND cl.slug = ANY(${query.clubSlugs})
      )
    `);
  }

  const where = conditions.length
    ? conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`)
    : sql`TRUE`;

  const orderBy = sql.unsafe(SORTS[query.sort]?.sql ?? SORTS.games.sql);
  const offset = (query.page - 1) * query.pageSize;

  const rows = await sql<(AdvancedResultRow & { total: string })[]>`
    SELECT p.id, p.slug, p.display_name AS "displayName",
           c.debut_season AS "debutSeason", c.final_season AS "finalSeason",
           c.games, c.goals, c.finals, c.premierships,
           c.brownlow_votes AS "brownlowVotes",
           c.clubs_played   AS "clubsPlayed",
           (SELECT string_agg(DISTINCT cl.short_name, ', ' ORDER BY cl.short_name)
              FROM player_clubs pc JOIN clubs cl ON cl.id = pc.club_id
             WHERE pc.player_id = p.id) AS "clubNames",
           count(*) OVER () AS total
      FROM players p
      JOIN player_career_stats c ON c.player_id = p.id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ${query.pageSize} OFFSET ${offset}
  `;

  return {
    rows: rows.map(({ total: _total, ...rest }) => rest),
    total: rows.length > 0 ? Number(rows[0].total) : 0,
  };
}

/** Clubs for the filter control. */
export async function getClubOptions() {
  return sql<{ slug: string; name: string; isCurrent: boolean }[]>`
    SELECT slug, name, is_current_afl_club AS "isCurrent"
      FROM clubs
     ORDER BY is_current_afl_club DESC, name
  `;
}

/**
 * Club organizations (lineage-level, not the 24 historical identities)
 * for the grid solver's club-scoped builders -- "played for" means the
 * continuing club, so a Footscray-era row must match a Western Bulldogs
 * pick the same way club pages already treat the lineage as one entity.
 */
export async function getClubOrganizationOptions() {
  return sql<{ id: number; name: string; isActive: boolean }[]>`
    SELECT id, name, is_active AS "isActive"
      FROM club_organizations
     ORDER BY is_active DESC, name
  `;
}

/** Venues for a picker, e.g. the grid solver's Grounds & venues category. */
export async function getVenueOptions() {
  return sql<{ id: number; name: string }[]>`
    SELECT id, canonical_name AS name
      FROM venues
     ORDER BY canonical_name
  `;
}
