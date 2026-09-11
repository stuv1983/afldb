import { randomUUID } from 'node:crypto';

import 'server-only';

import postgres from 'postgres';

import { sql } from '@/db/client';
import {
  isAdministrableListSeason,
  listSeasonBounds,
  readListSeasonBounds,
  type ListSeasonBounds,
} from '@/db/queries/admin-season-lists';
import { recordDataEdit } from '@/db/queries/audit-log';
import { FIRST_LEADERSHIP_SEASON } from '@/db/queries/club-leadership';
import { resolvePlayerIdentity } from '@/db/queries/player-identity';

/**
 * Club leadership administration: THE `club_leadership` mutation contract
 * (AFLDB-ISSUE-163, ISSUE-156 P3e Stage 1).
 *
 * WHAT AN APPOINTMENT MEANS (§4). One `club_leadership` row asserts:
 *
 *     player P was appointed to leadership role R at club identity C for
 *     season S; it is currently held, was held and has ceased, or was
 *     recorded in error and was never valid.
 *
 * It is an administrative fact about an OFFICE. It is not participation, it is
 * not a match-level "captained this game" record, and it is not a property of
 * the person: the same player may hold two appointments, and an appointment
 * outlives every list change around it.
 *
 * CURRENT IS A STATUS, NEVER A CLOCK (§7, §8, D-3). `status = 'active'` is the
 * whole of "currently holds the office". Nothing here compares a date to
 * `now()`: a pre-season appointment usually has no announced date at all, and a
 * rule that read one would flip at midnight, differ by time zone and be
 * untestable. `started_on` / `ended_on` are EVIDENCE, and NULL means genuinely
 * unknown — never 1 January, never the season opener, never today.
 *
 * CO-CAPTAINCY IS A COUNT, NOT A ROLE (§6, D-2). Two or more concurrent active
 * `captain` rows at one club-season ARE co-captains. There is deliberately no
 * `co_captain` role and no "one captain per club" rule — that rule would make
 * co-captaincy unrepresentable, which is the defect this shape avoids. What
 * there IS, is a server-enforced confirmation: appointing a second captain
 * requires `confirmCoCaptaincy`, so a REPLACEMENT can never become a
 * co-captaincy by accident (L-3).
 *
 * THE SEASON-LIST PRECONDITION IS NOT A FOREIGN KEY (§9, D-5). A player is
 * appointable for club C / season S only while they hold C's authoritative S
 * list place, checked here inside the transaction with `FOR KEY SHARE` on the
 * membership row so a concurrent AFLDB-ISSUE-161 removal cannot slip between
 * the check and the write. It governs CURRENT MUTATION ELIGIBILITY only. An
 * appointment row is HISTORICAL VALIDITY and survives any later list
 * correction, transfer or removal — which is why there is no FK (it would
 * either block 161's DELETE or cascade it) and why the replay deliberately does
 * NOT re-check membership (§19). Removing or transferring a member who holds an
 * active appointment stays permitted by 161; the leadership surface warns, and
 * never blocks.
 *
 * HISTORY IS NEVER DELETED (§12, D-7). There is no hard-delete path and no
 * tombstone. `ended` preserves a real appointment that ceased; `void` preserves
 * a row that should never have existed. Both keep the row so its `data_edits`
 * audit rows stay resolvable through `appointment_key` at the next promotion
 * lineage remap — the AFLDB-ISSUE-162 reasoning, for the same reason.
 *
 * IDENTITY IS MINTED AND IMMUTABLE (§5, D-8). `appointment_key` is a
 * `randomUUID()` minted once here and never edited, and it is never in any SET
 * list. Every candidate natural key either recurs (a player re-appointed later
 * in the same season is a second, different appointment) or is mutable (dates,
 * role, reason, note). The durable `data_overrides` payload names the club by
 * SLUG and the player by IDENTITY STRING — never by id, which a promotion
 * renumbers, and never by a display name, which decides nothing anywhere in
 * AFLDB.
 *
 * TRANSACTIONS (§13). Every mutation is one `AFLDB_IMPORT_DATABASE_URL`
 * transaction: canonical write(s) + `data_overrides` + `recordDataEdit()`, all
 * or nothing. Preconditions are checked BEFORE the first write. A refusal
 * discovered after a write has happened is thrown as a `RollbackRefusal`, never
 * returned — `postgres.js` commits when the `begin()` callback RESOLVES, so a
 * plain `return refuse(...)` past the first write would commit a half-done,
 * partly-unaudited mutation while reporting failure.
 *
 * CAPTAINCIES IS NOT TOUCHED (§3). The Wikipedia honours import remains the
 * historical source for seasons below `FIRST_LEADERSHIP_SEASON`, and nothing
 * here reads, writes or keys against it. The public projections join the two by
 * a hard season boundary (`src/db/queries/club-leadership.ts`), so no season is
 * ever answered by both.
 *
 * REVALIDATION IS RETURNED, NEVER PERFORMED (§21, D-13, the S-6 rule). No
 * mutation calls `revalidatePath`. Each returns `revalidatePaths` — the public
 * club paths of the affected ORGANISATION, computed server-side from club ids
 * the browser never supplied — and the Stage 2 action layer hands them to the
 * capability-gated revalidate route after the action resolves.
 */

type Tx = postgres.TransactionSql;

// --- vocabulary ----------------------------------------------------------

export const LEADERSHIP_ENTITY_TYPE = 'club_leadership';
export const LEADERSHIP_FIELD_GROUP = 'appointment';
export const LEADERSHIP_SOURCE_KEY = 'manual_admin_edit';

/**
 * The closed role vocabulary (migration 098, D-2). `co_captain` is deliberately
 * absent: the office is "captain" and co-captaincy is the plural of it.
 */
export const LEADERSHIP_ROLES = ['captain', 'vice_captain'] as const;
export type LeadershipRole = (typeof LEADERSHIP_ROLES)[number];

/** The lifecycle (migration 098, D-3/D-7). No DELETE state exists. */
export const LEADERSHIP_STATUSES = ['active', 'ended', 'void'] as const;
export type LeadershipStatus = (typeof LEADERSHIP_STATUSES)[number];

export function isLeadershipRole(value: unknown): value is LeadershipRole {
  return typeof value === 'string' && (LEADERSHIP_ROLES as readonly string[]).includes(value);
}

export function isLeadershipStatus(value: unknown): value is LeadershipStatus {
  return typeof value === 'string' && (LEADERSHIP_STATUSES as readonly string[]).includes(value);
}

/**
 * The first season leadership may be administered for — RE-EXPORTED, never
 * re-declared. `src/db/queries/club-leadership.ts` owns the one declaration
 * (itself derived from `FIRST_LIST_SEASON`), because the same number is the
 * public source boundary between `captaincies` and this table, and two
 * declarations of a boundary are two ways for it to drift.
 *
 * The floor is ENFORCED by `readListSeasonBounds()` — the season-list window —
 * rather than by comparing against this constant, which is what makes
 * "leadership can never precede the lists" structural. This value is the
 * boundary and the wording of a refusal.
 */
export { FIRST_LEADERSHIP_SEASON };

/** The `data_edits.field_group` of every leadership mutation (§15). */
export type LeadershipFieldGroup =
  | 'leadership_appointed'
  | 'leadership_ended'
  | 'leadership_reinstated'
  | 'leadership_corrected'
  | 'leadership_voided';

// --- entity_key shape (§5) -----------------------------------------------

/**
 * The durable key of one appointment. Mirrors the decode in
 * `tools/migration/common.py`'s `replay_admin_overrides('club_leadership')`;
 * the two must never be able to disagree about what a key means.
 *
 * A MINTED TOKEN, like AFLDB-ISSUE-162's fixture key and unlike
 * AFLDB-ISSUE-161's natural membership key — see the module header and the
 * `appointment_key` column comment in migration 098.
 */
export function leadershipEntityKey(appointmentKey: string): string {
  return `${LEADERSHIP_SOURCE_KEY}:${appointmentKey}`;
}

/** The inverse of {@link leadershipEntityKey}, or null when the key is not one. */
export function parseLeadershipEntityKey(key: string): string | null {
  const prefix = `${LEADERSHIP_SOURCE_KEY}:`;
  if (!key.startsWith(prefix)) return null;
  const token = key.slice(prefix.length);
  return token.length > 0 ? token : null;
}

// --- season bounds (§10) -------------------------------------------------

export type LeadershipSeasonBounds = ListSeasonBounds;

/**
 * The seasons whose leadership may be administered — IDENTICAL to the
 * season-list window, reused rather than copied, so the two can never drift
 * into a state where a club's list may be administered for a season its
 * leadership may not, or the reverse.
 */
export function leadershipSeasonBounds(maxSeasonYear: number | null): LeadershipSeasonBounds {
  return listSeasonBounds(maxSeasonYear);
}

export function isAdministrableLeadershipSeason(
  season: number, bounds: LeadershipSeasonBounds,
): boolean {
  return isAdministrableListSeason(season, bounds);
}

function seasonBoundError(season: number, bounds: LeadershipSeasonBounds): string {
  if (bounds.first > bounds.last) {
    return 'No leadership can be administered yet: the season register is empty.';
  }
  if (season < bounds.first) {
    return `${season} is before ${FIRST_LEADERSHIP_SEASON}, the first season AFLDB holds `
      + 'authoritative club leadership for. Earlier captains are the historical honours record.';
  }
  return `${season} is beyond ${bounds.last}, the latest season leadership may be administered `
    + 'for. The season register has to advance first.';
}

// --- date validation (§7, L-5) -------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * True only for a `YYYY-MM-DD` string that names a REAL Gregorian calendar day.
 *
 * The shape test is not enough and `Date.parse()` is not a calendar check: it
 * NORMALISES impossible days rather than rejecting them, so `2027-02-30` parses
 * — as 2 March — and an appointment would carry a date that does not exist, or
 * be silently moved to one that does. This is the AFLDB-ISSUE-162 §37.8 lesson
 * and the same arithmetic `parseAuditDate()` uses: build the day in UTC and
 * require all three components to survive.
 *
 * `Date.UTC` is CALENDAR ARITHMETIC ONLY. Nothing here converts a time zone,
 * and the value stored is the operator's string unchanged: these are AFL local
 * calendar facts, never instants.
 */
function isRealCalendarDate(value: string): boolean {
  const parts = ISO_DATE.exec(value);
  if (!parts) return false;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const utc = new Date(Date.UTC(year, month - 1, day));
  return utc.getUTCFullYear() === year
    && utc.getUTCMonth() === month - 1
    && utc.getUTCDate() === day;
}

export type LeadershipDatesInput = { startedOn?: string | null; endedOn?: string | null };
export type NormalisedLeadershipDates = { startedOn: string | null; endedOn: string | null };

/**
 * NULL means genuinely unknown (D-3). A blank field is an unknown date, not an
 * invitation to invent one, and the interval rule is the same one migration
 * 098 carries as `club_leadership_dates_ck` so no writer, replay or future
 * importer can bypass it.
 */
export function normaliseLeadershipDates(
  input: LeadershipDatesInput,
): NormalisedLeadershipDates | { error: string } {
  const started = (input.startedOn ?? '').trim();
  const ended = (input.endedOn ?? '').trim();
  for (const [label, value] of [['start', started], ['end', ended]] as const) {
    if (!value) continue;
    if (!ISO_DATE.test(value)) {
      return { error: `Enter the ${label} date as YYYY-MM-DD, or leave it blank if it is unknown.` };
    }
    if (!isRealCalendarDate(value)) return { error: `${value} is not a real date.` };
  }
  if (started && ended && ended < started) {
    return { error: 'The end date is before the start date.' };
  }
  return { startedOn: started || null, endedOn: ended || null };
}

// --- results (§14) -------------------------------------------------------

export type LeadershipRefusalReason =
  | 'validation'
  | 'not_found'
  | 'stale'
  | 'not_listed'
  | 'duplicate_active'
  | 'co_captaincy_unconfirmed'
  | 'invalid_transition'
  | 'invalid_dates'
  | 'forbidden'
  | 'ambiguous_identity'
  | 'conflict'
  | 'failed';

export type LeadershipRefusal = {
  ok: false;
  error: string;
  reason: LeadershipRefusalReason;
  /** The players or clubs a refusal is ABOUT, so a caller need not parse the sentence. */
  subjects?: string[];
};

export type LeadershipMutationResult<T> = ({ ok: true } & T) | LeadershipRefusal;

/** What every successful mutation returns on top of its own payload (§21). */
export type LeadershipMutationEnvelope = {
  appointmentKey: string;
  /**
   * The public club paths a successful mutation invalidates — every identity of
   * the affected organisation. Computed SERVER-SIDE from the appointment's own
   * club id; never client-supplied, and never revalidated from here (D-13).
   */
  revalidatePaths: string[];
};

function refuse(
  reason: LeadershipRefusalReason, error: string, subjects?: string[],
): LeadershipRefusal {
  return subjects?.length ? { ok: false, error, reason, subjects } : { ok: false, error, reason };
}

/**
 * A refusal discovered AFTER this transaction has already written something.
 *
 * `postgres.js` commits when the `begin()` callback RESOLVES and rolls back only
 * when it REJECTS, so returning a refusal past the first write would commit the
 * half-done mutation while reporting failure — an unaudited canonical write.
 * Throwing rolls the transaction back, and the mutation's own `catch` turns it
 * back into exactly the refusal the caller would otherwise have received.
 *
 * The AFLDB-ISSUE-160 pattern, used here for EVERY post-write refusal without
 * exception.
 */
class RollbackRefusal extends Error {
  constructor(
    readonly reason: LeadershipRefusalReason,
    readonly detail: string,
    readonly subjects: string[] = [],
  ) {
    super(detail);
    this.name = 'RollbackRefusal';
  }
}

/** The refusal a `RollbackRefusal` carried, or null for a genuine failure. */
function rolledBackRefusal(error: unknown): LeadershipRefusal | null {
  return error instanceof RollbackRefusal
    ? refuse(error.reason, error.detail, error.subjects)
    : null;
}

function mutationFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `The appointment could not be changed: ${message}`;
}

// --- the narrow SELECT-only import-role helper (ISSUE-159 D-2 precedent) --

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

// --- club resolution (§10) -----------------------------------------------

type ResolvedLeadershipClub = {
  id: number;
  slug: string;
  name: string;
  organizationId: number;
  eligible: boolean;
};

/**
 * Resolve a club slug and say whether that identity may be administered in the
 * season — through `afldb_season_list_clubs()`, the ONE eligibility rule
 * migration 096 introduced and AFLDB-ISSUE-162 reused. There is deliberately no
 * second future-club rule anywhere in this issue.
 */
async function resolveClub(
  tx: Tx, clubSlug: string, season: number,
): Promise<ResolvedLeadershipClub | null> {
  const [row] = await tx<ResolvedLeadershipClub[]>`
    SELECT c.id, c.slug, c.name, c.organization_id AS "organizationId",
           EXISTS (SELECT 1 FROM afldb_season_list_clubs(${season}::smallint) e WHERE e.id = c.id)
             AS eligible
      FROM clubs c
     WHERE c.slug = ${clubSlug}
  `;
  return row ?? null;
}

function ineligibleClubError(club: { name: string }, season: number): string {
  return `${club.name} is not a club whose leadership may be administered for ${season}. `
    + 'Choose one of the identities competing in that season.';
}

/**
 * The public paths one club's leadership change invalidates: `/clubs/<slug>`
 * for EVERY identity of that organisation (§21, D-13).
 *
 * Every identity, because the continuing identity carries the current
 * leadership block while each era page carries the Captains history table that
 * the season-boundary union changes. Typically one to three paths; never every
 * club, never a layout, never `/`.
 */
export async function clubPublicPaths(
  db: postgres.Sql | Tx, clubId: number,
): Promise<string[]> {
  const rows = await (db as postgres.Sql)<{ slug: string }[]>`
    SELECT slug FROM clubs
     WHERE organization_id = (SELECT organization_id FROM clubs WHERE id = ${clubId})
     ORDER BY slug
  `;
  return rows.map((row) => `/clubs/${row.slug}`);
}

// --- the canonical row ---------------------------------------------------

export type LeadershipRow = {
  id: number;
  appointmentKey: string;
  season: number;
  clubId: number;
  clubSlug: string;
  clubName: string;
  organizationId: number;
  playerId: number;
  playerSlug: string;
  displayName: string;
  role: LeadershipRole;
  status: LeadershipStatus;
  statusReason: string | null;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

const LEADERSHIP_COLUMNS = `
  l.id::int AS id, l.appointment_key AS "appointmentKey", l.season::int AS season,
  l.club_id AS "clubId", c.slug AS "clubSlug", c.name AS "clubName",
  c.organization_id AS "organizationId",
  l.player_id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName",
  l.role AS role, l.status AS status, l.status_reason AS "statusReason",
  l.started_on::text AS "startedOn", l.ended_on::text AS "endedOn", l.note AS note,
  l.created_at::text AS "createdAt", l.updated_at::text AS "updatedAt"`;

const LEADERSHIP_JOINS = `
  FROM club_leadership l
  JOIN clubs c ON c.id = l.club_id
  JOIN players p ON p.id = l.player_id`;

/**
 * Lock one appointment for update and read it back whole.
 *
 * `FOR UPDATE` is taken on `club_leadership` alone: the clubs and players joins
 * are lookups, and `FOR UPDATE OF` an outer relation is not permitted.
 */
async function lockAppointment(tx: Tx, appointmentKey: string): Promise<LeadershipRow | null> {
  const [locked] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM club_leadership
     WHERE appointment_key = ${appointmentKey} FOR UPDATE
  `;
  if (!locked) return null;
  const rows = await tx.unsafe(
    `SELECT ${LEADERSHIP_COLUMNS} ${LEADERSHIP_JOINS} WHERE l.id = $1`, [locked.id],
  ) as unknown as LeadershipRow[];
  return rows[0] ?? null;
}

/** The `manual_admin_edit` source every AFLDB-ISSUE-163 row is written under. */
async function manualSourceId(tx: Tx): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    SELECT id FROM sources WHERE key = ${LEADERSHIP_SOURCE_KEY}
  `;
  if (!row) throw new Error(`Required source '${LEADERSHIP_SOURCE_KEY}' is not configured.`);
  return row.id;
}

// --- the player subject (§9, L-8, L-11) ----------------------------------

type PlayerSubject = {
  id: number;
  displayName: string;
  identity: string;
};

/**
 * Re-read the player server-side, resolve the durable identity their override
 * payload will carry, and confirm they hold this club's list place for this
 * season — with the membership row LOCKED `FOR KEY SHARE`, so a concurrent
 * AFLDB-ISSUE-161 removal of it cannot commit between this check and the
 * appointment write.
 *
 * `FOR KEY SHARE` rather than `FOR UPDATE` on purpose: it is the weakest lock
 * that blocks a DELETE of the row, and it does not block another reader taking
 * the same lock — two clubs appointing leaders concurrently must not serialise
 * on each other.
 *
 * An identity-less legacy player is REFUSED rather than given a minted one:
 * minting an identity is a player-lifecycle decision belonging to the draft and
 * adopt actions (AFLDB-ISSUE-160 §6.8), exactly as season-list administration
 * refuses it. An appointment recorded against a player with no durable identity
 * could not survive a rebuild.
 *
 * NAMES NEVER DECIDE (L-11). Nothing here reads a display name to find anyone;
 * the name is read only so a refusal can say who it is about.
 */
async function resolveAppointableSubject(tx: Tx, input: {
  playerId: number; season: number; club: { id: number; name: string };
}): Promise<{ ok: true; player: PlayerSubject } | LeadershipRefusal> {
  const [player] = await tx<{ id: number; displayName: string }[]>`
    SELECT id, display_name AS "displayName" FROM players WHERE id = ${input.playerId}
  `;
  if (!player) return refuse('not_found', `No player with id ${input.playerId}.`);

  const resolved = await resolvePlayerIdentity(tx, player.id);
  if (!resolved.ok) return refuse(resolved.reason, resolved.error);
  if (resolved.identity === null) {
    return refuse('conflict',
      `${player.displayName} (#${player.id}) carries no durable identity, so an appointment `
      + 'recorded against them could not survive a rebuild. Attach an AFL Tables identity, or '
      + 'adopt the player through the draft administration screen, before appointing them.',
      [player.displayName]);
  }

  // L-8. The lock is the point: it blocks a concurrent AFLDB-ISSUE-161 DELETE
  // of this membership until the appointment commits.
  const [membership] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM season_list_members
     WHERE season = ${input.season}::smallint
       AND club_id = ${input.club.id}
       AND player_id = ${player.id}
     FOR KEY SHARE
  `;
  if (!membership) {
    const [elsewhere] = await tx<{ clubName: string; clubSlug: string }[]>`
      SELECT c.name AS "clubName", c.slug AS "clubSlug"
        FROM season_list_members m
        JOIN clubs c ON c.id = m.club_id
       WHERE m.season = ${input.season}::smallint AND m.player_id = ${player.id}
    `;
    return refuse('not_listed',
      elsewhere
        ? `${player.displayName} is on ${elsewhere.clubName}'s ${input.season} list, not `
          + `${input.club.name}'s. Leadership is appointed from the club's own list.`
        : `${player.displayName} is not on ${input.club.name}'s ${input.season} list. `
          + 'Add them to the list first — an appointment is made from the list, never around it.',
      [player.displayName]);
  }

  return {
    ok: true,
    player: { id: player.id, displayName: player.displayName, identity: resolved.identity },
  };
}

/**
 * L-2. The active appointment this player already holds for this season, if
 * any — checked before any write so the common case is a plain refusal that
 * names the role and club rather than a constraint violation.
 *
 * `ux_club_leadership_active_player` is the backstop for the race this check
 * cannot see.
 */
async function activeAppointmentFor(tx: Tx, input: {
  season: number; playerId: number; excludeId?: number;
}): Promise<{ role: LeadershipRole; clubName: string } | null> {
  const [row] = await tx<{ role: LeadershipRole; clubName: string }[]>`
    SELECT l.role, c.name AS "clubName"
      FROM club_leadership l
      JOIN clubs c ON c.id = l.club_id
     WHERE l.season = ${input.season}::smallint
       AND l.player_id = ${input.playerId}
       AND l.status = 'active'
       AND l.id <> ${input.excludeId ?? 0}
     LIMIT 1
  `;
  return row ?? null;
}

function duplicateActiveError(
  player: { displayName: string }, existing: { role: LeadershipRole; clubName: string },
  season: number,
): string {
  const role = existing.role === 'captain' ? 'captain' : 'vice-captain';
  return `${player.displayName} is already the active ${season} ${role} at ${existing.clubName}. `
    + 'End that appointment before recording another one.';
}

/**
 * L-3. The sitting captains of a club-season, so a second captain appointment
 * is a DELIBERATE co-captaincy rather than an accident.
 *
 * This is the only cardinality rule leadership has, and it is a confirmation,
 * not a limit: co-captains are permitted without count, and so are multiple
 * vice-captains (L-4, no confirmation at all — clubs routinely name two or
 * three and nobody means "replace" by it).
 */
async function sittingCaptains(tx: Tx, input: {
  season: number; clubId: number; excludeId?: number;
}): Promise<string[]> {
  const rows = await tx<{ displayName: string }[]>`
    SELECT p.display_name AS "displayName"
      FROM club_leadership l
      JOIN players p ON p.id = l.player_id
     WHERE l.season = ${input.season}::smallint
       AND l.club_id = ${input.clubId}
       AND l.role = 'captain'
       AND l.status = 'active'
       AND l.id <> ${input.excludeId ?? 0}
     ORDER BY p.display_name
  `;
  return rows.map((row) => row.displayName);
}

// --- the durable record (§5, §19) ----------------------------------------

export type LeadershipOverridePayload = {
  appointment_key: string;
  club_slug: string;
  season: number;
  player_identity: string;
  role: LeadershipRole;
  status: LeadershipStatus;
  started_on: string | null;
  ended_on: string | null;
  status_reason?: string;
  note?: string;
  replaces_appointment_key?: string;
  replaced_by_appointment_key?: string;
};

/**
 * The whole-row durable payload. A club SLUG and a player IDENTITY STRING,
 * never ids: ids are renumbered by a promotion, slugs are tracked reference
 * data, and the identity is what the AFLDB-ISSUE-160 players replay resolves.
 * A display name appears nowhere.
 *
 * Keys carrying no value are OMITTED rather than written as null — an absent
 * key and an explicit null are different things to the replay — while the two
 * DATES are written as explicit nulls, because for those the null IS the fact
 * ("the date is unknown", D-3).
 */
export function leadershipOverridePayload(row: {
  appointmentKey: string;
  clubSlug: string;
  season: number;
  playerIdentity: string;
  role: LeadershipRole;
  status: LeadershipStatus;
  startedOn: string | null;
  endedOn: string | null;
  statusReason?: string | null;
  note?: string | null;
  replacesAppointmentKey?: string | null;
  replacedByAppointmentKey?: string | null;
}): LeadershipOverridePayload {
  const payload: LeadershipOverridePayload = {
    appointment_key: row.appointmentKey,
    club_slug: row.clubSlug,
    season: row.season,
    player_identity: row.playerIdentity,
    role: row.role,
    status: row.status,
    started_on: row.startedOn,
    ended_on: row.endedOn,
  };
  const reason = (row.statusReason ?? '').trim();
  if (reason) payload.status_reason = reason;
  const note = (row.note ?? '').trim();
  if (note) payload.note = note;
  if (row.replacesAppointmentKey) payload.replaces_appointment_key = row.replacesAppointmentKey;
  if (row.replacedByAppointmentKey) {
    payload.replaced_by_appointment_key = row.replacedByAppointmentKey;
  }
  return payload;
}

/**
 * Write (or rewrite) the durable record for one appointment.
 *
 * `is_active` is ALWAYS true: the lifecycle lives in the payload's `status`,
 * because an ENDED or VOID appointment must be RE-CREATED by the replay rather
 * than suppressed by it — otherwise its `data_edits` rows become unresolvable
 * at the next promotion lineage remap. This is the AFLDB-ISSUE-162 shape, not
 * AFLDB-ISSUE-161's tombstone: there is no DELETE here to tombstone.
 */
async function writeLeadershipOverride(
  tx: Tx, payload: LeadershipOverridePayload, adminUserId: number,
): Promise<void> {
  await tx`
    INSERT INTO data_overrides
          (entity_type, entity_key, field_group, override_values, admin_user_id, is_active, updated_at)
    VALUES (${LEADERSHIP_ENTITY_TYPE}, ${leadershipEntityKey(payload.appointment_key)},
            ${LEADERSHIP_FIELD_GROUP},
            ${tx.json(payload as unknown as postgres.JSONValue)}, ${adminUserId}, true, now())
    ON CONFLICT (entity_type, entity_key, field_group) DO UPDATE
       SET override_values = EXCLUDED.override_values,
           is_active = true,
           admin_user_id = EXCLUDED.admin_user_id,
           updated_at = now()
  `;
}

/**
 * The identifying facts every audit row carries inside `new_values`, so an
 * entry is readable without joining anything (§15).
 */
function auditIdentity(row: {
  appointmentKey: string; season: number; clubSlug: string;
  playerIdentity: string; role: LeadershipRole;
}): Record<string, unknown> {
  return {
    appointment_key: row.appointmentKey,
    season: row.season,
    club_slug: row.clubSlug,
    player_identity: row.playerIdentity,
    role: row.role,
    entity_key: leadershipEntityKey(row.appointmentKey),
  };
}

/**
 * Insert one appointment: canonical row, durable override, audit row. Both
 * callers (appoint, and the incoming half of a replace) go through here, so the
 * three writes cannot come apart in one path and not another.
 */
async function insertAppointment(tx: Tx, input: {
  season: number;
  club: { id: number; slug: string };
  player: PlayerSubject;
  role: LeadershipRole;
  startedOn: string | null;
  note: string | null;
  sourceId: number;
  adminUserId: number;
  replacesAppointmentKey?: string | null;
  auditExtra?: Record<string, unknown>;
}): Promise<{ appointmentId: number; appointmentKey: string }> {
  const appointmentKey = randomUUID();

  // Defensive. randomUUID() colliding is not a real event, but a token that
  // already named an appointment would silently retarget one.
  const [existing] = await tx<{ id: number }[]>`
    SELECT id::int AS id FROM club_leadership WHERE appointment_key = ${appointmentKey}
  `;
  if (existing) {
    throw new RollbackRefusal('conflict',
      'An appointment identity collided. Nothing was written; try again.');
  }

  const [inserted] = await tx<{ id: number }[]>`
    INSERT INTO club_leadership
          (appointment_key, season, club_id, player_id, role, status,
           started_on, note, source_id, source_record_id)
    VALUES (${appointmentKey}, ${input.season}::smallint, ${input.club.id}, ${input.player.id},
            ${input.role}, 'active', ${input.startedOn}::date, ${input.note},
            ${input.sourceId}, ${appointmentKey})
    RETURNING id::int AS id
  `;
  if (!inserted) throw new RollbackRefusal('failed', 'The appointment row was not written.');

  const payload = leadershipOverridePayload({
    appointmentKey,
    clubSlug: input.club.slug,
    season: input.season,
    playerIdentity: input.player.identity,
    role: input.role,
    status: 'active',
    startedOn: input.startedOn,
    endedOn: null,
    note: input.note,
    replacesAppointmentKey: input.replacesAppointmentKey,
  });
  await writeLeadershipOverride(tx, payload, input.adminUserId);

  await recordDataEdit(tx, {
    tableName: 'club_leadership',
    rowId: inserted.id,
    fieldGroup: 'leadership_appointed',
    oldValues: {},
    newValues: { ...payload, ...(input.auditExtra ?? {}) },
    adminUserId: input.adminUserId,
    note: input.note,
  });

  return { appointmentId: inserted.id, appointmentKey };
}

// --- appoint (§12) -------------------------------------------------------

export type AppointLeaderInput = {
  season: number;
  clubSlug: string;
  playerId: number;
  role: LeadershipRole;
  adminUserId: number;
  startedOn?: string | null;
  note?: string | null;
  /**
   * L-3. Required when a captain is already active at this club-season and the
   * new appointment is also a captain — so a co-captaincy is always a decision
   * and never the residue of someone who meant to REPLACE the sitting captain.
   */
  confirmCoCaptaincy?: boolean;
};

export async function appointLeader(
  input: AppointLeaderInput,
): Promise<LeadershipMutationResult<LeadershipMutationEnvelope & { appointmentId: number }>> {
  if (!isLeadershipRole(input.role)) {
    return refuse('validation', 'Choose a leadership role.');
  }
  const dates = normaliseLeadershipDates({ startedOn: input.startedOn });
  if ('error' in dates) return refuse('invalid_dates', dates.error);

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const bounds = await readListSeasonBounds(tx as unknown as typeof sql);
        if (!isAdministrableLeadershipSeason(input.season, bounds)) {
          return refuse('validation', seasonBoundError(input.season, bounds));
        }

        const club = await resolveClub(tx, input.clubSlug, input.season);
        if (!club) return refuse('validation', `No club with the identifier "${input.clubSlug}".`);
        if (!club.eligible) return refuse('validation', ineligibleClubError(club, input.season));

        const subject = await resolveAppointableSubject(tx, {
          playerId: input.playerId, season: input.season, club,
        });
        if (!subject.ok) return subject;

        const existing = await activeAppointmentFor(tx, {
          season: input.season, playerId: input.playerId,
        });
        if (existing) {
          return refuse('duplicate_active',
            duplicateActiveError(subject.player, existing, input.season),
            [subject.player.displayName]);
        }

        if (input.role === 'captain' && !input.confirmCoCaptaincy) {
          const sitting = await sittingCaptains(tx, { season: input.season, clubId: club.id });
          if (sitting.length) {
            return refuse('co_captaincy_unconfirmed',
              `${club.name} already has an active ${input.season} captain: ${sitting.join(', ')}. `
              + 'Confirm a co-captaincy to appoint alongside them, or replace the sitting '
              + 'captain instead.', sitting);
          }
        }

        const sourceId = await manualSourceId(tx);
        const paths = await clubPublicPaths(tx, club.id);

        // Everything above refused before a write. From here, any refusal throws.
        const written = await insertAppointment(tx, {
          season: input.season,
          club,
          player: subject.player,
          role: input.role,
          startedOn: dates.startedOn,
          note: (input.note ?? '').trim() || null,
          sourceId,
          adminUserId: input.adminUserId,
        });
        return { ok: true as const, ...written, revalidatePaths: paths };
      }) as LeadershipMutationResult<LeadershipMutationEnvelope & { appointmentId: number }>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- the shared edit transaction (§12, §13) ------------------------------

export type LeadershipEditBase = {
  appointmentKey: string;
  /** The `updatedAt` the form rendered. Per-row compare-and-swap. */
  expectedUpdatedAt: string;
  adminUserId: number;
  note?: string | null;
};

type LeadershipFieldUpdates = Partial<{
  status: LeadershipStatus;
  statusReason: string | null;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
}>;

type EditResult = LeadershipMutationResult<LeadershipMutationEnvelope>;

/**
 * Lock, compare-and-swap, gate, apply, rewrite the durable record, audit — one
 * transaction, in that order.
 *
 * `apply` runs AFTER every precondition, so a refusal inside it is a post-write
 * refusal and must throw, never return. Role, player, club and season are
 * absent from `LeadershipFieldUpdates` deliberately: they are NOT correctable
 * (§12). A wrong one is a `void` plus a new appointment — two honest records
 * rather than one record quietly becoming a different assertion.
 */
async function editAppointment(input: LeadershipEditBase & {
  fieldGroup: LeadershipFieldGroup;
  /** Preconditions that do not depend on a write. Refuse from here, not from `apply`. */
  precheck?: (ctx: { tx: Tx; row: LeadershipRow }) => Promise<LeadershipRefusal | null>;
  apply: (ctx: { tx: Tx; row: LeadershipRow }) => Promise<{
    updates: LeadershipFieldUpdates;
    oldValues: Record<string, unknown>;
    newValues: Record<string, unknown>;
  }>;
}): Promise<EditResult> {
  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const row = await lockAppointment(tx, input.appointmentKey);
        if (!row) return refuse('not_found', 'That appointment no longer exists.');
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That appointment changed while this page was open. Reload it and try again.');
        }

        if (input.precheck) {
          const refusal = await input.precheck({ tx, row });
          if (refusal) return refusal;
        }

        const identity = await resolvePlayerIdentity(tx, row.playerId);
        if (!identity.ok) return refuse(identity.reason, identity.error);
        if (identity.identity === null) {
          return refuse('conflict',
            `${row.displayName} (#${row.playerId}) no longer carries a durable identity, so this `
            + 'appointment could not be recorded durably. Reconcile the player identity first.',
            [row.displayName]);
        }

        const paths = await clubPublicPaths(tx, row.clubId);

        // Everything above refused before a write. From here, any refusal throws.
        const applied = await input.apply({ tx, row });
        const u = applied.updates;
        const next = {
          status: u.status ?? row.status,
          statusReason: u.statusReason === undefined ? row.statusReason : u.statusReason,
          startedOn: u.startedOn === undefined ? row.startedOn : u.startedOn,
          endedOn: u.endedOn === undefined ? row.endedOn : u.endedOn,
          note: u.note === undefined ? row.note : u.note,
        };

        await tx`
          UPDATE club_leadership
             SET status = ${next.status},
                 status_reason = ${next.statusReason},
                 started_on = ${next.startedOn}::date,
                 ended_on = ${next.endedOn}::date,
                 note = ${next.note},
                 updated_at = now()
           WHERE id = ${row.id}
        `;

        const payload = leadershipOverridePayload({
          appointmentKey: row.appointmentKey,
          clubSlug: row.clubSlug,
          season: row.season,
          playerIdentity: identity.identity,
          role: row.role,
          status: next.status,
          startedOn: next.startedOn,
          endedOn: next.endedOn,
          statusReason: next.statusReason,
          note: next.note,
        });
        await writeLeadershipOverride(tx, payload, input.adminUserId);

        await recordDataEdit(tx, {
          tableName: 'club_leadership',
          rowId: row.id,
          fieldGroup: input.fieldGroup,
          oldValues: applied.oldValues,
          newValues: {
            ...auditIdentity({
              appointmentKey: row.appointmentKey,
              season: row.season,
              clubSlug: row.clubSlug,
              playerIdentity: identity.identity,
              role: row.role,
            }),
            ...applied.newValues,
          },
          adminUserId: input.adminUserId,
          note: input.note,
        });

        return { ok: true as const, appointmentKey: row.appointmentKey, revalidatePaths: paths };
      }) as EditResult;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- end / reinstate / correct / void (§12, L-14) ------------------------

export type EndAppointmentInput = LeadershipEditBase & {
  endedOn?: string | null;
  reason?: string | null;
};

/**
 * The office ceased. A VALID historical appointment that finished — which is
 * why the row is kept, not deleted, and why this is not `void`.
 *
 * `endedOn` is optional: a captain who stepped down on a date nobody recorded
 * is an ordinary state, and NULL says so honestly rather than inventing the day
 * the operator happened to type it in.
 */
export async function endAppointment(input: EndAppointmentInput): Promise<EditResult> {
  const reason = (input.reason ?? '').trim() || null;
  return editAppointment({
    ...input,
    fieldGroup: 'leadership_ended',
    precheck: async ({ row }) => {
      if (row.status !== 'active') {
        return refuse('invalid_transition',
          `That appointment is ${row.status}, so there is nothing to end.`);
      }
      const dates = normaliseLeadershipDates({
        startedOn: row.startedOn, endedOn: input.endedOn,
      });
      if ('error' in dates) return refuse('invalid_dates', dates.error);
      return null;
    },
    apply: async ({ row }) => {
      const dates = normaliseLeadershipDates({
        startedOn: row.startedOn, endedOn: input.endedOn,
      });
      if ('error' in dates) throw new RollbackRefusal('invalid_dates', dates.error);
      return {
        updates: { status: 'ended', endedOn: dates.endedOn, statusReason: reason },
        oldValues: { status: row.status, ended_on: row.endedOn, status_reason: row.statusReason },
        newValues: { status: 'ended', ended_on: dates.endedOn, status_reason: reason },
      };
    },
  });
}

/**
 * An end entered in error. The appointment goes back to `active` and its end
 * date is cleared — an active row may not carry one (L-6) — and the
 * appointability preconditions run again, because reinstating is a new
 * assertion that the player holds the office NOW.
 */
export async function reinstateAppointment(
  input: LeadershipEditBase & { confirmCoCaptaincy?: boolean },
): Promise<EditResult> {
  return editAppointment({
    ...input,
    fieldGroup: 'leadership_reinstated',
    precheck: async ({ tx, row }) => {
      if (row.status !== 'ended') {
        return refuse('invalid_transition',
          row.status === 'void'
            ? 'That appointment was voided as a data-entry error. Voided appointments are kept '
              + 'for the record and are not reinstated; record a new appointment instead.'
            : 'That appointment is already active.');
      }
      const bounds = await readListSeasonBounds(tx as unknown as typeof sql);
      if (!isAdministrableLeadershipSeason(row.season, bounds)) {
        return refuse('validation', seasonBoundError(row.season, bounds));
      }
      const subject = await resolveAppointableSubject(tx, {
        playerId: row.playerId,
        season: row.season,
        club: { id: row.clubId, name: row.clubName },
      });
      if (!subject.ok) return subject;

      const existing = await activeAppointmentFor(tx, {
        season: row.season, playerId: row.playerId, excludeId: row.id,
      });
      if (existing) {
        return refuse('duplicate_active',
          duplicateActiveError(subject.player, existing, row.season),
          [subject.player.displayName]);
      }

      if (row.role === 'captain' && !input.confirmCoCaptaincy) {
        const sitting = await sittingCaptains(tx, {
          season: row.season, clubId: row.clubId, excludeId: row.id,
        });
        if (sitting.length) {
          return refuse('co_captaincy_unconfirmed',
            `${row.clubName} already has an active ${row.season} captain: ${sitting.join(', ')}. `
            + 'Confirm a co-captaincy to reinstate alongside them.', sitting);
        }
      }
      return null;
    },
    apply: async ({ row }) => ({
      updates: { status: 'active', endedOn: null, statusReason: null },
      oldValues: { status: row.status, ended_on: row.endedOn, status_reason: row.statusReason },
      newValues: { status: 'active', ended_on: null, status_reason: null },
    }),
  });
}

export type CorrectAppointmentInput = LeadershipEditBase & LeadershipDatesInput & {
  appointmentNote?: string | null;
};

/**
 * A data-entry correction to EVIDENCE — the dates and the note, and nothing
 * else.
 *
 * Role, player, club and season are not correctable here by design (§12): each
 * of them changes WHAT the row asserts, and an assertion that quietly became a
 * different one leaves no record that the first was ever made. A wrong one is
 * voided and re-entered.
 */
export async function correctAppointment(input: CorrectAppointmentInput): Promise<EditResult> {
  const dates = normaliseLeadershipDates(input);
  if ('error' in dates) return refuse('invalid_dates', dates.error);

  return editAppointment({
    ...input,
    fieldGroup: 'leadership_corrected',
    precheck: async ({ row }) => {
      if (row.status === 'void') {
        return refuse('invalid_transition',
          'That appointment was voided as a data-entry error. Voided appointments are kept for '
          + 'the record and are not maintained.');
      }
      if (row.status === 'active' && dates.endedOn !== null) {
        return refuse('invalid_dates',
          'An active appointment cannot carry an end date. End the appointment instead — that is '
          + 'what records when it ceased.');
      }
      return null;
    },
    apply: async ({ row }) => ({
      updates: {
        startedOn: dates.startedOn,
        endedOn: dates.endedOn,
        note: (input.appointmentNote ?? '').trim() || null,
      },
      oldValues: { started_on: row.startedOn, ended_on: row.endedOn, note: row.note },
      newValues: {
        started_on: dates.startedOn,
        ended_on: dates.endedOn,
        note: (input.appointmentNote ?? '').trim() || null,
      },
    }),
  });
}

export type VoidAppointmentInput = LeadershipEditBase & { reason: string };

/**
 * This record should never have existed.
 *
 * Kept — never deleted — so its `data_edits` rows stay resolvable at the next
 * promotion lineage remap, excluded from every current and historical
 * projection, and outside the active partial unique index. Voiding is TERMINAL
 * and is not the reverse of ending: an appointment that really happened and
 * finished is `ended`, and conflating the two destroys the only record of which
 * it was. The reason is mandatory in the writer AND in the CHECK.
 */
export async function voidAppointment(input: VoidAppointmentInput): Promise<EditResult> {
  const reason = input.reason.trim();
  if (!reason) return refuse('validation', 'Give a reason for voiding this appointment.');
  return editAppointment({
    ...input,
    fieldGroup: 'leadership_voided',
    precheck: async ({ row }) => (row.status === 'void'
      ? refuse('invalid_transition', 'That appointment is already void.')
      : null),
    apply: async ({ row }) => ({
      updates: { status: 'void', statusReason: reason },
      oldValues: { status: row.status, status_reason: row.statusReason },
      newValues: { status: 'void', status_reason: reason },
    }),
  });
}

// --- replace (§12) -------------------------------------------------------

export type ReplaceLeaderInput = {
  appointmentKey: string;
  expectedUpdatedAt: string;
  newPlayerId: number;
  adminUserId: number;
  /** The changeover date, when it is known. Ends one row and starts the other. */
  effectiveOn?: string | null;
  note?: string | null;
};

export type ReplaceLeaderResult = LeadershipMutationEnvelope & {
  endedAppointmentKey: string;
  appointmentId: number;
  replacementId: string;
};

/**
 * A mid-season change of leader, as ONE transaction: the outgoing appointment
 * becomes `ended`, and a NEW appointment for the incoming player is created
 * with the same role, club and season.
 *
 * Both rows are preserved, because both are true: someone held the office and
 * then someone else did. This is deliberately not an UPDATE of the player on
 * one row — that would erase the outgoing captain from history and leave the
 * audit trail asserting something the database no longer says.
 *
 * It is one primitive rather than end-then-appoint because a separate appoint
 * that failed would leave the club with no leader recorded at all — a worse
 * state than either the before or the after. The two audit rows share a
 * `replacement_id`, and the two payloads cross-reference each other, so the
 * change reads as one movement wherever it is inspected.
 */
export async function replaceLeader(
  input: ReplaceLeaderInput,
): Promise<LeadershipMutationResult<ReplaceLeaderResult>> {
  const replacementId = randomUUID();
  const dates = normaliseLeadershipDates({ endedOn: input.effectiveOn });
  if ('error' in dates) return refuse('invalid_dates', dates.error);
  const effectiveOn = dates.endedOn;

  return withImportConnection(async (importSql) => {
    try {
      return await importSql.begin(async (tx) => {
        const row = await lockAppointment(tx, input.appointmentKey);
        if (!row) return refuse('not_found', 'That appointment no longer exists.');
        if (row.updatedAt !== input.expectedUpdatedAt) {
          return refuse('stale',
            'That appointment changed while this page was open. Reload it and try again.');
        }
        if (row.status !== 'active') {
          return refuse('invalid_transition',
            `That appointment is ${row.status}, so there is no sitting leader to replace.`);
        }
        if (row.playerId === input.newPlayerId) {
          return refuse('validation',
            `${row.displayName} already holds that appointment.`, [row.displayName]);
        }
        if (row.startedOn && effectiveOn && effectiveOn < row.startedOn) {
          return refuse('invalid_dates',
            'The changeover date is before the outgoing appointment started.');
        }

        const bounds = await readListSeasonBounds(tx as unknown as typeof sql);
        if (!isAdministrableLeadershipSeason(row.season, bounds)) {
          return refuse('validation', seasonBoundError(row.season, bounds));
        }

        const outgoingIdentity = await resolvePlayerIdentity(tx, row.playerId);
        if (!outgoingIdentity.ok) {
          return refuse(outgoingIdentity.reason, outgoingIdentity.error);
        }
        if (outgoingIdentity.identity === null) {
          return refuse('conflict',
            `${row.displayName} (#${row.playerId}) no longer carries a durable identity, so the `
            + 'outgoing appointment could not be recorded durably. Reconcile the player identity '
            + 'first.', [row.displayName]);
        }

        const incoming = await resolveAppointableSubject(tx, {
          playerId: input.newPlayerId,
          season: row.season,
          club: { id: row.clubId, name: row.clubName },
        });
        if (!incoming.ok) return incoming;

        const existing = await activeAppointmentFor(tx, {
          season: row.season, playerId: input.newPlayerId,
        });
        if (existing) {
          return refuse('duplicate_active',
            duplicateActiveError(incoming.player, existing, row.season),
            [incoming.player.displayName]);
        }

        const sourceId = await manualSourceId(tx);
        const paths = await clubPublicPaths(tx, row.clubId);
        const note = (input.note ?? '').trim() || null;

        // Everything above refused before a write. From here, any refusal throws.
        await tx`
          UPDATE club_leadership
             SET status = 'ended', ended_on = ${effectiveOn}::date, updated_at = now()
           WHERE id = ${row.id}
        `;

        const written = await insertAppointment(tx, {
          season: row.season,
          club: { id: row.clubId, slug: row.clubSlug },
          player: incoming.player,
          role: row.role,
          startedOn: effectiveOn,
          note,
          sourceId,
          adminUserId: input.adminUserId,
          replacesAppointmentKey: row.appointmentKey,
          auditExtra: { replacement_id: replacementId, replaces: row.appointmentKey },
        });

        // The outgoing payload is rewritten LAST so it can name the appointment
        // that replaced it — the cross-reference only exists once both do.
        const endedPayload = leadershipOverridePayload({
          appointmentKey: row.appointmentKey,
          clubSlug: row.clubSlug,
          season: row.season,
          playerIdentity: outgoingIdentity.identity,
          role: row.role,
          status: 'ended',
          startedOn: row.startedOn,
          endedOn: effectiveOn,
          statusReason: row.statusReason,
          note: row.note,
          replacedByAppointmentKey: written.appointmentKey,
        });
        await writeLeadershipOverride(tx, endedPayload, input.adminUserId);

        await recordDataEdit(tx, {
          tableName: 'club_leadership',
          rowId: row.id,
          fieldGroup: 'leadership_ended',
          oldValues: { status: row.status, ended_on: row.endedOn },
          newValues: {
            ...auditIdentity({
              appointmentKey: row.appointmentKey,
              season: row.season,
              clubSlug: row.clubSlug,
              playerIdentity: outgoingIdentity.identity,
              role: row.role,
            }),
            status: 'ended',
            ended_on: effectiveOn,
            replacement_id: replacementId,
            replaced_by: written.appointmentKey,
          },
          adminUserId: input.adminUserId,
          note,
        });

        return {
          ok: true as const,
          appointmentKey: written.appointmentKey,
          appointmentId: written.appointmentId,
          endedAppointmentKey: row.appointmentKey,
          replacementId,
          revalidatePaths: paths,
        };
      }) as LeadershipMutationResult<ReplaceLeaderResult>;
    } catch (error) {
      return rolledBackRefusal(error) ?? refuse('failed', mutationFailure(error));
    }
  });
}

// --- admin reads (§17) ---------------------------------------------------

export type ClubSeasonLeadershipRow = LeadershipRow & {
  /**
   * Whether the player STILL holds this club's list place for this season.
   *
   * False is a diagnostic, never an error and never a reason to hide the row:
   * the membership may have been removed or transferred afterwards, and the
   * appointment remains the true record of who held the office (§9, R-3/R-4).
   */
  listed: boolean;
};

/**
 * One club's leadership for one season — every appointment, active, ended and
 * void, in one query.
 *
 * Ordered so the current holders come first and a pre-season appointment sorts
 * before a mid-season replacement WITHOUT any date being invented:
 * `started_on NULLS FIRST` puts the unknown-date appointment first, which is
 * what it almost always is.
 */
export async function readClubSeasonLeadership(
  season: number, clubSlug: string,
): Promise<ClubSeasonLeadershipRow[]> {
  return sql<ClubSeasonLeadershipRow[]>`
    SELECT l.id::int AS id, l.appointment_key AS "appointmentKey", l.season::int AS season,
           l.club_id AS "clubId", c.slug AS "clubSlug", c.name AS "clubName",
           c.organization_id AS "organizationId",
           l.player_id AS "playerId", p.slug AS "playerSlug", p.display_name AS "displayName",
           l.role, l.status, l.status_reason AS "statusReason",
           l.started_on::text AS "startedOn", l.ended_on::text AS "endedOn", l.note,
           l.created_at::text AS "createdAt", l.updated_at::text AS "updatedAt",
           EXISTS (SELECT 1 FROM season_list_members m
                    WHERE m.season = l.season AND m.club_id = l.club_id
                      AND m.player_id = l.player_id) AS listed
      FROM club_leadership l
      JOIN clubs c ON c.id = l.club_id
      JOIN players p ON p.id = l.player_id
     WHERE l.season = ${season}::smallint AND c.slug = ${clubSlug}
     ORDER BY CASE l.status WHEN 'active' THEN 0 WHEN 'ended' THEN 1 ELSE 2 END,
              l.role, l.started_on NULLS FIRST, l.created_at, l.id
  `;
}

/** One appointment, by its durable key. */
export async function readLeadershipAppointment(
  appointmentKey: string,
): Promise<LeadershipRow | null> {
  const rows = await sql.unsafe(
    `SELECT ${LEADERSHIP_COLUMNS} ${LEADERSHIP_JOINS} WHERE l.appointment_key = $1`,
    [appointmentKey],
  ) as unknown as LeadershipRow[];
  return rows[0] ?? null;
}

export type LeadershipClubSummary = {
  clubSlug: string;
  clubName: string;
  organizationId: number;
  /** The active captains, alphabetically. Two or more ARE co-captains. */
  captains: string[];
  viceCaptains: number;
  /** Active appointments whose holder is no longer on this club's list (§9). */
  unlistedActive: number;
};

/**
 * The season overview: every eligible club and what leadership it has recorded.
 * "None recorded" is `captains = []`, which is a real and expected state for a
 * season nobody has administered yet, not an error.
 */
export async function readLeadershipOverview(season: number): Promise<LeadershipClubSummary[]> {
  return sql<LeadershipClubSummary[]>`
    SELECT e.slug AS "clubSlug", e.name AS "clubName", e.organization_id AS "organizationId",
           COALESCE((SELECT array_agg(p.display_name ORDER BY p.display_name)
                       FROM club_leadership l JOIN players p ON p.id = l.player_id
                      WHERE l.season = ${season}::smallint AND l.club_id = e.id
                        AND l.role = 'captain' AND l.status = 'active'), '{}'::text[]) AS captains,
           (SELECT count(*)::int FROM club_leadership l
             WHERE l.season = ${season}::smallint AND l.club_id = e.id
               AND l.role = 'vice_captain' AND l.status = 'active') AS "viceCaptains",
           (SELECT count(*)::int FROM club_leadership l
             WHERE l.season = ${season}::smallint AND l.club_id = e.id AND l.status = 'active'
               AND NOT EXISTS (SELECT 1 FROM season_list_members m
                                WHERE m.season = l.season AND m.club_id = l.club_id
                                  AND m.player_id = l.player_id)) AS "unlistedActive"
      FROM afldb_season_list_clubs(${season}::smallint) e
     ORDER BY e.name
  `;
}

export type LeadershipDiagnostic = {
  appointmentKey: string;
  playerId: number;
  playerSlug: string;
  displayName: string;
  role: LeadershipRole;
  startedOn: string | null;
};

/**
 * Active appointments whose holder is no longer on this club's list for the
 * season — a leader who was removed or transferred afterwards (§9, R-3/R-4).
 *
 * Read-only and advisory. AFLDB-ISSUE-161's removal and transfer stay permitted
 * exactly as they are; this surfaces the consequence so an administrator can
 * end the appointment deliberately, and NOTHING here ends it for them.
 */
export async function readLeadershipDiagnostics(
  season: number, clubSlug: string,
): Promise<LeadershipDiagnostic[]> {
  return sql<LeadershipDiagnostic[]>`
    SELECT l.appointment_key AS "appointmentKey", l.player_id AS "playerId",
           p.slug AS "playerSlug", p.display_name AS "displayName", l.role,
           l.started_on::text AS "startedOn"
      FROM club_leadership l
      JOIN clubs c ON c.id = l.club_id
      JOIN players p ON p.id = l.player_id
     WHERE l.season = ${season}::smallint AND c.slug = ${clubSlug} AND l.status = 'active'
       AND NOT EXISTS (SELECT 1 FROM season_list_members m
                        WHERE m.season = l.season AND m.club_id = l.club_id
                          AND m.player_id = l.player_id)
     ORDER BY l.role, p.display_name
  `;
}

/** The administrable season range, for the season selector. */
export async function administrableLeadershipSeasons(): Promise<LeadershipSeasonBounds> {
  return readListSeasonBounds(sql);
}

// --- durable-record reads (import role only, ISSUE-159 D-2) --------------

export type LeadershipOverrideRow = {
  entityKey: string;
  fieldGroup: string;
  overrideValues: Record<string, unknown>;
  isActive: boolean;
  updatedAt: Date;
};

/** The durable record of one appointment. */
export async function readLeadershipOverrides(
  appointmentKey: string,
): Promise<LeadershipOverrideRow[]> {
  return withImportConnection((importSql) => importSql<LeadershipOverrideRow[]>`
    SELECT entity_key AS "entityKey", field_group AS "fieldGroup",
           override_values AS "overrideValues", is_active AS "isActive", updated_at AS "updatedAt"
      FROM data_overrides
     WHERE entity_type = ${LEADERSHIP_ENTITY_TYPE}
       AND entity_key = ${leadershipEntityKey(appointmentKey)}
     ORDER BY field_group
  `);
}
