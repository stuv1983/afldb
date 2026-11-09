import 'server-only';

import { sql } from '@/db/client';
import { allOf, containsPattern, rangeConditions } from '@/db/queries/filters';
import { UNICODE_SPACE_REPLACEMENTS, UNICODE_SPACE_SEPARATORS, canonicalSpaces } from '@/lib/like';
import { DRAFT_KIND_RANK_SQL, FATHER_SON_SIGNING_KIND } from '@/lib/draft-categories';
import type { FilterValues } from '@/search/table-filters';

export type DraftPickRow = {
  id: number;
  draftYear: number;
  /** The source's display label for the event (AFLDB-ISSUE-336: never shown without the kind). */
  draftType: string;
  /** The canonical category; a pick number is meaningful only within it. */
  draftKind: string | null;
  pickNumber: number | null;
  /** Source signing text, e.g. "Father-Son (…)", "Academy (Brisbane)"; null when none. */
  signing: string | null;
  /** Head of `signing`, e.g. "Father-Son", "Academy"; null when none. */
  signingKind: string | null;
  playerId: number | null;
  playerSlug: string | null;
  playerDisplayName: string | null;
  playerNameRaw: string;
  linkStatus: string;
  clubSlug: string | null;
  clubName: string | null;
  clubNameRaw: string | null;
  originClub: string | null;
  draftAge: number | null;
  /** Career games of the linked player; null when the pick is unlinked. */
  careerGames: number | null;
};

/**
 * Draft columns the index may be filtered on.
 *
 * `games` is the drafted player's career total, which exists only for a
 * selection that was linked to a player. A range on it therefore excludes
 * unlinked rows rather than treating them as zero games — the filter help
 * text says so, because a quarter of legacy rows are unlinked.
 */
export const DRAFT_FILTER_COLUMNS: Record<string, string> = {
  pick: 'dp.pick_number',
  age: 'dp.draft_age',
  games: 'pcs.games',
};

/**
 * Sort keys. `type` sorts by category in display order, not by label text, and `pick`
 * always keeps categories apart (AFLDB-ISSUE-336): National pick 1 and Rookie pick 1 are
 * never adjacent as if they were the same selection.
 */
export const DRAFT_SORTS: Record<string, string> = {
  year: 'dp.draft_year',
  pick: 'dp.pick_number',
  player: 'COALESCE(p.sort_name, dp.player_name_raw)',
  type: DRAFT_KIND_RANK_SQL,
  age: 'dp.draft_age',
  games: 'pcs.games',
};

/**
 * The tie-break every draft list ends with: category order, pick within the category,
 * name, then the row id, so a page boundary never depends on physical row order.
 */
const DRAFT_ORDER_TAIL =
  `dp.draft_year DESC, ${DRAFT_KIND_RANK_SQL}, dp.pick_number NULLS LAST, `
  + 'COALESCE(p.sort_name, dp.player_name_raw), dp.id';

export function isDraftSort(s: string | undefined): s is keyof typeof DRAFT_SORTS {
  return s !== undefined && Object.hasOwn(DRAFT_SORTS, s);
}

export function isDraftSortDir(d: string | undefined): d is 'asc' | 'desc' {
  return d === 'asc' || d === 'desc';
}

export type DraftPickFilters = {
  year?: number;
  clubSlug?: string;
  origin?: string;
  /** Legacy `type` parameter: the source label. */
  draftType?: string;
  /** The canonical category (`draft_picks.draft_kind`). */
  kind?: string;
  /** Only selections whose signing mechanism is Father–Son, in whatever category. */
  fatherSon?: boolean;
  q?: string;
  ranges?: FilterValues;
  sort?: string;
  dir?: string;
  page: number;
  pageSize: number;
};

type DraftScopeFilters = Omit<DraftPickFilters, 'kind' | 'fatherSon' | 'sort' | 'dir' | 'page' | 'pageSize'>;

/** The conditions shared by the list and the per-category counts. */
function scopeConditions(filters: DraftScopeFilters) {
  const conditions = filters.ranges
    ? rangeConditions(filters.ranges, DRAFT_FILTER_COLUMNS)
    : [];

  if (filters.year !== undefined) {
    conditions.push(sql`dp.draft_year = ${filters.year}`);
  }
  if (filters.clubSlug) {
    conditions.push(sql`c.slug = ${filters.clubSlug}`);
  }
  if (filters.origin) {
    conditions.push(sql`dp.original_club_raw ILIKE ${containsPattern(filters.origin)}`);
  }
  if (filters.draftType) {
    conditions.push(sql`dp.draft_type = ${filters.draftType}`);
  }
  if (filters.q) {
    // AFLDB-ISSUE-337: DraftGuru raw names separate words with U+00A0, so an unlinked pick could
    // not be found by a name typed with an ordinary space. Both sides are canonicalised with the
    // separator list of migration 099; the raw column itself is never rewritten.
    const like = containsPattern(canonicalSpaces(filters.q));
    conditions.push(sql`(
      translate(dp.player_name_raw, ${UNICODE_SPACE_SEPARATORS}::text, ${UNICODE_SPACE_REPLACEMENTS}::text) ILIKE ${like}
      OR translate(p.display_name, ${UNICODE_SPACE_SEPARATORS}::text, ${UNICODE_SPACE_REPLACEMENTS}::text) ILIKE ${like}
    )`);
  }
  return conditions;
}

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
  const conditions = scopeConditions(filters);
  if (filters.kind) {
    conditions.push(sql`dp.draft_kind = ${filters.kind}`);
  }
  if (filters.fatherSon) {
    conditions.push(sql`dp.signing_kind = ${FATHER_SON_SIGNING_KIND}`);
  }

  const where = allOf(conditions);
  const offset = (filters.page - 1) * filters.pageSize;

  let orderBy = sql`${sql.unsafe(DRAFT_ORDER_TAIL)}`;
  if (isDraftSort(filters.sort) && isDraftSortDir(filters.dir)) {
    const sortCol = DRAFT_SORTS[filters.sort];
    const sqlDir = filters.dir === 'asc' ? sql`ASC` : sql`DESC`;
    // A pick-number sort is a sort WITHIN each category, never across them.
    const lead = filters.sort === 'pick' ? sql`${sql.unsafe(DRAFT_KIND_RANK_SQL)}, ` : sql``;
    orderBy = sql`${lead}${sql.unsafe(sortCol)} ${sqlDir} NULLS LAST, ${sql.unsafe(DRAFT_ORDER_TAIL)}`;
  }

  const rows = await sql<(DraftPickRow & { total: string })[]>`
    SELECT dp.id, dp.draft_year AS "draftYear", dp.draft_type AS "draftType",
           dp.draft_kind AS "draftKind", dp.pick_number AS "pickNumber",
           dp.signing, dp.signing_kind AS "signingKind",
           dp.player_id AS "playerId", p.slug AS "playerSlug",
           p.display_name AS "playerDisplayName", dp.player_name_raw AS "playerNameRaw",
           dp.link_status_value::text AS "linkStatus",
           c.slug AS "clubSlug", c.name AS "clubName", dp.club_name_raw AS "clubNameRaw",
           dp.original_club_raw AS "originClub",
           dp.draft_age AS "draftAge",
           pcs.games AS "careerGames",
           count(*) OVER () AS total
      FROM draft_picks dp
      LEFT JOIN players p ON p.id = dp.player_id
      LEFT JOIN player_career_stats pcs ON pcs.player_id = dp.player_id
      LEFT JOIN clubs c ON c.id = dp.club_id
     WHERE ${where}
     ORDER BY ${orderBy}
     LIMIT ${filters.pageSize} OFFSET ${offset}
  `;

  if (rows.length > 0 || offset <= 0) {
    return {
      rows: rows.map(({ total: _total, ...rest }) => rest),
      total: rows.length > 0 ? Number(rows[0].total) : 0,
    };
  }

  // AFLDB-ISSUE-344: an offset past the end returns no rows, so the window count
  // vanishes with them and a nonempty result would read as "0 matching". Count the
  // same FROM/JOIN/WHERE once, only on this empty past-the-end page (as listPlayers
  // does), so the caller can report the true total and redirect to a page that exists.
  const [counted] = await sql<{ total: string }[]>`
    SELECT count(*) AS total
      FROM draft_picks dp
      LEFT JOIN players p ON p.id = dp.player_id
      LEFT JOIN player_career_stats pcs ON pcs.player_id = dp.player_id
      LEFT JOIN clubs c ON c.id = dp.club_id
     WHERE ${where}
  `;
  return { rows: [], total: Number(counted.total) };
}

export async function getDraftYears(): Promise<number[]> {
  const rows = await sql<{ year: number }[]>`
    SELECT DISTINCT draft_year AS year FROM draft_picks ORDER BY year DESC
  `;
  return rows.map((r) => r.year);
}

export type DraftCategoryCount = {
  draftYear: number;
  draftKind: string | null;
  total: number;
  /** Rows of this category whose signing mechanism is Father–Son (a subset of `total`). */
  fatherSon: number;
};

/**
 * Selections per year and category under the list's non-category filters, so a category
 * tab states how many rows it would show. Father–Son is a subset of its categories and is
 * counted inside them, never added to the total.
 */
export async function getDraftCategoryCounts(filters: DraftScopeFilters): Promise<DraftCategoryCount[]> {
  const where = allOf(scopeConditions(filters));
  const rows = await sql<{ draftYear: number; draftKind: string | null; total: number; fatherSon: number }[]>`
    SELECT dp.draft_year::int AS "draftYear", dp.draft_kind AS "draftKind",
           count(*)::int AS total,
           count(*) FILTER (WHERE dp.signing_kind = ${FATHER_SON_SIGNING_KIND})::int AS "fatherSon"
      FROM draft_picks dp
      LEFT JOIN players p ON p.id = dp.player_id
      LEFT JOIN player_career_stats pcs ON pcs.player_id = dp.player_id
      LEFT JOIN clubs c ON c.id = dp.club_id
     WHERE ${where}
     GROUP BY dp.draft_year, dp.draft_kind
     ORDER BY dp.draft_year DESC, dp.draft_kind
  `;
  return rows.map((r) => ({ ...r }));
}

export async function getDraftTypes(): Promise<string[]> {
  const rows = await sql<{ type: string }[]>`
    SELECT DISTINCT draft_type AS type FROM draft_picks ORDER BY type
  `;
  return rows.map((r) => r.type);
}

export type PlayerDraftHistoryRow = {
  id: number;
  draftYear: number;
  draftType: string;
  draftKind: string | null;
  pickNumber: number | null;
  signing: string | null;
  signingKind: string | null;
  clubName: string | null;
  clubSlug: string | null;
  originClub: string | null;
  heightCm: number | null;
  weightKg: number | null;
  draftAge: number | null;
  detail: string | null;
  pickNote: string | null;
};

/**
 * All draft selections recorded for one player (see changeLog.md).
 */
export async function getPlayerDraftHistory(playerId: number): Promise<PlayerDraftHistoryRow[]> {
  return sql<PlayerDraftHistoryRow[]>`
    SELECT dp.id, dp.draft_year AS "draftYear", dp.draft_type AS "draftType",
           dp.draft_kind AS "draftKind", dp.pick_number AS "pickNumber",
           dp.signing, dp.signing_kind AS "signingKind",
           c.name AS "clubName", c.slug AS "clubSlug",
           dp.original_club_raw AS "originClub",
           dp.height_cm AS "heightCm", dp.weight_kg AS "weightKg",
           dp.draft_age AS "draftAge", dp.detail, dp.pick_note AS "pickNote"
      FROM draft_picks dp
      LEFT JOIN clubs c ON c.id = dp.club_id
     WHERE dp.player_id = ${playerId}
     ORDER BY dp.draft_year DESC, ${sql.unsafe(DRAFT_KIND_RANK_SQL)}, dp.pick_number ASC NULLS LAST, dp.id
  `;
}
