import 'server-only';

import { sql } from '@/db/client';

export type DraftPickRow = {
  id: number;
  draftYear: number;
  draftType: string;
  draftKind: string | null;
  pickNumber: number | null;
  playerId: number | null;
  playerSlug: string | null;
  playerDisplayName: string | null;
  playerNameRaw: string;
  linkStatus: string;
  clubSlug: string | null;
  clubName: string | null;
  clubNameRaw: string | null;
  draftAge: number | null;
};

export type DraftPickFilters = {
  year?: number;
  clubSlug?: string;
  draftType?: string;
  q?: string;
  page: number;
  pageSize: number;
};

/**
 * Draft and recruitment history, 1981 onward.
 *
 * Roughly a quarter of legacy rows have no linked player (see
 * draft_picks_link_ck / draft_persons_backlog_ck in migration 019); those
 * rows are still returned, with playerId null and the raw source name in
 * playerNameRaw, rather than filtered out.
 */
export async function listDraftPicks(
  filters: DraftPickFilters,
): Promise<{ rows: DraftPickRow[]; total: number }> {
  const conditions: ReturnType<typeof sql>[] = [sql`TRUE`];

  if (filters.year !== undefined) {
    conditions.push(sql`dp.draft_year = ${filters.year}`);
  }
  if (filters.clubSlug) {
    conditions.push(sql`c.slug = ${filters.clubSlug}`);
  }
  if (filters.draftType) {
    conditions.push(sql`dp.draft_type = ${filters.draftType}`);
  }
  if (filters.q) {
    const like = `%${filters.q}%`;
    conditions.push(sql`(dp.player_name_raw ILIKE ${like} OR p.display_name ILIKE ${like})`);
  }

  const where = conditions.reduce((acc, cond) => sql`${acc} AND ${cond}`);
  const offset = (filters.page - 1) * filters.pageSize;

  const rows = await sql<(DraftPickRow & { total: string })[]>`
    SELECT dp.id, dp.draft_year AS "draftYear", dp.draft_type AS "draftType",
           dp.draft_kind AS "draftKind", dp.pick_number AS "pickNumber",
           dp.player_id AS "playerId", p.slug AS "playerSlug",
           p.display_name AS "playerDisplayName", dp.player_name_raw AS "playerNameRaw",
           dp.link_status_value::text AS "linkStatus",
           c.slug AS "clubSlug", c.name AS "clubName", dp.club_name_raw AS "clubNameRaw",
           dp.draft_age AS "draftAge",
           count(*) OVER () AS total
      FROM draft_picks dp
      LEFT JOIN players p ON p.id = dp.player_id
      LEFT JOIN clubs c ON c.id = dp.club_id
     WHERE ${where}
     ORDER BY dp.draft_year DESC, dp.pick_number NULLS LAST
     LIMIT ${filters.pageSize} OFFSET ${offset}
  `;

  return {
    rows,
    total: rows.length > 0 ? Number(rows[0].total) : 0,
  };
}

export async function getDraftYears(): Promise<number[]> {
  const rows = await sql<{ year: number }[]>`
    SELECT DISTINCT draft_year AS year FROM draft_picks ORDER BY year DESC
  `;
  return rows.map((r) => r.year);
}

export async function getDraftTypes(): Promise<string[]> {
  const rows = await sql<{ type: string }[]>`
    SELECT DISTINCT draft_type AS type FROM draft_picks ORDER BY type
  `;
  return rows.map((r) => r.type);
}
