/**
 * AFLDB-ISSUE-257 Slice 1 — the durable Match Sheet authority model, pure.
 *
 * A Match Sheet save is a human decision about source-owned `player_match_stats`
 * rows. That decision is recorded in `data_overrides` (entity_type
 * `player_match_stats`) so a settle, a fitzRoy reload and a promotion do not
 * silently revert it. This module is the DB-free half: the key, the identity
 * rule, the payload shapes, the changed-field calculation and the interpretation
 * of the stored records. No `server-only` import, no database, no filesystem
 * access of its own (the continuity contract is loaded by the caller and handed
 * in), so the settle, the tools and a Next-runtime writer can all share it.
 *
 * FAIL CLOSED throughout: anything this module cannot read with certainty comes
 * back as a typed refusal, never as "no authority".
 *
 * `NULL` means "not recorded", never zero. An absent payload key carries no
 * authority; a JSON `null` is an explicit "this is humanly recorded as not
 * recorded".
 */
import { createHash } from 'node:crypto';

import { deriveDisposals, type PlayerMatchStatInput } from '../match-sheet';
import {
  classifyAflApiForwardIdentity,
} from './afl-api-adjudication';
import {
  loadFitzroyProfileContinuityRules,
  type ValidatedFitzroyProfileContinuityRules,
} from './fitzroy-profile-continuity';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

export const PLAYER_MATCH_STATS_ENTITY = 'player_match_stats';
export const MATCH_SHEET_FIELD_GROUP = 'match_sheet';
export const LINEUP_FIELD_GROUP = 'lineup';

export const AFLTABLES_IDENTITY_PREFIX = 'afltables:';
export const MANUAL_IDENTITY_PREFIX = 'manual_admin_edit:';

/** The Match Sheet's twelve columns; `club_slug` stands for `club_id`. */
export const MATCH_SHEET_FIELDS = [
  'club_slug', 'jumper_number',
  'goals', 'behinds', 'kicks', 'handballs', 'disposals',
  'marks', 'tackles', 'hitouts', 'frees_for', 'frees_against',
] as const;

export type MatchSheetField = (typeof MATCH_SHEET_FIELDS)[number];
export type MatchSheetFieldValue = string | number | null;
/** One player's twelve Match Sheet values (or a pre-image of them). */
export type MatchSheetRowValues = Readonly<Record<MatchSheetField, MatchSheetFieldValue>>;
/** A flat delta: key presence is authority; `null` is an explicit "not recorded". */
export type MatchSheetDelta = Partial<Record<MatchSheetField, MatchSheetFieldValue>>;

/**
 * `disposals = kicks + handballs` is enforced by the Match Sheet validator and by
 * nothing in the schema, so the three are one unit: if any changed, all three are
 * recorded (and protected) together.
 */
export const COUPLED_DISPOSAL_FIELDS = ['kicks', 'handballs', 'disposals'] as const;

const SMALLINT_MAX = 32767;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * entity_key: <match_key>|<player identity>, decoded at the LAST '|'
 * ------------------------------------------------------------------ */

export type PlayerIdentityParts = {
  /** `afltables` or `manual_admin_edit` — the `sources.key`. */
  sourceKey: 'afltables' | 'manual_admin_edit';
  /** The `external_identities.external_id` (the profile path, or the token). */
  externalId: string;
};

/**
 * Splits an identity string at the FIRST `:` into its source key and external id.
 * Only the two durable namespaces are admissible; anything else is `null`.
 */
export function parsePlayerIdentity(identity: string): PlayerIdentityParts | null {
  const at = identity.indexOf(':');
  if (at <= 0) return null;
  const sourceKey = identity.slice(0, at);
  const externalId = identity.slice(at + 1);
  if (externalId === '' || externalId.includes('|')) return null;
  if (sourceKey !== 'afltables' && sourceKey !== 'manual_admin_edit') return null;
  return { sourceKey, externalId };
}

/** The season component of a match key (`^\d{4}\|.`), or null. */
export function seasonOfMatchKeyForAuthority(matchKey: string): number | null {
  const m = /^(\d{4})\|./.exec(matchKey);
  return m ? Number(m[1]) : null;
}

export type EncodeKeyResult =
  | { ok: true; entityKey: string }
  | { ok: false; reason: 'invalid_match_key' | 'identity_contains_separator' | 'invalid_identity' };

/**
 * `(match_key, identity) -> entity_key`. Refuses an identity containing `|` (the
 * only thing that could make the last-`|` decode ambiguous) and any identity that
 * is not `afltables:<path>` / `manual_admin_edit:<token>`.
 */
export function encodePlayerMatchStatsKey(matchKey: string, identity: string): EncodeKeyResult {
  if (identity.includes('|')) return { ok: false, reason: 'identity_contains_separator' };
  if (seasonOfMatchKeyForAuthority(matchKey) === null) return { ok: false, reason: 'invalid_match_key' };
  if (parsePlayerIdentity(identity) === null) return { ok: false, reason: 'invalid_identity' };
  return { ok: true, entityKey: `${matchKey}|${identity}` };
}

export type DecodedPlayerMatchStatsKey = {
  matchKey: string;
  identity: string;
  season: number;
} & PlayerIdentityParts;

/**
 * `entity_key -> (match_key, identity)`, split at the LAST `|`. The match key may
 * itself contain `|` (a club name can); the identity never can. `null` for any key
 * that does not decode exactly: no separator, an empty half, a match half without a
 * season prefix, or an identity that is not one of the two durable namespaces.
 */
export function decodePlayerMatchStatsKey(entityKey: string): DecodedPlayerMatchStatsKey | null {
  const at = entityKey.lastIndexOf('|');
  if (at <= 0) return null;
  const matchKey = entityKey.slice(0, at);
  const identity = entityKey.slice(at + 1);
  const season = seasonOfMatchKeyForAuthority(matchKey);
  const parts = parsePlayerIdentity(identity);
  if (season === null || parts === null) return null;
  return { matchKey, identity, season, ...parts };
}

/**
 * The §18.3 match-scope predicate, in TypeScript: the key starts with
 * `<matchKey>|` and carries no further `|`, so a longer match key that merely
 * shares the prefix (`A|B` against a record of `A|B|C`) is excluded. The SQL
 * counterpart is `starts_with(entity_key, $mk || '|') AND strpos(substr(entity_key,
 * length($mk) + 2), '|') = 0`; never a `LIKE`.
 */
export function entityKeyBelongsToMatch(entityKey: string, matchKey: string): boolean {
  const prefix = `${matchKey}|`;
  return entityKey.startsWith(prefix) && !entityKey.slice(prefix.length).includes('|');
}

/* ------------------------------------------------------------------ *
 * Player identity (D-257-9): path, folded pair, else one manual token
 * ------------------------------------------------------------------ */

export type PlayerIdentityRefusal =
  | 'ambiguous_identity'
  | 'no_durable_identity'
  | 'identity_contains_separator'
  | 'continuity_contract_invalid';

export type PlayerIdentityClassification =
  | { ok: true; identity: string; via: 'afltables' | 'manual_admin_edit' }
  | { ok: false; reason: PlayerIdentityRefusal; detail?: string };

/** The tracked continuity rules, or why they could not be read. */
export type ContinuityRulesLoad =
  | { ok: true; rules: ValidatedFitzroyProfileContinuityRules }
  | { ok: false; detail: string };

/**
 * Loads and validates the tracked fitzRoy continuity contract without throwing.
 * A Next-runtime caller passes an explicit `process.cwd()`-based `contractPath`
 * (the `admin-draft.ts` `loadJson` precedent) rather than relying on the
 * `import.meta.url` default inside a bundle.
 */
export function loadContinuityRulesFailClosed(contractPath?: string): ContinuityRulesLoad {
  try {
    return { ok: true, rules: loadFitzroyProfileContinuityRules(contractPath) };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The ISSUE-257 identity rule over the player's accepted identity rows
 * (`afltables` / `afltables_profile_url`, status `unique`/`resolved`, and the
 * manual tokens), as RAW external ids:
 *
 * - one distinct AFL Tables path -> `afltables:<path>`;
 * - exactly two, and exactly one tracked `profile_url_continuity` rule names that
 *   pair -> `afltables:<rule.continuing_url>`;
 * - any other multi-path state -> `ambiguous_identity`;
 * - no path: exactly one token -> `manual_admin_edit:<token>`; several ->
 *   `ambiguous_identity`; none -> `no_durable_identity`;
 * - an identity containing `|` -> `identity_contains_separator`.
 *
 * The decision itself is `classifyAflApiForwardIdentity`, the single shared
 * implementation behind the rebuild, recovery and promotion forward lookups: there
 * is no second mapping here. The continuity rules are consulted only when exactly
 * two distinct paths exist; an unreadable or malformed contract then fails closed
 * as `continuity_contract_invalid`. (`resolvePlayerIdentity` is deliberately NOT
 * used or changed: it serves draft, season lists, leadership and awards.)
 */
export function classifyPlayerMatchStatsIdentity(input: {
  afltablesPaths: readonly string[];
  manualTokens: readonly string[];
  continuity: ContinuityRulesLoad;
}): PlayerIdentityClassification {
  const distinctPaths = new Set(input.afltablesPaths);
  if (distinctPaths.size === 2 && !input.continuity.ok) {
    return { ok: false, reason: 'continuity_contract_invalid', detail: input.continuity.detail };
  }
  const rules: ValidatedFitzroyProfileContinuityRules = input.continuity.ok
    ? input.continuity.rules
    : ([] as unknown as ValidatedFitzroyProfileContinuityRules);
  const result = classifyAflApiForwardIdentity({
    afltablesPaths: input.afltablesPaths,
    manualIdentities: input.manualTokens,
    continuityRules: rules,
  });
  if (!result.ok) {
    return { ok: false, reason: result.reason === 'ambiguous' ? 'ambiguous_identity' : 'no_durable_identity' };
  }
  const identity = result.via === 'afltables'
    ? `${AFLTABLES_IDENTITY_PREFIX}${result.identity}`
    : `${MANUAL_IDENTITY_PREFIX}${result.identity}`;
  if (identity.includes('|')) return { ok: false, reason: 'identity_contains_separator' };
  return { ok: true, identity, via: result.via };
}

/**
 * Every identity string that resolves to the player: each accepted AFL Tables path
 * (both members of a folded pair) and each manual token. The input to
 * `decideAuthorityKey`; deduplicated and sorted for determinism.
 */
export function resolvableIdentityForms(input: {
  afltablesPaths: readonly string[];
  manualTokens: readonly string[];
}): readonly string[] {
  return [...new Set([
    ...input.afltablesPaths.map((p) => `${AFLTABLES_IDENTITY_PREFIX}${p}`),
    ...input.manualTokens.map((t) => `${MANUAL_IDENTITY_PREFIX}${t}`),
  ])].sort();
}

/* ------------------------------------------------------------------ *
 * D-257-9 reverse resolution: a STORED identity -> exactly one player
 * ------------------------------------------------------------------ */

export type StoredIdentityRefusal =
  | 'invalid_identity'
  | 'continuity_contract_invalid'
  /** The identity names no accepted external identity. */
  | 'unresolved'
  /** A side of the pair names more than one player. */
  | 'ambiguous'
  /** A tracked pair's OTHER side names no accepted external identity. */
  | 'partner_missing'
  /** The two sides of a tracked pair resolve to different players. */
  | 'split';

export type StoredIdentityResolution =
  | { ok: true; playerId: number }
  | { ok: false; reason: StoredIdentityRefusal; detail?: string };

/**
 * The OTHER side of every tracked `profile_url_continuity` rule that names `path`
 * (as either side), de-duplicated and sorted. Empty when no rule names it.
 */
export function continuityPartnersOf(
  path: string, rules: ValidatedFitzroyProfileContinuityRules,
): string[] {
  const partners = new Set<string>();
  for (const rule of rules) {
    if (rule.continuingUrl === path) partners.add(rule.renumberedUrl);
    else if (rule.renumberedUrl === path) partners.add(rule.continuingUrl);
  }
  return [...partners].sort();
}

/**
 * The reverse of `classifyPlayerMatchStatsIdentity` (D-257-9), shared by the settle
 * snapshot, the replay preflight (the Python twin is `pms_resolve_identity` in
 * `tools/migration/common.py`, pinned by a parity corpus) and promotion:
 *
 * - `manual_admin_edit:<token>` resolves iff exactly one distinct player holds it;
 * - `afltables:<path>` in no tracked rule resolves iff exactly one distinct player
 *   holds it;
 * - a path that is EITHER side of a tracked rule resolves only if BOTH sides (the
 *   path and every partner) each resolve to exactly one player and it is the SAME
 *   player. A split, missing or ambiguous side is refused.
 *
 * `playerIdsByIdentity` is keyed by the full identity string and holds the distinct
 * players of accepted rows (`afltables` / `afltables_profile_url`, status
 * `unique`/`resolved`; manual tokens). An unreadable contract fails closed for every
 * identity: a path that cannot be shown to be in no rule is not resolvable.
 */
export function resolveStoredIdentityToPlayer(input: {
  identity: string;
  playerIdsByIdentity: ReadonlyMap<string, readonly number[]>;
  continuity: ContinuityRulesLoad;
}): StoredIdentityResolution {
  if (!input.continuity.ok) {
    return { ok: false, reason: 'continuity_contract_invalid', detail: input.continuity.detail };
  }
  const parts = parsePlayerIdentity(input.identity);
  if (parts === null) return { ok: false, reason: 'invalid_identity' };
  const playersOf = (identity: string) => new Set(input.playerIdsByIdentity.get(identity) ?? []);

  const own = playersOf(input.identity);
  if (own.size === 0) return { ok: false, reason: 'unresolved' };
  if (own.size > 1) return { ok: false, reason: 'ambiguous' };
  const playerId = [...own][0];
  if (parts.sourceKey === 'manual_admin_edit') return { ok: true, playerId };

  for (const partner of continuityPartnersOf(parts.externalId, input.continuity.rules)) {
    const other = playersOf(`${AFLTABLES_IDENTITY_PREFIX}${partner}`);
    if (other.size === 0) return { ok: false, reason: 'partner_missing', detail: partner };
    if (other.size > 1) return { ok: false, reason: 'ambiguous', detail: partner };
    if ([...other][0] !== playerId) return { ok: false, reason: 'split', detail: partner };
  }
  return { ok: true, playerId };
}

/* ------------------------------------------------------------------ *
 * D-257-8: stable-key reuse across identity upgrades
 * ------------------------------------------------------------------ */

/** The columns of an existing `data_overrides` record this decision needs. */
export type AuthorityRecordRef = {
  entityKey: string;
  fieldGroup: string;
  isActive: boolean;
};

export type AuthorityKeyDecision =
  | { ok: true; action: 'reuse' | 'mint'; identity: string; entityKey: string }
  | {
    ok: false;
    reason: PlayerIdentityRefusal | 'ambiguous_authority' | 'malformed_authority_key' | 'invalid_key';
    detail?: string;
  };

/**
 * Which key a (match, player) decision is recorded under.
 *
 * Records are resolved by the identity ENCODED in their key, never by string
 * equality with today's preferred identity: a player who later gains an AFL Tables
 * path keeps the key their decision already has. Of the match's records, those
 * whose encoded identity is one of the player's resolvable `forms` belong to the
 * player. Under exactly one identity form -> `reuse` it; under none -> `mint` the
 * current canonical identity; under more than one -> `ambiguous_authority`
 * (operator repair). A record in the match's scope whose key does not decode
 * refuses (`malformed_authority_key`) rather than being skipped.
 *
 * INACTIVE records count. A withdrawn (Return to source) record still names the
 * identity form the decision was made under; re-saving reactivates it under the
 * same key rather than minting a second form, which would leave one player with
 * two forms of authority for one match and make the next save ambiguous.
 *
 * A failed canonical classification refuses first: an identity that cannot be
 * classified (ambiguous, none, `|`, bad contract) is not a basis for any write.
 */
export function decideAuthorityKey(input: {
  matchKey: string;
  canonical: PlayerIdentityClassification;
  forms: readonly string[];
  /** The match's ISSUE-257 records (rows outside the match scope are ignored). */
  records: readonly AuthorityRecordRef[];
}): AuthorityKeyDecision {
  if (!input.canonical.ok) {
    return { ok: false, reason: input.canonical.reason, detail: input.canonical.detail };
  }
  const forms = new Set(input.forms);
  const found = new Set<string>();
  for (const record of input.records) {
    if (!entityKeyBelongsToMatch(record.entityKey, input.matchKey)) continue;
    const decoded = decodePlayerMatchStatsKey(record.entityKey);
    if (decoded === null) {
      return { ok: false, reason: 'malformed_authority_key', detail: record.entityKey };
    }
    if (forms.has(decoded.identity)) found.add(decoded.identity);
  }
  if (found.size > 1) {
    return { ok: false, reason: 'ambiguous_authority', detail: [...found].sort().join(', ') };
  }
  const identity = found.size === 1 ? [...found][0] : input.canonical.identity;
  const encoded = encodePlayerMatchStatsKey(input.matchKey, identity);
  if (!encoded.ok) return { ok: false, reason: 'invalid_key', detail: encoded.reason };
  return { ok: true, action: found.size === 1 ? 'reuse' : 'mint', identity, entityKey: encoded.entityKey };
}

/* ------------------------------------------------------------------ *
 * Changed-field calculation
 * ------------------------------------------------------------------ */

/**
 * The fields a save changed, against the locked pre-image. A missing row's
 * pre-image is all-null (`pre = null`), so one rule serves an update and an
 * addition: an addition records exactly its non-null entered fields (plus the
 * coupled disposal triple when any of the three is entered). An unchanged field
 * records nothing; a field changed to `null` records an explicit `null`; a field
 * changed back to the source's value is still recorded (D-257-3).
 */
export function computeMatchSheetDelta(
  pre: MatchSheetRowValues | null, next: MatchSheetRowValues,
): MatchSheetDelta {
  const delta: MatchSheetDelta = {};
  for (const field of MATCH_SHEET_FIELDS) {
    const before = pre === null ? null : pre[field];
    if (before !== next[field]) delta[field] = next[field];
  }
  if (COUPLED_DISPOSAL_FIELDS.some((field) => field in delta)) {
    for (const field of COUPLED_DISPOSAL_FIELDS) delta[field] = next[field];
  }
  return delta;
}

/** Merge a new delta into an existing payload: existing keys kept, incoming overwrite. */
export function mergeMatchSheetDelta(
  existing: MatchSheetDelta | null, incoming: MatchSheetDelta,
): MatchSheetDelta {
  return { ...(existing ?? {}), ...incoming };
}

/** The canonical column names a delta protects (`club_slug` -> `club_id`). */
export function protectedColumnsOf(delta: MatchSheetDelta): ReadonlySet<string> {
  const columns = new Set<string>();
  for (const key of Object.keys(delta) as MatchSheetField[]) {
    columns.add(key === 'club_slug' ? 'club_id' : key);
  }
  return columns;
}

/* ------------------------------------------------------------------ *
 * Payload parse / validate (strict; unknown key => unreadable)
 * ------------------------------------------------------------------ */

export type PayloadParse<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'payload_unreadable'; detail: string };

const unreadable = (detail: string): { ok: false; reason: 'payload_unreadable'; detail: string } =>
  ({ ok: false, reason: 'payload_unreadable', detail });

/**
 * Validates a stored `match_sheet` payload. Strict: a non-object, an empty object,
 * an unknown key, a mistyped value, a partial disposal triple or a triple that
 * does not sum all make the record unreadable (the caller treats that as
 * indeterminate / refuses).
 */
export function parseMatchSheetPayload(raw: unknown): PayloadParse<MatchSheetDelta> {
  if (!isRecord(raw)) return unreadable('match_sheet payload is not an object');
  const known = new Set<string>(MATCH_SHEET_FIELDS);
  const keys = Object.keys(raw);
  if (keys.length === 0) return unreadable('match_sheet payload is empty');
  const delta: MatchSheetDelta = {};
  for (const key of keys) {
    if (!known.has(key)) return unreadable(`unknown match_sheet key ${JSON.stringify(key)}`);
    const field = key as MatchSheetField;
    const value = raw[key];
    if (field === 'club_slug') {
      if (typeof value !== 'string' || value === '') return unreadable('club_slug must be a non-empty string');
    } else if (field === 'jumper_number') {
      if (value !== null && (typeof value !== 'string' || value === '' || value.length > 4)) {
        return unreadable('jumper_number must be null or a 1-4 character string');
      }
    } else if (value !== null
      && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > SMALLINT_MAX)) {
      return unreadable(`${field} must be null or a non-negative integer`);
    }
    delta[field] = value as MatchSheetFieldValue;
  }
  const present = COUPLED_DISPOSAL_FIELDS.filter((field) => field in delta);
  if (present.length !== 0 && present.length !== COUPLED_DISPOSAL_FIELDS.length) {
    return unreadable('kicks, handballs and disposals must be recorded together');
  }
  const { kicks, handballs, disposals } = delta;
  if (typeof kicks === 'number' && typeof handballs === 'number' && typeof disposals === 'number'
    && disposals !== kicks + handballs) {
    return unreadable('disposals does not equal kicks plus handballs');
  }
  return { ok: true, value: delta };
}

/** Validates a stored `lineup` payload: exactly `{"present": boolean}`. */
export function parseLineupPayload(raw: unknown): PayloadParse<{ present: boolean }> {
  if (!isRecord(raw)) return unreadable('lineup payload is not an object');
  const keys = Object.keys(raw);
  if (keys.length !== 1 || keys[0] !== 'present' || typeof raw.present !== 'boolean') {
    return unreadable('lineup payload must be exactly {"present": boolean}');
  }
  return { ok: true, value: { present: raw.present } };
}

/* ------------------------------------------------------------------ *
 * Interpreting one key's stored records
 * ------------------------------------------------------------------ */

export type StoredAuthorityRecord = {
  fieldGroup: string;
  isActive: boolean;
  overrideValues: unknown;
};

export type KeyAuthority =
  | {
    ok: true;
    /** The active `match_sheet` delta, or null when none is active. */
    fields: MatchSheetDelta | null;
    /** The active `lineup` presence; null when no active lineup record. */
    presence: 'present' | 'removed' | null;
  }
  | { ok: false; reason: 'payload_unreadable' | 'unknown_field_group' | 'duplicate_field_group'; detail: string };

/**
 * Interprets the records of ONE entity_key. `is_active = false` means returned to
 * source: no authority, whatever the payload held (an inactive record is not even
 * parsed). An ACTIVE record in an unknown field group, a duplicated group, or with
 * an unreadable payload makes the key unreadable.
 */
export function interpretKeyAuthority(records: readonly StoredAuthorityRecord[]): KeyAuthority {
  let fields: MatchSheetDelta | null = null;
  let presence: 'present' | 'removed' | null = null;
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.fieldGroup)) {
      return { ok: false, reason: 'duplicate_field_group', detail: record.fieldGroup };
    }
    seen.add(record.fieldGroup);
    if (!record.isActive) continue;
    if (record.fieldGroup === MATCH_SHEET_FIELD_GROUP) {
      const parsed = parseMatchSheetPayload(record.overrideValues);
      if (!parsed.ok) return parsed;
      fields = parsed.value;
    } else if (record.fieldGroup === LINEUP_FIELD_GROUP) {
      const parsed = parseLineupPayload(record.overrideValues);
      if (!parsed.ok) return parsed;
      presence = parsed.value.present ? 'present' : 'removed';
    } else {
      return { ok: false, reason: 'unknown_field_group', detail: record.fieldGroup };
    }
  }
  return { ok: true, fields, presence };
}

/* ------------------------------------------------------------------ *
 * Slice 6 — the ISSUE-238 correction's authority guard (F-PR-06)
 * ------------------------------------------------------------------ */

/** One stored record of a match, as the identity-correction guard reads it. */
export type MatchAuthorityRecord = StoredAuthorityRecord & { entityKey: string };

export type ManualAuthorityBlocker = {
  entityKey: string;
  /** The ACTIVE field groups of an `authority` blocker; every group of the key when indeterminate. */
  fieldGroups: readonly string[];
  kind: 'authority' | 'indeterminate';
  /** Why the key could not be proven not to name P or P′ (indeterminate only). */
  reason: string | null;
};

/**
 * Which ISSUE-257 records of ONE match stop an ORIGINAL identity correction from
 * MOVEing / DELETEing the closure row of P at that match. Pure.
 *
 * A key's records are interpreted together (`interpretKeyAuthority`): a key whose
 * records are all withdrawn carries no authority and never blocks. Otherwise the key's
 * ENCODED identity is resolved to a player (`resolveStoredIdentityToPlayer`, D-257-9);
 * `pId` or `pPrimeId` -> `authority`. Fail closed: a key that does not decode, records
 * that cannot be interpreted (unreadable payload, unknown or duplicate group) or an
 * identity that does not resolve to exactly one player (including an unreadable
 * continuity contract) cannot be proven not to be P/P′ -> `indeterminate`.
 * Records outside the match's key scope (§18.3 predicate) are ignored.
 */
export function manualAuthorityBlockersForMatch(input: {
  matchKey: string;
  records: readonly MatchAuthorityRecord[];
  playerIdsByIdentity: ReadonlyMap<string, readonly number[]>;
  continuity: ContinuityRulesLoad;
  pId: number;
  pPrimeId: number;
}): readonly ManualAuthorityBlocker[] {
  const byKey = new Map<string, MatchAuthorityRecord[]>();
  for (const record of input.records) {
    if (!entityKeyBelongsToMatch(record.entityKey, input.matchKey)) continue;
    const list = byKey.get(record.entityKey) ?? [];
    list.push(record);
    byKey.set(record.entityKey, list);
  }
  const blockers: ManualAuthorityBlocker[] = [];
  for (const entityKey of [...byKey.keys()].sort()) {
    const records = byKey.get(entityKey)!;
    const allGroups = records.map((r) => r.fieldGroup).sort();
    const indeterminate = (reason: string): void => {
      blockers.push({ entityKey, fieldGroups: allGroups, kind: 'indeterminate', reason });
    };
    const decoded = decodePlayerMatchStatsKey(entityKey);
    if (decoded === null) { indeterminate('key does not decode'); continue; }
    const interpreted = interpretKeyAuthority(records);
    if (!interpreted.ok) { indeterminate(`${interpreted.reason}: ${interpreted.detail}`); continue; }
    if (interpreted.fields === null && interpreted.presence === null) continue; // all withdrawn
    const resolution = resolveStoredIdentityToPlayer({
      identity: decoded.identity, playerIdsByIdentity: input.playerIdsByIdentity, continuity: input.continuity,
    });
    if (!resolution.ok) { indeterminate(`identity ${resolution.reason}`); continue; }
    if (resolution.playerId !== input.pId && resolution.playerId !== input.pPrimeId) continue;
    blockers.push({
      entityKey,
      fieldGroups: records.filter((r) => r.isActive).map((r) => r.fieldGroup).sort(),
      kind: 'authority',
      reason: null,
    });
  }
  return blockers;
}

/** The STOP `detail` for `manual_authority_present`: names every blocking key and group. */
export function describeManualAuthorityBlockers(blockers: readonly ManualAuthorityBlocker[]): string {
  return blockers.map((b) => b.kind === 'authority'
    ? `active Match Sheet authority ${b.entityKey} [${b.fieldGroups.join(',')}]`
    : `indeterminate Match Sheet authority ${b.entityKey} [${b.fieldGroups.join(',')}]: ${b.reason}`).join('; ');
}

/* ------------------------------------------------------------------ *
 * Slice 3 — stale-sheet token, per-player planning, authority writes
 * ------------------------------------------------------------------ */

/** One `player_match_stats` row as the Match Sheet sees it (its twelve columns + the key). */
export type MatchSheetStatRow = {
  playerId: number;
  clubId: number;
  jumperNumber: string | null;
  goals: number | null;
  behinds: number | null;
  kicks: number | null;
  handballs: number | null;
  disposals: number | null;
  marks: number | null;
  tackles: number | null;
  hitouts: number | null;
  freesFor: number | null;
  freesAgainst: number | null;
};

const nullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * The stale-sheet token: a SHA-256 over the match's FULL set of Match Sheet rows,
 * ordered by player id, so it is independent of row order and changes if any value
 * changes or any row is inserted or deleted. Computed from the unlocked read at page
 * load and recomputed from the locked read inside the save transaction.
 */
export function matchSheetStaleToken(rows: readonly MatchSheetStatRow[]): string {
  const canonical = [...rows]
    .sort((a, b) => Number(a.playerId) - Number(b.playerId))
    .map((r) => [
      Number(r.playerId), Number(r.clubId), r.jumperNumber ?? null,
      nullableNumber(r.goals), nullableNumber(r.behinds), nullableNumber(r.kicks),
      nullableNumber(r.handballs), nullableNumber(r.disposals), nullableNumber(r.marks),
      nullableNumber(r.tackles), nullableNumber(r.hitouts), nullableNumber(r.freesFor),
      nullableNumber(r.freesAgainst),
    ]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export type MatchSheetPlanItem =
  | {
    kind: 'add' | 'update';
    playerId: number;
    row: MatchSheetStatRow;
    pre: MatchSheetRowValues | null;
    delta: MatchSheetDelta;
  }
  | { kind: 'remove'; playerId: number; pre: MatchSheetRowValues };

export type MatchSheetPlan =
  | { ok: true; items: MatchSheetPlanItem[] }
  | { ok: false; error: string };

function rowValuesOf(
  row: MatchSheetStatRow, slugOf: (clubId: number) => string | undefined,
): MatchSheetRowValues | string {
  const slug = slugOf(Number(row.clubId));
  if (slug === undefined) return `Club #${row.clubId} has no slug.`;
  return {
    club_slug: slug,
    jumper_number: row.jumperNumber ?? null,
    goals: nullableNumber(row.goals), behinds: nullableNumber(row.behinds),
    kicks: nullableNumber(row.kicks), handballs: nullableNumber(row.handballs),
    disposals: nullableNumber(row.disposals), marks: nullableNumber(row.marks),
    tackles: nullableNumber(row.tackles), hitouts: nullableNumber(row.hitouts),
    frees_for: nullableNumber(row.freesFor), frees_against: nullableNumber(row.freesAgainst),
  };
}

/**
 * Per-player planning against the LOCKED rows as the pre-image. A player whose
 * submitted values equal the locked row produces nothing; an absent row is an
 * addition (all-null pre-image); a removal of a row that does not exist is a no-op.
 * Rows the sheet did not mention are untouched.
 */
export function planMatchSheetChanges(input: {
  locked: readonly MatchSheetStatRow[];
  players: readonly PlayerMatchStatInput[];
  removedPlayerIds: readonly number[];
  clubSlugById: ReadonlyMap<number, string>;
}): MatchSheetPlan {
  const slugOf = (clubId: number) => input.clubSlugById.get(clubId);
  const lockedById = new Map(input.locked.map((row) => [Number(row.playerId), row]));
  const items: MatchSheetPlanItem[] = [];

  for (const playerId of input.removedPlayerIds) {
    const row = lockedById.get(playerId);
    if (row === undefined) continue;
    const pre = rowValuesOf(row, slugOf);
    if (typeof pre === 'string') return { ok: false, error: pre };
    items.push({ kind: 'remove', playerId, pre });
  }

  for (const p of input.players) {
    const kicks = p.kicks ?? null;
    const handballs = p.handballs ?? null;
    const next: MatchSheetStatRow = {
      playerId: p.playerId,
      clubId: p.clubId,
      jumperNumber: p.jumperNumber?.trim() || null,
      goals: p.goals ?? null, behinds: p.behinds ?? null, kicks, handballs,
      disposals: deriveDisposals(kicks, handballs, p.disposals),
      marks: p.marks ?? null, tackles: p.tackles ?? null, hitouts: p.hitouts ?? null,
      freesFor: p.freesFor ?? null, freesAgainst: p.freesAgainst ?? null,
    };
    const nextValues = rowValuesOf(next, slugOf);
    if (typeof nextValues === 'string') return { ok: false, error: nextValues };
    const lockedRow = lockedById.get(p.playerId);
    let pre: MatchSheetRowValues | null = null;
    if (lockedRow !== undefined) {
      const preValues = rowValuesOf(lockedRow, slugOf);
      if (typeof preValues === 'string') return { ok: false, error: preValues };
      pre = preValues;
    }
    const delta = computeMatchSheetDelta(pre, nextValues);
    if (pre !== null && Object.keys(delta).length === 0) continue;
    items.push({ kind: pre === null ? 'add' : 'update', playerId: p.playerId, row: next, pre, delta });
  }
  return { ok: true, items };
}

export type PlayerIdentityRows = {
  afltablesPaths: readonly string[];
  manualTokens: readonly string[];
};

export type AuthorityRecordRow = {
  entityKey: string;
  fieldGroup: string;
  isActive: boolean;
  /** The parsed jsonb payload (`null` when unparseable). */
  overrideValues: unknown;
};

export type AuthorityWriteOp =
  | {
    kind: 'upsert';
    entityKey: string;
    fieldGroup: typeof MATCH_SHEET_FIELD_GROUP | typeof LINEUP_FIELD_GROUP;
    payload: MatchSheetDelta | { present: boolean };
  }
  | { kind: 'deactivate'; entityKey: string; fieldGroup: typeof MATCH_SHEET_FIELD_GROUP };

export type AuthorityWritePlan =
  | {
    ok: true;
    ops: AuthorityWriteOp[];
    keys: { playerId: number; entityKey: string; action: 'reuse' | 'mint' }[];
  }
  | { ok: false; error: string };

export const AUTHORITY_UNAVAILABLE_REFUSAL =
  'Durable Match Sheet authority is not available until migration 110 is applied; nothing was saved.';

export const MATCH_SHEET_SETTLE_RUNNING_REFUSAL =
  'A source settle is running for this match; try again in a moment. Nothing was saved.';

/**
 * Error classification only (AFLDB-ISSUE-257 F-S4-01 / F-S4-02): a lock timeout
 * (`55P03`) or a deadlock victim (`40P01`) means the whole save transaction rolled
 * back while a settle held the rows, so the admin gets the retryable refusal.
 * Nothing is retried here and nothing partial survives; every other error is not
 * retryable and returns `null`.
 */
export function matchSheetRetryableRefusal(error: unknown): string | null {
  const code = typeof error === 'object' && error !== null
    ? (error as { code?: unknown }).code
    : undefined;
  return code === '55P03' || code === '40P01' ? MATCH_SHEET_SETTLE_RUNNING_REFUSAL : null;
}

/**
 * Turns the plan into the `data_overrides` writes (D-257-8 / D-257-9). Pure: the
 * caller supplies the storable probe result, each changed player's identity rows,
 * the continuity load and the match's existing records. No plan items -> no writes
 * and no probe requirement; any item with the probe false -> the State A refusal.
 * Anything unclassifiable, ambiguous or unreadable refuses the WHOLE save.
 */
export function buildMatchSheetAuthorityWrites(input: {
  matchKey: string;
  items: readonly MatchSheetPlanItem[];
  storable: boolean;
  continuity: ContinuityRulesLoad;
  identities: ReadonlyMap<number, PlayerIdentityRows>;
  records: readonly AuthorityRecordRow[];
}): AuthorityWritePlan {
  if (input.items.length === 0) return { ok: true, ops: [], keys: [] };
  if (!input.storable) return { ok: false, error: AUTHORITY_UNAVAILABLE_REFUSAL };

  const ops: AuthorityWriteOp[] = [];
  const keys: { playerId: number; entityKey: string; action: 'reuse' | 'mint' }[] = [];
  const seenKeys = new Map<string, number>();

  for (const item of input.items) {
    const rows = input.identities.get(item.playerId) ?? { afltablesPaths: [], manualTokens: [] };
    const canonical = classifyPlayerMatchStatsIdentity({
      afltablesPaths: rows.afltablesPaths, manualTokens: rows.manualTokens, continuity: input.continuity,
    });
    const decision = decideAuthorityKey({
      matchKey: input.matchKey,
      canonical,
      forms: resolvableIdentityForms(rows),
      records: input.records,
    });
    if (!decision.ok) {
      return {
        ok: false,
        error: `Player #${item.playerId} cannot be saved: ${decision.reason}${decision.detail ? ` (${decision.detail})` : ''}. Nothing was saved.`,
      };
    }
    const owner = seenKeys.get(decision.entityKey);
    if (owner !== undefined) {
      return {
        ok: false,
        error: `Players #${owner} and #${item.playerId} resolve to the same durable identity. Nothing was saved.`,
      };
    }
    seenKeys.set(decision.entityKey, item.playerId);
    keys.push({ playerId: item.playerId, entityKey: decision.entityKey, action: decision.action });

    const authority = interpretKeyAuthority(
      input.records.filter((r) => r.entityKey === decision.entityKey),
    );
    if (!authority.ok) {
      return {
        ok: false,
        error: `Player #${item.playerId} has unreadable stored authority (${authority.reason}: ${authority.detail}). Nothing was saved.`,
      };
    }

    if (item.kind === 'remove') {
      ops.push({ kind: 'upsert', entityKey: decision.entityKey, fieldGroup: LINEUP_FIELD_GROUP, payload: { present: false } });
      ops.push({ kind: 'deactivate', entityKey: decision.entityKey, fieldGroup: MATCH_SHEET_FIELD_GROUP });
      continue;
    }
    if (item.kind === 'add') {
      ops.push({ kind: 'upsert', entityKey: decision.entityKey, fieldGroup: LINEUP_FIELD_GROUP, payload: { present: true } });
    }
    // An addition starts a fresh payload; an update merges over the ACTIVE one only.
    const payload = item.kind === 'add' ? item.delta : mergeMatchSheetDelta(authority.fields, item.delta);
    const parsed = parseMatchSheetPayload(payload);
    if (!parsed.ok) {
      return { ok: false, error: `Player #${item.playerId}: ${parsed.detail}. Nothing was saved.` };
    }
    ops.push({ kind: 'upsert', entityKey: decision.entityKey, fieldGroup: MATCH_SHEET_FIELD_GROUP, payload });
  }
  return { ok: true, ops, keys };
}

/* ------------------------------------------------------------------ *
 * Slice 7 — match deletion guard and "Return to source" (D-257-5 / D-257-6)
 * ------------------------------------------------------------------ */

/**
 * The `sources.key` values that legitimately own a `player_match_stats` row (D-257-6 refined:
 * a returned addition whose row one of them now owns is withdrawn and the row KEPT):
 * `SETTLE_SOURCE_KEY` of `settle-afltables.ts` ('afltables') and of `settle-afl-api.ts`
 * ('afl_api'), and the fitzRoy core reload's `SOURCE_KEY_FITZROY` ('fitzroy_afldata',
 * `import_fitzroy_core.py`), which owns the reloaded player-match facts — the F-PR-03 case of a
 * reload whose source now carries the added player. Pinned to all three declarations by a
 * source test.
 */
export const SETTLING_SOURCE_KEYS: readonly string[] = ['afltables', 'afl_api', 'fitzroy_afldata'];

export type MatchAuthorityEntry = {
  entityKey: string;
  playerId: number;
  kind: 'fields' | 'addition' | 'removal';
  /** The active `match_sheet` payload keys (empty when none). */
  fields: string[];
  activeGroups: string[];
};

export type MatchAuthorityIndeterminate = {
  entityKey: string;
  reason: string;
  activeGroups: string[];
};

export type MatchAuthoritySummary = {
  entries: MatchAuthorityEntry[];
  indeterminate: MatchAuthorityIndeterminate[];
};

/**
 * The ACTIVE durable authority of ONE match, per key. Pure. A key with no active
 * record carries none (inactive = returned to source) and is omitted. Fail closed: an
 * active key that does not decode, cannot be interpreted, or whose identity does not
 * resolve to exactly one player is `indeterminate`, never "no authority". Records
 * outside the §18.3 match scope are ignored.
 */
export function summariseActiveMatchAuthority(input: {
  matchKey: string;
  records: readonly MatchAuthorityRecord[];
  playerIdsByIdentity: ReadonlyMap<string, readonly number[]>;
  continuity: ContinuityRulesLoad;
}): MatchAuthoritySummary {
  const byKey = new Map<string, MatchAuthorityRecord[]>();
  for (const record of input.records) {
    if (!entityKeyBelongsToMatch(record.entityKey, input.matchKey)) continue;
    const list = byKey.get(record.entityKey) ?? [];
    list.push(record);
    byKey.set(record.entityKey, list);
  }
  const entries: MatchAuthorityEntry[] = [];
  const indeterminate: MatchAuthorityIndeterminate[] = [];
  for (const entityKey of [...byKey.keys()].sort()) {
    const records = byKey.get(entityKey)!;
    const activeGroups = records.filter((r) => r.isActive).map((r) => r.fieldGroup).sort();
    if (activeGroups.length === 0) continue;
    const fail = (reason: string): void => {
      indeterminate.push({ entityKey, reason, activeGroups });
    };
    const decoded = decodePlayerMatchStatsKey(entityKey);
    if (decoded === null) { fail('key does not decode'); continue; }
    const interpreted = interpretKeyAuthority(records);
    if (!interpreted.ok) { fail(`${interpreted.reason}: ${interpreted.detail}`); continue; }
    const resolution = resolveStoredIdentityToPlayer({
      identity: decoded.identity, playerIdsByIdentity: input.playerIdsByIdentity, continuity: input.continuity,
    });
    if (!resolution.ok) { fail(`identity ${resolution.reason}`); continue; }
    entries.push({
      entityKey,
      playerId: resolution.playerId,
      kind: interpreted.presence === 'present' ? 'addition'
        : interpreted.presence === 'removed' ? 'removal' : 'fields',
      fields: interpreted.fields === null ? [] : Object.keys(interpreted.fields),
      activeGroups,
    });
  }
  return { entries, indeterminate };
}

export type ReturnToSourcePlan =
  | { ok: true; action: 'withdraw_only' | 'withdraw_delete_row' | 'withdraw_keep_row' }
  | { ok: false; error: string };

/**
 * What "Return to source" does for ONE player's key (D-257-6), pure. `authority` is the
 * interpretation of that key's records; `row` is the player's current
 * `player_match_stats` row at the match (`null` when absent) with the owning
 * `sources.key` (`null` = unowned, i.e. `source_id IS NULL`).
 *
 * - nothing active -> refuse;
 * - field authority only -> withdraw (the next settle restores source values);
 * - manual removal -> the row must be absent, else refuse; withdraw (the settle restores it);
 * - manual addition -> row absent: refuse; unowned: withdraw + DELETE the row; owned by a
 *   settling source (`SETTLING_SOURCE_KEYS`): withdraw, KEEP the row (the source adopted it
 *   since); any other owner: refuse. Never invents a source value.
 */
export function planReturnToSource(input: {
  authority: KeyAuthority;
  row: { sourceKey: string | null; hasSourceId: boolean } | null;
}): ReturnToSourcePlan {
  const { authority, row } = input;
  if (!authority.ok) {
    return { ok: false, error: `the stored authority is unreadable (${authority.reason}: ${authority.detail})` };
  }
  if (authority.fields === null && authority.presence === null) {
    return { ok: false, error: 'no durable Match Sheet authority for this player in this match' };
  }
  if (authority.presence === 'removed') {
    if (row !== null) {
      return { ok: false, error: 'the manually removed player still has a row in this match (unexpected state); repair it before returning to source' };
    }
    return { ok: true, action: 'withdraw_only' };
  }
  if (authority.presence === 'present') {
    if (row === null) {
      return { ok: false, error: 'the manually added player has no row in this match (unexpected state); repair it before returning to source' };
    }
    if (!row.hasSourceId) return { ok: true, action: 'withdraw_delete_row' };
    if (row.sourceKey !== null && SETTLING_SOURCE_KEYS.includes(row.sourceKey)) {
      return { ok: true, action: 'withdraw_keep_row' };
    }
    return { ok: false, error: `the row is owned by an unexpected source (${row.sourceKey ?? 'unknown'}); repair it before returning to source` };
  }
  return { ok: true, action: 'withdraw_only' };
}
