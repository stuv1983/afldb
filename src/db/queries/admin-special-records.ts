import 'server-only';

import { sql } from '@/db/client';
import { MANUAL_SOURCE_KEY, type SpecialRecordTable } from '@/lib/special-records/identity';

/**
 * Special-records administration — the READ side of the correction / void /
 * suppression lifecycle for the two curated families (AFLDB-ISSUE-167,
 * AFLDB-ISSUE-156 P4, Stage 3).
 *
 *   player_achievements  (migration 053) — the first-kick goal, loaded by
 *                        tools/records/import-first-kick-goal.ts;
 *   after_siren_kicks    (migration 089) — kicks after the siren, loaded by
 *                        tools/migration/after_siren.py.
 *
 * WHICH POOL, AND WHY IT IS THIS ONE (decision D-5, 2026-09-13). Both tables
 * are read here on the APP/public client, never on `authSql`. The planning
 * §6.5 had assumed the admin surface would read them on the auth pool and
 * would therefore need two new grants in tools/maintenance/privileges.sql;
 * current source contradicted that, and the operator resolved it the other
 * way. `src/db/authClient.ts` holds `afldb_auth` to the operational and
 * auth-owned tables precisely so "a compromise of the auth path still cannot
 * touch statistics", and every comparable admin surface already reads football
 * data on the public client (`admin-awards.ts`, `admin-club-leadership.ts`,
 * `player-links.ts:86-88` — "Reads run on the public client"). Granting
 * `afldb_auth` SELECT here would widen a deliberate boundary WITH NO CALLER.
 *
 * So: if a future change here ever seems to need an `afldb_auth` grant on
 * either table, the read has been put on the wrong pool. privileges.sql stays
 * unchanged, and `tests/integration/special-records-lifecycle.test.ts` pins
 * the whole contract including `afldb_auth`'s absence.
 *
 * The ONE thing this module does not read is the audit trail: `data_edits` is
 * not application data and is readable only by `afldb_auth`, so the per-record
 * history comes from the ISSUE-157 reader (`audit-reader.ts`) through its own
 * pool, exactly as the awards detail pages get theirs.
 *
 * WHY THE ADMIN LISTS DEFAULT TO EVERY STATUS. Every other list in this
 * codebase defaults to `active`, because every other list feeds, or mirrors,
 * the public site. This one is the surface whose job is to report what the
 * lifecycle has TAKEN OUT of the public site, and there are 334 + 126 rows in
 * total — a whole-table default costs nothing and hides nothing. Stage 5's
 * `status = 'active'` filtering is a PUBLIC-read-model concern and must never
 * reach these queries.
 *
 * READ-ONLY BY CONTRACT, in this stage. There is no mutation here: no
 * correction, no void, no reinstate, no replace, no create. Those are Stage 6,
 * under `data.specialRecords.edit`. Two consequences are load-bearing rather
 * than incidental:
 *
 *   * D-2 (2026-09-13) DEFERRED after-siren player-link resolution. This
 *     module SHOWS `link_status_value`, `candidate_count` and the resolved
 *     player, so an unlinked row is visible as unlinked; it adds no link
 *     mutation, no second queue and no change to `LINK_TARGET_TABLES`, which
 *     would collide with AFLDB-ISSUE-164's live confidence work.
 *   * The derived and identity-bearing fields (§3.4.1) are returned for
 *     DISPLAY and are never offered as fields: `link_status_value`,
 *     `candidate_count`, `player_achievements.match_id` and
 *     `after_siren_kicks.club_id` are derived; `source_id` and
 *     `source_record_id` are identity, and a wrong identity is repaired by
 *     void + manual replacement, never by a rekey (that is P10's).
 *
 * UNRESOLVED ROWS ARE PRESERVED. Every join below is a LEFT JOIN. Both tables
 * keep the source's spelling of a player, a club and an opponent even when
 * they cannot be resolved — that is what `link_status_value` is for — so an
 * inner join anywhere would silently drop the rows an administrator most needs
 * to see, and the search covers the raw source spelling for the same reason.
 */

// --- vocabulary ----------------------------------------------------------

/**
 * Migration 102's lifecycle. TWO states, not three: a first kick and a kick
 * after the siren are EVENTS — neither CEASES the way a club_leadership office
 * does, so there is no `ended`. Frozen here and in the two CHECK constraints.
 */
export const SPECIAL_RECORD_STATUSES = ['active', 'void'] as const;
export type SpecialRecordStatus = (typeof SPECIAL_RECORD_STATUSES)[number];

/**
 * Three states, not a boolean: an administrator asking "what did we void, and
 * why" wants the voided rows ALONE. `all` is the default (see the header).
 */
export type SpecialRecordStatusFilter = SpecialRecordStatus | 'all';

export const DEFAULT_ADMIN_STATUS_FILTER: SpecialRecordStatusFilter = 'all';

/**
 * Who owns the row's fields. `source` is a row an importer reloads, so a
 * correction to it will need a durable `data_overrides` delta (Stage 4/6) or
 * the next reload reverts it. `manual` is an administrator's own row, which
 * nothing reloads.
 */
export type SpecialRecordProvenance = 'manual' | 'source';

/** Whether the row resolved to a player. The gap D-2 leaves visible. */
export type SpecialRecordLinkFilter = 'linked' | 'unlinked';

export function isSpecialRecordStatusFilter(value: unknown): value is SpecialRecordStatusFilter {
  return value === 'active' || value === 'void' || value === 'all';
}

export function isSpecialRecordProvenance(value: unknown): value is SpecialRecordProvenance {
  return value === 'manual' || value === 'source';
}

export function isSpecialRecordLinkFilter(value: unknown): value is SpecialRecordLinkFilter {
  return value === 'linked' || value === 'unlinked';
}

/**
 * Whether a row's own source key makes it an administrator's row. Compared
 * against the row's key rather than a list of importer names, so a new source
 * needs no change here. A row with NO source reads as source-owned, which is
 * what it is: `manual_admin_edit` IS a source, and its absence is not a claim
 * of administrative ownership.
 */
export function provenanceOf(sourceKey: string | null): SpecialRecordProvenance {
  return sourceKey === MANUAL_SOURCE_KEY ? 'manual' : 'source';
}

// --- row shapes ----------------------------------------------------------

/** What every special-record row carries, whichever family it belongs to. */
type SpecialRecordCommon = {
  id: number;
  status: SpecialRecordStatus;
  statusReason: string | null;
  updatedAt: string;

  /** Derived, never editable (§3.4.1) — the player-link decision's own record. */
  playerId: number | null;
  playerSlug: string | null;
  playerDisplayName: string | null;
  playerNameRaw: string;
  playerNameClean: string;
  linkStatus: string;
  candidateCount: number;

  clubId: number | null;
  clubSlug: string | null;
  clubName: string | null;
  clubNameRaw: string;

  season: number;
  roundRaw: string;

  matchId: number | null;
  matchDate: string | null;

  /** Identity and provenance, shown and never offered as fields. */
  sourceId: number | null;
  sourceKey: string | null;
  sourceRecordId: string | null;
  importBatchId: string | null;
  importedAt: string;

  sourceAnnotation: string | null;
  notes: string | null;
};

export type FirstKickGoalAdminRow = SpecialRecordCommon & {
  achievementType: string;
  seasonFootnoteRaw: string | null;
  consecutiveGoalKicks: number;
  noFurtherCareerGoals: boolean;
  noFurtherCareerKicks: boolean;
  /** Derived from this; `match_id` is re-derived when it changes (§10.3). */
  kicklessMatchesBeforeFirstKick: number;
};

export type AfterSirenAdminRow = SpecialRecordCommon & {
  opponentClubId: number | null;
  opponentSlug: string | null;
  opponentName: string | null;
  opponentNameRaw: string;
  competition: string;
  premiershipSeason: boolean;
  kickScored: 'goal' | 'behind' | 'none';
  kickEffect: 'won' | 'drew' | 'none';
  shotDetail: string | null;
  kickerResult: 'win' | 'loss' | 'draw';
  siren: 'final' | 'end_of_extra_time' | 'end_of_regulation';
  kickerScoreRaw: string;
  opponentScoreRaw: string;
  kickerPoints: number;
  opponentPoints: number;
  supergoalScoring: boolean;
  /**
   * EVIDENCE, NEVER LIFECYCLE (migration 089, gate G-3). `false` means the
   * source row carried no reference for a kick that really happened. It must
   * never be conflated with `void`, which says the AFLDB row should not exist,
   * and the two may never share a control.
   */
  cited: boolean;
};

// --- the SELECTs ---------------------------------------------------------

const FIRST_KICK_SELECT = `
  a.id::int AS id, a.status AS status, a.status_reason AS "statusReason",
  a.updated_at::text AS "updatedAt",
  a.achievement_type::text AS "achievementType",
  a.player_id AS "playerId", p.slug AS "playerSlug", p.display_name AS "playerDisplayName",
  a.player_name_raw AS "playerNameRaw", a.player_name_clean AS "playerNameClean",
  a.link_status_value::text AS "linkStatus", a.candidate_count::int AS "candidateCount",
  a.club_id AS "clubId", c.slug AS "clubSlug", c.name AS "clubName",
  a.club_name_raw AS "clubNameRaw",
  a.season::int AS season, a.season_footnote_raw AS "seasonFootnoteRaw",
  a.round_raw AS "roundRaw",
  a.consecutive_goal_kicks::int AS "consecutiveGoalKicks",
  a.no_further_career_goals AS "noFurtherCareerGoals",
  a.no_further_career_kicks AS "noFurtherCareerKicks",
  a.kickless_matches_before_first_kick::int AS "kicklessMatchesBeforeFirstKick",
  a.match_id AS "matchId", m.match_date::text AS "matchDate",
  a.source_id::int AS "sourceId", s.key AS "sourceKey",
  a.source_record_id AS "sourceRecordId",
  a.import_batch_id::text AS "importBatchId", a.imported_at::text AS "importedAt",
  a.source_annotation AS "sourceAnnotation", a.notes AS notes`;

const FIRST_KICK_FROM = `
  FROM player_achievements a
  LEFT JOIN players p ON p.id = a.player_id
  LEFT JOIN clubs c ON c.id = a.club_id
  LEFT JOIN matches m ON m.id = a.match_id
  LEFT JOIN sources s ON s.id = a.source_id`;

const AFTER_SIREN_SELECT = `
  k.id::int AS id, k.status AS status, k.status_reason AS "statusReason",
  k.updated_at::text AS "updatedAt",
  k.player_id AS "playerId", p.slug AS "playerSlug", p.display_name AS "playerDisplayName",
  k.player_name_raw AS "playerNameRaw", k.player_name_clean AS "playerNameClean",
  k.link_status_value::text AS "linkStatus", k.candidate_count::int AS "candidateCount",
  k.club_id AS "clubId", c.slug AS "clubSlug", c.name AS "clubName",
  k.club_name_raw AS "clubNameRaw",
  k.opponent_club_id AS "opponentClubId", o.slug AS "opponentSlug", o.name AS "opponentName",
  k.opponent_name_raw AS "opponentNameRaw",
  k.competition AS competition, k.premiership_season AS "premiershipSeason",
  k.season::int AS season, k.round_raw AS "roundRaw",
  k.match_id AS "matchId", m.match_date::text AS "matchDate",
  k.kick_scored::text AS "kickScored", k.kick_effect::text AS "kickEffect",
  k.shot_detail AS "shotDetail", k.kicker_result::text AS "kickerResult",
  k.siren::text AS siren,
  k.kicker_score_raw AS "kickerScoreRaw", k.opponent_score_raw AS "opponentScoreRaw",
  k.kicker_points::int AS "kickerPoints", k.opponent_points::int AS "opponentPoints",
  k.supergoal_scoring AS "supergoalScoring", k.cited AS cited,
  k.source_id::int AS "sourceId", s.key AS "sourceKey",
  k.source_record_id AS "sourceRecordId",
  k.import_batch_id::text AS "importBatchId", k.imported_at::text AS "importedAt",
  k.source_annotation AS "sourceAnnotation", k.notes AS notes`;

const AFTER_SIREN_FROM = `
  FROM after_siren_kicks k
  LEFT JOIN players p ON p.id = k.player_id
  LEFT JOIN clubs c ON c.id = k.club_id
  LEFT JOIN clubs o ON o.id = k.opponent_club_id
  LEFT JOIN matches m ON m.id = k.match_id
  LEFT JOIN sources s ON s.id = k.source_id`;

// --- filtering and paging ------------------------------------------------

export type SpecialRecordPage<TRow> = { rows: TRow[]; total: number };

export type SpecialRecordListFilter = {
  status?: SpecialRecordStatusFilter;
  provenance?: SpecialRecordProvenance | null;
  link?: SpecialRecordLinkFilter | null;
  season?: number | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
};

export type AfterSirenListFilter = SpecialRecordListFilter & {
  effect?: 'won' | 'drew' | 'none' | null;
};

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

function listBounds(filter: SpecialRecordListFilter): { limit: number; offset: number } {
  const size = Number(filter.pageSize ?? DEFAULT_PAGE_SIZE);
  const limit = Number.isInteger(size) ? Math.min(Math.max(size, 1), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  const requested = Number(filter.page ?? 1);
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;
  return { limit, offset: (page - 1) * limit };
}

/**
 * The four predicates both families share, as bound parameters $1 to $4.
 *
 * `$1` is the status filter, where 'all' matches everything — the default, and
 * the reason a voided record is on this surface at all. `$2` is provenance
 * (NULL matches everything), compared against the row's own source key. `$4`
 * is the link filter, which is a READ: it selects rows by whether they
 * resolved to a player and offers no way to change that (D-2).
 */
function sharedPredicate(alias: string): string {
  return `($1::text = 'all' OR ${alias}.status = $1::text)
        AND ($2::text IS NULL OR ($2::text = 'manual') = (COALESCE(s.key, '') = $3::text))
        AND ($4::text IS NULL OR ($4::text = 'linked') = (${alias}.player_id IS NOT NULL))`;
}

/** Every filter binds as one of these; nothing is ever spliced into the SQL. */
type BoundValue = string | number | boolean | null;

const sharedValues = (filter: SpecialRecordListFilter): BoundValue[] => [
  filter.status ?? DEFAULT_ADMIN_STATUS_FILTER,
  filter.provenance ?? null,
  MANUAL_SOURCE_KEY,
  filter.link ?? null,
];

async function pageOf<TRow>(
  select: string, from: string, where: string, order: string,
  values: BoundValue[], limit: number, offset: number,
): Promise<SpecialRecordPage<TRow>> {
  const [rows, totals] = await Promise.all([
    sql.unsafe(
      `SELECT ${select} ${from} WHERE ${where} ORDER BY ${order} LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ) as unknown as Promise<TRow[]>,
    sql.unsafe(
      `SELECT count(*)::int AS total ${from} WHERE ${where}`, values,
    ) as unknown as Promise<{ total: number }[]>,
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

// --- the admin reads -----------------------------------------------------

/**
 * First-kick-goal records (`player_achievements`).
 *
 * Deliberately NOT filtered by `achievement_type`. The enum has exactly one
 * member, so a predicate would buy nothing today and would SILENTLY HIDE a
 * future family row rather than surface it — and D-1 (2026-09-13) put the
 * family / father-son domain out of P4's scope entirely, so a second member
 * appearing is a decision to be taken, not a row to be swallowed.
 * `tests/special-records-admin.test.ts` fails the moment the enum grows,
 * which is the alarm that makes leaving the filter out the safe choice.
 *
 * The search covers the SOURCE spelling as well as the linked player's display
 * name, and the source record id: an unlinked row has no display name, and
 * `fkg-042` is how the tracked manifest names one.
 */
export async function listFirstKickGoals(
  filter: SpecialRecordListFilter = {},
): Promise<SpecialRecordPage<FirstKickGoalAdminRow>> {
  const { limit, offset } = listBounds(filter);
  return pageOf<FirstKickGoalAdminRow>(
    FIRST_KICK_SELECT, FIRST_KICK_FROM,
    `${sharedPredicate('a')}
        AND ($5::int IS NULL OR a.season = $5::int)
        AND ($6::text IS NULL OR a.player_name_raw ILIKE '%' || $6::text || '%'
             OR p.display_name ILIKE '%' || $6::text || '%'
             OR a.source_record_id ILIKE '%' || $6::text || '%')`,
    'a.season, a.round_raw, a.id',
    [
      ...sharedValues(filter),
      filter.season ?? null,
      (filter.search ?? '').trim() || null,
    ],
    limit, offset,
  );
}

export async function readFirstKickGoal(id: number): Promise<FirstKickGoalAdminRow | null> {
  const rows = await sql.unsafe(
    `SELECT ${FIRST_KICK_SELECT} ${FIRST_KICK_FROM} WHERE a.id = $1`, [id],
  ) as unknown as FirstKickGoalAdminRow[];
  return rows[0] ?? null;
}

/**
 * After-the-siren records (`after_siren_kicks`).
 *
 * `cited` is NOT a filter and never will be one on this surface: it is an
 * evidence gap about a kick that happened, the public site shows uncited kicks
 * exactly as it always has, and putting it beside the lifecycle control is the
 * precise confusion migration 089 and gate G-3 exist to prevent. It is a
 * column on the row, like the score.
 */
export async function listAfterSirenKicks(
  filter: AfterSirenListFilter = {},
): Promise<SpecialRecordPage<AfterSirenAdminRow>> {
  const { limit, offset } = listBounds(filter);
  return pageOf<AfterSirenAdminRow>(
    AFTER_SIREN_SELECT, AFTER_SIREN_FROM,
    `${sharedPredicate('k')}
        AND ($5::int IS NULL OR k.season = $5::int)
        AND ($6::text IS NULL OR k.kick_effect::text = $6::text)
        AND ($7::text IS NULL OR k.player_name_raw ILIKE '%' || $7::text || '%'
             OR p.display_name ILIKE '%' || $7::text || '%'
             OR k.source_record_id ILIKE '%' || $7::text || '%')`,
    'k.season, k.round_raw, k.id',
    [
      ...sharedValues(filter),
      filter.season ?? null,
      filter.effect ?? null,
      (filter.search ?? '').trim() || null,
    ],
    limit, offset,
  );
}

export async function readAfterSirenKick(id: number): Promise<AfterSirenAdminRow | null> {
  const rows = await sql.unsafe(
    `SELECT ${AFTER_SIREN_SELECT} ${AFTER_SIREN_FROM} WHERE k.id = $1`, [id],
  ) as unknown as AfterSirenAdminRow[];
  return rows[0] ?? null;
}

// --- the landing page's counts -------------------------------------------

export type SpecialRecordCounts = { active: number; void: number };

/**
 * One grouped count per family, for the two landing cards.
 *
 * Two statements, no join, no scan of anything else. Deliberately NOT filtered
 * to active: the void figure IS the number this surface exists to report.
 */
export async function specialRecordLifecycleCounts(): Promise<
Record<SpecialRecordTable, SpecialRecordCounts>
> {
  const [achievements, kicks] = await Promise.all([
    sql<{ status: SpecialRecordStatus; n: number }[]>`
      SELECT status, count(*)::int AS n FROM player_achievements GROUP BY status`,
    sql<{ status: SpecialRecordStatus; n: number }[]>`
      SELECT status, count(*)::int AS n FROM after_siren_kicks GROUP BY status`,
  ]);
  const fold = (rows: { status: SpecialRecordStatus; n: number }[]): SpecialRecordCounts => ({
    active: rows.find((r) => r.status === 'active')?.n ?? 0,
    void: rows.find((r) => r.status === 'void')?.n ?? 0,
  });
  return {
    player_achievements: fold(achievements),
    after_siren_kicks: fold(kicks),
  };
}

/**
 * The seasons each family actually holds, VOIDED ROWS INCLUDED, for the list
 * filters. Not derived from the public queries: those become active-only at
 * Stage 5, so a season whose every row had been voided would vanish from the
 * filter that is the only way to find them again.
 */
export async function listFirstKickGoalSeasonsForAdmin(): Promise<number[]> {
  const rows = await sql<{ season: number }[]>`
    SELECT DISTINCT season::int AS season FROM player_achievements ORDER BY season`;
  return rows.map((r) => r.season);
}

export async function listAfterSirenSeasonsForAdmin(): Promise<number[]> {
  const rows = await sql<{ season: number }[]>`
    SELECT DISTINCT season::int AS season FROM after_siren_kicks ORDER BY season`;
  return rows.map((r) => r.season);
}
