/**
 * AFLDB-ISSUE-245 — the manual / post-baseline player REGISTRATIONS carried through the
 * destructive `db:test:rebuild`: every `data_overrides('players', 'manual_admin_edit:<token>',
 * 'identity')` creation record, the stable identities it re-creates, and the attribution actor
 * it names. The I18 rebuild (2026-09-24) destroyed the 92 ISSUE-224 registrations because
 * nothing carried this state; ISSUE-237 Stage 18 then had no player to replay onto.
 *
 * THE AUTHORITY IS `data_overrides`, exactly as in production promotion
 * (docs/production-promotion.md §8 step 1). The creation record is the durable record of an
 * administrator-created player (`createPlayerInTransaction`, src/db/queries/players.ts), and
 * `replay_admin_overrides(players)` (tools/migration/common.py) re-creates the player, its
 * `manual_admin_edit` identity and its attached AFL Tables identity from it — or BINDS the token
 * onto the source-owned player the rebuild already created under that path (the debut /
 * source-convergence case, so a promotion after the debut yields one player, not twins). The
 * rebuild runs THAT function (`replay_manual_registrations.py`); nothing here re-implements it.
 * This module owns only what the rebuild needs around it, and depends on nothing in
 * `rebuild_afl_api_adjudications.ts` (which imports it):
 *
 *   capture   Stage 2, inside the ONE combined capture: read every `players` override and every
 *             identity the registration lifecycle depends on, refuse BEFORE destruction on
 *             anything the replay cannot reproduce exactly (`registrationsFromLive`), and return
 *             the registration section — the stable token, the override payload as PostgreSQL's
 *             own jsonb text, its timestamps, the actor's email and role. `players.id` and
 *             `admin_user_id` travel as AUDIT ONLY, outside the payload hash, and nothing ever
 *             reads them back as identity.
 *   reinstate Stage 17, owner DSN, one transaction (`reinstateManualRegistrations`): plan against
 *             the rebuilt database and refuse on any collision (`planRegistrationReplay`),
 *             recreate the attribution actors, insert the override rows exactly as captured and
 *             read them back.
 *   replay    Stage 18: `replay_manual_registrations.py`, the production function, import role.
 *   verify    Stage 19, read-only (`manualRegistrationVerificationProblems`): re-capture the live
 *             state and require it to equal the capture, surrogates aside, with no problem.
 *
 * `data_edits` IS NOT CARRIED. It is the audit log, keyed by the surrogate `row_id`; nothing on
 * `afldb_test` resolves identity through it, and the replay needs nothing from it. Production
 * promotion remaps it for its own reasons (the `row_id` lineage remap); a rebuilt test database
 * starts a fresh audit history, as it always has.
 *
 * NO NAME-ONLY LINKING. A registration re-attaches to an existing player only through its AFL
 * Tables profile path, and only when exactly one bindable source identity holds that path.
 */
import type { TransactionSql } from 'postgres';

import { isLifecycleRole, type LifecycleRole } from '../../src/lib/auth/admin-lifecycle';

/** Any refusal. Thrown before the reset (capture) or inside a transaction (reinstate). */
export class RegistrationRebuildRefused extends Error {}

export const MANUAL_NAMESPACE = 'manual_admin_edit';
export const REGISTRATION_FIELD_GROUP = 'identity';
/**
 * The admin surface's own profile-path rule, `AFLTABLES_PROFILE_PATH_RE` in
 * src/db/queries/admin-draft.ts (a `server-only` module this tool cannot load). The DB-free
 * suite pins the two to the same source text.
 */
export const REGISTRATION_PROFILE_PATH_RE = /^players\/[A-Z]\/[A-Za-z0-9_'.-]+\.html$/;

/**
 * Every key a creation record may carry: what `createPlayerInTransaction` and
 * `attachAflTablesIdentityInTransaction` write, plus the keys `replay_admin_overrides(players)`
 * reads in its merge UPDATE. Anything else is a shape the replay would silently ignore, so it
 * refuses instead.
 */
export const REGISTRATION_PAYLOAD_KEYS = [
  'display_name', 'given_name', 'surname', 'dob', 'dob_confidence', 'birth_year', 'birth_year_min',
  'birth_year_max', 'birth_year_confidence', 'height_cm', 'weight_kg', 'notes', 'afltables_profile_path',
] as const;
const VALUE_CONFIDENCES = new Set(['sourced', 'estimated', 'derived', 'unknown']);
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const BINDABLE_STATUSES = new Set(['unique', 'resolved']);

// ---------------------------------------------------------------------------
// The captured section
// ---------------------------------------------------------------------------

export type CapturedRegistration = {
  /** The stable identity: the `manual_admin_edit` token, minted once and never edited. */
  token: string;
  /** `override_values::text` exactly as PostgreSQL rendered it; re-cast to jsonb on reinstate. */
  overrideValues: string;
  /** The payload's `afltables_profile_path` (null when absent or null): a second stable identity. */
  afltablesProfilePath: string | null;
  /** UTC with microseconds: round-trips `timestamptz` exactly. */
  createdAt: string;
  updatedAt: string;
  /** The actor's stable identity across a rebuild, and its role at capture. */
  adminEmail: string;
  adminRole: LifecycleRole;
  /** The CAPTURED database's surrogates. Audit only: never reinstated, never hashed. */
  adminUserId: number;
  playerId: number;
};

/** Every captured field EXCEPT the two audit-only surrogates, for the payload hash. */
export function registrationTuple(r: CapturedRegistration): unknown[] {
  return [r.token, r.overrideValues, r.afltablesProfilePath, r.createdAt, r.updatedAt, r.adminEmail, r.adminRole];
}

export function sortRegistrations(rows: readonly CapturedRegistration[]): CapturedRegistration[] {
  return [...rows].sort((a, b) => (a.token < b.token ? -1 : a.token > b.token ? 1 : 0));
}

/**
 * Two sections are the same registrations when every durable field agrees; the surrogates
 * (`playerId`, `adminUserId`) are ignored and the actor email compares case-insensitively (the
 * `uq_auth_users_email_lower` rule). Order-independent.
 */
export function sameRegistrations(a: readonly CapturedRegistration[], b: readonly CapturedRegistration[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: CapturedRegistration) => JSON.stringify(registrationTuple({ ...r, adminEmail: r.adminEmail.toLowerCase() }));
  const sa = sortRegistrations(a);
  const sb = sortRegistrations(b);
  return sa.every((r, i) => key(r) === key(sb[i]));
}

const isPositiveId = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const isTextOrNull = (v: unknown) => v === null || typeof v === 'string';
/** The `::smallint` range: every integer column the players replay casts into is smallint (migration 002). */
const isSmallintOrNull = (v: unknown) => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= -32768 && v <= 32767);
/** A real calendar date, so `(o.override_values->>'dob')::date` cannot raise. */
function isCalendarDate(v: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const at = new Date(Date.UTC(y, mo - 1, d));
  return at.getUTCFullYear() === y && at.getUTCMonth() === mo - 1 && at.getUTCDate() === d;
}

const PLAYER_OVERRIDE_TEXT_KEYS = ['given_name', 'surname', 'notes'] as const;
const PLAYER_OVERRIDE_SMALLINT_KEYS = ['birth_year', 'birth_year_min', 'birth_year_max', 'height_cm', 'weight_kg'] as const;
const PLAYER_OVERRIDE_CONFIDENCE_KEYS = ['dob_confidence', 'birth_year_confidence'] as const;

/**
 * Every value in ONE players override payload that `replay_admin_overrides(players)` would fail to
 * cast (`::date`, `::smallint`, `::value_confidence`) -- in its INSERT of a creation record and in
 * its merge UPDATE of every payload, creation record or source-keyed correction alike. Shared by the
 * ISSUE-245 capture and the promotion checker's A4.2 gate so the two cannot drift. `rawText` is the
 * payload as PostgreSQL rendered it: jsonb keeps a numeric's scale, so `1990.0` parses to an integer
 * here yet `->>` hands `'1990.0'` to `::smallint`, which raises.
 */
export function playerOverrideValueProblems(p: Readonly<Record<string, unknown>>, rawText: string): string[] {
  const problems: string[] = [];
  for (const k of PLAYER_OVERRIDE_TEXT_KEYS) {
    if (k in p && !isTextOrNull(p[k])) problems.push(`${k} is not text or null`);
  }
  for (const k of PLAYER_OVERRIDE_SMALLINT_KEYS) {
    if (!(k in p)) continue;
    const literal = new RegExp(`"${k}"\\s*:\\s*(-?[0-9][0-9.eE+-]*)`).exec(rawText)?.[1];
    if (!isSmallintOrNull(p[k]) || (literal !== undefined && !/^-?[0-9]+$/.test(literal))) {
      problems.push(`${k} is not a smallint or null`);
    }
  }
  for (const k of PLAYER_OVERRIDE_CONFIDENCE_KEYS) {
    if (k in p && p[k] !== null && !VALUE_CONFIDENCES.has(p[k] as string)) problems.push(`${k} is not a value_confidence`);
  }
  if ('dob' in p && p.dob !== null && (typeof p.dob !== 'string' || !isCalendarDate(p.dob))) {
    problems.push('dob is not a YYYY-MM-DD calendar date');
  }
  return problems;
}

/** Parse a creation record and name everything the replay could not honour exactly. */
export function registrationPayloadProblems(overrideValues: string): { problems: string[]; path: string | null } {
  let payload: unknown;
  try {
    payload = JSON.parse(overrideValues);
  } catch {
    return { problems: ['the override payload is not valid JSON'], path: null };
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { problems: ['the override payload is not a JSON object'], path: null };
  }
  const p = payload as Record<string, unknown>;
  const problems: string[] = [];
  const unsupported = Object.keys(p).filter((k) => !(REGISTRATION_PAYLOAD_KEYS as readonly string[]).includes(k));
  if (unsupported.length > 0) problems.push(`unsupported override key(s): ${unsupported.sort().join(', ')}`);
  // replay_admin_overrides(players)'s own fail-closed pre-check, and the players NOT NULL column.
  if (typeof p.display_name !== 'string' || p.display_name.trim() === '') {
    problems.push('the override carries no display_name to re-create the player with');
  }
  problems.push(...playerOverrideValueProblems(p, overrideValues));
  if ('dob' in p && p.dob !== null) {
    // replay_admin_overrides(players)'s own pre-check (players_dob_confidence_ck, migration 018).
    if ((p.dob_confidence ?? 'unknown') === 'unknown') problems.push('dob is set with no dob_confidence');
  }
  let path: string | null = null;
  if ('afltables_profile_path' in p && p.afltables_profile_path !== null) {
    if (typeof p.afltables_profile_path !== 'string' || !REGISTRATION_PROFILE_PATH_RE.test(p.afltables_profile_path)) {
      problems.push('afltables_profile_path is not an AFL Tables profile path');
    } else {
      path = p.afltables_profile_path;
    }
  }
  return { problems, path };
}

/**
 * Structural problems with a captured registration section: what a faithful reinstatement
 * needs, re-checked on every parse so a hand-edited file refuses before any statement runs.
 */
export function registrationCaptureStructureProblems(rows: readonly CapturedRegistration[]): string[] {
  const problems: string[] = [];
  const tokens = new Set<string>();
  const paths = new Map<string, string>();
  const roles = new Map<string, unknown>();
  for (const r of rows) {
    const at = `registration ${String(r.token)}`;
    if (typeof r.token !== 'string' || r.token.trim() === '' || r.token !== r.token.trim()) {
      problems.push(`${at}: the manual_admin_edit token is empty or padded`);
      continue;
    }
    if (tokens.has(r.token)) problems.push(`${at}: duplicate manual identity token`);
    tokens.add(r.token);
    if (typeof r.overrideValues !== 'string') {
      problems.push(`${at}: the override payload is not jsonb text`);
    } else {
      const payload = registrationPayloadProblems(r.overrideValues);
      for (const p of payload.problems) problems.push(`${at}: ${p}`);
      if (payload.problems.length === 0 && payload.path !== r.afltablesProfilePath) {
        problems.push(`${at}: afltablesProfilePath does not equal the payload's afltables_profile_path`);
      }
    }
    if (r.afltablesProfilePath !== null) {
      const other = paths.get(r.afltablesProfilePath);
      if (other !== undefined) {
        problems.push(`${at}: AFL Tables path ${r.afltablesProfilePath} is also claimed by registration ${other}`);
      } else {
        paths.set(r.afltablesProfilePath, r.token);
      }
    }
    for (const [k, v] of [['created_at', r.createdAt], ['updated_at', r.updatedAt]] as const) {
      if (typeof v !== 'string' || !TIMESTAMP_RE.test(v)) problems.push(`${at}: ${k} is not UTC microsecond ISO text`);
    }
    if (typeof r.adminEmail !== 'string' || r.adminEmail.trim() === '') {
      problems.push(`${at}: the actor has no email to remap by`);
    } else {
      const key = r.adminEmail.toLowerCase();
      if (roles.has(key) && roles.get(key) !== r.adminRole) {
        problems.push(`${at}: its actor is captured with two different roles`);
      }
      if (!roles.has(key)) roles.set(key, r.adminRole);
    }
    if (!isLifecycleRole(r.adminRole)) {
      problems.push(`${at}: the actor's role '${String(r.adminRole)}' is not one auth_users.role allows`);
    }
    if (!isPositiveId(r.adminUserId)) problems.push(`${at}: admin_user_id is not a positive integer`);
    if (!isPositiveId(r.playerId)) problems.push(`${at}: player_id is not a positive integer`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// The live state (capture, verify) and the before-destruction rules
// ---------------------------------------------------------------------------

export type LiveIdentityRow = { externalId: string; playerId: number | null; status: string; matchMethod: string | null };

export type LiveRegistrationState = {
  /** Every `data_overrides` row with entity_type 'players', any namespace, any state. */
  overrides: readonly {
    entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: string;
    createdAt: string; updatedAt: string; adminUserId: number;
    adminEmail: string | null; adminRole: string | null;
  }[];
  /** Every ACTIVE non-manual `players` override, with the player its own identity resolves to. */
  corrections: readonly { entityKey: string; fieldGroup: string; playerId: number }[];
  /** Every `manual_admin_edit` identity row. */
  manualIdentities: readonly LiveIdentityRow[];
  /** Every `afltables` identity row held by a manual player, or naming a payload path. */
  afltablesIdentities: readonly LiveIdentityRow[];
};

export const EMPTY_LIVE_REGISTRATION_STATE: LiveRegistrationState = {
  overrides: [], corrections: [], manualIdentities: [], afltablesIdentities: [],
};

function splitEntityKey(entityKey: string): { namespace: string; token: string } {
  const at = entityKey.indexOf(':');
  return at < 0 ? { namespace: entityKey, token: '' } : { namespace: entityKey.slice(0, at), token: entityKey.slice(at + 1) };
}

function isBindable(row: LiveIdentityRow, matchMethod: string): row is LiveIdentityRow & { playerId: number } {
  return row.playerId !== null && BINDABLE_STATUSES.has(row.status) && row.matchMethod === matchMethod;
}

/**
 * The registration section of a live database, and every reason it cannot be carried. The
 * capture refuses on ANY problem, before destruction; the verify stage re-runs this on the
 * rebuilt database and demands the same answer. Never a name, never a stored `players.id`: a
 * registration is found by its token, and its player by that token's own identity row.
 */
export function registrationsFromLive(state: LiveRegistrationState): {
  registrations: CapturedRegistration[]; problems: string[];
} {
  const problems: string[] = [];
  const registrations: CapturedRegistration[] = [];
  const tokens = new Set<string>();
  for (const o of state.overrides) {
    const { namespace, token } = splitEntityKey(o.entityKey);
    if (namespace !== MANUAL_NAMESPACE) continue; // a source-keyed correction: see below
    const at = `registration ${o.entityKey} (${o.fieldGroup})`;
    if (token === '') { problems.push(`${at}: the entity key carries no token`); continue; }
    if (o.fieldGroup !== REGISTRATION_FIELD_GROUP) {
      problems.push(`${at}: unsupported override shape: only field_group '${REGISTRATION_FIELD_GROUP}' is a creation record`);
      continue;
    }
    if (!o.isActive) {
      problems.push(`${at}: the creation record is inactive; its replay semantics are not defined`);
      continue;
    }
    tokens.add(token);
    const payload = registrationPayloadProblems(o.overrideValues);
    for (const p of payload.problems) problems.push(`${at}: ${p}`);
    if (o.adminEmail === null || o.adminEmail.trim() === '') problems.push(`${at}: its actor has no resolvable email`);
    if (!isLifecycleRole(o.adminRole)) problems.push(`${at}: its actor's role '${String(o.adminRole)}' cannot be recreated safely`);

    const own = state.manualIdentities.filter((m) => m.externalId === token);
    const players = [...new Set(own.filter((m) => isBindable(m, MANUAL_NAMESPACE)).map((m) => m.playerId as number))];
    if (own.some((m) => !isBindable(m, MANUAL_NAMESPACE))) {
      problems.push(`${at}: a manual_admin_edit identity row for the token is not unique/resolved and player-linked`);
    }
    if (players.length === 0) {
      problems.push(`${at}: no resolvable stable registration identity (the token names no player)`);
      continue;
    }
    if (players.length > 1) {
      problems.push(`${at}: the manual identity resolves to ${players.length} players`);
      continue;
    }
    const [playerId] = players;
    const held = state.afltablesIdentities.filter((a) => isBindable(a, 'afltables_profile_url') && a.playerId === playerId)
      .map((a) => a.externalId);
    if (payload.path !== null) {
      const forPath = state.afltablesIdentities.filter((a) => a.externalId === payload.path);
      if (forPath.some((a) => !isBindable(a, 'afltables_profile_url') || a.playerId !== playerId)) {
        problems.push(`${at}: AFL Tables path ${payload.path} is attached to a different player or is not a bindable identity`);
      } else if (!held.includes(payload.path)) {
        problems.push(`${at}: the creation record names ${payload.path}, but the player does not hold it`);
      }
    }
    const extra = held.filter((h) => h !== payload.path);
    if (extra.length > 0) {
      problems.push(`${at}: the player holds AFL Tables identit${extra.length === 1 ? 'y' : 'ies'} ${extra.join(', ')} `
        + 'that the creation record does not carry; the replay would not re-create '
        + (extra.length === 1 ? 'it' : 'them'));
    }
    // Only a clean record joins the section; a refused one is already named above.
    if (payload.problems.length === 0 && typeof o.adminEmail === 'string' && isLifecycleRole(o.adminRole)) {
      registrations.push({
        token, overrideValues: o.overrideValues, afltablesProfilePath: payload.path,
        createdAt: o.createdAt, updatedAt: o.updatedAt, adminEmail: o.adminEmail, adminRole: o.adminRole,
        adminUserId: o.adminUserId, playerId,
      });
    }
  }

  // A manual player with no creation record would be destroyed by the reset and re-created by
  // nothing: the ISSUE-245 failure itself, refused here rather than after destruction.
  for (const m of state.manualIdentities) {
    if (!tokens.has(m.externalId)) {
      problems.push(`manual_admin_edit identity ${m.externalId} (player ${String(m.playerId)}) has no active `
        + `'${REGISTRATION_FIELD_GROUP}' creation record: the rebuild would destroy that player and nothing would re-create it`);
    }
  }
  const byPlayer = new Map<number, string>();
  for (const r of registrations) {
    const other = byPlayer.get(r.playerId);
    if (other !== undefined) problems.push(`registrations ${other} and ${r.token} resolve to the same player`);
    else byPlayer.set(r.playerId, r.token);
  }
  // A later source-keyed correction of a registered player is outside the carried lifecycle:
  // replaying the creation record alone would not reproduce that player, so it refuses.
  for (const c of state.corrections) {
    const token = byPlayer.get(c.playerId);
    if (token !== undefined) {
      problems.push(`correction override ${c.entityKey} (${c.fieldGroup}) targets registered player ${token}: `
        + 'player corrections are not carried by the rebuild, and the creation record alone would not reproduce it');
    }
  }
  // The cross-row rules (one token, one path, one role per actor) over the clean records.
  problems.push(...registrationCaptureStructureProblems(registrations));
  return { registrations: sortRegistrations(registrations), problems };
}

/** The live registration state, inside the caller's transaction. Empty on a database the reset has cleared. */
export async function readLiveRegistrationState(tx: TransactionSql): Promise<LiveRegistrationState> {
  const [shape] = await tx<{ overrides: boolean; identities: boolean; sources: boolean }[]>`
    SELECT to_regclass('public.data_overrides') IS NOT NULL AS overrides,
           to_regclass('public.external_identities') IS NOT NULL AS identities,
           to_regclass('public.sources') IS NOT NULL AS sources
  `;
  if (!shape.overrides || !shape.identities || !shape.sources) return EMPTY_LIVE_REGISTRATION_STATE;

  const overrides = await tx<LiveRegistrationState['overrides'][number][]>`
    SELECT o.entity_key AS "entityKey", o.field_group AS "fieldGroup", o.is_active AS "isActive",
           o.override_values::text AS "overrideValues",
           to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
           to_char(o.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
           o.admin_user_id AS "adminUserId", u.email AS "adminEmail", u.role AS "adminRole"
      FROM data_overrides o
      LEFT JOIN auth_users u ON u.id = o.admin_user_id
     WHERE o.entity_type = 'players'
     ORDER BY o.entity_key, o.field_group
  `;
  const corrections = await tx<LiveRegistrationState['corrections'][number][]>`
    SELECT DISTINCT o.entity_key AS "entityKey", o.field_group AS "fieldGroup", e.player_id AS "playerId"
      FROM data_overrides o
      JOIN sources s ON s.key = split_part(o.entity_key, ':', 1)
      JOIN external_identities e ON e.source_id = s.id
                                AND e.external_id = substring(o.entity_key from position(':' in o.entity_key) + 1)
                                AND e.status IN ('unique', 'resolved')
                                AND e.player_id IS NOT NULL
     WHERE o.entity_type = 'players' AND o.is_active
       AND split_part(o.entity_key, ':', 1) <> ${MANUAL_NAMESPACE}
     ORDER BY 1, 2
  `;
  const manualIdentities = await tx<LiveIdentityRow[]>`
    SELECT e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS status,
           e.match_method AS "matchMethod"
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = ${MANUAL_NAMESPACE}
     ORDER BY e.external_id
  `;
  const playerIds = [...new Set(manualIdentities.map((m) => m.playerId).filter((id): id is number => id !== null))];
  const paths = [...new Set(overrides.map((o) => {
    try {
      const v = (JSON.parse(o.overrideValues) as Record<string, unknown>).afltables_profile_path;
      return typeof v === 'string' ? v : null;
    } catch {
      return null;
    }
  }).filter((p): p is string => p !== null))];
  const afltablesIdentities = playerIds.length === 0 && paths.length === 0 ? [] : await tx<LiveIdentityRow[]>`
    SELECT e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS status,
           e.match_method AS "matchMethod"
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables'
       AND (e.player_id = ANY (${tx.array(playerIds)}::int[]) OR e.external_id = ANY (${tx.array(paths)}::text[]))
     ORDER BY e.external_id
  `;
  return { overrides, corrections, manualIdentities, afltablesIdentities };
}

/**
 * The verify stage's whole contract (and the capture's "already reinstated" proof): the live
 * state re-captured must carry no problem and must equal the capture, surrogates aside.
 */
export function manualRegistrationVerificationProblems(
  captured: readonly CapturedRegistration[], live: LiveRegistrationState,
): string[] {
  const { registrations, problems } = registrationsFromLive(live);
  const out = [...problems];
  if (!sameRegistrations(captured, registrations)) {
    const liveTokens = new Set(registrations.map((r) => r.token));
    const missing = captured.filter((r) => !liveTokens.has(r.token)).map((r) => r.token);
    out.push(`the live registrations differ from the capture (${captured.length} captured, `
      + `${registrations.length} live${missing.length > 0 ? `; missing ${missing.slice(0, 5).join(', ')}` : ''})`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reinstatement planning (pure)
// ---------------------------------------------------------------------------

export type RegistrationReplayState = {
  /** Live `players` overrides in the manual namespace. A rebuilt database holds none. */
  manualOverrideRows: number;
  /** Every live `manual_admin_edit` identity. A rebuilt database holds none. */
  manualIdentities: readonly LiveIdentityRow[];
  /** Every live `afltables` identity row whose external_id is a captured path, any status/method. */
  afltablesForPaths: readonly LiveIdentityRow[];
};

export type RegistrationReplayPlan = {
  /** No player holds the registration's path (or it has none): the replay creates the player. */
  creates: { token: string; path: string | null }[];
  /** The rebuild already created the source-owned player under the path: the replay binds to it. */
  binds: { token: string; path: string; playerId: number }[];
};

/**
 * What `replay_admin_overrides(players)` WILL do to each captured registration on this rebuilt
 * database, decided before anything is written — and every case where what it would do is not
 * a faithful reinstatement, which refuses the whole stage:
 *
 *   * a live manual override or `manual_admin_edit` identity (a duplicate manual identity: the
 *     replay would skip the token as already present, or collide with it);
 *   * a captured path held by a row that is not a bindable `afltables_profile_url` identity (the
 *     replay's `NOT EXISTS` guard would silently attach nothing);
 *   * a path bound to more than one player, or two registrations converging on one player.
 *
 * A path held by exactly one bindable source identity is the source-owned convergence case: the
 * player debuted and the accepted source now carries them. It binds, never duplicates.
 */
export function planRegistrationReplay(
  registrations: readonly CapturedRegistration[], state: RegistrationReplayState,
): RegistrationReplayPlan {
  const problems = registrationCaptureStructureProblems(registrations);
  if (state.manualOverrideRows > 0) {
    problems.push(`the rebuilt database already holds ${state.manualOverrideRows} manual players override row(s); `
      + 'registration reinstatement needs none');
  }
  const captured = new Set(registrations.map((r) => r.token));
  for (const m of state.manualIdentities) {
    problems.push(captured.has(m.externalId)
      ? `registration ${m.externalId}: duplicate manual identity — the rebuilt database already holds it (player ${String(m.playerId)})`
      : `the rebuilt database already holds an unexpected manual_admin_edit identity ${m.externalId}`);
  }
  const plan: RegistrationReplayPlan = { creates: [], binds: [] };
  const boundBy = new Map<number, string>();
  for (const r of registrations) {
    if (r.afltablesProfilePath === null) {
      plan.creates.push({ token: r.token, path: null });
      continue;
    }
    const rows = state.afltablesForPaths.filter((a) => a.externalId === r.afltablesProfilePath);
    if (rows.length === 0) {
      plan.creates.push({ token: r.token, path: r.afltablesProfilePath });
      continue;
    }
    if (rows.some((a) => !isBindable(a, 'afltables_profile_url'))) {
      problems.push(`registration ${r.token}: ${r.afltablesProfilePath} is held by an identity row that is not a `
        + 'bindable afltables_profile_url identity; the replay would attach nothing');
      continue;
    }
    const players = [...new Set(rows.map((a) => a.playerId as number))];
    if (players.length > 1) {
      problems.push(`registration ${r.token}: ${r.afltablesProfilePath} resolves to ${players.length} source players`);
      continue;
    }
    const other = boundBy.get(players[0]);
    if (other !== undefined) {
      problems.push(`registrations ${other} and ${r.token} would both bind to source player ${players[0]}`);
      continue;
    }
    boundBy.set(players[0], r.token);
    plan.binds.push({ token: r.token, path: r.afltablesProfilePath, playerId: players[0] });
  }
  if (problems.length > 0) {
    throw new RegistrationRebuildRefused(
      `The registrations cannot be reinstated; nothing was written: ${problems.join('; ')}`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Attribution actors
// ---------------------------------------------------------------------------

/** An attribution-only account to create: email and role, and nothing else. */
export type AttributionOnlyActor = { email: string; role: LifecycleRole };

/**
 * THE one write of an attribution-only account: the given email and role, NULL password hash,
 * NULL TOTP secret, disabled at creation. Every other column keeps its schema default. No
 * session, no other auth state. Moved here (AFLDB-ISSUE-245) from
 * rebuild_afl_api_adjudications.ts, which re-exports it unchanged for the ISSUE-235 ledger and
 * the ISSUE-237 recovery-actor CLI, so the shape is still written exactly once.
 */
export async function insertAttributionOnlyActor(tx: TransactionSql, actor: AttributionOnlyActor): Promise<number> {
  const [row] = await tx<{ id: number }[]>`
    INSERT INTO auth_users (email, role, password_hash, totp_secret, disabled_at)
    VALUES (${actor.email}, ${actor.role}, NULL, NULL, now())
    RETURNING id
  `;
  return row.id;
}

export type RegistrationActorPlan = {
  /** lower(email) -> the existing account reused for it, untouched. */
  reuse: Map<string, number>;
  create: AttributionOnlyActor[];
};

/**
 * One actor per case-insensitive email. An existing account is reused ONLY when it already holds
 * the captured role, and is never modified — so a credentialed user is never overwritten or
 * downgraded. A role disagreement is conflicting actor state and STOPs, as does an email that
 * matches two accounts, or an open admin invite for an account that would have to be created
 * (accepting it would make the attribution-only row sign-in capable).
 */
export function planRegistrationActors(
  registrations: readonly CapturedRegistration[],
  existing: readonly { id: number; email: string; role: string }[],
  openInviteEmails: readonly string[],
): RegistrationActorPlan {
  const problems: string[] = [];
  const actors = new Map<string, { email: string; role: LifecycleRole }>();
  for (const r of registrations) {
    const key = r.adminEmail.toLowerCase();
    const seen = actors.get(key);
    if (!seen) actors.set(key, { email: r.adminEmail, role: r.adminRole });
    else if (seen.role !== r.adminRole) problems.push(`the actor ${key} is captured with two different roles`);
  }
  const invites = new Set(openInviteEmails.map((e) => e.toLowerCase()));
  const plan: RegistrationActorPlan = { reuse: new Map(), create: [] };
  for (const [key, actor] of actors) {
    const matches = existing.filter((e) => e.email.toLowerCase() === key);
    if (matches.length > 1) {
      problems.push(`the actor ${key} matches ${matches.length} auth_users rows`);
    } else if (matches.length === 1) {
      if (matches[0].role !== actor.role) {
        problems.push(`conflicting actor state: auth_users ${matches[0].id} holds ${key} in role '${matches[0].role}', `
          + `the capture records '${actor.role}'; it is never overwritten or downgraded`);
      } else {
        plan.reuse.set(key, matches[0].id);
      }
    } else if (invites.has(key)) {
      problems.push(`an open admin invite exists for ${key}; accepting it would make the attribution-only actor sign-in capable`);
    } else {
      plan.create.push(actor);
    }
  }
  if (problems.length > 0) {
    throw new RegistrationRebuildRefused(
      `The registration actors cannot be recreated safely; nothing was written: ${problems.join('; ')}`);
  }
  return plan;
}

// ---------------------------------------------------------------------------
// Reinstatement (database) — Stage 17, inside the caller's owner transaction
// ---------------------------------------------------------------------------

export type RegistrationReinstateReport = {
  registrations: number;
  creates: number;
  binds: number;
  actorsReused: number;
  actorsCreated: number;
};

async function readReplayState(
  tx: TransactionSql, registrations: readonly CapturedRegistration[],
): Promise<RegistrationReplayState> {
  const [{ manualOverrideRows }] = await tx<{ manualOverrideRows: number }[]>`
    SELECT count(*)::int AS "manualOverrideRows" FROM data_overrides
     WHERE entity_type = 'players' AND split_part(entity_key, ':', 1) = ${MANUAL_NAMESPACE}
  `;
  const manualIdentities = await tx<LiveIdentityRow[]>`
    SELECT e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS status,
           e.match_method AS "matchMethod"
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = ${MANUAL_NAMESPACE}
     ORDER BY e.external_id
  `;
  const paths = registrations.map((r) => r.afltablesProfilePath).filter((p): p is string => p !== null);
  const afltablesForPaths = paths.length === 0 ? [] : await tx<LiveIdentityRow[]>`
    SELECT e.external_id AS "externalId", e.player_id AS "playerId", e.status::text AS status,
           e.match_method AS "matchMethod"
      FROM external_identities e JOIN sources s ON s.id = e.source_id
     WHERE s.key = 'afltables' AND e.external_id = ANY (${tx.array(paths)}::text[])
     ORDER BY e.external_id
  `;
  return { manualOverrideRows, manualIdentities, afltablesForPaths };
}

/**
 * Stage 17, whole, inside the CALLER'S transaction (which has already proved the rebuild marker
 * matches this capture): plan, refuse, recreate actors, insert every creation record exactly as
 * captured, and read each one back byte for byte. Throws on the first problem, so the caller's
 * rollback leaves no override and no actor behind. The players themselves are Stage 18's.
 */
export async function reinstateManualRegistrations(
  tx: TransactionSql, registrations: readonly CapturedRegistration[],
): Promise<RegistrationReinstateReport> {
  const structural = registrationCaptureStructureProblems(registrations);
  if (structural.length > 0) {
    throw new RegistrationRebuildRefused(
      `The registration section cannot be reinstated; nothing was written: ${structural.join('; ')}`);
  }
  if (registrations.length === 0) return { registrations: 0, creates: 0, binds: 0, actorsReused: 0, actorsCreated: 0 };

  const plan = planRegistrationReplay(registrations, await readReplayState(tx, registrations));

  const emails = [...new Set(registrations.map((r) => r.adminEmail.toLowerCase()))];
  const existing = await tx<{ id: number; email: string; role: string }[]>`
    SELECT id, email, role FROM auth_users WHERE lower(email) = ANY (${tx.array(emails)}::text[])
  `;
  const invites = await tx<{ email: string }[]>`
    SELECT email FROM admin_invites
     WHERE lower(email) = ANY (${tx.array(emails)}::text[])
       AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  `;
  const actors = planRegistrationActors(registrations, existing, invites.map((i) => i.email));
  const actorIdByEmail = new Map(actors.reuse);
  for (const actor of actors.create) {
    actorIdByEmail.set(actor.email.toLowerCase(), await insertAttributionOnlyActor(tx, actor));
  }

  // The captured jsonb and timestamptz values are PostgreSQL's own text renderings, bound as
  // `text` and parsed by the server (the ISSUE-235 ledger's rule): bound straight as jsonb the
  // text would be JSON-encoded a second time; as timestamptz it would lose its microseconds.
  for (const r of registrations) {
    await tx`
      INSERT INTO data_overrides
            (entity_type, entity_key, field_group, override_values, is_active, admin_user_id,
             created_at, updated_at)
      VALUES ('players', ${`${MANUAL_NAMESPACE}:${r.token}`}, ${REGISTRATION_FIELD_GROUP},
              ${r.overrideValues}::text::jsonb, true, ${actorIdByEmail.get(r.adminEmail.toLowerCase())!},
              ${r.createdAt}::text::timestamptz, ${r.updatedAt}::text::timestamptz)
    `;
  }

  const readBack = await tx<{ entityKey: string; overrideValues: string; createdAt: string; updatedAt: string; adminUserId: number }[]>`
    SELECT entity_key AS "entityKey", override_values::text AS "overrideValues",
           to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "createdAt",
           to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
           admin_user_id AS "adminUserId"
      FROM data_overrides
     WHERE entity_type = 'players' AND field_group = ${REGISTRATION_FIELD_GROUP} AND is_active
       AND split_part(entity_key, ':', 1) = ${MANUAL_NAMESPACE}
     ORDER BY entity_key
  `;
  const problems = reinstatedRegistrationProblems(registrations, readBack, actorIdByEmail);
  if (problems.length > 0) {
    throw new RegistrationRebuildRefused(`The reinstated creation records do not match the capture: ${problems.join('; ')}`);
  }
  return {
    registrations: registrations.length, creates: plan.creates.length, binds: plan.binds.length,
    actorsReused: actors.reuse.size, actorsCreated: actors.create.length,
  };
}

/** The read-back must be exactly the captured rows: payload text, both timestamps, the remapped actor. */
export function reinstatedRegistrationProblems(
  registrations: readonly CapturedRegistration[],
  readBack: readonly { entityKey: string; overrideValues: string; createdAt: string; updatedAt: string; adminUserId: number }[],
  actorIdByEmail: ReadonlyMap<string, number>,
): string[] {
  if (readBack.length !== registrations.length) {
    return [`${registrations.length} creation record(s) planned but ${readBack.length} read back`];
  }
  const byKey = new Map(readBack.map((r) => [r.entityKey, r]));
  const problems: string[] = [];
  for (const r of registrations) {
    const got = byKey.get(`${MANUAL_NAMESPACE}:${r.token}`);
    if (!got) { problems.push(`registration ${r.token} was not read back`); continue; }
    if (got.overrideValues !== r.overrideValues || got.createdAt !== r.createdAt || got.updatedAt !== r.updatedAt
        || got.adminUserId !== actorIdByEmail.get(r.adminEmail.toLowerCase())) {
      problems.push(`registration ${r.token} was not reinstated byte-for-byte`);
    }
  }
  return problems;
}
