import 'server-only';

import { randomUUID } from 'node:crypto';

import postgres from 'postgres';

import { sql } from '@/db/client';
import { recordDataEdit } from '@/db/queries/audit-log';
import { MANUAL_SOURCE_KEY, resolvePlayerIdentity } from '@/db/queries/player-identity';
import {
  awardPath, awardSeasonPath, clubPath, honourTeamPath, playerPath,
} from '@/lib/format';
import { honourTeamSlug } from '@/lib/slugs';

/**
 * Awards & honours administration — the correction / void / replacement
 * lifecycle for `award_winners`, `hall_of_fame` and `honour_team_members`
 * (AFLDB-ISSUE-165, AFLDB-ISSUE-156 P5).
 *
 * WHY A DEDICATED MODULE RATHER THAN `EDITABLE_ENTITIES`/`saveEdit()`.
 * The generic editor (`src/lib/edit/spec.ts`) has no concept of
 * "identity-bearing fields are void + replace only", and none of "this table
 * has an active importer that must be told to re-apply the correction". Every
 * domain in this umbrella that needed lifecycle semantics — coaches, season
 * lists, fixtures, club leadership — built its own query module for exactly
 * that reason, and this follows them.
 *
 * THE THREE INVARIANTS EVERY MUTATION HERE HOLDS.
 *
 *   1. IDENTITY IS NEVER CORRECTED IN PLACE. Which award, which season, which
 *      person, which team, which induction year — each of them changes WHAT
 *      the row asserts, and an assertion that quietly became a different one
 *      leaves no record that the first was ever made. A wrong one is a void
 *      plus a new row: two honest records instead of one silent rewrite (R-1).
 *
 *   2. EVERY DECISION IS DURABLE. All three tables carry
 *      `player_id REFERENCES players(id)`, so a full rebuild's
 *      `TRUNCATE ... CASCADE` on `players` empties them; and all three are
 *      reloaded by `tools/migration/import_awards.py`, whose `reload_keyed()`
 *      UPDATE re-asserts every column in its own list from the freshly parsed
 *      source. A canonical-row-only edit therefore survives neither. So every
 *      mutation writes a `data_overrides` row in the same transaction, which
 *      `replay_admin_overrides()` re-applies after each group's reload
 *      (migration 101's header states the whole argument).
 *
 *   3. THE DURABLE RECORD IS NAMED BY NATURAL IDENTITY, NEVER BY `id`. A
 *      rebuild and a promotion both renumber these tables —
 *      `tools/db/promotion-inventory.ts` has said so about these exact three
 *      tables since AFLDB-ISSUE-151. `entity_key` is
 *      `<sources.key>:<natural key>` and a payload never carries a row id, a
 *      club id or a player id.
 *
 * CONCURRENCY. Every mutation takes `SELECT ... FOR UPDATE` on its canonical
 * row and then compares `updated_at` against the value the caller last saw.
 * A stale value refuses before anything is written. `honour_team_members`
 * additionally takes the AFLDB-ISSUE-080 §5.3 transaction-scoped advisory lock
 * that `createHonourTeamMember()` and `import_awards.py` already contend on,
 * because migration 059's partial indexes leave the mixed linked/unlinked
 * same-name collisions with no database backstop.
 *
 * AUDIT. Every successful mutation writes `data_edits` in the same
 * transaction (the AFLDB-ISSUE-027 contract): a failure rolls the canonical
 * write, the override and the audit row back together.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO.
 *   * no Brownlow. `award_winners` is not where Brownlow results live, and the
 *     refusal `createAwardWinner()` already carries is repeated here;
 *   * no player LINKING. `player_id` / `link_status_value` stay governed by
 *     /admin/player-links. A void merely removes the row from those queues
 *     (D-10);
 *   * no `awards` catalogue editing. This administers WINNERS, not the award
 *     definitions — except for `awards.first_season` / `last_season`, which
 *     are DERIVED from the winners and are therefore recomputed here from
 *     ACTIVE rows alone whenever a void, reinstatement or replacement can have
 *     moved the span (D-11);
 *   * no `hall_of_fame.removed_year` lifecycle. That column records that a
 *     real inductee was later formally removed from the Hall of Fame — a true
 *     historical fact about a completely valid row. It is ordinary correctable
 *     metadata here, and never `status`.
 */

type Tx = postgres.TransactionSql;

// --- vocabulary ----------------------------------------------------------

export const HONOUR_TABLES = [
  'award_winners', 'hall_of_fame', 'honour_team_members',
] as const;
export type HonourTable = (typeof HONOUR_TABLES)[number];

/**
 * Migration 101's lifecycle. TWO states, not three: an award result, an
 * induction or a team selection does not CEASE the way a club_leadership
 * appointment does, so there is no `ended`. Frozen here, in
 * `tools/migration/common.py` (`HONOUR_LIFECYCLE_STATUSES`) and in the three
 * CHECK constraints; `tests/data-overrides-source-contract.test.ts` pins the
 * three together so they cannot drift.
 */
export const HONOUR_STATUSES = ['active', 'void'] as const;
export type HonourStatus = (typeof HONOUR_STATUSES)[number];

/** Migration 101's three `data_overrides.field_group` values (§6.2, D-9). */
export const HONOUR_FIELD_GROUPS = ['lifecycle', 'correction', 'record'] as const;
export type HonourFieldGroup = (typeof HONOUR_FIELD_GROUPS)[number];

export const BROWNLOW_AWARD_SLUG = 'brownlow-medal';

const HALL_OF_FAME_CATEGORIES = new Set([
  'Player', 'Coach', 'Umpire', 'Media', 'Administrator', 'Pioneer',
]);

/**
 * The frozen cross-language identity of the `honour_team_members` advisory
 * lock. Byte-identical to `HONOUR_TEAM_LOCK_NAMESPACE`/`_KEY` in
 * `src/db/queries/awards-admin.ts` and in `tools/migration/import_awards.py`;
 * never derived by hashing a string, because the three implementations must
 * contend on identical literals (AFLDB-ISSUE-080 §5.3).
 */
const HONOUR_TEAM_LOCK_NAMESPACE = 717275; // 0xAF1DB
const HONOUR_TEAM_LOCK_KEY = 1;

export function isHonourStatus(value: unknown): value is HonourStatus {
  return typeof value === 'string' && (HONOUR_STATUSES as readonly string[]).includes(value);
}

// --- durable keys (§6.2) -------------------------------------------------

/**
 * A `|` inside an identity-bearing string would make the durable key
 * ambiguous, because that character is what separates its halves. No real
 * inductee name and no real honour-team name contains one; a proposed one that
 * does is refused rather than silently mangled.
 */
export function carriesKeySeparator(value: string): boolean {
  return value.includes('|');
}

/** `<sources.key>:<source_record_id>` — migration 042's identity for a winner. */
export function awardWinnerEntityKey(sourceKey: string, sourceRecordId: string): string {
  return `${sourceKey}:${sourceRecordId}`;
}

/**
 * `<sources.key>:<name>|<inducted_year>`. `hall_of_fame` has no
 * `source_record_id` column at all, so migration 042's natural key carries the
 * identity. An absent induction year is the empty half — 45 of the 343
 * inductees genuinely have none, and NULLS NOT DISTINCT keeps them inside the
 * key rather than exempt from it.
 */
export function hallOfFameEntityKey(
  sourceKey: string, name: string, inductedYear: number | null,
): string {
  return `${sourceKey}:${name}|${inductedYear ?? ''}`;
}

/**
 * `<sources.key>:<team_name>|<player identity>`, where the player identity is
 * the AFL Tables / manual identity string for a LINKED row and
 * `name:<player_name_raw>` for an unlinked one — the same two-axis identity
 * migration 059 gave the table.
 */
export function honourTeamEntityKey(
  sourceKey: string, teamName: string, playerIdentity: string,
): string {
  return `${sourceKey}:${teamName}|${playerIdentity}`;
}

/** The player half of an honour-team key: a durable identity, or the raw name. */
export function honourTeamPlayerIdentity(
  identity: string | null, playerNameRaw: string,
): string {
  return identity ?? `name:${playerNameRaw}`;
}

/**
 * The identity strings `tools/db/promotion-inventory.ts` resolves a
 * `data_edits.row_id` through at a lineage remap. They are the same natural
 * keys as above with `|` throughout, because a remap identity is compared
 * across two databases and never parsed back into halves; the SQL that
 * computes each one lives in `LINEAGE_IDENTITY_SQL` and
 * `tests/db-promotion-check.test.ts` pins the two representations together.
 */
export function awardWinnerLineageIdentity(
  sourceKey: string, sourceRecordId: string,
): string {
  return `${sourceKey}|${sourceRecordId}`;
}
export function hallOfFameLineageIdentity(name: string, inductedYear: number | null): string {
  return `${name}|${inductedYear ?? ''}`;
}
export function honourTeamLineageIdentity(teamName: string, playerIdentity: string): string {
  return `${teamName}|${playerIdentity}`;
}

// --- results (§14 shape, the AFLDB-ISSUE-163 precedent) ------------------

export type HonourRefusalReason =
  | 'validation'
  | 'not_found'
  | 'stale'
  | 'no_durable_key'
  | 'invalid_transition'
  | 'duplicate'
  | 'ambiguous_identity'
  | 'conflict'
  | 'forbidden'
  | 'failed';

export type HonourRefusal = {
  ok: false;
  error: string;
  reason: HonourRefusalReason;
  /** What the refusal is ABOUT, so a caller need not parse the sentence. */
  subjects?: string[];
};

export type HonourMutationEnvelope = {
  table: HonourTable;
  rowId: number;
  /** The durable `data_overrides.entity_key` this mutation recorded against. */
  entityKey: string;
  /**
   * The public paths a successful mutation invalidates, computed SERVER-SIDE
   * from the row's own ids. Never client-supplied, and never revalidated from
   * here: `revalidatePath()` inside a Server Action hangs the Next 15.5 client
   * (AFLDB-ISSUE-156 §7 R-7), so the caller POSTs these to the allowlisted
   * revalidate route after the action resolves.
   */
  revalidatePaths: string[];
};

export type HonourMutationResult<T = HonourMutationEnvelope> =
  ({ ok: true } & T) | HonourRefusal;

function refuse(
  reason: HonourRefusalReason, error: string, subjects?: string[],
): HonourRefusal {
  return subjects?.length ? { ok: false, error, reason, subjects } : { ok: false, error, reason };
}

/**
 * A refusal discovered AFTER this transaction has already written something.
 *
 * `postgres.js` commits when the `begin()` callback RESOLVES and rolls back
 * only when it REJECTS, so returning a refusal past the first write would
 * commit a half-done mutation while reporting failure — an unaudited canonical
 * write. Throwing rolls the transaction back and the caller's `catch` turns it
 * back into exactly the refusal it would otherwise have returned. The
 * AFLDB-ISSUE-160 pattern, used here for EVERY post-write refusal.
 */
class RollbackRefusal extends Error {
  constructor(
    readonly reason: HonourRefusalReason,
    readonly detail: string,
    readonly subjects: string[] = [],
  ) {
    super(detail);
    this.name = 'RollbackRefusal';
  }
}

function rolledBackRefusal(error: unknown): HonourRefusal | null {
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

// --- the canonical rows --------------------------------------------------

export type AwardWinnerRow = {
  id: number;
  awardId: number;
  awardSlug: string;
  awardName: string;
  season: number | null;
  playerId: number | null;
  playerSlug: string | null;
  playerNameRaw: string;
  linkStatus: string;
  candidateCount: number;
  clubId: number | null;
  clubSlug: string | null;
  clubNameRaw: string | null;
  /** `numeric(8,2)`, carried as text: nothing here arithmetics it. */
  votes: string | null;
  position: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  note: string | null;
  sortOrder: number | null;
  sourceId: number | null;
  sourceKey: string | null;
  sourceRecordId: string | null;
  status: HonourStatus;
  statusReason: string | null;
  updatedAt: string;
};

export type HallOfFameRow = {
  id: number;
  name: string;
  playerId: number | null;
  playerSlug: string | null;
  linkStatus: string;
  category: string | null;
  inductedYear: number | null;
  isLegend: boolean;
  legendYear: number | null;
  clubNameRaw: string | null;
  state: string | null;
  playingCareer: string | null;
  /** A historical fact about the Hall of Fame. NEVER lifecycle state (§5.2). */
  removedYear: number | null;
  notes: string | null;
  sourceId: number | null;
  sourceKey: string | null;
  status: HonourStatus;
  statusReason: string | null;
  updatedAt: string;
};

export type HonourTeamMemberRow = {
  id: number;
  teamName: string;
  playerId: number | null;
  playerSlug: string | null;
  playerNameRaw: string;
  linkStatus: string;
  position: string | null;
  role: string | null;
  clubNameRaw: string | null;
  sortOrder: number;
  note: string | null;
  sourceId: number | null;
  sourceKey: string | null;
  status: HonourStatus;
  statusReason: string | null;
  updatedAt: string;
};

const AWARD_WINNER_COLUMNS = `
  w.id::int AS id, w.award_id AS "awardId", a.slug AS "awardSlug", a.name AS "awardName",
  w.season::int AS season, w.player_id AS "playerId", p.slug AS "playerSlug",
  w.player_name_raw AS "playerNameRaw", w.link_status_value::text AS "linkStatus",
  w.candidate_count::int AS "candidateCount",
  w.club_id AS "clubId", c.slug AS "clubSlug", w.club_name_raw AS "clubNameRaw",
  w.votes::text AS votes, w.position AS position,
  w.is_captain AS "isCaptain", w.is_vice_captain AS "isViceCaptain",
  w.note AS note, w.sort_order::int AS "sortOrder",
  w.source_id::int AS "sourceId", s.key AS "sourceKey",
  w.source_record_id AS "sourceRecordId",
  w.status AS status, w.status_reason AS "statusReason", w.updated_at::text AS "updatedAt"
  FROM award_winners w
  JOIN awards a ON a.id = w.award_id
  LEFT JOIN players p ON p.id = w.player_id
  LEFT JOIN clubs c ON c.id = w.club_id
  LEFT JOIN sources s ON s.id = w.source_id`;

const HALL_OF_FAME_COLUMNS = `
  h.id::int AS id, h.name AS name, h.player_id AS "playerId", p.slug AS "playerSlug",
  h.link_status_value::text AS "linkStatus", h.category AS category,
  h.inducted_year::int AS "inductedYear", h.is_legend AS "isLegend",
  h.legend_year::int AS "legendYear", h.club_name_raw AS "clubNameRaw",
  h.state AS state, h.playing_career AS "playingCareer",
  h.removed_year::int AS "removedYear", h.notes AS notes,
  h.source_id::int AS "sourceId", s.key AS "sourceKey",
  h.status AS status, h.status_reason AS "statusReason", h.updated_at::text AS "updatedAt"
  FROM hall_of_fame h
  LEFT JOIN players p ON p.id = h.player_id
  LEFT JOIN sources s ON s.id = h.source_id`;

const HONOUR_TEAM_COLUMNS = `
  m.id::int AS id, m.team_name AS "teamName", m.player_id AS "playerId", p.slug AS "playerSlug",
  m.player_name_raw AS "playerNameRaw", m.link_status_value::text AS "linkStatus",
  m.position AS position, m.role AS role, m.club_name_raw AS "clubNameRaw",
  m.sort_order::int AS "sortOrder", m.note AS note,
  m.source_id::int AS "sourceId", s.key AS "sourceKey",
  m.status AS status, m.status_reason AS "statusReason", m.updated_at::text AS "updatedAt"
  FROM honour_team_members m
  LEFT JOIN players p ON p.id = m.player_id
  LEFT JOIN sources s ON s.id = m.source_id`;

// --- admin reads ---------------------------------------------------------

export type HonourListFilter = {
  /** Defaults to active-only; an admin reviewing "what did we void" opts in. */
  includeVoided?: boolean;
  search?: string | null;
  limit?: number;
  offset?: number;
};

function listBounds(filter: HonourListFilter): { limit: number; offset: number } {
  const limit = Math.min(Math.max(Number(filter.limit ?? 100), 1), 500);
  const offset = Math.max(Number(filter.offset ?? 0), 0);
  return { limit, offset };
}

export async function listAwardWinners(
  filter: HonourListFilter & { awardSlug?: string | null; season?: number | null } = {},
): Promise<AwardWinnerRow[]> {
  const { limit, offset } = listBounds(filter);
  const search = (filter.search ?? '').trim() || null;
  return await sql.unsafe(
    `SELECT ${AWARD_WINNER_COLUMNS}
      WHERE ($1::boolean OR w.status <> 'void')
        AND ($2::text IS NULL OR a.slug = $2::text)
        AND ($3::int IS NULL OR w.season = $3::int)
        AND ($4::text IS NULL OR w.player_name_raw ILIKE '%' || $4::text || '%')
      ORDER BY a.slug, w.season DESC NULLS LAST, w.sort_order NULLS LAST, w.id
      LIMIT $5 OFFSET $6`,
    [
      filter.includeVoided ?? false, filter.awardSlug ?? null, filter.season ?? null,
      search, limit, offset,
    ],
  ) as unknown as AwardWinnerRow[];
}

export async function readAwardWinner(id: number): Promise<AwardWinnerRow | null> {
  const rows = await sql.unsafe(
    `SELECT ${AWARD_WINNER_COLUMNS} WHERE w.id = $1`, [id],
  ) as unknown as AwardWinnerRow[];
  return rows[0] ?? null;
}

export async function listHallOfFame(
  filter: HonourListFilter & { inductedYear?: number | null } = {},
): Promise<HallOfFameRow[]> {
  const { limit, offset } = listBounds(filter);
  const search = (filter.search ?? '').trim() || null;
  return await sql.unsafe(
    `SELECT ${HALL_OF_FAME_COLUMNS}
      WHERE ($1::boolean OR h.status <> 'void')
        AND ($2::int IS NULL OR h.inducted_year = $2::int)
        AND ($3::text IS NULL OR h.name ILIKE '%' || $3::text || '%')
      ORDER BY h.inducted_year DESC NULLS LAST, h.name, h.id
      LIMIT $4 OFFSET $5`,
    [filter.includeVoided ?? false, filter.inductedYear ?? null, search, limit, offset],
  ) as unknown as HallOfFameRow[];
}

export async function readHallOfFameInductee(id: number): Promise<HallOfFameRow | null> {
  const rows = await sql.unsafe(
    `SELECT ${HALL_OF_FAME_COLUMNS} WHERE h.id = $1`, [id],
  ) as unknown as HallOfFameRow[];
  return rows[0] ?? null;
}

export async function listHonourTeamMembers(
  filter: HonourListFilter & { teamName?: string | null } = {},
): Promise<HonourTeamMemberRow[]> {
  const { limit, offset } = listBounds(filter);
  const search = (filter.search ?? '').trim() || null;
  return await sql.unsafe(
    `SELECT ${HONOUR_TEAM_COLUMNS}
      WHERE ($1::boolean OR m.status <> 'void')
        AND ($2::text IS NULL OR m.team_name = $2::text)
        AND ($3::text IS NULL OR m.player_name_raw ILIKE '%' || $3::text || '%')
      ORDER BY m.team_name, m.sort_order, m.id
      LIMIT $4 OFFSET $5`,
    [filter.includeVoided ?? false, filter.teamName ?? null, search, limit, offset],
  ) as unknown as HonourTeamMemberRow[];
}

export async function readHonourTeamMember(id: number): Promise<HonourTeamMemberRow | null> {
  const rows = await sql.unsafe(
    `SELECT ${HONOUR_TEAM_COLUMNS} WHERE m.id = $1`, [id],
  ) as unknown as HonourTeamMemberRow[];
  return rows[0] ?? null;
}

export type HonourOverrideRow = {
  entityType: HonourTable;
  entityKey: string;
  fieldGroup: HonourFieldGroup;
  overrideValues: Record<string, unknown>;
  isActive: boolean;
  updatedAt: string;
};

/** The durable records themselves, for the admin history panel and the tests. */
export async function readHonourOverrides(
  entityType: HonourTable, entityKey?: string,
): Promise<HonourOverrideRow[]> {
  return sql<HonourOverrideRow[]>`
    SELECT entity_type AS "entityType", entity_key AS "entityKey",
           field_group AS "fieldGroup", override_values AS "overrideValues",
           is_active AS "isActive", updated_at::text AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = ${entityType}
       AND (${entityKey ?? null}::text IS NULL OR entity_key = ${entityKey ?? null}::text)
     ORDER BY entity_key, field_group
  `;
}

// --- the durable record --------------------------------------------------

/**
 * Write (or rewrite) one durable record.
 *
 * `is_active` is ALWAYS true, for all three field groups. The lifecycle lives
 * in the payload's `status`, because a VOIDED row must be RE-CREATED by the
 * replay and then voided again, never suppressed by it: suppressing it would
 * delete the row whose `data_edits` rows must stay resolvable at the next
 * promotion lineage remap. This is the AFLDB-ISSUE-162/163 shape, not
 * AFLDB-ISSUE-161's tombstone — there is no DELETE here to tombstone.
 */
async function writeOverride(tx: Tx, input: {
  entityType: HonourTable;
  entityKey: string;
  fieldGroup: HonourFieldGroup;
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
 * Refuse a NEW durable record whose key is already claimed.
 *
 * The key shapes fixed by D-8..D-12 are natural, not minted, so two rows of
 * one source that share a natural key share a durable key too — and the second
 * write would silently overwrite the first row's decision. Migration 101 made
 * the identity indexes active-row-only precisely so a replacement can re-use a
 * VOIDED row's identity, and that is exactly the case this refuses when both
 * rows belong to the same source.
 *
 * The ordinary replacement — a source-owned row voided and re-entered as a
 * `manual_admin_edit` one — is UNAFFECTED: the two keys differ in their source
 * half, so both durable records stand side by side.
 */
async function refuseClaimedKey(
  tx: Tx, entityType: HonourTable, entityKey: string,
): Promise<void> {
  const [claimed] = await tx<{ fieldGroup: string }[]>`
    SELECT field_group AS "fieldGroup" FROM data_overrides
     WHERE entity_type = ${entityType} AND entity_key = ${entityKey}
       AND field_group IN ('record', 'lifecycle')
     ORDER BY field_group LIMIT 1
  `;
  if (claimed) {
    throw new RollbackRefusal('conflict',
      `A durable ${claimed.fieldGroup} record already exists for ${entityKey}. `
      + 'That identity is already spoken for — most often by a row of the same source '
      + 'that was voided earlier — and two records cannot share one durable key. '
      + 'Reinstate the existing row, or record the replacement under a different identity.');
  }
}

// --- awards.first_season / last_season (D-11) ----------------------------

/**
 * Recompute an award's presented season span from ACTIVE winners alone.
 *
 * Called inside the SAME transaction as every void, reinstatement, replacement
 * and creation that can move it. A voided row is one that should never have
 * existed, so letting it set the first or last season an award is presented
 * over would publish the very error the void retracts. `import_awards.py`'s
 * own span update carries the identical predicate, so the importer and the
 * administrator can never disagree.
 *
 * An award whose last active winner is voided ends with NULL on both halves —
 * honest ("no winner is recorded") rather than a stale span kept for tidiness.
 */
async function recomputeAwardSpan(tx: Tx, awardId: number): Promise<void> {
  await tx`
    UPDATE awards a
       SET first_season = span.first_season,
           last_season = span.last_season
      FROM (SELECT min(season) AS first_season, max(season) AS last_season
              FROM award_winners
             WHERE award_id = ${awardId} AND status = 'active') AS span
     WHERE a.id = ${awardId}
  `;
}

// --- revalidation paths (computed server-side) ---------------------------

function awardWinnerPaths(row: {
  awardSlug: string; season: number | null; playerId: number | null;
  playerSlug: string | null; clubSlug: string | null;
}): string[] {
  const paths = [awardPath(row.awardSlug)];
  if (row.season !== null) paths.push(awardSeasonPath(row.awardSlug, row.season));
  if (row.playerId !== null && row.playerSlug) paths.push(playerPath(row.playerSlug, row.playerId));
  if (row.clubSlug) paths.push(clubPath(row.clubSlug));
  return [...new Set(paths)];
}

function hallOfFamePaths(row: { playerId: number | null; playerSlug: string | null }): string[] {
  const paths = ['/hall-of-fame'];
  if (row.playerId !== null && row.playerSlug) paths.push(playerPath(row.playerSlug, row.playerId));
  return paths;
}

function honourTeamPaths(row: {
  teamName: string; playerId: number | null; playerSlug: string | null;
}): string[] {
  const paths = [honourTeamPath(honourTeamSlug(row.teamName))];
  if (row.playerId !== null && row.playerSlug) paths.push(playerPath(row.playerSlug, row.playerId));
  return paths;
}

// --- the shared edit core (§6.3) -----------------------------------------

/**
 * What every domain hands the shared core once it has locked and read its row.
 * `apply` runs AFTER every precondition, so a refusal inside it is a post-write
 * refusal and must THROW, never return.
 */
type LockedHonourRow<TRow> = {
  id: number;
  entityKey: string;
  status: HonourStatus;
  statusReason: string | null;
  updatedAt: string;
  sourceKey: string | null;
  revalidatePaths: string[];
  /** Carried into every audit row so an entry reads without joining anything. */
  auditIdentity: Record<string, unknown>;
  /** The domain's own fully-read row, under the lock. */
  row: TRow;
};

type LockResult<TRow> = LockedHonourRow<TRow> | null | HonourRefusal;

function isRefusal<TRow>(value: LockResult<TRow>): value is HonourRefusal {
  return value !== null && 'ok' in value && value.ok === false;
}

export type HonourEditBase = {
  rowId: number;
  /** The `updatedAt` the form rendered. Per-row compare-and-swap. */
  expectedUpdatedAt: string;
  adminUserId: number;
  note?: string | null;
};

async function runHonourEdit<TRow>(input: HonourEditBase & {
  table: HonourTable;
  fieldGroup: string;
  lock: (tx: Tx, rowId: number) => Promise<LockResult<TRow>>;
  precheck?: (ctx: { tx: Tx; row: LockedHonourRow<TRow> }) => Promise<HonourRefusal | null>;
  apply: (ctx: { tx: Tx; row: LockedHonourRow<TRow> }) => Promise<{
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
    overrideGroup: HonourFieldGroup;
    overridePayload: Record<string, unknown>;
  }>;
}): Promise<HonourMutationResult> {
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
      }) as HonourMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// =========================================================================
// award_winners
// =========================================================================

/**
 * The fields a correction may touch. Everything absent is identity-bearing:
 * `award_id`, `season`, `player_id`, `player_name_raw`, `source_id` and
 * `source_record_id` each change WHAT the row asserts or WHO recorded it, so a
 * wrong one is a void plus a replacement (R-1).
 */
export type AwardWinnerCorrection = Partial<{
  votes: string | number | null;
  position: string | null;
  isCaptain: boolean;
  isViceCaptain: boolean;
  note: string | null;
  sortOrder: number | null;
  candidateCount: number;
  /** Moves as ONE fact: the club id and its raw name, or neither. */
  clubId: number | null;
}>;

export const AWARD_WINNER_IDENTITY_FIELDS = [
  'awardId', 'season', 'playerId', 'playerNameRaw', 'sourceId', 'sourceRecordId',
] as const;

/** The same rule for the other two domains, stated once for a caller to render. */
export const HALL_OF_FAME_IDENTITY_FIELDS = ['name', 'inductedYear'] as const;
export const HONOUR_TEAM_IDENTITY_FIELDS = ['teamName', 'playerId', 'playerNameRaw'] as const;

/**
 * The refusal every identity-bearing field shares, so the sentence an
 * administrator reads is the same wherever they meet it.
 */
export function identityFieldRefusal(field: string, what: string): string {
  return `${field} is part of what this record asserts and cannot be corrected in place. `
    + `Void this ${what} and record the correct one, so both the mistake and the `
    + 'correction survive as history.';
}

async function lockAwardWinner(tx: Tx, rowId: number): Promise<LockResult<AwardWinnerRow>> {
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM award_winners WHERE id = ${rowId} FOR UPDATE
  `;
  if (!locked) return null;
  const rows = await tx.unsafe(
    `SELECT ${AWARD_WINNER_COLUMNS} WHERE w.id = $1`, [locked.id],
  ) as unknown as AwardWinnerRow[];
  const row = rows[0];
  if (!row) return null;

  // B-1's defensive refusal. Every award_winners row in afldb_test today
  // carries both halves (0 NULL source_id, 0 NULL source_record_id over 3,712
  // rows, measured 2026-09-13), so this is not reachable by current data — but
  // a row without a durable key cannot be named in data_overrides at all, so
  // its correction or void would be silently lost by the next rebuild. Refuse
  // rather than record a decision that cannot survive.
  if (row.sourceId === null || row.sourceKey === null || !row.sourceRecordId) {
    return refuse('no_durable_key',
      `Award winner #${row.id} carries no source identity (source_id / source_record_id), `
      + 'so a correction or void of it could not be recorded durably and would be lost by '
      + 'the next reload. Give the row a provenance first.');
  }

  return {
    id: row.id,
    entityKey: awardWinnerEntityKey(row.sourceKey, row.sourceRecordId),
    status: row.status,
    statusReason: row.statusReason,
    updatedAt: row.updatedAt,
    sourceKey: row.sourceKey,
    revalidatePaths: awardWinnerPaths(row),
    auditIdentity: {
      entity_key: awardWinnerEntityKey(row.sourceKey, row.sourceRecordId),
      lineage_identity: awardWinnerLineageIdentity(row.sourceKey, row.sourceRecordId),
      award_slug: row.awardSlug,
      season: row.season,
      player_name_raw: row.playerNameRaw,
    },
    row,
  };
}

/** Whether this row is owned by a source that reloads it, or by an administrator. */
function isManual(sourceKey: string | null): boolean {
  return sourceKey === MANUAL_SOURCE_KEY;
}

/**
 * The correction payload. For a SOURCE-OWNED row it is a DELTA — only the
 * fields the administrator actually changed, so the reload keeps supplying
 * everything else and a later source improvement is not frozen out. Key
 * presence is the semantics: an absent key leaves the source value, an
 * explicit null clears it (the migration-086 discipline the replay mirrors).
 *
 * For a MANUAL row the whole durable representation is rewritten instead,
 * under the `record` group: nothing reloads it, so there is no source value
 * for a delta to be a delta OF.
 */
function awardWinnerRecordPayload(
  row: AwardWinnerRow, playerIdentity: string | null, extra: Record<string, unknown> = {},
) {
  return {
    award_slug: row.awardSlug,
    season: row.season,
    player_identity: playerIdentity,
    player_name_raw: row.playerNameRaw,
    club_slug: row.clubSlug,
    club_name_raw: row.clubNameRaw,
    votes: row.votes,
    position: row.position,
    is_captain: row.isCaptain,
    is_vice_captain: row.isViceCaptain,
    note: row.note,
    sort_order: row.sortOrder,
    candidate_count: row.candidateCount,
    status: row.status,
    status_reason: row.statusReason,
    ...extra,
  };
}

export type CorrectAwardWinnerInput = HonourEditBase & {
  fields: AwardWinnerCorrection;
  /** Named only so a caller sending one gets a sentence rather than silence. */
  identityAttempt?: Partial<Record<(typeof AWARD_WINNER_IDENTITY_FIELDS)[number], unknown>>;
};

export async function correctAwardWinner(
  input: CorrectAwardWinnerInput,
): Promise<HonourMutationResult> {
  const attempted = Object.keys(input.identityAttempt ?? {});
  if (attempted.length > 0) {
    return refuse('forbidden', identityFieldRefusal(attempted.join(', '), 'award winner'));
  }
  const f = input.fields;
  if (f.votes !== undefined && f.votes !== null) {
    const votes = Number(f.votes);
    if (!Number.isFinite(votes) || votes < 0 || votes > 999_999.99) {
      return refuse('validation', 'Award votes or statistic must be from 0 to 999999.99.');
    }
  }
  if (f.sortOrder !== undefined && f.sortOrder !== null
      && (!Number.isInteger(f.sortOrder) || f.sortOrder < 1 || f.sortOrder > 100)) {
    return refuse('validation', 'Display order must be a whole number from 1 to 100.');
  }
  if (f.candidateCount !== undefined
      && (!Number.isInteger(f.candidateCount) || f.candidateCount < 0)) {
    return refuse('validation', 'Candidate count must be a whole number of 0 or more.');
  }
  if (Object.keys(f).length === 0) {
    return refuse('validation', 'Nothing was changed.');
  }

  return runHonourEdit({
    ...input,
    table: 'award_winners',
    fieldGroup: 'award_winner_corrected',
    lock: lockAwardWinner,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition',
        'That award winner was voided. Voided records are kept for the record and are not '
        + 'maintained; reinstate it first if the row should stand.')
      : null),
    apply: async ({ tx, row }) => {
      const w = row.row;
      const delta: Record<string, unknown> = {};
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};

      const next = {
        votes: f.votes === undefined ? w.votes : (f.votes === null ? null : String(f.votes)),
        position: f.position === undefined ? w.position : (f.position?.trim() || null),
        isCaptain: f.isCaptain ?? w.isCaptain,
        isViceCaptain: f.isViceCaptain ?? w.isViceCaptain,
        note: f.note === undefined ? w.note : (f.note?.trim() || null),
        sortOrder: f.sortOrder === undefined ? w.sortOrder : f.sortOrder,
        candidateCount: f.candidateCount ?? w.candidateCount,
        clubId: f.clubId === undefined ? w.clubId : f.clubId,
      };

      let clubSlug = w.clubSlug;
      let clubNameRaw = w.clubNameRaw;
      if (f.clubId !== undefined && f.clubId !== w.clubId) {
        if (f.clubId === null) {
          clubSlug = null;
          clubNameRaw = null;
        } else {
          // The club a winner is recorded under must be the identity that was
          // actually trading in that season — Footscray rather than Western
          // Bulldogs in 1980 — resolved by the one rule the create path uses.
          const [resolved] = await tx<{ id: number; slug: string; name: string }[]>`
            SELECT season_club.id::int AS id, season_club.slug AS slug, season_club.name AS name
              FROM clubs selected
              LEFT JOIN clubs season_club
                ON season_club.id = afldb_identity_for_season(
                     selected.organization_id, ${w.season}::smallint)
             WHERE selected.id = ${f.clubId}
          `;
          if (!resolved?.id) {
            throw new RollbackRefusal('validation',
              'The selected club has no identity active in that season.');
          }
          if (resolved.id !== f.clubId) {
            throw new RollbackRefusal('validation',
              `${resolved.name} (club #${resolved.id}) is the identity active in ${w.season}.`);
          }
          clubSlug = resolved.slug;
          clubNameRaw = resolved.name;
        }
        next.clubId = f.clubId;
        delta.club_slug = clubSlug;
        delta.club_name_raw = clubNameRaw;
        oldValues.club_id = w.clubId;
        newValues.club_id = f.clubId;
      }

      for (const [key, before, after] of [
        ['votes', w.votes, next.votes],
        ['position', w.position, next.position],
        ['is_captain', w.isCaptain, next.isCaptain],
        ['is_vice_captain', w.isViceCaptain, next.isViceCaptain],
        ['note', w.note, next.note],
        ['sort_order', w.sortOrder, next.sortOrder],
        ['candidate_count', w.candidateCount, next.candidateCount],
      ] as const) {
        if (before !== after) {
          delta[key] = after;
          oldValues[key] = before;
          newValues[key] = after;
        }
      }

      await tx`
        UPDATE award_winners
           SET votes = ${next.votes}::numeric,
               position = ${next.position},
               is_captain = ${next.isCaptain},
               is_vice_captain = ${next.isViceCaptain},
               note = ${next.note},
               sort_order = ${next.sortOrder}::smallint,
               candidate_count = ${next.candidateCount}::smallint,
               club_id = ${next.clubId},
               club_name_raw = ${clubNameRaw},
               updated_at = now()
         WHERE id = ${w.id}
      `;

      // A manual row has no source to be a delta OF, so its whole durable
      // representation is rewritten — including the player identity, which
      // must be re-resolved here rather than dropped: the replay re-creates
      // the row from this payload after a rebuild, and an omitted identity
      // would bring the winner back unlinked.
      let manualIdentity: string | null = null;
      if (isManual(w.sourceKey) && w.playerId !== null) {
        const resolved = await resolvePlayerIdentity(tx, w.playerId);
        if (!resolved.ok) throw new RollbackRefusal('ambiguous_identity', resolved.error);
        manualIdentity = resolved.identity;
      }

      return {
        oldValues,
        newValues,
        overrideGroup: isManual(w.sourceKey) ? 'record' : 'correction',
        overridePayload: isManual(w.sourceKey)
          ? awardWinnerRecordPayload({
            ...w,
            votes: next.votes,
            position: next.position,
            isCaptain: next.isCaptain,
            isViceCaptain: next.isViceCaptain,
            note: next.note,
            sortOrder: next.sortOrder,
            candidateCount: next.candidateCount,
            clubId: next.clubId,
            clubSlug,
            clubNameRaw,
          }, manualIdentity)
          : delta,
      };
    },
  });
}

export type VoidHonourInput = HonourEditBase & { reason: string };

export async function voidAwardWinner(input: VoidHonourInput): Promise<HonourMutationResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for voiding this award winner.');
  return runHonourEdit({
    ...input,
    table: 'award_winners',
    fieldGroup: 'award_winner_voided',
    lock: lockAwardWinner,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That award winner is already void.') : null),
    apply: async ({ tx, row }) => {
      const w = row.row;
      await tx`
        UPDATE award_winners
           SET status = 'void', status_reason = ${reason}, updated_at = now()
         WHERE id = ${w.id}
      `;
      // D-11, in the same transaction: an award's presented span is derived
      // from its winners, so voiding one can move it.
      await recomputeAwardSpan(tx, w.awardId);
      return {
        oldValues: { status: w.status, status_reason: w.statusReason },
        newValues: { status: 'void', status_reason: reason },
        overrideGroup: 'lifecycle',
        overridePayload: { status: 'void', status_reason: reason },
      };
    },
  });
}

export async function reinstateAwardWinner(
  input: HonourEditBase,
): Promise<HonourMutationResult> {
  return runHonourEdit({
    ...input,
    table: 'award_winners',
    fieldGroup: 'award_winner_reinstated',
    lock: lockAwardWinner,
    precheck: async ({ row }) => (row.status !== 'void'
      ? refuse('invalid_transition', 'That award winner is already active.') : null),
    apply: async ({ tx, row }) => {
      const w = row.row;
      await tx`
        UPDATE award_winners
           SET status = 'active', status_reason = NULL, updated_at = now()
         WHERE id = ${w.id}
      `;
      await recomputeAwardSpan(tx, w.awardId);
      return {
        oldValues: { status: w.status, status_reason: w.statusReason },
        newValues: { status: 'active', status_reason: null },
        overrideGroup: 'lifecycle',
        overridePayload: { status: 'active', status_reason: null },
      };
    },
  });
}

// --- award_winners: create and replace -----------------------------------

export type CreateAwardWinnerInput = {
  awardId: number;
  season: number;
  playerId?: number | null;
  playerNameRaw?: string | null;
  clubId?: number | null;
  clubNameRaw?: string | null;
  votes?: string | number | null;
  position?: string | null;
  isCaptain?: boolean;
  isViceCaptain?: boolean;
  note?: string | null;
  sortOrder?: number | null;
  adminUserId: number;
  /**
   * R-5. Two rows for one player in one award season are LEGITIMATE — the 1984
   * All-Australian holds 24 club-selection rows and 24 state-selection rows for
   * the same players, and migration 042 exists because a
   * (award, season, player) uniqueness rule would have rejected all of it as
   * corrupt. So a same-player row is surfaced as a conflict to confirm, never
   * refused outright and never silently allowed.
   */
  confirmDuplicate?: boolean;
};

type CreatedWinner = { rowId: number; entityKey: string; sourceRecordId: string };

async function insertAwardWinner(tx: Tx, input: CreateAwardWinnerInput & {
  replacesKey?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<CreatedWinner> {
  const [award] = await tx<{
    id: number; slug: string; name: string; category: string;
    awardClubId: number | null; seasonClubId: number | null;
    seasonClubSlug: string | null; seasonClubName: string | null;
  }[]>`
    SELECT a.id::int AS id, a.slug, a.name, a.category,
           a.club_id AS "awardClubId",
           season_club.id::int AS "seasonClubId",
           season_club.slug AS "seasonClubSlug",
           season_club.name AS "seasonClubName"
      FROM awards a
      LEFT JOIN clubs award_club ON award_club.id = a.club_id
      LEFT JOIN clubs season_club
        ON season_club.id = afldb_identity_for_season(
             award_club.organization_id, ${input.season}::smallint)
     WHERE a.id = ${input.awardId}
  `;
  if (!award) throw new RollbackRefusal('validation', 'The selected award does not exist.');
  if (award.slug === BROWNLOW_AWARD_SLUG) {
    throw new RollbackRefusal('forbidden',
      'Brownlow Medal winners must be recorded in authoritative brownlow_season_votes, '
      + 'not award_winners.');
  }

  let playerName = input.playerNameRaw?.trim() || '';
  let playerIdentity: string | null = null;
  if (input.playerId) {
    const [p] = await tx<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}
    `;
    if (!p) throw new RollbackRefusal('validation', 'The selected player does not exist.');
    playerName = p.displayName;
    const identity = await resolvePlayerIdentity(tx, input.playerId);
    if (!identity.ok) throw new RollbackRefusal('ambiguous_identity', identity.error);
    // A legacy identity-less player is NOT refused here: unlike a leadership
    // appointment, an award row is meaningful unlinked (player_name_raw is the
    // source's own text and NOT NULL), so the durable record simply carries no
    // player identity and the replay re-creates the row unlinked.
    playerIdentity = identity.identity;
  }
  if (!playerName) throw new RollbackRefusal('validation', 'Player name is required.');

  let clubId = input.clubId ?? null;
  let clubSlug: string | null = null;
  let clubNameRaw = input.clubNameRaw?.trim() || null;
  if (award.category === 'club_best_and_fairest') {
    if (award.awardClubId === null) {
      throw new RollbackRefusal('validation',
        `Club best-and-fairest award '${award.name}' has no club definition.`);
    }
    if (award.seasonClubId === null) {
      throw new RollbackRefusal('validation',
        `Award '${award.name}' has no club identity active in season ${input.season}.`);
    }
    if (clubId !== null && clubId !== award.seasonClubId) {
      throw new RollbackRefusal('validation',
        `Award '${award.name}' must use ${award.seasonClubName} `
        + `(club #${award.seasonClubId}) in ${input.season}.`);
    }
    clubId = award.seasonClubId;
    clubSlug = award.seasonClubSlug;
    clubNameRaw = award.seasonClubName;
  } else if (clubId !== null) {
    const [selected] = await tx<{
      seasonClubId: number | null; seasonClubSlug: string | null; seasonClubName: string | null;
    }[]>`
      SELECT season_club.id::int AS "seasonClubId",
             season_club.slug AS "seasonClubSlug",
             season_club.name AS "seasonClubName"
        FROM clubs selected
        LEFT JOIN clubs season_club
          ON season_club.id = afldb_identity_for_season(
               selected.organization_id, ${input.season}::smallint)
       WHERE selected.id = ${clubId}
    `;
    if (!selected) throw new RollbackRefusal('validation', 'The selected club does not exist.');
    if (selected.seasonClubId === null) {
      throw new RollbackRefusal('validation',
        `The selected club has no identity active in season ${input.season}.`);
    }
    if (clubId !== selected.seasonClubId) {
      throw new RollbackRefusal('validation',
        `${selected.seasonClubName} (club #${selected.seasonClubId}) is the identity `
        + `active in ${input.season}.`);
    }
    clubSlug = selected.seasonClubSlug;
    clubNameRaw = selected.seasonClubName;
  }

  if (!input.confirmDuplicate && input.playerId) {
    const existing = await tx<{ id: number }[]>`
      SELECT id::int AS id FROM award_winners
       WHERE award_id = ${input.awardId} AND season = ${input.season}::smallint
         AND player_id = ${input.playerId} AND status = 'active'
       ORDER BY id
    `;
    if (existing.length > 0) {
      throw new RollbackRefusal('duplicate',
        `${playerName} is already recorded as a ${award.name} winner in ${input.season} `
        + `(entry ${existing.map((r) => `#${r.id}`).join(', ')}). Some awards legitimately `
        + 'record the same player twice in one season — the 1984 All-Australian lists every '
        + 'player under both a club and a state selection — so confirm the duplicate if that '
        + 'is what this is.',
        [playerName]);
    }
  }

  const sourceId = await manualSourceId(tx);
  const sourceRecordId = `award_winner:${randomUUID()}`;
  const entityKey = awardWinnerEntityKey(MANUAL_SOURCE_KEY, sourceRecordId);
  await refuseClaimedKey(tx, 'award_winners', entityKey);

  const votes = input.votes === undefined || input.votes === null ? null : String(input.votes);
  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO award_winners (
      award_id, season, player_id, player_name_raw, link_status_value,
      club_id, club_name_raw, votes, position, is_captain, is_vice_captain,
      note, sort_order, status, source_id, source_record_id
    ) VALUES (
      ${input.awardId}, ${input.season}::smallint, ${input.playerId ?? null}, ${playerName},
      ${input.playerId ? 'resolved' : 'unmatched'}::link_status,
      ${clubId}, ${clubNameRaw}, ${votes}::numeric, ${input.position?.trim() || null},
      ${input.isCaptain ?? false}, ${input.isViceCaptain ?? false},
      ${input.note?.trim() || null}, ${input.sortOrder ?? null}::smallint,
      'active', ${sourceId}, ${sourceRecordId}
    )
    RETURNING id::int AS id
  `;
  if (!inserted) throw new RollbackRefusal('failed', 'The award winner row was not written.');

  const payload: Record<string, unknown> = {
    award_slug: award.slug,
    season: input.season,
    player_identity: playerIdentity,
    player_name_raw: playerName,
    club_slug: clubSlug,
    club_name_raw: clubNameRaw,
    votes,
    position: input.position?.trim() || null,
    is_captain: input.isCaptain ?? false,
    is_vice_captain: input.isViceCaptain ?? false,
    note: input.note?.trim() || null,
    sort_order: input.sortOrder ?? null,
    candidate_count: 0,
    status: 'active',
    status_reason: null,
  };
  if (input.replacesKey) payload.replaces_key = input.replacesKey;

  await writeOverride(tx, {
    entityType: 'award_winners',
    entityKey,
    fieldGroup: 'record',
    payload,
    adminUserId: input.adminUserId,
  });

  await recordDataEdit(tx, {
    tableName: 'award_winners',
    rowId: inserted.id,
    fieldGroup: 'award_winner_created',
    oldValues: {},
    newValues: {
      entity_key: entityKey,
      lineage_identity: awardWinnerLineageIdentity(MANUAL_SOURCE_KEY, sourceRecordId),
      ...payload,
      ...(input.auditExtra ?? {}),
    },
    adminUserId: input.adminUserId,
    note: input.note,
  });

  await recomputeAwardSpan(tx, input.awardId);
  return { rowId: inserted.id, entityKey, sourceRecordId };
}

export async function createAwardWinner(
  input: CreateAwardWinnerInput,
): Promise<HonourMutationResult> {
  if (!Number.isInteger(input.awardId) || input.awardId <= 0) {
    return refuse('validation', 'Award ID must be a positive integer.');
  }
  if (!Number.isInteger(input.season) || input.season < 1897 || input.season > 2100) {
    return refuse('validation', 'Award season must be from 1897 to 2100.');
  }
  if (input.votes != null) {
    const votes = Number(input.votes);
    if (!Number.isFinite(votes) || votes < 0 || votes > 999_999.99) {
      return refuse('validation', 'Award votes or statistic must be from 0 to 999999.99.');
    }
  }
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const created = await insertAwardWinner(tx as Tx, input);
        const row = await readAwardWinnerInTx(tx as Tx, created.rowId);
        return {
          ok: true as const,
          table: 'award_winners' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          revalidatePaths: row ? awardWinnerPaths(row) : [],
        };
      }) as HonourMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

async function readAwardWinnerInTx(tx: Tx, id: number): Promise<AwardWinnerRow | null> {
  const rows = await tx.unsafe(
    `SELECT ${AWARD_WINNER_COLUMNS} WHERE w.id = $1`, [id],
  ) as unknown as AwardWinnerRow[];
  return rows[0] ?? null;
}

export type ReplaceAwardWinnerInput = HonourEditBase & {
  reason: string;
  replacement: Omit<CreateAwardWinnerInput, 'adminUserId'>;
};

export type HonourReplacementResult = HonourMutationEnvelope & {
  /** The voided row's durable key, so the pair reads as one movement. */
  voidedEntityKey: string;
  voidedRowId: number;
  replacementId: string;
};

/**
 * Void the wrong record and create the right one, as ONE transaction.
 *
 * Not an UPDATE of the identity on a single row: that would erase the fact
 * that the wrong assertion was ever made, and leave the audit trail asserting
 * something the database no longer says. Not void-then-create either, because
 * a separate create that failed would leave the season with no winner recorded
 * at all — a worse state than before or after. The two audit rows share a
 * `replacement_id` and the two durable payloads cross-reference each other by
 * NATURAL KEY, never by row id.
 */
export async function replaceAwardWinner(
  input: ReplaceAwardWinnerInput,
): Promise<HonourMutationResult<HonourReplacementResult>> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for replacing this award winner.');
  const replacementId = randomUUID();

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const locked = await lockAwardWinner(tx as Tx, input.rowId);
        if (locked === null) return refuse('not_found', 'That award winner no longer exists.');
        if (isRefusal(locked)) return locked;
        const row = locked;
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That record changed while this page was open. Reload it and try again.');
        }
        if (row.status !== 'active') {
          return refuse('invalid_transition',
            'That award winner is already void, so there is nothing to replace.');
        }

        // Everything above refused before a write. From here, any refusal throws.
        await (tx as Tx)`
          UPDATE award_winners
             SET status = 'void', status_reason = ${reason}, updated_at = now()
           WHERE id = ${row.id}
        `;

        const created = await insertAwardWinner(tx as Tx, {
          ...input.replacement,
          adminUserId: input.adminUserId,
          replacesKey: row.entityKey,
          auditExtra: { replacement_id: replacementId, replaces: row.entityKey },
        });

        // The voided payload is written LAST so it can name what replaced it:
        // the cross-reference only exists once both keys do.
        await writeOverride(tx as Tx, {
          entityType: 'award_winners',
          entityKey: row.entityKey,
          fieldGroup: 'lifecycle',
          payload: {
            status: 'void',
            status_reason: reason,
            replaced_by_key: created.entityKey,
          },
          adminUserId: input.adminUserId,
        });

        await recordDataEdit(tx as Tx, {
          tableName: 'award_winners',
          rowId: row.id,
          fieldGroup: 'award_winner_voided',
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

        await recomputeAwardSpan(tx as Tx, row.row.awardId);

        return {
          ok: true as const,
          table: 'award_winners' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          voidedEntityKey: row.entityKey,
          voidedRowId: row.id,
          replacementId,
          revalidatePaths: row.revalidatePaths,
        };
      }) as HonourMutationResult<HonourReplacementResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// =========================================================================
// hall_of_fame
// =========================================================================

export type HallOfFameCorrection = Partial<{
  category: string | null;
  isLegend: boolean;
  legendYear: number | null;
  clubNameRaw: string | null;
  state: string | null;
  playingCareer: string | null;
  /** A fact about the Hall of Fame, corrected like any other. Not lifecycle. */
  removedYear: number | null;
  notes: string | null;
}>;

async function lockHallOfFame(tx: Tx, rowId: number): Promise<LockResult<HallOfFameRow>> {
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM hall_of_fame WHERE id = ${rowId} FOR UPDATE
  `;
  if (!locked) return null;
  const rows = await tx.unsafe(
    `SELECT ${HALL_OF_FAME_COLUMNS} WHERE h.id = $1`, [locked.id],
  ) as unknown as HallOfFameRow[];
  const row = rows[0];
  if (!row) return null;
  if (row.sourceKey === null) {
    return refuse('no_durable_key',
      `Hall of Fame entry #${row.id} carries no source, so a correction or void of it could `
      + 'not be recorded durably and would be lost by the next reload. Give the row a '
      + 'provenance first.');
  }
  if (carriesKeySeparator(row.name)) {
    return refuse('no_durable_key',
      `Hall of Fame entry #${row.id} has a name containing "|", which the durable key uses to `
      + 'separate the name from the induction year. Correct the name before administering it.');
  }
  const entityKey = hallOfFameEntityKey(row.sourceKey, row.name, row.inductedYear);
  return {
    id: row.id,
    entityKey,
    status: row.status,
    statusReason: row.statusReason,
    updatedAt: row.updatedAt,
    sourceKey: row.sourceKey,
    revalidatePaths: hallOfFamePaths(row),
    auditIdentity: {
      entity_key: entityKey,
      lineage_identity: hallOfFameLineageIdentity(row.name, row.inductedYear),
      name: row.name,
      inducted_year: row.inductedYear,
    },
    row,
  };
}

function hallOfFameRecordPayload(
  row: HallOfFameRow, playerIdentity: string | null, extra: Record<string, unknown> = {},
) {
  return {
    player_identity: playerIdentity,
    category: row.category,
    is_legend: row.isLegend,
    legend_year: row.legendYear,
    club_name_raw: row.clubNameRaw,
    state: row.state,
    playing_career: row.playingCareer,
    removed_year: row.removedYear,
    notes: row.notes,
    status: row.status,
    status_reason: row.statusReason,
    ...extra,
  };
}

export type CorrectHallOfFameInput = HonourEditBase & {
  fields: HallOfFameCorrection;
  /** `name` and `inducted_year` are identity; naming one gets a sentence. */
  identityAttempt?: Partial<{ name: unknown; inductedYear: unknown }>;
};

export async function correctHallOfFameInductee(
  input: CorrectHallOfFameInput,
): Promise<HonourMutationResult> {
  const attempted = Object.keys(input.identityAttempt ?? {});
  if (attempted.length > 0) {
    return refuse('forbidden', identityFieldRefusal(attempted.join(', '), 'induction'));
  }
  const f = input.fields;
  if (Object.keys(f).length === 0) return refuse('validation', 'Nothing was changed.');
  if (f.category !== undefined && f.category !== null
      && !HALL_OF_FAME_CATEGORIES.has(f.category.trim())) {
    return refuse('validation', 'Invalid Hall of Fame category.');
  }

  return runHonourEdit({
    ...input,
    table: 'hall_of_fame',
    fieldGroup: 'hall_of_fame_corrected',
    lock: lockHallOfFame,
    precheck: async ({ row }) => {
      if (row.status === 'void') {
        return refuse('invalid_transition',
          'That entry was voided. Voided records are kept for the record and are not '
          + 'maintained; reinstate it first if the row should stand.');
      }
      const h = row.row;
      const legend = f.isLegend ?? h.isLegend;
      const legendYear = f.legendYear === undefined ? h.legendYear : f.legendYear;
      if (legend && (legendYear === null
          || (h.inductedYear !== null && legendYear < h.inductedYear))) {
        return refuse('validation',
          'A Legend needs an elevation year from the induction year onwards.');
      }
      if (f.removedYear !== undefined && f.removedYear !== null
          && h.inductedYear !== null && f.removedYear < h.inductedYear) {
        return refuse('validation', 'The removal year cannot precede the induction year.');
      }
      return null;
    },
    apply: async ({ tx, row }) => {
      const h = row.row;
      const next = {
        category: f.category === undefined ? h.category : (f.category?.trim() || null),
        isLegend: f.isLegend ?? h.isLegend,
        legendYear: f.legendYear === undefined ? h.legendYear : f.legendYear,
        clubNameRaw: f.clubNameRaw === undefined ? h.clubNameRaw : (f.clubNameRaw?.trim() || null),
        state: f.state === undefined ? h.state : (f.state?.trim() || null),
        playingCareer: f.playingCareer === undefined
          ? h.playingCareer : (f.playingCareer?.trim() || null),
        removedYear: f.removedYear === undefined ? h.removedYear : f.removedYear,
        notes: f.notes === undefined ? h.notes : (f.notes?.trim() || null),
      };
      const delta: Record<string, unknown> = {};
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const [key, before, after] of [
        ['category', h.category, next.category],
        ['is_legend', h.isLegend, next.isLegend],
        ['legend_year', h.legendYear, next.legendYear],
        ['club_name_raw', h.clubNameRaw, next.clubNameRaw],
        ['state', h.state, next.state],
        ['playing_career', h.playingCareer, next.playingCareer],
        ['removed_year', h.removedYear, next.removedYear],
        ['notes', h.notes, next.notes],
      ] as const) {
        if (before !== after) {
          delta[key] = after;
          oldValues[key] = before;
          newValues[key] = after;
        }
      }

      await tx`
        UPDATE hall_of_fame
           SET category = ${next.category},
               is_legend = ${next.isLegend},
               legend_year = ${next.legendYear}::smallint,
               club_name_raw = ${next.clubNameRaw},
               state = ${next.state},
               playing_career = ${next.playingCareer},
               removed_year = ${next.removedYear}::smallint,
               notes = ${next.notes},
               updated_at = now()
         WHERE id = ${h.id}
      `;

      // As for award_winners: a manual row's whole durable representation is
      // rewritten, so its player identity is re-resolved rather than dropped.
      let manualIdentity: string | null = null;
      if (isManual(h.sourceKey) && h.playerId !== null) {
        const resolved = await resolvePlayerIdentity(tx, h.playerId);
        if (!resolved.ok) throw new RollbackRefusal('ambiguous_identity', resolved.error);
        manualIdentity = resolved.identity;
      }

      return {
        oldValues,
        newValues,
        overrideGroup: isManual(h.sourceKey) ? 'record' : 'correction',
        overridePayload: isManual(h.sourceKey)
          ? hallOfFameRecordPayload({ ...h, ...next }, manualIdentity)
          : delta,
      };
    },
  });
}

export async function voidHallOfFameInductee(
  input: VoidHonourInput,
): Promise<HonourMutationResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for voiding this entry.');
  return runHonourEdit({
    ...input,
    table: 'hall_of_fame',
    fieldGroup: 'hall_of_fame_voided',
    lock: lockHallOfFame,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That entry is already void.') : null),
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE hall_of_fame
           SET status = 'void', status_reason = ${reason}, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'void', status_reason: reason },
        overrideGroup: 'lifecycle',
        overridePayload: { status: 'void', status_reason: reason },
      };
    },
  });
}

export async function reinstateHallOfFameInductee(
  input: HonourEditBase,
): Promise<HonourMutationResult> {
  return runHonourEdit({
    ...input,
    table: 'hall_of_fame',
    fieldGroup: 'hall_of_fame_reinstated',
    lock: lockHallOfFame,
    precheck: async ({ tx, row }) => {
      if (row.status !== 'void') {
        return refuse('invalid_transition', 'That entry is already active.');
      }
      // The identity key is ACTIVE-ROW-ONLY (migration 101), so reinstating can
      // collide with whatever took the place while this row was void. Say so in
      // a sentence rather than letting the unique index raise a raw error.
      const h = row.row;
      const [taken] = await tx<{ id: number }[]>`
        SELECT id::int AS id FROM hall_of_fame
         WHERE name = ${h.name}
           AND inducted_year IS NOT DISTINCT FROM ${h.inductedYear}::smallint
           AND status <> 'void' AND id <> ${h.id}
         LIMIT 1
      `;
      return taken
        ? refuse('duplicate',
          `${h.name} (${h.inductedYear ?? 'no year'}) is already recorded by entry #${taken.id}. `
          + 'Void that entry first if this one is the right record.', [h.name])
        : null;
    },
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE hall_of_fame
           SET status = 'active', status_reason = NULL, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'active', status_reason: null },
        overrideGroup: 'lifecycle',
        overridePayload: { status: 'active', status_reason: null },
      };
    },
  });
}

export type CreateHallOfFameInput = {
  name: string;
  playerId?: number | null;
  category?: string | null;
  inductedYear: number;
  isLegend?: boolean;
  legendYear?: number | null;
  clubNameRaw?: string | null;
  state?: string | null;
  playingCareer?: string | null;
  notes?: string | null;
  removedYear?: number | null;
  adminUserId: number;
};

async function insertHallOfFame(tx: Tx, input: CreateHallOfFameInput & {
  replacesKey?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<{ rowId: number; entityKey: string }> {
  const category = input.category?.trim() || 'Player';
  if (!HALL_OF_FAME_CATEGORIES.has(category)) {
    throw new RollbackRefusal('validation', 'Invalid Hall of Fame category.');
  }

  // THE SUPPLIED NAME IS CANONICAL, and this is the one place `hall_of_fame`
  // deliberately diverges from `award_winners` and `honour_team_members`.
  //
  // On those two, `player_name_raw` is a DISPLAY fact sitting beside a separate
  // identity (a minted source record id, or the player id itself), so deriving
  // it from the linked player — which `src/db/queries/awards-admin.ts` has
  // always done — moves nothing that decides which row this is.
  //
  // Here the name IS the identity: migration 042 keys this table on
  // (name, inducted_year), and migration 101's durable key is
  // '<source key>:<name>|<inducted_year>'. Overwriting an administrator's typed
  // name with the linked player's display name therefore files the induction
  // under a DIFFERENT key from the one they asked for — silently, and exactly
  // where R-1 says an identity may never move by itself. It also makes the
  // required replacement case unexpressible: re-entering a voided inductee
  // under the SAME name and year while linking the person it should have been
  // is precisely how a mis-identified Hall of Fame row is corrected, and
  // deriving the name from the new player defeats it.
  //
  // The player link is a separate assertion: "this inductee is that footballer".
  // The two may legitimately read differently — a Hall of Fame entry carries the
  // name a person was inducted UNDER, which is not always their AFLDB display
  // name. The display name is used only when no name was supplied at all.
  let name = input.name.trim();
  let playerIdentity: string | null = null;
  if (input.playerId) {
    const [p] = await tx<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}
    `;
    if (!p) throw new RollbackRefusal('validation', 'The selected player does not exist.');
    if (!name) name = p.displayName;
    const identity = await resolvePlayerIdentity(tx, input.playerId);
    if (!identity.ok) throw new RollbackRefusal('ambiguous_identity', identity.error);
    playerIdentity = identity.identity;
  }
  if (!name) throw new RollbackRefusal('validation', 'Inductee name is required.');
  if (carriesKeySeparator(name)) {
    throw new RollbackRefusal('validation',
      'An inductee name cannot contain "|": the durable key uses it to separate the name '
      + 'from the induction year.');
  }

  const [clash] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM hall_of_fame
     WHERE name = ${name} AND inducted_year IS NOT DISTINCT FROM ${input.inductedYear}::smallint
       AND status <> 'void'
     LIMIT 1
  `;
  if (clash) {
    throw new RollbackRefusal('duplicate',
      `${name} is already recorded as inducted in ${input.inductedYear} (entry #${clash.id}). `
      + 'Correct that entry instead, or void it first if it is wrong.', [name]);
  }

  const sourceId = await manualSourceId(tx);
  const entityKey = hallOfFameEntityKey(MANUAL_SOURCE_KEY, name, input.inductedYear);
  await refuseClaimedKey(tx, 'hall_of_fame', entityKey);

  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO hall_of_fame (
      name, player_id, link_status_value, category, inducted_year,
      is_legend, legend_year, club_name_raw, state, playing_career,
      removed_year, notes, status, source_id
    ) VALUES (
      ${name}, ${input.playerId ?? null}, ${input.playerId ? 'resolved' : 'unmatched'}::link_status,
      ${category}, ${input.inductedYear}::smallint,
      ${input.isLegend ?? false}, ${input.legendYear ?? null}::smallint,
      ${input.clubNameRaw?.trim() || null}, ${input.state?.trim() || null},
      ${input.playingCareer?.trim() || null}, ${input.removedYear ?? null}::smallint,
      ${input.notes?.trim() || null}, 'active', ${sourceId}
    )
    RETURNING id::int AS id
  `;
  if (!inserted) throw new RollbackRefusal('failed', 'The Hall of Fame row was not written.');

  const payload: Record<string, unknown> = {
    player_identity: playerIdentity,
    category,
    is_legend: input.isLegend ?? false,
    legend_year: input.legendYear ?? null,
    club_name_raw: input.clubNameRaw?.trim() || null,
    state: input.state?.trim() || null,
    playing_career: input.playingCareer?.trim() || null,
    removed_year: input.removedYear ?? null,
    notes: input.notes?.trim() || null,
    status: 'active',
    status_reason: null,
  };
  if (input.replacesKey) payload.replaces_key = input.replacesKey;

  await writeOverride(tx, {
    entityType: 'hall_of_fame',
    entityKey,
    fieldGroup: 'record',
    payload,
    adminUserId: input.adminUserId,
  });

  await recordDataEdit(tx, {
    tableName: 'hall_of_fame',
    rowId: inserted.id,
    fieldGroup: 'hall_of_fame_created',
    oldValues: {},
    newValues: {
      entity_key: entityKey,
      lineage_identity: hallOfFameLineageIdentity(name, input.inductedYear),
      name,
      inducted_year: input.inductedYear,
      ...payload,
      ...(input.auditExtra ?? {}),
    },
    adminUserId: input.adminUserId,
    note: input.notes,
  });

  return { rowId: inserted.id, entityKey };
}

export async function createHallOfFameInductee(
  input: CreateHallOfFameInput,
): Promise<HonourMutationResult> {
  if (!Number.isInteger(input.inductedYear)
      || input.inductedYear < 1996 || input.inductedYear > 2100) {
    return refuse('validation', 'Inducted year must be from 1996 to 2100.');
  }
  if (input.isLegend && (!Number.isInteger(input.legendYear)
      || (input.legendYear as number) < input.inductedYear
      || (input.legendYear as number) > 2100)) {
    return refuse('validation', 'Legend year must be from the induction year to 2100.');
  }
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const created = await insertHallOfFame(tx as Tx, input);
        const row = await (async () => {
          const rows = await (tx as Tx).unsafe(
            `SELECT ${HALL_OF_FAME_COLUMNS} WHERE h.id = $1`, [created.rowId],
          ) as unknown as HallOfFameRow[];
          return rows[0] ?? null;
        })();
        return {
          ok: true as const,
          table: 'hall_of_fame' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          revalidatePaths: row ? hallOfFamePaths(row) : ['/hall-of-fame'],
        };
      }) as HonourMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

export type ReplaceHallOfFameInput = HonourEditBase & {
  reason: string;
  replacement: Omit<CreateHallOfFameInput, 'adminUserId'>;
};

export async function replaceHallOfFameInductee(
  input: ReplaceHallOfFameInput,
): Promise<HonourMutationResult<HonourReplacementResult>> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for replacing this entry.');
  const replacementId = randomUUID();

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const locked = await lockHallOfFame(tx as Tx, input.rowId);
        if (locked === null) return refuse('not_found', 'That entry no longer exists.');
        if (isRefusal(locked)) return locked;
        const row = locked;
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That record changed while this page was open. Reload it and try again.');
        }
        if (row.status !== 'active') {
          return refuse('invalid_transition',
            'That entry is already void, so there is nothing to replace.');
        }

        // Void FIRST, so the identity key is free for a replacement that
        // re-uses the same name and induction year — which migration 101's
        // active-row-only index is exactly what makes possible.
        await (tx as Tx)`
          UPDATE hall_of_fame
             SET status = 'void', status_reason = ${reason}, updated_at = now()
           WHERE id = ${row.id}
        `;

        const created = await insertHallOfFame(tx as Tx, {
          ...input.replacement,
          adminUserId: input.adminUserId,
          replacesKey: row.entityKey,
          auditExtra: { replacement_id: replacementId, replaces: row.entityKey },
        });

        await writeOverride(tx as Tx, {
          entityType: 'hall_of_fame',
          entityKey: row.entityKey,
          fieldGroup: 'lifecycle',
          payload: {
            status: 'void', status_reason: reason, replaced_by_key: created.entityKey,
          },
          adminUserId: input.adminUserId,
        });

        await recordDataEdit(tx as Tx, {
          tableName: 'hall_of_fame',
          rowId: row.id,
          fieldGroup: 'hall_of_fame_voided',
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
          table: 'hall_of_fame' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          voidedEntityKey: row.entityKey,
          voidedRowId: row.id,
          replacementId,
          revalidatePaths: row.revalidatePaths,
        };
      }) as HonourMutationResult<HonourReplacementResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// =========================================================================
// honour_team_members
// =========================================================================

export type HonourTeamCorrection = Partial<{
  position: string | null;
  role: string | null;
  clubNameRaw: string | null;
  sortOrder: number;
  note: string | null;
}>;

/**
 * Take the AFLDB-ISSUE-080 §5.3 lock before reading honour-team identity.
 *
 * Migration 059's two partial indexes leave the mixed linked/unlinked
 * same-name collisions with NO database backstop, so the collision check and
 * the write must share one protected transaction. The try form fails fast
 * rather than parking a web request behind a multi-minute reload; the
 * transaction scope releases the lock on commit and rollback alike.
 */
async function takeHonourTeamLock(tx: Tx): Promise<void> {
  const [lock] = await tx<{ locked: boolean }[]>`
    SELECT pg_try_advisory_xact_lock(
      ${HONOUR_TEAM_LOCK_NAMESPACE}, ${HONOUR_TEAM_LOCK_KEY}
    ) AS locked
  `;
  if (!lock?.locked) {
    throw new RollbackRefusal('conflict',
      'An honours reload is in progress; try again shortly.');
  }
}

async function lockHonourTeamMember(
  tx: Tx, rowId: number,
): Promise<LockResult<HonourTeamMemberRow>> {
  await takeHonourTeamLock(tx);
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM honour_team_members WHERE id = ${rowId} FOR UPDATE
  `;
  if (!locked) return null;
  const rows = await tx.unsafe(
    `SELECT ${HONOUR_TEAM_COLUMNS} WHERE m.id = $1`, [locked.id],
  ) as unknown as HonourTeamMemberRow[];
  const row = rows[0];
  if (!row) return null;
  if (row.sourceKey === null) {
    return refuse('no_durable_key',
      `Honour-team entry #${row.id} carries no source, so a correction or void of it could not `
      + 'be recorded durably and would be lost by the next reload. Give the row a provenance '
      + 'first.');
  }
  if (carriesKeySeparator(row.teamName)) {
    return refuse('no_durable_key',
      `Honour-team entry #${row.id} belongs to a team whose name contains "|", which the `
      + 'durable key uses to separate the team from the player identity.');
  }

  let identity: string | null = null;
  if (row.playerId !== null) {
    const resolved = await resolvePlayerIdentity(tx, row.playerId);
    if (!resolved.ok) return refuse('ambiguous_identity', resolved.error);
    identity = resolved.identity;
    if (identity === null) {
      return refuse('no_durable_key',
        `${row.playerNameRaw} (#${row.playerId}) carries no durable identity, so this entry `
        + 'could not be recorded durably. Reconcile the player identity first.',
        [row.playerNameRaw]);
    }
  }
  const playerIdentity = honourTeamPlayerIdentity(identity, row.playerNameRaw);
  const entityKey = honourTeamEntityKey(row.sourceKey, row.teamName, playerIdentity);

  return {
    id: row.id,
    entityKey,
    status: row.status,
    statusReason: row.statusReason,
    updatedAt: row.updatedAt,
    sourceKey: row.sourceKey,
    revalidatePaths: honourTeamPaths(row),
    auditIdentity: {
      entity_key: entityKey,
      lineage_identity: honourTeamLineageIdentity(row.teamName, playerIdentity),
      team_name: row.teamName,
      player_identity: playerIdentity,
    },
    row,
  };
}

/**
 * No `player_identity` here: for this table the identity IS the key's second
 * half, so the replay reads it from `entity_key` and a payload copy could only
 * ever disagree with it.
 */
function honourTeamRecordPayload(row: HonourTeamMemberRow, extra: Record<string, unknown> = {}) {
  return {
    player_name_raw: row.playerNameRaw,
    position: row.position,
    role: row.role,
    club_name_raw: row.clubNameRaw,
    sort_order: row.sortOrder,
    note: row.note,
    status: row.status,
    status_reason: row.statusReason,
    ...extra,
  };
}

export type CorrectHonourTeamInput = HonourEditBase & {
  fields: HonourTeamCorrection;
  identityAttempt?: Partial<{ teamName: unknown; playerId: unknown; playerNameRaw: unknown }>;
};

export async function correctHonourTeamMember(
  input: CorrectHonourTeamInput,
): Promise<HonourMutationResult> {
  const attempted = Object.keys(input.identityAttempt ?? {});
  if (attempted.length > 0) {
    return refuse('forbidden', identityFieldRefusal(attempted.join(', '), 'selection'));
  }
  const f = input.fields;
  if (Object.keys(f).length === 0) return refuse('validation', 'Nothing was changed.');
  if (f.sortOrder !== undefined
      && (!Number.isInteger(f.sortOrder) || f.sortOrder < 0 || f.sortOrder > 50)) {
    return refuse('validation', 'Lineup order must be a whole number from 0 to 50.');
  }

  return runHonourEdit({
    ...input,
    table: 'honour_team_members',
    fieldGroup: 'honour_team_corrected',
    lock: lockHonourTeamMember,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition',
        'That selection was voided. Voided records are kept for the record and are not '
        + 'maintained; reinstate it first if the row should stand.')
      : null),
    apply: async ({ tx, row }) => {
      const m = row.row;
      const next = {
        position: f.position === undefined ? m.position : (f.position?.trim() || null),
        role: f.role === undefined ? m.role : (f.role?.trim() || null),
        clubNameRaw: f.clubNameRaw === undefined ? m.clubNameRaw : (f.clubNameRaw?.trim() || null),
        sortOrder: f.sortOrder ?? m.sortOrder,
        note: f.note === undefined ? m.note : (f.note?.trim() || null),
      };
      const delta: Record<string, unknown> = {};
      const oldValues: Record<string, unknown> = {};
      const newValues: Record<string, unknown> = {};
      for (const [key, before, after] of [
        ['position', m.position, next.position],
        ['role', m.role, next.role],
        ['club_name_raw', m.clubNameRaw, next.clubNameRaw],
        ['sort_order', m.sortOrder, next.sortOrder],
        ['note', m.note, next.note],
      ] as const) {
        if (before !== after) {
          delta[key] = after;
          oldValues[key] = before;
          newValues[key] = after;
        }
      }

      await tx`
        UPDATE honour_team_members
           SET position = ${next.position},
               role = ${next.role},
               club_name_raw = ${next.clubNameRaw},
               sort_order = ${next.sortOrder}::smallint,
               note = ${next.note},
               updated_at = now()
         WHERE id = ${m.id}
      `;

      return {
        oldValues,
        newValues,
        overrideGroup: isManual(m.sourceKey) ? 'record' : 'correction',
        overridePayload: isManual(m.sourceKey)
          ? honourTeamRecordPayload({ ...m, ...next })
          : delta,
      };
    },
  });
}

export async function voidHonourTeamMember(
  input: VoidHonourInput,
): Promise<HonourMutationResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for voiding this selection.');
  return runHonourEdit({
    ...input,
    table: 'honour_team_members',
    fieldGroup: 'honour_team_voided',
    lock: lockHonourTeamMember,
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That selection is already void.') : null),
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE honour_team_members
           SET status = 'void', status_reason = ${reason}, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'void', status_reason: reason },
        overrideGroup: 'lifecycle',
        overridePayload: { status: 'void', status_reason: reason },
      };
    },
  });
}

export async function reinstateHonourTeamMember(
  input: HonourEditBase,
): Promise<HonourMutationResult> {
  return runHonourEdit({
    ...input,
    table: 'honour_team_members',
    fieldGroup: 'honour_team_reinstated',
    lock: lockHonourTeamMember,
    precheck: async ({ tx, row }) => {
      if (row.status !== 'void') {
        return refuse('invalid_transition', 'That selection is already active.');
      }
      const m = row.row;
      const conflict = await honourTeamCollision(tx, {
        teamName: m.teamName,
        playerId: m.playerId,
        playerName: m.playerNameRaw,
        excludeId: m.id,
      });
      return conflict ? refuse('duplicate', conflict, [m.playerNameRaw]) : null;
    },
    apply: async ({ tx, row }) => {
      await tx`
        UPDATE honour_team_members
           SET status = 'active', status_reason = NULL, updated_at = now()
         WHERE id = ${row.id}
      `;
      return {
        oldValues: { status: row.status, status_reason: row.statusReason },
        newValues: { status: 'active', status_reason: null },
        overrideGroup: 'lifecycle',
        overridePayload: { status: 'active', status_reason: null },
      };
    },
  });
}

/**
 * The AFLDB-ISSUE-080 §4.3/§4.4 collision policy, over ACTIVE rows only.
 *
 * On `(team_name, player_id)` an existing row for the same linked player always
 * collides, whatever its display name. On `(team_name, player_name_raw)` a
 * raw-name match is a collision only while identity is ambiguous or asserted
 * twice: migration 059 stopped treating a raw name as identity, so a second
 * player positively linked to a different id may share a display name and must
 * stay recordable. Voided rows are excluded because they no longer hold the
 * team place — which is what makes a replacement expressible at all.
 *
 * Returns the sentence to refuse with, or null.
 */
async function honourTeamCollision(tx: Tx, input: {
  teamName: string;
  playerId: number | null;
  playerName: string;
  excludeId?: number;
}): Promise<string | null> {
  const existing = await tx<{
    id: number; playerNameRaw: string; playerId: number | null;
  }[]>`
    SELECT id::int AS id, player_name_raw AS "playerNameRaw", player_id AS "playerId"
      FROM honour_team_members
     WHERE team_name = ${input.teamName}
       AND status <> 'void'
       AND id <> ${input.excludeId ?? 0}
       AND (player_name_raw = ${input.playerName}
            OR (${input.playerId}::integer IS NOT NULL
                AND player_id = ${input.playerId}::integer))
     ORDER BY id
  `;
  for (const row of existing) {
    if (input.playerId !== null && row.playerId === input.playerId) {
      return `'${input.teamName}' already records this player as '${row.playerNameRaw}' `
        + `(entry #${row.id}, linked to player #${row.playerId}). It cannot be added again.`;
    }
    if (row.playerNameRaw !== input.playerName) continue;
    if (row.playerId !== null && input.playerId !== null) continue;
    const existingIdentity = row.playerId === null
      ? 'not linked to a player' : `linked to player #${row.playerId}`;
    const proposedIdentity = input.playerId === null
      ? 'not linked to a player' : `linked to player #${input.playerId}`;
    return `'${input.teamName}' already has an entry named '${row.playerNameRaw}' `
      + `(entry #${row.id}, ${existingIdentity}); the new entry is ${proposedIdentity}. `
      + 'Review whether they are the same person before recording it.';
  }
  return null;
}

export type CreateHonourTeamMemberInput = {
  teamName: string;
  playerId?: number | null;
  playerNameRaw?: string | null;
  position?: string | null;
  role?: string | null;
  clubNameRaw?: string | null;
  sortOrder?: number;
  note?: string | null;
  adminUserId: number;
};

async function insertHonourTeamMember(tx: Tx, input: CreateHonourTeamMemberInput & {
  replacesKey?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<{ rowId: number; entityKey: string }> {
  const teamName = input.teamName.trim();
  if (!teamName) throw new RollbackRefusal('validation', 'Team name is required.');
  if (carriesKeySeparator(teamName)) {
    throw new RollbackRefusal('validation',
      'A team name cannot contain "|": the durable key uses it to separate the team from '
      + 'the player identity.');
  }

  let playerName = input.playerNameRaw?.trim() || '';
  let identity: string | null = null;
  if (input.playerId) {
    const [p] = await tx<{ displayName: string }[]>`
      SELECT display_name AS "displayName" FROM players WHERE id = ${input.playerId}
    `;
    if (!p) throw new RollbackRefusal('validation', 'The selected player does not exist.');
    playerName = p.displayName;
    const resolved = await resolvePlayerIdentity(tx, input.playerId);
    if (!resolved.ok) throw new RollbackRefusal('ambiguous_identity', resolved.error);
    identity = resolved.identity;
    if (identity === null) {
      throw new RollbackRefusal('no_durable_key',
        `${playerName} (#${input.playerId}) carries no durable identity, so this selection `
        + 'could not be recorded durably. Reconcile the player identity first.', [playerName]);
    }
  }
  if (!playerName) throw new RollbackRefusal('validation', 'Player name is required.');

  const collision = await honourTeamCollision(tx, {
    teamName, playerId: input.playerId ?? null, playerName,
  });
  if (collision) throw new RollbackRefusal('duplicate', collision, [playerName]);

  const playerIdentity = honourTeamPlayerIdentity(identity, playerName);
  const sourceId = await manualSourceId(tx);
  const entityKey = honourTeamEntityKey(MANUAL_SOURCE_KEY, teamName, playerIdentity);
  await refuseClaimedKey(tx, 'honour_team_members', entityKey);

  const sortOrder = Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0;
  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO honour_team_members (
      team_name, player_id, player_name_raw, link_status_value,
      position, role, club_name_raw, sort_order, note, status, source_id
    ) VALUES (
      ${teamName}, ${input.playerId ?? null}, ${playerName},
      ${input.playerId ? 'resolved' : 'unmatched'}::link_status,
      ${input.position?.trim() || null}, ${input.role?.trim() || null},
      ${input.clubNameRaw?.trim() || null}, ${sortOrder}::smallint,
      ${input.note?.trim() || null}, 'active', ${sourceId}
    )
    RETURNING id::int AS id
  `;
  if (!inserted) throw new RollbackRefusal('failed', 'The honour-team row was not written.');

  const payload: Record<string, unknown> = {
    player_name_raw: playerName,
    position: input.position?.trim() || null,
    role: input.role?.trim() || null,
    club_name_raw: input.clubNameRaw?.trim() || null,
    sort_order: sortOrder,
    note: input.note?.trim() || null,
    status: 'active',
    status_reason: null,
  };
  if (input.replacesKey) payload.replaces_key = input.replacesKey;

  await writeOverride(tx, {
    entityType: 'honour_team_members',
    entityKey,
    fieldGroup: 'record',
    payload,
    adminUserId: input.adminUserId,
  });

  await recordDataEdit(tx, {
    tableName: 'honour_team_members',
    rowId: inserted.id,
    fieldGroup: 'honour_team_created',
    oldValues: {},
    newValues: {
      entity_key: entityKey,
      lineage_identity: honourTeamLineageIdentity(teamName, playerIdentity),
      team_name: teamName,
      player_identity: playerIdentity,
      ...payload,
      ...(input.auditExtra ?? {}),
    },
    adminUserId: input.adminUserId,
    note: input.note,
  });

  return { rowId: inserted.id, entityKey };
}

export async function createHonourTeamMember(
  input: CreateHonourTeamMemberInput,
): Promise<HonourMutationResult> {
  if (input.sortOrder != null && (!Number.isInteger(input.sortOrder)
      || input.sortOrder < 0 || input.sortOrder > 50)) {
    return refuse('validation', 'Lineup order must be a whole number from 0 to 50.');
  }
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        await takeHonourTeamLock(tx as Tx);
        const created = await insertHonourTeamMember(tx as Tx, input);
        return {
          ok: true as const,
          table: 'honour_team_members' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          revalidatePaths: [honourTeamPath(honourTeamSlug(input.teamName.trim()))],
        };
      }) as HonourMutationResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

export type ReplaceHonourTeamInput = HonourEditBase & {
  reason: string;
  replacement: Omit<CreateHonourTeamMemberInput, 'adminUserId'>;
};

export async function replaceHonourTeamMember(
  input: ReplaceHonourTeamInput,
): Promise<HonourMutationResult<HonourReplacementResult>> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for replacing this selection.');
  const replacementId = randomUUID();

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const locked = await lockHonourTeamMember(tx as Tx, input.rowId);
        if (locked === null) return refuse('not_found', 'That selection no longer exists.');
        if (isRefusal(locked)) return locked;
        const row = locked;
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That record changed while this page was open. Reload it and try again.');
        }
        if (row.status !== 'active') {
          return refuse('invalid_transition',
            'That selection is already void, so there is nothing to replace.');
        }

        // Void first so the team place is free: the replacement re-runs the
        // FULL §4.3/§4.4 collision check, which a still-active predecessor
        // would otherwise fail.
        await (tx as Tx)`
          UPDATE honour_team_members
             SET status = 'void', status_reason = ${reason}, updated_at = now()
           WHERE id = ${row.id}
        `;

        const created = await insertHonourTeamMember(tx as Tx, {
          ...input.replacement,
          adminUserId: input.adminUserId,
          replacesKey: row.entityKey,
          auditExtra: { replacement_id: replacementId, replaces: row.entityKey },
        });

        await writeOverride(tx as Tx, {
          entityType: 'honour_team_members',
          entityKey: row.entityKey,
          fieldGroup: 'lifecycle',
          payload: {
            status: 'void', status_reason: reason, replaced_by_key: created.entityKey,
          },
          adminUserId: input.adminUserId,
        });

        await recordDataEdit(tx as Tx, {
          tableName: 'honour_team_members',
          rowId: row.id,
          fieldGroup: 'honour_team_voided',
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
          table: 'honour_team_members' as const,
          rowId: created.rowId,
          entityKey: created.entityKey,
          voidedEntityKey: row.entityKey,
          voidedRowId: row.id,
          replacementId,
          revalidatePaths: row.revalidatePaths,
        };
      }) as HonourMutationResult<HonourReplacementResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}
