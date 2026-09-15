import 'server-only';

import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
import { resolvePlayerIdentity } from '@/db/queries/player-identity';
import { clubPath, matchPath, playerPath } from '@/lib/format';
import {
  type AfterSirenEffect, type AfterSirenResult, type AfterSirenScore, type AfterSirenSiren,
  validateAfterSirenEvent,
} from '@/lib/special-records/after-siren-rules';
import {
  FAMILY_BY_TABLE, MANUAL_SOURCE_KEY, mintManualSourceRecordId, specialRecordEntityKey,
  type SpecialRecordTable,
} from '@/lib/special-records/identity';

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

// =========================================================================
// Stage 6 — the write side
// =========================================================================
//
// WHAT A MUTATION HERE WRITES, AND WHY ALL THREE MUST COMMIT TOGETHER.
//
//   1. the CANONICAL row      -- the read-path cache of the decision;
//   2. one `data_overrides`   -- the DURABLE authority, the only thing that
//      row                       survives a destructive rebuild (migration 102's
//                                header states the whole argument);
//   3. one `data_edits` row   -- the append-only audit, the AFLDB-ISSUE-027
//                                contract: a failed audit insert rolls the
//                                canonical change back.
//
// All three go in ONE transaction on a short-lived `afldb_import` connection
// (D-5): reads above run on the app pool, writes run as the importer role, and
// `afldb_auth` gets nothing on either table. If a special-record data query
// here ever seems to need `authSql`, the pool architecture is wrong.
//
// WHAT A MUTATION MAY TOUCH, AND WHY THE LIST IS EXACTLY THIS ONE. The
// correctable set below is, column for column, the amendable set
// AFLDB-ISSUE-167 §3.4 classifies AND the set the Stage 4 replay adapters
// carry (`tools/records/special-records-replay.ts` COLUMNS,
// `tools/migration/common.py`'s matching list). That agreement is not a
// coincidence to be relied on quietly -- `tests/special-records-admin.test.ts`
// reads the adapter as source and fails if the two lists ever part -- because a
// mutation that writes a column the replay cannot carry would create state a
// rebuild silently reverts, which is the one failure the whole durable-decision
// design exists to prevent.
//
// THE LINK COLUMNS ARE THEREFORE NOT CORRECTABLE, and this is a consequence
// rather than a preference. `player_id`, `club_id`, `opponent_club_id` and
// `match_id` appear in no override payload and in no replay UPDATE: the replay
// says so in its own words ("Link columns are deliberately NOT restored here:
// linkage is /admin/player-links' business (D-2)"). §3.4.1 had already ruled
// `link_status_value`, `candidate_count`, `player_achievements.match_id` and
// `after_siren_kicks.club_id` derived; the remaining links join them here for
// the durability reason above. A manual CREATION is the one place a link is
// set, because a `record` payload CAN carry `player_identity` and `match_key`,
// which the replay resolves back to ids after a rebuild.
//
// NO DESTRUCTIVE DELETE. There is no delete path in this module and none is to
// be added: suppression is a lifecycle state, the row is kept so its
// `data_edits` rows stay resolvable through the next promotion's lineage remap,
// and operator CLI repair is the only removal (§10.2).

type Tx = postgres.TransactionSql;

export type SpecialRecordRefusalReason =
  | 'validation'
  | 'not_found'
  | 'stale'
  | 'no_durable_key'
  | 'invalid_transition'
  | 'conflict'
  | 'ambiguous_identity'
  | 'forbidden'
  | 'failed';

export type SpecialRecordRefusal = {
  ok: false;
  error: string;
  reason: SpecialRecordRefusalReason;
  /** What the refusal is ABOUT, so a caller need not parse the sentence. */
  subjects?: string[];
};

export type SpecialRecordMutationEnvelope = {
  table: SpecialRecordTable;
  rowId: number;
  /** The durable `data_overrides.entity_key` this mutation recorded against. */
  entityKey: string;
  /**
   * The paths a successful mutation invalidates, computed SERVER-SIDE from the
   * row's own ids. Never client-supplied, and never revalidated from here:
   * `revalidatePath()` inside a Server Action hangs the Next 15.5 client
   * (AFLDB-ISSUE-156 §7 R-7), so the caller POSTs these to the allowlisted
   * `/admin/records/revalidate` route after the action resolves.
   */
  revalidatePaths: string[];
};

export type SpecialRecordMutationResult<T = SpecialRecordMutationEnvelope> =
  ({ ok: true } & T) | SpecialRecordRefusal;

export type SpecialRecordReplacementResult = SpecialRecordMutationEnvelope & {
  /** The suppressed row's durable key, so the pair reads as one movement. */
  suppressedEntityKey: string;
  suppressedRowId: number;
  replacementId: string;
};

function refuse(
  reason: SpecialRecordRefusalReason, error: string, subjects?: string[],
): SpecialRecordRefusal {
  return subjects?.length ? { ok: false, error, reason, subjects } : { ok: false, error, reason };
}

/**
 * A refusal discovered AFTER this transaction has already written something.
 *
 * `postgres.js` commits when the `begin()` callback RESOLVES and rolls back
 * only when it REJECTS, so returning a refusal past the first write would
 * commit a half-done mutation while reporting failure -- an unaudited canonical
 * write. Throwing rolls the transaction back and the caller's `catch` turns it
 * back into exactly the refusal it would otherwise have returned (the
 * AFLDB-ISSUE-160 pattern, used here for EVERY post-write refusal).
 */
class RollbackRefusal extends Error {
  constructor(
    readonly reason: SpecialRecordRefusalReason,
    readonly detail: string,
    readonly subjects: string[] = [],
  ) {
    super(detail);
    this.name = 'RollbackRefusal';
  }
}

function rolledBackRefusal(error: unknown): SpecialRecordRefusal | null {
  return error instanceof RollbackRefusal
    ? refuse(error.reason, error.detail, error.subjects)
    : null;
}

function mutationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `The record could not be changed: ${message}`;
}

async function withImportConnection<T>(fn: (importSql: postgres.Sql) => Promise<T>): Promise<T> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) throw new Error('AFLDB_IMPORT_DATABASE_URL is not configured.');
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(importSql);
  } finally {
    await importSql.end({ timeout: 5 });
  }
}

async function manualSourceId(tx: Tx): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    SELECT id FROM sources WHERE key = ${MANUAL_SOURCE_KEY}
  `;
  if (!row) throw new Error(`Required source '${MANUAL_SOURCE_KEY}' is not configured.`);
  return row.id;
}

/**
 * The promotion lineage identity for either family:
 * `'<sources.key>|<source_record_id>'` (a PIPE, not the `entity_key` colon).
 *
 * `tools/db/promotion-inventory.ts` computes the same string in SQL for
 * `first_kick_goal_key` / `after_siren_key`; it is carried into every audit row
 * here so a `data_edits` entry stays resolvable after a promotion has
 * renumbered the surrogate id it names.
 */
export function specialRecordLineageIdentity(sourceKey: string, sourceRecordId: string): string {
  return `${sourceKey}|${sourceRecordId}`;
}

/** Whether this row is owned by a source that reloads it, or by an administrator. */
function isManual(sourceKey: string | null): boolean {
  return sourceKey === MANUAL_SOURCE_KEY;
}

export const SPECIAL_RECORD_FIELD_GROUPS = ['lifecycle', 'correction', 'record'] as const;
export type SpecialRecordFieldGroup = (typeof SPECIAL_RECORD_FIELD_GROUPS)[number];

/**
 * Write (or rewrite) one durable record.
 *
 * `is_active` is ALWAYS true, for all three field groups. The lifecycle lives
 * in the payload's `status`, because a SUPPRESSED row must be RE-CREATED by the
 * replay and then voided again, never suppressed by it: suppressing the
 * override would delete the row whose `data_edits` rows must stay resolvable at
 * the next promotion lineage remap. No tombstone -- the AFLDB-ISSUE-162/163/165
 * shape (§5.2).
 */
async function writeOverride(tx: Tx, input: {
  entityType: SpecialRecordTable;
  entityKey: string;
  fieldGroup: SpecialRecordFieldGroup;
  payload: Record<string, unknown>;
  adminUserId: number;
}): Promise<void> {
  await tx`
    INSERT INTO data_overrides
          (entity_type, entity_key, field_group, override_values, admin_user_id,
           is_active, updated_at)
    VALUES (${input.entityType}, ${input.entityKey}, ${input.fieldGroup},
            ${tx.json(input.payload as unknown as postgres.JSONValue)},
            ${input.adminUserId}, true, now())
    ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
       SET override_values = EXCLUDED.override_values,
           is_active = true,
           admin_user_id = EXCLUDED.admin_user_id,
           updated_at = now()
  `;
}

/**
 * Refuse a durable authority combination the Stage 4 replay would later refuse.
 *
 * The replay's own rule (`special-records-replay.ts`, and `common.py`'s twin):
 * a `record` override owns the WHOLE durable row, its status included, so a
 * second active override over the same key makes the outcome order-dependent
 * and FAILS THE WHOLE RELOAD CLOSED. `correction` + `lifecycle` is NOT a
 * collision -- they own disjoint fields and replay in a defined order.
 *
 * Checking it HERE, before the override is written, is the difference between
 * an administrator reading a sentence now and an operator meeting a refused
 * rebuild months later with no idea which decision caused it.
 */
async function refuseOverrideCollision(tx: Tx, input: {
  entityType: SpecialRecordTable;
  entityKey: string;
  fieldGroup: SpecialRecordFieldGroup;
}): Promise<void> {
  const existing = await tx<{ fieldGroup: string }[]>`
    SELECT field_group AS "fieldGroup" FROM data_overrides
     WHERE entity_type = ${input.entityType} AND entity_key = ${input.entityKey}
       AND is_active = true AND field_group <> ${input.fieldGroup}
     ORDER BY field_group
  `;
  if (existing.length === 0) return;
  const other = existing.map((row) => row.fieldGroup);
  const wouldCollide = input.fieldGroup === 'record' || other.includes('record');
  if (!wouldCollide) return;
  throw new RollbackRefusal('conflict',
    `${input.entityKey} already carries a durable ${other.join(' and ')} decision, and a `
    + 'record decision owns the whole row including its status. Two authorities over one '
    + 'record would make a rebuild order-dependent, so the reload would refuse. Resolve the '
    + 'existing decision first.',
    [input.entityKey]);
}

/**
 * Refuse a NEW manual record whose durable key is already claimed.
 *
 * Collision is impossible on two independent axes -- the minted uuid and the
 * `manual_admin_edit` source id -- which is why migration 102 needed no
 * active-row-only uniqueness (its header says so). This asserts that rather
 * than assuming it: a claimed key would silently overwrite an earlier decision.
 */
async function refuseClaimedKey(
  tx: Tx, entityType: SpecialRecordTable, entityKey: string,
): Promise<void> {
  const [claimed] = await tx<{ fieldGroup: string }[]>`
    SELECT field_group AS "fieldGroup" FROM data_overrides
     WHERE entity_type = ${entityType} AND entity_key = ${entityKey}
     ORDER BY field_group LIMIT 1
  `;
  if (claimed) {
    throw new RollbackRefusal('conflict',
      `A durable ${claimed.fieldGroup} record already exists for ${entityKey}. That identity is `
      + 'already spoken for and two records cannot share one durable key.');
  }
}

// --- revalidation paths (computed server-side) ---------------------------

/**
 * The public pages a special-record change can move, named from the row's own
 * ids, plus this domain's two admin surfaces.
 *
 * `/records/first-kick-goal` and `/records/after-the-siren` are ISR 24h;
 * `/players/<slug>-<id>` is ISR 1h and renders the player's honours, which
 * Stage 5 made active-only; `/matches/<id>` and `/clubs/<slug>` are the other
 * two cached pages a linked row reaches. The two `/admin/records/...` paths are
 * `force-dynamic` and need no invalidation -- they are named so the set reads
 * as the complete consumer list rather than a filtered one, the same way
 * AFLDB-ISSUE-165 names `/hall-of-fame`.
 */
const FIRST_KICK_PUBLIC_PATH = '/records/first-kick-goal';
const AFTER_SIREN_PUBLIC_PATH = '/records/after-the-siren';

function specialRecordPaths(
  family: 'first-kick-goal' | 'after-the-siren',
  row: {
    id: number;
    playerId: number | null; playerSlug: string | null;
    clubSlug: string | null; matchId: number | null;
    opponentSlug?: string | null;
  },
): string[] {
  const publicPath = family === 'first-kick-goal' ? FIRST_KICK_PUBLIC_PATH : AFTER_SIREN_PUBLIC_PATH;
  const paths = [publicPath, `/admin/records/${family}`, `/admin/records/${family}/${row.id}`];
  if (row.playerId !== null && row.playerSlug) paths.push(playerPath(row.playerSlug, row.playerId));
  if (row.clubSlug) paths.push(clubPath(row.clubSlug));
  if (row.opponentSlug) paths.push(clubPath(row.opponentSlug));
  if (row.matchId !== null) paths.push(matchPath(row.matchId));
  return [...new Set(paths)];
}

// --- the shared edit core ------------------------------------------------

export type SpecialRecordEditBase = {
  rowId: number;
  /** The `updatedAt` the form rendered. Per-row compare-and-swap. */
  expectedUpdatedAt: string;
  adminUserId: number;
  note?: string | null;
};

export type SuppressSpecialRecordInput = SpecialRecordEditBase & { reason: string };

type LockedSpecialRecord<TRow> = {
  id: number;
  entityKey: string;
  status: SpecialRecordStatus;
  statusReason: string | null;
  updatedAt: string;
  sourceKey: string | null;
  revalidatePaths: string[];
  /** Carried into every audit row so an entry reads without joining anything. */
  auditIdentity: Record<string, unknown>;
  row: TRow;
};

type LockResult<TRow> = LockedSpecialRecord<TRow> | null | SpecialRecordRefusal;

function isRefusal<TRow>(value: LockResult<TRow>): value is SpecialRecordRefusal {
  return value !== null && 'ok' in value && value.ok === false;
}

/**
 * Lock one row, read it whole, and derive everything a mutation needs from it.
 *
 * The `FOR UPDATE` is taken on the id alone and the full read follows, because
 * the display SELECTs carry LEFT JOINs and `FOR UPDATE` may not be applied to
 * the nullable side of an outer join.
 */
async function lockSpecialRecord<TRow extends {
  id: number; status: SpecialRecordStatus; statusReason: string | null; updatedAt: string;
  sourceId: number | null; sourceKey: string | null; sourceRecordId: string | null;
  season: number; roundRaw: string; playerNameRaw: string;
  playerId: number | null; playerSlug: string | null; clubSlug: string | null;
  matchId: number | null;
}>(
  tx: Tx,
  table: SpecialRecordTable,
  family: 'first-kick-goal' | 'after-the-siren',
  rowId: number,
  read: (tx: Tx, id: number) => Promise<TRow | null>,
  noun: string,
): Promise<LockResult<TRow>> {
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM ${tx(table)} WHERE id = ${rowId} FOR UPDATE
  `;
  if (!locked) return null;
  const row = await read(tx, locked.id);
  if (!row) return null;

  // A row without a durable key cannot be named in `data_overrides` at all, so
  // its correction or suppression would be silently lost by the next rebuild.
  // Probe P-2 measured 334/334 and 126/126 rows carrying both halves on
  // afldb_test, so this is not reachable by current data -- and recording a
  // decision that cannot survive is worse than refusing to record it.
  if (row.sourceId === null || row.sourceKey === null || !row.sourceRecordId) {
    return refuse('no_durable_key',
      `${noun} #${row.id} carries no source identity (source_id / source_record_id), so a `
      + 'correction or suppression of it could not be recorded durably and would be lost by the '
      + 'next reload. Give the row a provenance first.');
  }

  const entityKey = specialRecordEntityKey(row.sourceKey, row.sourceRecordId);
  return {
    id: row.id,
    entityKey,
    status: row.status,
    statusReason: row.statusReason,
    updatedAt: row.updatedAt,
    sourceKey: row.sourceKey,
    revalidatePaths: specialRecordPaths(family, row as never),
    auditIdentity: {
      entity_key: entityKey,
      lineage_identity: specialRecordLineageIdentity(row.sourceKey, row.sourceRecordId),
      season: row.season,
      round_raw: row.roundRaw,
      player_name_raw: row.playerNameRaw,
    },
    row,
  };
}

/**
 * Lock, compare-and-swap, apply, record the durable authority, audit -- in one
 * transaction, in that order.
 *
 * EVERYTHING BEFORE `apply` REFUSES WITHOUT WRITING. A stale
 * `expectedUpdatedAt` therefore leaves no canonical change, no `data_overrides`
 * row and no `data_edits` row -- the whole of §10.3's contract. From `apply`
 * onward a refusal must THROW, and `RollbackRefusal` is how.
 *
 * A NOTE ON WHAT CAN LEGITIMATELY INVALIDATE A FORM. The Stage 4 replay does
 * not bump `updated_at` when it would write identical values (its step 6 is
 * guarded by IS DISTINCT FROM, precisely so an ordinary reload does not
 * invalidate an open form) -- but it DOES bump it when a reload genuinely
 * changes the row. So an importer run CAN make an administrator's open form
 * stale, and that is correct: the form was rendered from a row that no longer
 * says what it said. The answer is to reload the page, never to weaken the
 * compare-and-swap.
 */
async function runSpecialRecordEdit<TRow>(input: SpecialRecordEditBase & {
  table: SpecialRecordTable;
  fieldGroup: string;
  lock: (tx: Tx, rowId: number) => Promise<LockResult<TRow>>;
  precheck?: (ctx: { tx: Tx; row: LockedSpecialRecord<TRow> }) => Promise<SpecialRecordRefusal | null>;
  apply: (ctx: { tx: Tx; row: LockedSpecialRecord<TRow> }) => Promise<{
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    overrideGroup: SpecialRecordFieldGroup;
    overridePayload: Record<string, unknown>;
  }>;
}): Promise<SpecialRecordMutationResult> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const locked = await input.lock(tx as Tx, input.rowId);
        if (locked === null) return refuse('not_found', 'That record no longer exists.');
        if (isRefusal(locked)) return locked;
        const row = locked;

        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That record changed while this page was open. Reload it and try again.');
        }

        if (input.precheck) {
          const refusal = await input.precheck({ tx: tx as Tx, row });
          if (refusal) return refusal;
        }

        // Everything above refused before a write. From here, any refusal throws.
        const applied = await input.apply({ tx: tx as Tx, row });

        await refuseOverrideCollision(tx as Tx, {
          entityType: input.table,
          entityKey: row.entityKey,
          fieldGroup: applied.overrideGroup,
        });

        await writeOverride(tx as Tx, {
          entityType: input.table,
          entityKey: row.entityKey,
          fieldGroup: applied.overrideGroup,
          payload: applied.overridePayload,
          adminUserId: input.adminUserId,
        });

        await recordDataEdit(tx as Tx, {
          tableName: input.table,
          rowId: row.id,
          fieldGroup: input.fieldGroup,
          oldValues: applied.oldValues,
          newValues: { ...row.auditIdentity, ...applied.newValues },
          adminUserId: input.adminUserId,
          note: input.note,
        });

        return {
          ok: true as const,
          table: input.table,
          rowId: row.id,
          entityKey: row.entityKey,
          revalidatePaths: row.revalidatePaths,
        };
      }) as SpecialRecordMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- the correctable surface ---------------------------------------------

/** One correctable field: the canonical column it writes, and the cast it needs. */
type CorrectableSpec = { column: string; cast: string };

/**
 * Family A's correctable fields -- §3.4's amendable list for
 * `player_achievements`, which is also, column for column, the Stage 4 replay
 * adapter's `COLUMNS.player_achievements`.
 */
export const FIRST_KICK_CORRECTABLE: Readonly<Record<string, CorrectableSpec>> = {
  playerNameRaw: { column: 'player_name_raw', cast: '' },
  playerNameClean: { column: 'player_name_clean', cast: '' },
  clubNameRaw: { column: 'club_name_raw', cast: '' },
  season: { column: 'season', cast: '::smallint' },
  roundRaw: { column: 'round_raw', cast: '' },
  seasonFootnoteRaw: { column: 'season_footnote_raw', cast: '' },
  sourceAnnotation: { column: 'source_annotation', cast: '' },
  notes: { column: 'notes', cast: '' },
  consecutiveGoalKicks: { column: 'consecutive_goal_kicks', cast: '::smallint' },
  noFurtherCareerGoals: { column: 'no_further_career_goals', cast: '::boolean' },
  noFurtherCareerKicks: { column: 'no_further_career_kicks', cast: '::boolean' },
  kicklessMatchesBeforeFirstKick: { column: 'kickless_matches_before_first_kick', cast: '::smallint' },
};

/** Family B's, likewise identical to `COLUMNS.after_siren_kicks`. */
export const AFTER_SIREN_CORRECTABLE: Readonly<Record<string, CorrectableSpec>> = {
  playerNameRaw: { column: 'player_name_raw', cast: '' },
  playerNameClean: { column: 'player_name_clean', cast: '' },
  clubNameRaw: { column: 'club_name_raw', cast: '' },
  opponentNameRaw: { column: 'opponent_name_raw', cast: '' },
  competition: { column: 'competition', cast: '' },
  premiershipSeason: { column: 'premiership_season', cast: '::boolean' },
  season: { column: 'season', cast: '::smallint' },
  roundRaw: { column: 'round_raw', cast: '' },
  kickScored: { column: 'kick_scored', cast: '::after_siren_score' },
  kickEffect: { column: 'kick_effect', cast: '::after_siren_effect' },
  kickerResult: { column: 'kicker_result', cast: '::after_siren_result' },
  kickerScoreRaw: { column: 'kicker_score_raw', cast: '' },
  opponentScoreRaw: { column: 'opponent_score_raw', cast: '' },
  kickerPoints: { column: 'kicker_points', cast: '::smallint' },
  opponentPoints: { column: 'opponent_points', cast: '::smallint' },
  siren: { column: 'siren', cast: '::after_siren_siren' },
  supergoalScoring: { column: 'supergoal_scoring', cast: '::boolean' },
  cited: { column: 'cited', cast: '::boolean' },
  shotDetail: { column: 'shot_detail', cast: '' },
  sourceAnnotation: { column: 'source_annotation', cast: '' },
  notes: { column: 'notes', cast: '' },
};

/**
 * Every field a correction may NOT touch, named so a crafted payload gets a
 * sentence rather than silence.
 *
 * `link*` / `candidateCount` / `playerId` / `clubId` / `opponentClubId` /
 * `matchId` are derived or link-owned (§3.4.1, D-2); `sourceId`,
 * `sourceRecordId` and `achievementType` are identity -- a wrong identity is a
 * suppression plus a manual replacement, never a rekey (that is P10's); and
 * `status` / `statusReason` belong to the lifecycle controls, not to a
 * correction.
 */
export const SPECIAL_RECORD_UNCORRECTABLE = [
  'id', 'status', 'statusReason', 'updatedAt',
  'playerId', 'playerSlug', 'playerDisplayName', 'linkStatus', 'candidateCount',
  'clubId', 'clubSlug', 'clubName', 'opponentClubId', 'opponentSlug', 'opponentName',
  'matchId', 'matchDate',
  'sourceId', 'sourceKey', 'sourceRecordId', 'importBatchId', 'importedAt',
  'achievementType',
] as const;

export function uncorrectableFieldRefusal(fields: string[], noun: string): string {
  return `${fields.join(', ')} cannot be corrected here. Identity and provenance are what the `
    + `record IS -- a wrong one is a suppression plus a manual replacement, so both the mistake `
    + `and the correction survive as history. The player, club and match links, the link status `
    + `and the candidate count are derived by the import and the player-link queue, not typed on `
    + `this ${noun}.`;
}

/**
 * The fields a caller actually asked to change, refusing anything outside the
 * correctable set BEFORE a transaction is opened.
 *
 * Defence in depth: the typed `fields` parameter already excludes these at
 * compile time, and a Server Action only copies across the fields its own
 * allowlist names -- but a crafted payload reaching this module directly must
 * not be able to reach a derived column through an object key either.
 */
function partitionCorrection(
  fields: Record<string, unknown>, correctable: Readonly<Record<string, CorrectableSpec>>,
): { allowed: string[]; forbidden: string[] } {
  const allowed: string[] = [];
  const forbidden: string[] = [];
  for (const key of Object.keys(fields)) {
    if (fields[key] === undefined) continue;
    if (Object.hasOwn(correctable, key)) allowed.push(key);
    else forbidden.push(key);
  }
  return { allowed, forbidden };
}

/**
 * The canonical UPDATE for a correction: only the columns that actually
 * changed, bound as parameters, with the column names taken from the
 * allowlisted spec above and never from the caller.
 */
async function applyCorrectionUpdate(
  tx: Tx,
  table: SpecialRecordTable,
  rowId: number,
  correctable: Readonly<Record<string, CorrectableSpec>>,
  changed: { key: string; value: unknown }[],
): Promise<void> {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const { key, value } of changed) {
    const spec = correctable[key];
    values.push(value);
    assignments.push(`${spec.column} = $${values.length}${spec.cast}`);
  }
  assignments.push('updated_at = now()');
  values.push(rowId);
  await tx.unsafe(
    `UPDATE ${table} SET ${assignments.join(', ')} WHERE id = $${values.length}`,
    values as never[],
  );
}

/**
 * The correction DELTA, keyed by CANONICAL COLUMN NAME because that is what the
 * replay reads (`jsonb_exists(t.v, '<column>')`). Key presence is the
 * semantics: an absent key leaves the source value, an explicit JSON null
 * clears it (the migration-086 discipline both adapters mirror).
 */
function correctionDelta(
  correctable: Readonly<Record<string, CorrectableSpec>>,
  changed: { key: string; value: unknown }[],
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const { key, value } of changed) delta[correctable[key].column] = value;
  return delta;
}

/**
 * The durable identity of the player and the match a MANUAL row carries.
 *
 * Both travel as natural keys, never as ids: `player_identity` is
 * `'afltables:<external id>'` or `'manual_admin_edit:<token>'`, which the
 * replay resolves back through `external_identities`; `match_key` is
 * `matches.match_key`, which it resolves back through `matches`. A rebuild
 * renumbers every id and neither of these.
 */
async function manualLinkIdentity(
  tx: Tx, playerId: number | null, matchId: number | null,
): Promise<{ playerIdentity: string | null; matchKey: string | null }> {
  let playerIdentity: string | null = null;
  if (playerId !== null) {
    const resolved = await resolvePlayerIdentity(tx, playerId);
    if (!resolved.ok) throw new RollbackRefusal('ambiguous_identity', resolved.error);
    playerIdentity = resolved.identity;
  }
  let matchKey: string | null = null;
  if (matchId !== null) {
    const [match] = await tx<{ matchKey: string }[]>`
      SELECT match_key AS "matchKey" FROM matches WHERE id = ${matchId}
    `;
    if (!match) throw new RollbackRefusal('validation', 'The selected match does not exist.');
    matchKey = match.matchKey;
  }
  return { playerIdentity, matchKey };
}

/**
 * The match-consistency invariant a manual special-record write must satisfy
 * before it may name a match at all (AFLDB-ISSUE-176): the match must exist,
 * it must belong to the record's own season, and — when the write also names
 * a player — that player must actually have a `player_match_stats` row for
 * it. A record naming a match the player never played in, or a match from a
 * different season, is not evidence the record can carry, so this throws
 * before `insertFirstKickGoal` / `insertAfterSirenKick` writes anything: no
 * canonical row, no durable `data_overrides` payload, no audit row.
 */
async function validateSpecialRecordMatchLink(
  tx: Tx, matchId: number | null, season: number, playerId: number | null,
): Promise<void> {
  if (matchId === null) return;
  const [match] = await tx<{ season: number }[]>`
    SELECT season::int AS season FROM matches WHERE id = ${matchId}
  `;
  if (!match) throw new RollbackRefusal('validation', 'The selected match does not exist.');
  if (match.season !== season) {
    throw new RollbackRefusal('validation',
      `The selected match is from the ${match.season} season, not ${season}: a special `
      + "record's match must belong to the record's own season.");
  }
  if (playerId !== null) {
    const [played] = await tx<{ id: number }[]>`
      SELECT id FROM player_match_stats WHERE match_id = ${matchId} AND player_id = ${playerId}
    `;
    if (!played) {
      throw new RollbackRefusal('validation',
        'The selected player has no match statistics for the selected match, so the two cannot '
        + 'be linked together on this record.');
    }
  }
}

// =========================================================================
// player_achievements -- the first-kick goal
// =========================================================================

async function readFirstKickGoalInTx(tx: Tx, id: number): Promise<FirstKickGoalAdminRow | null> {
  const rows = await tx.unsafe(
    `SELECT ${FIRST_KICK_SELECT} ${FIRST_KICK_FROM} WHERE a.id = $1`, [id] as never[],
  ) as unknown as FirstKickGoalAdminRow[];
  return rows[0] ?? null;
}

function lockFirstKickGoal(tx: Tx, rowId: number) {
  return lockSpecialRecord<FirstKickGoalAdminRow>(
    tx, 'player_achievements', 'first-kick-goal', rowId, readFirstKickGoalInTx,
    'First-kick-goal record',
  );
}

/**
 * The WHOLE durable representation of a manual first-kick row, in exactly the
 * shape `replaySpecialRecordOverrides()` re-creates a row from: every column in
 * its `COLUMNS.player_achievements` spec, the lifecycle pair, and the two
 * natural link identities.
 *
 * `club_id` is deliberately absent, and that is not an omission. The replay's
 * `record` INSERT sets `player_id`, `link_status_value` and `match_id` and no
 * club column at all, so a payload carrying a club id would describe a row the
 * replay cannot rebuild -- and a manual row this module created must be
 * reconstructable EXACTLY. The club therefore lives where the replay can keep
 * it: in `club_name_raw`, the source spelling, which every public read already
 * falls back to (`COALESCE(cl.name, a.club_name_raw)`).
 */
function firstKickRecordPayload(
  row: FirstKickGoalAdminRow,
  links: { playerIdentity: string | null; matchKey: string | null },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    player_name_raw: row.playerNameRaw,
    player_name_clean: row.playerNameClean,
    club_name_raw: row.clubNameRaw,
    season: row.season,
    round_raw: row.roundRaw,
    season_footnote_raw: row.seasonFootnoteRaw,
    source_annotation: row.sourceAnnotation,
    notes: row.notes,
    consecutive_goal_kicks: row.consecutiveGoalKicks,
    no_further_career_goals: row.noFurtherCareerGoals,
    no_further_career_kicks: row.noFurtherCareerKicks,
    kickless_matches_before_first_kick: row.kicklessMatchesBeforeFirstKick,
    status: row.status,
    status_reason: row.statusReason,
    player_identity: links.playerIdentity,
    match_key: links.matchKey,
    ...extra,
  };
}

export type FirstKickGoalCorrection = Partial<{
  playerNameRaw: string;
  playerNameClean: string;
  clubNameRaw: string;
  season: number;
  roundRaw: string;
  seasonFootnoteRaw: string | null;
  sourceAnnotation: string | null;
  notes: string | null;
  consecutiveGoalKicks: number;
  noFurtherCareerGoals: boolean;
  noFurtherCareerKicks: boolean;
  kicklessMatchesBeforeFirstKick: number;
}>;

function validateFirstKickFields(f: FirstKickGoalCorrection): string | null {
  if (f.playerNameRaw !== undefined && !f.playerNameRaw.trim()) {
    return 'The player name as the source wrote it cannot be emptied; it is what an unlinked '
      + 'record still asserts.';
  }
  if (f.playerNameClean !== undefined && !f.playerNameClean.trim()) {
    return 'The cleaned player name cannot be emptied.';
  }
  if (f.clubNameRaw !== undefined && !f.clubNameRaw.trim()) {
    return 'The club name as the source wrote it cannot be emptied.';
  }
  if (f.roundRaw !== undefined && !f.roundRaw.trim()) return 'The round cannot be emptied.';
  if (f.season !== undefined && (!Number.isInteger(f.season) || f.season < 1897 || f.season > 2100)) {
    return 'Season must be a year from 1897 to 2100.';
  }
  if (f.consecutiveGoalKicks !== undefined
      && (!Number.isInteger(f.consecutiveGoalKicks) || f.consecutiveGoalKicks < 1)) {
    return 'Consecutive goal kicks must be a whole number of 1 or more '
      + '(player_achievements_consecutive_ck).';
  }
  if (f.kicklessMatchesBeforeFirstKick !== undefined
      && (!Number.isInteger(f.kicklessMatchesBeforeFirstKick)
        || f.kicklessMatchesBeforeFirstKick < 0)) {
    return 'Kickless matches before the first kick must be a whole number of 0 or more '
      + '(player_achievements_kickless_ck).';
  }
  return null;
}

export type CorrectFirstKickGoalInput = SpecialRecordEditBase & {
  fields: FirstKickGoalCorrection;
};

/**
 * Correct the amendable metadata of one first-kick-goal record.
 *
 * THE MATCH LINK IS NOT RE-DERIVED HERE, and that is a deliberate, evidenced
 * decision rather than an oversight (AFLDB-ISSUE-167 Stage 6 finding F-1).
 * Planning §3.4.1 stated that `match_id` follows
 * `kickless_matches_before_first_kick`, quoting migration 053's column comment
 * (`053:103-105`). Current source says the opposite in as many words:
 * `tools/records/import-first-kick-goal.ts:797-808` resolves the match as "the
 * one the SOURCE says it happened in -- the player's game in that season at
 * that round -- not one inferred from career position", and gives Brent
 * Harvey's 1996 debut as the reason. So the derivation inputs are `season` and
 * `round_raw`, both of which ARE correctable here.
 *
 * Re-deriving the link inside this transaction would nevertheless be wrong: the
 * Stage 4 replay carries a correction as a DELTA over the amendable columns and
 * touches no link column, so after a destructive rebuild the row would carry
 * the importer's own `match_id` (from the SOURCE's season and round) beside the
 * corrected season -- a state this mutation could not reproduce. Leaving the
 * link alone is therefore the only outcome that is identical before and after a
 * rebuild. The detail page says so in the operator's words.
 */
export async function correctFirstKickGoal(
  input: CorrectFirstKickGoalInput,
): Promise<SpecialRecordMutationResult> {
  const { allowed, forbidden } = partitionCorrection(
    input.fields as Record<string, unknown>, FIRST_KICK_CORRECTABLE,
  );
  if (forbidden.length > 0) {
    return refuse('forbidden', uncorrectableFieldRefusal(forbidden, 'first-kick-goal record'),
      forbidden);
  }
  if (allowed.length === 0) return refuse('validation', 'Nothing was changed.');
  const invalid = validateFirstKickFields(input.fields);
  if (invalid) return refuse('validation', invalid);

  return runSpecialRecordEdit<FirstKickGoalAdminRow>({
    ...input,
    table: 'player_achievements',
    fieldGroup: 'first_kick_goal_corrected',
    lock: lockFirstKickGoal,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition',
        'That record is suppressed. Suppressed records are kept for the record and are not '
        + 'maintained; reinstate it first if the row should stand.')
      : null),
    apply: async ({ tx, row }) => {
      const a = row.row;
      const before: Record<string, unknown> = {
        playerNameRaw: a.playerNameRaw,
        playerNameClean: a.playerNameClean,
        clubNameRaw: a.clubNameRaw,
        season: a.season,
        roundRaw: a.roundRaw,
        seasonFootnoteRaw: a.seasonFootnoteRaw,
        sourceAnnotation: a.sourceAnnotation,
        notes: a.notes,
        consecutiveGoalKicks: a.consecutiveGoalKicks,
        noFurtherCareerGoals: a.noFurtherCareerGoals,
        noFurtherCareerKicks: a.noFurtherCareerKicks,
        kicklessMatchesBeforeFirstKick: a.kicklessMatchesBeforeFirstKick,
      };
      const fields = input.fields as Record<string, unknown>;
      const changed = allowed.map((key) => ({ key, value: fields[key] ?? null }));

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const { key, value } of changed) {
        oldValues[FIRST_KICK_CORRECTABLE[key].column] = before[key];
        newValues[FIRST_KICK_CORRECTABLE[key].column] = value;
      }

      await applyCorrectionUpdate(tx, 'player_achievements', a.id, FIRST_KICK_CORRECTABLE, changed);

      if (!isManual(a.sourceKey)) {
        return {
          oldValues,
          newValues,
          overrideGroup: 'correction',
          overridePayload: correctionDelta(FIRST_KICK_CORRECTABLE, changed),
        };
      }

      // A manual row has no source to be a delta OF, so its whole durable
      // representation is rewritten -- link identities re-resolved rather than
      // dropped, because the replay re-creates the row from this payload and an
      // omitted identity would bring it back unlinked.
      const updated = await readFirstKickGoalInTx(tx, a.id);
      if (!updated) throw new RollbackRefusal('failed', 'The corrected record could not be read back.');
      const links = await manualLinkIdentity(tx, updated.playerId, updated.matchId);
      return {
        oldValues,
        newValues,
        overrideGroup: 'record',
        overridePayload: firstKickRecordPayload(updated, links),
      };
    },
  });
}

export async function suppressFirstKickGoal(
  input: SuppressSpecialRecordInput,
): Promise<SpecialRecordMutationResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return refuse('validation', 'Give a reason for suppressing this first-kick-goal record.');
  }
  return runSpecialRecordEdit<FirstKickGoalAdminRow>({
    ...input,
    table: 'player_achievements',
    fieldGroup: 'first_kick_goal_suppressed',
    lock: lockFirstKickGoal,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That record is already suppressed.') : null),
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE player_achievements
           SET status = 'void', status_reason = ${reason}, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'void', status_reason: reason },
        overrideGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
        overridePayload: isManual(row.sourceKey)
          ? await manualFirstKickPayload(tx, row.id)
          : { status: 'void', status_reason: reason },
      };
    },
  });
}

/**
 * A MANUAL row's suppression rewrites its `record` payload rather than adding a
 * `lifecycle` one beside it.
 *
 * Two active overrides over one key is the collision the replay fails closed
 * on, and a `record` payload already carries `status` and `status_reason` --
 * so the lifecycle decision belongs inside it. A SOURCE-owned row is the other
 * case: it has no `record` override, so its lifecycle decision is its own row.
 */
async function manualFirstKickPayload(
  tx: Tx, rowId: number,
): Promise<Record<string, unknown>> {
  const updated = await readFirstKickGoalInTx(tx, rowId);
  if (!updated) throw new RollbackRefusal('failed', 'The record could not be read back.');
  const links = await manualLinkIdentity(tx, updated.playerId, updated.matchId);
  return firstKickRecordPayload(updated, links);
}

export async function reinstateFirstKickGoal(
  input: SpecialRecordEditBase,
): Promise<SpecialRecordMutationResult> {
  return runSpecialRecordEdit<FirstKickGoalAdminRow>({
    ...input,
    table: 'player_achievements',
    fieldGroup: 'first_kick_goal_reinstated',
    lock: lockFirstKickGoal,
    precheck: async ({ row }) => (row.status !== 'void'
      ? refuse('invalid_transition', 'That record is already active.') : null),
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE player_achievements
           SET status = 'active', status_reason = NULL, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'active', status_reason: null },
        overrideGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
        overridePayload: isManual(row.sourceKey)
          ? await manualFirstKickPayload(tx, row.id)
          : { status: 'active', status_reason: null },
      };
    },
  });
}

export type CreateFirstKickGoalInput = {
  playerId?: number | null;
  playerNameRaw?: string | null;
  playerNameClean?: string | null;
  clubNameRaw: string;
  season: number;
  roundRaw: string;
  seasonFootnoteRaw?: string | null;
  sourceAnnotation?: string | null;
  notes?: string | null;
  consecutiveGoalKicks?: number;
  noFurtherCareerGoals?: boolean;
  noFurtherCareerKicks?: boolean;
  kicklessMatchesBeforeFirstKick?: number;
  /** Selected by database id, never by name (Phase E §12). */
  matchId?: number | null;
  adminUserId: number;
};

type CreatedSpecialRecord = { rowId: number; entityKey: string; sourceRecordId: string };

async function insertFirstKickGoal(tx: Tx, input: CreateFirstKickGoalInput & {
  replacesKey?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<CreatedSpecialRecord> {
  let playerNameRaw = input.playerNameRaw?.trim() || '';
  if (input.playerId) {
    const [player] = await tx<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}
    `;
    if (!player) throw new RollbackRefusal('validation', 'The selected player does not exist.');
    if (!playerNameRaw) playerNameRaw = player.displayName;
  }
  if (!playerNameRaw) {
    throw new RollbackRefusal('validation',
      'Select a player, or enter the name as the source records it: an unlinked record still '
      + 'asserts a name.');
  }
  const playerNameClean = input.playerNameClean?.trim() || playerNameRaw;

  await validateSpecialRecordMatchLink(tx, input.matchId ?? null, input.season, input.playerId ?? null);
  const links = await manualLinkIdentity(tx, input.playerId ?? null, input.matchId ?? null);

  const sourceId = await manualSourceId(tx);
  const sourceRecordId = mintManualSourceRecordId(FAMILY_BY_TABLE.player_achievements);
  const entityKey = specialRecordEntityKey(MANUAL_SOURCE_KEY, sourceRecordId);
  await refuseClaimedKey(tx, 'player_achievements', entityKey);

  // Exactly the columns the replay's `record` INSERT sets, and no others: a
  // manual row this module writes must be the row a rebuild reconstructs.
  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO player_achievements (
      achievement_type, player_name_raw, player_name_clean, club_name_raw,
      season, round_raw, season_footnote_raw, source_annotation, notes,
      consecutive_goal_kicks, no_further_career_goals, no_further_career_kicks,
      kickless_matches_before_first_kick,
      status, status_reason, source_id, source_record_id,
      player_id, link_status_value, match_id
    ) VALUES (
      'first_kick_goal'::player_achievement_type, ${playerNameRaw}, ${playerNameClean},
      ${input.clubNameRaw.trim()},
      ${input.season}::smallint, ${input.roundRaw.trim()},
      ${input.seasonFootnoteRaw?.trim() || null}, ${input.sourceAnnotation?.trim() || null},
      ${input.notes?.trim() || null},
      ${input.consecutiveGoalKicks ?? 1}::smallint,
      ${input.noFurtherCareerGoals ?? false}, ${input.noFurtherCareerKicks ?? false},
      ${input.kicklessMatchesBeforeFirstKick ?? 0}::smallint,
      'active', NULL, ${sourceId}, ${sourceRecordId},
      ${input.playerId ?? null},
      ${input.playerId ? 'resolved' : 'unmatched'}::link_status,
      ${input.matchId ?? null}
    )
    RETURNING id::int AS id
  `;
  if (!inserted) throw new RollbackRefusal('failed', 'The first-kick-goal row was not written.');

  const created = await readFirstKickGoalInTx(tx, inserted.id);
  if (!created) throw new RollbackRefusal('failed', 'The new record could not be read back.');

  const payload = firstKickRecordPayload(created, links,
    input.replacesKey ? { replaces_key: input.replacesKey } : {});

  await refuseOverrideCollision(tx, {
    entityType: 'player_achievements', entityKey, fieldGroup: 'record',
  });
  await writeOverride(tx, {
    entityType: 'player_achievements',
    entityKey,
    fieldGroup: 'record',
    payload,
    adminUserId: input.adminUserId,
  });

  await recordDataEdit(tx, {
    tableName: 'player_achievements',
    rowId: inserted.id,
    fieldGroup: 'first_kick_goal_created',
    oldValues: {},
    newValues: {
      entity_key: entityKey,
      lineage_identity: specialRecordLineageIdentity(MANUAL_SOURCE_KEY, sourceRecordId),
      ...payload,
      ...(input.auditExtra ?? {}),
    },
    adminUserId: input.adminUserId,
    note: input.notes,
  });

  return { rowId: inserted.id, entityKey, sourceRecordId };
}

function validateFirstKickCreate(input: CreateFirstKickGoalInput): string | null {
  if (!input.clubNameRaw?.trim()) return 'The club name as the source records it is required.';
  if (!input.roundRaw?.trim()) return 'The round is required.';
  return validateFirstKickFields({
    season: input.season,
    consecutiveGoalKicks: input.consecutiveGoalKicks,
    kicklessMatchesBeforeFirstKick: input.kicklessMatchesBeforeFirstKick,
  });
}

export async function createFirstKickGoal(
  input: CreateFirstKickGoalInput,
): Promise<SpecialRecordMutationResult> {
  const invalid = validateFirstKickCreate(input);
  if (invalid) return refuse('validation', invalid);
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const created = await insertFirstKickGoal(tx as Tx, input);
        const row = await readFirstKickGoalInTx(tx as Tx, created.rowId);
        return {
          ok: true as const,
          table: 'player_achievements' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          revalidatePaths: row ? specialRecordPaths('first-kick-goal', row) : [],
        };
      }) as SpecialRecordMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

export type ReplaceFirstKickGoalInput = SpecialRecordEditBase & {
  reason: string;
  replacement: Omit<CreateFirstKickGoalInput, 'adminUserId'>;
};

/**
 * Suppress the wrong record and create the right one, as ONE transaction.
 *
 * Not an UPDATE of the identity on a single row: that would erase the fact that
 * the wrong assertion was ever made, and a wrong `source_record_id` is P10's
 * rekey problem, not this surface's. Not suppress-then-create either, because a
 * separate create that failed would leave the fact recorded nowhere. The two
 * audit rows share a `replacement_id` and the two durable payloads
 * cross-reference each other by NATURAL KEY, never by row id.
 */
export async function replaceFirstKickGoal(
  input: ReplaceFirstKickGoalInput,
): Promise<SpecialRecordMutationResult<SpecialRecordReplacementResult>> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for replacing this record.');
  const invalid = validateFirstKickCreate({ ...input.replacement, adminUserId: input.adminUserId });
  if (invalid) return refuse('validation', invalid);
  const replacementId = randomUUID();

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const locked = await lockFirstKickGoal(tx as Tx, input.rowId);
        if (locked === null) return refuse('not_found', 'That record no longer exists.');
        if (isRefusal(locked)) return locked;
        const row = locked;
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That record changed while this page was open. Reload it and try again.');
        }
        if (row.status !== 'active') {
          return refuse('invalid_transition',
            'That record is already suppressed, so there is nothing to replace.');
        }

        // Everything above refused before a write. From here, any refusal throws.
        await (tx as Tx)`
          UPDATE player_achievements
             SET status = 'void', status_reason = ${reason}, updated_at = now()
           WHERE id = ${row.id}
        `;

        const created = await insertFirstKickGoal(tx as Tx, {
          ...input.replacement,
          adminUserId: input.adminUserId,
          replacesKey: row.entityKey,
          auditExtra: { replacement_id: replacementId, replaces: row.entityKey },
        });

        // The suppressed payload is written LAST so it can name what replaced
        // it: the cross-reference only exists once both keys do.
        const suppressedPayload = isManual(row.sourceKey)
          ? {
            ...await manualFirstKickPayload(tx as Tx, row.id),
            replaced_by_key: created.entityKey,
          }
          : { status: 'void', status_reason: reason, replaced_by_key: created.entityKey };

        await refuseOverrideCollision(tx as Tx, {
          entityType: 'player_achievements',
          entityKey: row.entityKey,
          fieldGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
        });
        await writeOverride(tx as Tx, {
          entityType: 'player_achievements',
          entityKey: row.entityKey,
          fieldGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
          payload: suppressedPayload,
          adminUserId: input.adminUserId,
        });

        await recordDataEdit(tx as Tx, {
          tableName: 'player_achievements',
          rowId: row.id,
          fieldGroup: 'first_kick_goal_suppressed',
          oldValues: { status: row.status, status_reason: row.statusReason },
          newValues: {
            ...row.auditIdentity,
            status: 'void',
            status_reason: reason,
            replacement_id: replacementId,
            replaced_by_key: created.entityKey,
          },
          adminUserId: input.adminUserId,
          note: input.note,
        });

        return {
          ok: true as const,
          table: 'player_achievements' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          suppressedEntityKey: row.entityKey,
          suppressedRowId: row.id,
          replacementId,
          revalidatePaths: row.revalidatePaths,
        };
      }) as SpecialRecordMutationResult<SpecialRecordReplacementResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// =========================================================================
// after_siren_kicks -- the kick after the siren
// =========================================================================

async function readAfterSirenKickInTx(tx: Tx, id: number): Promise<AfterSirenAdminRow | null> {
  const rows = await tx.unsafe(
    `SELECT ${AFTER_SIREN_SELECT} ${AFTER_SIREN_FROM} WHERE k.id = $1`, [id] as never[],
  ) as unknown as AfterSirenAdminRow[];
  return rows[0] ?? null;
}

function lockAfterSirenKick(tx: Tx, rowId: number) {
  return lockSpecialRecord<AfterSirenAdminRow>(
    tx, 'after_siren_kicks', 'after-the-siren', rowId, readAfterSirenKickInTx,
    'After-the-siren record',
  );
}

/**
 * The WHOLE durable representation of a manual after-siren row, in exactly the
 * shape `replaySpecialRecordOverrides()` re-creates a row from.
 *
 * `club_id` and `opponent_club_id` are absent for the same reason
 * `firstKickRecordPayload` omits the club: the replay's `record` INSERT sets no
 * club column, so a payload naming one would describe a row a rebuild could not
 * reconstruct. Both clubs travel as the source spelling the public read already
 * falls back to.
 */
function afterSirenRecordPayload(
  row: AfterSirenAdminRow,
  links: { playerIdentity: string | null; matchKey: string | null },
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    player_name_raw: row.playerNameRaw,
    player_name_clean: row.playerNameClean,
    club_name_raw: row.clubNameRaw,
    opponent_name_raw: row.opponentNameRaw,
    competition: row.competition,
    premiership_season: row.premiershipSeason,
    season: row.season,
    round_raw: row.roundRaw,
    kick_scored: row.kickScored,
    kick_effect: row.kickEffect,
    kicker_result: row.kickerResult,
    kicker_score_raw: row.kickerScoreRaw,
    opponent_score_raw: row.opponentScoreRaw,
    kicker_points: row.kickerPoints,
    opponent_points: row.opponentPoints,
    siren: row.siren,
    supergoal_scoring: row.supergoalScoring,
    cited: row.cited,
    shot_detail: row.shotDetail,
    source_annotation: row.sourceAnnotation,
    notes: row.notes,
    status: row.status,
    status_reason: row.statusReason,
    player_identity: links.playerIdentity,
    match_key: links.matchKey,
    ...extra,
  };
}

async function manualAfterSirenPayload(
  tx: Tx, rowId: number,
): Promise<Record<string, unknown>> {
  const updated = await readAfterSirenKickInTx(tx, rowId);
  if (!updated) throw new RollbackRefusal('failed', 'The record could not be read back.');
  const links = await manualLinkIdentity(tx, updated.playerId, updated.matchId);
  return afterSirenRecordPayload(updated, links);
}

export type AfterSirenCorrection = Partial<{
  playerNameRaw: string;
  playerNameClean: string;
  clubNameRaw: string;
  opponentNameRaw: string;
  competition: string;
  premiershipSeason: boolean;
  season: number;
  roundRaw: string;
  kickScored: AfterSirenScore;
  kickEffect: AfterSirenEffect;
  kickerResult: AfterSirenResult;
  siren: AfterSirenSiren;
  kickerScoreRaw: string;
  opponentScoreRaw: string;
  kickerPoints: number;
  opponentPoints: number;
  supergoalScoring: boolean;
  cited: boolean;
  shotDetail: string | null;
  sourceAnnotation: string | null;
  notes: string | null;
}>;

function validateAfterSirenText(f: AfterSirenCorrection): string | null {
  const required: [keyof AfterSirenCorrection, string][] = [
    ['playerNameRaw', 'The player name as the source wrote it'],
    ['playerNameClean', 'The cleaned player name'],
    ['clubNameRaw', "The kicker's club name as the source wrote it"],
    ['opponentNameRaw', "The opponent's name as the source wrote it"],
    ['competition', 'The competition'],
    ['roundRaw', 'The round'],
    ['kickerScoreRaw', "The kicker's side's final score as the source wrote it"],
    ['opponentScoreRaw', "The opponent's final score as the source wrote it"],
  ];
  for (const [key, label] of required) {
    const value = f[key];
    if (value !== undefined && !String(value).trim()) return `${label} cannot be emptied.`;
  }
  if (f.season !== undefined && (!Number.isInteger(f.season) || f.season < 1897 || f.season > 2100)) {
    return 'Season must be a year from 1897 to 2100.';
  }
  return null;
}

export type CorrectAfterSirenKickInput = SpecialRecordEditBase & {
  fields: AfterSirenCorrection;
};

/**
 * Correct the amendable metadata of one after-the-siren record.
 *
 * THE FIVE COUPLED EVENT FIELDS ARE VALIDATED AS A COMBINATION, never
 * independently. `kick_scored`, `kick_effect`, `kicker_result`, `siren` and the
 * margin arithmetic over `kicker_points` / `opponent_points` are bound together
 * by migration 089's `_effect_ck` and `_regulation_ck`, and `premiership_season`
 * by `_match_ck` -- so the row as it WILL STAND is assembled first and checked
 * whole. The database still holds the same rules inside the same transaction;
 * what this buys is a sentence an administrator can act on instead of a
 * constraint name (§10.3).
 *
 * The match and both club links are untouched here, for the durability reason
 * the module header gives: no replay carries them, so a mutation that moved one
 * would create state a rebuild reverts.
 */
export async function correctAfterSirenKick(
  input: CorrectAfterSirenKickInput,
): Promise<SpecialRecordMutationResult> {
  const { allowed, forbidden } = partitionCorrection(
    input.fields as Record<string, unknown>, AFTER_SIREN_CORRECTABLE,
  );
  if (forbidden.length > 0) {
    return refuse('forbidden', uncorrectableFieldRefusal(forbidden, 'after-the-siren record'),
      forbidden);
  }
  if (allowed.length === 0) return refuse('validation', 'Nothing was changed.');
  const invalid = validateAfterSirenText(input.fields);
  if (invalid) return refuse('validation', invalid);

  return runSpecialRecordEdit<AfterSirenAdminRow>({
    ...input,
    table: 'after_siren_kicks',
    fieldGroup: 'after_siren_corrected',
    lock: lockAfterSirenKick,
    precheck: async ({ row }) => {
      if (row.status === 'void') {
        return refuse('invalid_transition',
          'That record is suppressed. Suppressed records are kept for the record and are not '
          + 'maintained; reinstate it first if the row should stand.');
      }
      // The coupled rules, over the row as it will stand once the delta lands.
      const k = row.row;
      const f = input.fields;
      const broken = validateAfterSirenEvent({
        kickScored: f.kickScored ?? k.kickScored,
        kickEffect: f.kickEffect ?? k.kickEffect,
        kickerResult: f.kickerResult ?? k.kickerResult,
        siren: f.siren ?? k.siren,
        kickerPoints: f.kickerPoints ?? k.kickerPoints,
        opponentPoints: f.opponentPoints ?? k.opponentPoints,
        premiershipSeason: f.premiershipSeason ?? k.premiershipSeason,
        hasMatch: k.matchId !== null,
      });
      return broken ? refuse('validation', broken) : null;
    },
    apply: async ({ tx, row }) => {
      const k = row.row;
      const before: Record<string, unknown> = {
        playerNameRaw: k.playerNameRaw,
        playerNameClean: k.playerNameClean,
        clubNameRaw: k.clubNameRaw,
        opponentNameRaw: k.opponentNameRaw,
        competition: k.competition,
        premiershipSeason: k.premiershipSeason,
        season: k.season,
        roundRaw: k.roundRaw,
        kickScored: k.kickScored,
        kickEffect: k.kickEffect,
        kickerResult: k.kickerResult,
        kickerScoreRaw: k.kickerScoreRaw,
        opponentScoreRaw: k.opponentScoreRaw,
        kickerPoints: k.kickerPoints,
        opponentPoints: k.opponentPoints,
        siren: k.siren,
        supergoalScoring: k.supergoalScoring,
        cited: k.cited,
        shotDetail: k.shotDetail,
        sourceAnnotation: k.sourceAnnotation,
        notes: k.notes,
      };
      const fields = input.fields as Record<string, unknown>;
      const changed = allowed.map((key) => ({ key, value: fields[key] ?? null }));

      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const { key, value } of changed) {
        oldValues[AFTER_SIREN_CORRECTABLE[key].column] = before[key];
        newValues[AFTER_SIREN_CORRECTABLE[key].column] = value;
      }

      await applyCorrectionUpdate(tx, 'after_siren_kicks', k.id, AFTER_SIREN_CORRECTABLE, changed);

      if (!isManual(k.sourceKey)) {
        return {
          oldValues,
          newValues,
          overrideGroup: 'correction',
          overridePayload: correctionDelta(AFTER_SIREN_CORRECTABLE, changed),
        };
      }
      return {
        oldValues,
        newValues,
        overrideGroup: 'record',
        overridePayload: await manualAfterSirenPayload(tx, k.id),
      };
    },
  });
}

export async function suppressAfterSirenKick(
  input: SuppressSpecialRecordInput,
): Promise<SpecialRecordMutationResult> {
  const reason = input.reason.trim();
  if (!reason) {
    return refuse('validation', 'Give a reason for suppressing this after-the-siren record.');
  }
  return runSpecialRecordEdit<AfterSirenAdminRow>({
    ...input,
    table: 'after_siren_kicks',
    fieldGroup: 'after_siren_suppressed',
    lock: lockAfterSirenKick,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That record is already suppressed.') : null),
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE after_siren_kicks
           SET status = 'void', status_reason = ${reason}, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'void', status_reason: reason },
        overrideGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
        overridePayload: isManual(row.sourceKey)
          ? await manualAfterSirenPayload(tx, row.id)
          : { status: 'void', status_reason: reason },
      };
    },
  });
}

export async function reinstateAfterSirenKick(
  input: SpecialRecordEditBase,
): Promise<SpecialRecordMutationResult> {
  return runSpecialRecordEdit<AfterSirenAdminRow>({
    ...input,
    table: 'after_siren_kicks',
    fieldGroup: 'after_siren_reinstated',
    lock: lockAfterSirenKick,
    precheck: async ({ row }) => (row.status !== 'void'
      ? refuse('invalid_transition', 'That record is already active.') : null),
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE after_siren_kicks
           SET status = 'active', status_reason = NULL, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'active', status_reason: null },
        overrideGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
        overridePayload: isManual(row.sourceKey)
          ? await manualAfterSirenPayload(tx, row.id)
          : { status: 'active', status_reason: null },
      };
    },
  });
}

export type CreateAfterSirenKickInput = {
  playerId?: number | null;
  playerNameRaw?: string | null;
  playerNameClean?: string | null;
  clubNameRaw: string;
  opponentNameRaw: string;
  competition: string;
  premiershipSeason: boolean;
  season: number;
  roundRaw: string;
  kickScored: AfterSirenScore;
  kickEffect: AfterSirenEffect;
  kickerResult: AfterSirenResult;
  siren?: AfterSirenSiren;
  kickerScoreRaw: string;
  opponentScoreRaw: string;
  kickerPoints: number;
  opponentPoints: number;
  supergoalScoring?: boolean;
  cited?: boolean;
  shotDetail?: string | null;
  sourceAnnotation?: string | null;
  notes?: string | null;
  /** Selected by database id, never by name (Phase E §12). */
  matchId?: number | null;
  adminUserId: number;
};

function validateAfterSirenCreate(input: CreateAfterSirenKickInput): string | null {
  const text = validateAfterSirenText({
    clubNameRaw: input.clubNameRaw,
    opponentNameRaw: input.opponentNameRaw,
    competition: input.competition,
    roundRaw: input.roundRaw,
    kickerScoreRaw: input.kickerScoreRaw,
    opponentScoreRaw: input.opponentScoreRaw,
    season: input.season,
  });
  if (text) return text;
  return validateAfterSirenEvent({
    kickScored: input.kickScored,
    kickEffect: input.kickEffect,
    kickerResult: input.kickerResult,
    siren: input.siren ?? 'final',
    kickerPoints: input.kickerPoints,
    opponentPoints: input.opponentPoints,
    premiershipSeason: input.premiershipSeason,
    hasMatch: (input.matchId ?? null) !== null,
  });
}

async function insertAfterSirenKick(tx: Tx, input: CreateAfterSirenKickInput & {
  replacesKey?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<CreatedSpecialRecord> {
  let playerNameRaw = input.playerNameRaw?.trim() || '';
  if (input.playerId) {
    const [player] = await tx<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}
    `;
    if (!player) throw new RollbackRefusal('validation', 'The selected player does not exist.');
    if (!playerNameRaw) playerNameRaw = player.displayName;
  }
  if (!playerNameRaw) {
    throw new RollbackRefusal('validation',
      'Select a player, or enter the name as the source records it: an unlinked record still '
      + 'asserts a name.');
  }
  const playerNameClean = input.playerNameClean?.trim() || playerNameRaw;

  await validateSpecialRecordMatchLink(tx, input.matchId ?? null, input.season, input.playerId ?? null);
  const links = await manualLinkIdentity(tx, input.playerId ?? null, input.matchId ?? null);

  const sourceId = await manualSourceId(tx);
  const sourceRecordId = mintManualSourceRecordId(FAMILY_BY_TABLE.after_siren_kicks);
  const entityKey = specialRecordEntityKey(MANUAL_SOURCE_KEY, sourceRecordId);
  await refuseClaimedKey(tx, 'after_siren_kicks', entityKey);

  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO after_siren_kicks (
      player_name_raw, player_name_clean, club_name_raw, opponent_name_raw,
      competition, premiership_season, season, round_raw,
      kick_scored, kick_effect, kicker_result, kicker_score_raw, opponent_score_raw,
      kicker_points, opponent_points, siren, supergoal_scoring, cited,
      shot_detail, source_annotation, notes,
      status, status_reason, source_id, source_record_id,
      player_id, link_status_value, match_id
    ) VALUES (
      ${playerNameRaw}, ${playerNameClean}, ${input.clubNameRaw.trim()},
      ${input.opponentNameRaw.trim()},
      ${input.competition.trim()}, ${input.premiershipSeason}, ${input.season}::smallint,
      ${input.roundRaw.trim()},
      ${input.kickScored}::after_siren_score, ${input.kickEffect}::after_siren_effect,
      ${input.kickerResult}::after_siren_result,
      ${input.kickerScoreRaw.trim()}, ${input.opponentScoreRaw.trim()},
      ${input.kickerPoints}::smallint, ${input.opponentPoints}::smallint,
      ${input.siren ?? 'final'}::after_siren_siren,
      ${input.supergoalScoring ?? false}, ${input.cited ?? true},
      ${input.shotDetail?.trim() || null}, ${input.sourceAnnotation?.trim() || null},
      ${input.notes?.trim() || null},
      'active', NULL, ${sourceId}, ${sourceRecordId},
      ${input.playerId ?? null},
      ${input.playerId ? 'resolved' : 'unmatched'}::link_status,
      ${input.matchId ?? null}
    )
    RETURNING id::int AS id
  `;
  if (!inserted) throw new RollbackRefusal('failed', 'The after-the-siren row was not written.');

  const created = await readAfterSirenKickInTx(tx, inserted.id);
  if (!created) throw new RollbackRefusal('failed', 'The new record could not be read back.');

  const payload = afterSirenRecordPayload(created, links,
    input.replacesKey ? { replaces_key: input.replacesKey } : {});

  await refuseOverrideCollision(tx, {
    entityType: 'after_siren_kicks', entityKey, fieldGroup: 'record',
  });
  await writeOverride(tx, {
    entityType: 'after_siren_kicks',
    entityKey,
    fieldGroup: 'record',
    payload,
    adminUserId: input.adminUserId,
  });

  await recordDataEdit(tx, {
    tableName: 'after_siren_kicks',
    rowId: inserted.id,
    fieldGroup: 'after_siren_created',
    oldValues: {},
    newValues: {
      entity_key: entityKey,
      lineage_identity: specialRecordLineageIdentity(MANUAL_SOURCE_KEY, sourceRecordId),
      ...payload,
      ...(input.auditExtra ?? {}),
    },
    adminUserId: input.adminUserId,
    note: input.notes,
  });

  return { rowId: inserted.id, entityKey, sourceRecordId };
}

export async function createAfterSirenKick(
  input: CreateAfterSirenKickInput,
): Promise<SpecialRecordMutationResult> {
  const invalid = validateAfterSirenCreate(input);
  if (invalid) return refuse('validation', invalid);
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const created = await insertAfterSirenKick(tx as Tx, input);
        const row = await readAfterSirenKickInTx(tx as Tx, created.rowId);
        return {
          ok: true as const,
          table: 'after_siren_kicks' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          revalidatePaths: row ? specialRecordPaths('after-the-siren', row) : [],
        };
      }) as SpecialRecordMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

export type ReplaceAfterSirenKickInput = SpecialRecordEditBase & {
  reason: string;
  replacement: Omit<CreateAfterSirenKickInput, 'adminUserId'>;
};

export async function replaceAfterSirenKick(
  input: ReplaceAfterSirenKickInput,
): Promise<SpecialRecordMutationResult<SpecialRecordReplacementResult>> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for replacing this record.');
  const invalid = validateAfterSirenCreate({ ...input.replacement, adminUserId: input.adminUserId });
  if (invalid) return refuse('validation', invalid);
  const replacementId = randomUUID();

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const locked = await lockAfterSirenKick(tx as Tx, input.rowId);
        if (locked === null) return refuse('not_found', 'That record no longer exists.');
        if (isRefusal(locked)) return locked;
        const row = locked;
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That record changed while this page was open. Reload it and try again.');
        }
        if (row.status !== 'active') {
          return refuse('invalid_transition',
            'That record is already suppressed, so there is nothing to replace.');
        }

        // Everything above refused before a write. From here, any refusal throws.
        await (tx as Tx)`
          UPDATE after_siren_kicks
             SET status = 'void', status_reason = ${reason}, updated_at = now()
           WHERE id = ${row.id}
        `;

        const created = await insertAfterSirenKick(tx as Tx, {
          ...input.replacement,
          adminUserId: input.adminUserId,
          replacesKey: row.entityKey,
          auditExtra: { replacement_id: replacementId, replaces: row.entityKey },
        });

        const suppressedPayload = isManual(row.sourceKey)
          ? {
            ...await manualAfterSirenPayload(tx as Tx, row.id),
            replaced_by_key: created.entityKey,
          }
          : { status: 'void', status_reason: reason, replaced_by_key: created.entityKey };

        await refuseOverrideCollision(tx as Tx, {
          entityType: 'after_siren_kicks',
          entityKey: row.entityKey,
          fieldGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
        });
        await writeOverride(tx as Tx, {
          entityType: 'after_siren_kicks',
          entityKey: row.entityKey,
          fieldGroup: isManual(row.sourceKey) ? 'record' : 'lifecycle',
          payload: suppressedPayload,
          adminUserId: input.adminUserId,
        });

        await recordDataEdit(tx as Tx, {
          tableName: 'after_siren_kicks',
          rowId: row.id,
          fieldGroup: 'after_siren_suppressed',
          oldValues: { status: row.status, status_reason: row.statusReason },
          newValues: {
            ...row.auditIdentity,
            status: 'void',
            status_reason: reason,
            replacement_id: replacementId,
            replaced_by_key: created.entityKey,
          },
          adminUserId: input.adminUserId,
          note: input.note,
        });

        return {
          ok: true as const,
          table: 'after_siren_kicks' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          suppressedEntityKey: row.entityKey,
          suppressedRowId: row.id,
          replacementId,
          revalidatePaths: row.revalidatePaths,
        };
      }) as SpecialRecordMutationResult<SpecialRecordReplacementResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}
