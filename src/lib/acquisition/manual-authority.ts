/**
 * AFLDB-ISSUE-122 §8 — the real `ManualAuthorityProvider`.
 *
 * This module answers exactly one question, for exactly one caller: has a
 * human already decided any of the fields this acquisition run proposes to
 * change? It stores nothing, writes nothing, and has no bypass. Every answer
 * it cannot fully justify is `'indeterminate'`, which refuses.
 *
 * **`data_overrides` is the authority record, and it is the only one read.**
 * `data_edits` is the append-only audit log, deliberately NOT consulted:
 * `afldb_import` holds INSERT and no SELECT on it (`privileges.sql`), and
 * `AFLDB-ISSUE-096` §7 declares it evidence rather than authority. Because
 * `applyDataEdit()` upserts the `data_overrides` row in the SAME transaction
 * as the canonical edit (`src/db/queries/data-edits.ts:230-238`), the whole
 * authority question is answerable from a table the settle role can already
 * read. No grant is widened to build this.
 *
 * **The proposition is proven at load time, not assumed.**
 *
 * The proposition is exactly this: an override for `match_period_scores` or
 * `brownlow_round_votes` is unrepresentable at the database level — not merely
 * unobserved. Those targets answer `'clear'` on proof rather than on optimism,
 * and `AFLDB-ISSUE-099` A4 is satisfied without widening the `data_overrides`
 * CHECK to admit them. When the proof cannot be established the targets answer
 * `'indeterminate'` instead, which refuses. (`player_match_stats` was a third
 * until AFLDB-ISSUE-257: it is now answered from its own active records, like
 * `matches`; see `buildPlayerMatchStatsAuthority`.)
 *
 * `overrideScopeProven` is true only when ALL FOUR of these hold
 * (`AFLDB-ISSUE-159` §3.1, decision D-1):
 *
 * 1. the live `data_overrides.entity_type` CHECK is readable and unambiguous —
 *    exactly one matching constraint definition, carrying at least one literal;
 * 2. none of `UNREPRESENTABLE_OVERRIDE_ENTITIES` is among its literals;
 * 3. none of `UNREPRESENTABLE_OVERRIDE_ENTITIES` is among
 *    `Object.keys(EDITABLE_ENTITIES)`;
 * 4. every editor entity is admitted by the CHECK (editor ⊆ CHECK).
 *
 * This is deliberately NOT an exact-set comparison against a pinned literal
 * list. An exact-set proof has no safe deploy order in either direction: the
 * migration that widens the CHECK breaks the running code, and the code that
 * expects the widened CHECK breaks against the un-migrated database — and the
 * breakage is a silent degradation of the nightly settle from apply to
 * propose-only. The four conditions above are order-independent: widening the
 * CHECK with an entity that is not a settle target (`AFLDB-ISSUE-159` widens it
 * with `coaches` and `match_coaches`) changes no answer, in either sequence,
 * while every original refusal is retained.
 *
 * **Snapshot timing.** `ManualAuthorityProvider` is synchronous by contract
 * (`observations.ts:391`), so the authority state is read once and answered
 * from memory thereafter. `loadManualAuthority()` is called with the settle
 * run's own transaction handle, so the snapshot is taken inside the
 * transaction that will do the writing. The settle transaction takes no lock
 * on `data_overrides`, so an override committed by an admin part-way through a
 * long run is not seen by that run; it is seen by the next one, and until then
 * the run proposes rather than applies. A stronger guarantee (row locks, or
 * `REPEATABLE READ`) belongs with the canonical writer in Stage S5, not here.
 */
import type postgres from 'postgres';

import { EDITABLE_ENTITIES } from '../edit/spec';
import { decodeJsonbObject } from '../jsonb';

import {
  continuityPartnersOf,
  decodePlayerMatchStatsKey,
  interpretKeyAuthority,
  loadContinuityRulesFailClosed,
  PLAYER_MATCH_STATS_ENTITY,
  protectedColumnsOf,
  resolveStoredIdentityToPlayer,
  type ContinuityRulesLoad,
} from './match-sheet-authority';
import type {
  ManualAuthorityProvider, ManualAuthorityQuery, ManualAuthorityVerdict,
} from './observations';

/**
 * The entity types the `data_overrides.entity_type` CHECK admits — migration 073
 * as widened by migration 095 (`AFLDB-ISSUE-159` §5.1), migration 096
 * (`AFLDB-ISSUE-161` §5: `season_list_members`, a playing-list membership, which
 * is not a settle target and changes no answer here) and migration 097
 * (`AFLDB-ISSUE-162` §19: `fixtures`, a SCHEDULED match, which is likewise not a
 * settle target — the settle writes `matches` and never reads or writes
 * `fixtures` — so it too changes no answer here) and migration 098
 * (`AFLDB-ISSUE-163` §19: `club_leadership`, a captain or vice-captain
 * appointment, which is likewise not a settle target — nothing in the nightly
 * settle reads or writes it — so it too changes no answer here) and migration
 * 101 (`AFLDB-ISSUE-165` §8: `award_winners`, `hall_of_fame` and
 * `honour_team_members`, none of which is a settle target either — the nightly
 * settle writes matches and statistics and neither reads nor writes an award,
 * an induction or an honour team — so admitting all three changes no answer
 * here) and migration 102 (`AFLDB-ISSUE-167` §6.3: `player_achievements` and
 * `after_siren_kicks`, the two curated special-record families, neither of which
 * is a settle target either — the nightly settle touches neither a first-kick
 * achievement nor an after-siren event — so admitting both changes no answer
 * here) and migration 110 (`AFLDB-ISSUE-257`: `player_match_stats`, the one
 * settle target now representable — the Match Sheet's durable authority,
 * answered from rows; a database still before 110 (State A) does not admit it,
 * and this list is not the proof, so that changes no answer here). Listed in the
 * order
 * §3.1 / §16.1 write it, which is NOT the ASCII order `checkAdmittedEntities()`
 * returns: nothing compares the two as sequences, and nothing may.
 *
 * **Inventory and documentation only.** This list is NOT the proof and must
 * never be compared for equality against the live constraint: doing so is the
 * exact-set coupling `AFLDB-ISSUE-159` §3.1 removed, and it re-creates a deploy
 * window in which widening the CHECK silently degrades the settle. The proof is
 * `overrideScopeProvenFrom()`, which asks only what the proposition needs.
 */
export const OVERRIDE_ENTITY_TYPES = [
  'coaches', 'draft_picks', 'fixtures', 'matches', 'match_coaches', 'players',
  'season_list_members', 'club_leadership',
  'award_winners', 'hall_of_fame', 'honour_team_members',
  'player_achievements', 'after_siren_kicks',
  'player_match_stats',
] as const;

/**
 * The settle targets for which a human override is unrepresentable while both
 * pinned contracts hold. `matches` is deliberately absent: it IS representable
 * and is answered from real rows. So, since AFLDB-ISSUE-257, is
 * `player_match_stats`: a Match Sheet save records durable authority for it
 * (`match-sheet-authority.ts`), it is answered from rows, and admitting it to the
 * `entity_type` CHECK does not touch the proof that still guards the two below
 * (AFLDB-ISSUE-257 §18.13, State A and State B both safe).
 */
export const UNREPRESENTABLE_OVERRIDE_ENTITIES = [
  'match_period_scores', 'brownlow_round_votes',
] as const;

/** The provenance source key an attendance figure typed by a human carries. */
export const MANUAL_ATTENDANCE_SOURCE_KEY = 'manual_admin_edit';

/** What one `(player_id, match_id)` pair's active ISSUE-257 records protect. */
export type PlayerMatchStatsPairAuthority = {
  /** Canonical column names a human decided (`club_slug` is `club_id`). */
  protectedColumns: ReadonlySet<string>;
  /** `removed` = a durable removal; `present` = a durable addition; null = none. */
  presence: 'present' | 'removed' | null;
};

/**
 * The season's active `player_match_stats` authority (AFLDB-ISSUE-257), already
 * decoded and resolved onto `(player_id, match_id)`.
 */
export type PlayerMatchStatsAuthority = {
  /** A record's key could not be decoded, so it names no match: every answer refuses. */
  allIndeterminate: boolean;
  /** Matches with an unreadable, unresolved or duplicated record: every answer refuses. */
  indeterminateMatchIds: ReadonlySet<number>;
  /**
   * Match keys (this season) an active record names that resolve to NO match, so there
   * is no id to mark. A query that carries `targetKey.match_key` — the applier's E4 does,
   * and it re-reads this snapshot per unit, so it also sees a match created since — is
   * `indeterminate` for such a key (AFLDB-ISSUE-257 Slice 4, fail closed).
   */
  unresolvedMatchKeys: ReadonlySet<string>;
  /** `playerMatchStatsPairKey(player_id, match_id)` -> the decision. */
  byPair: ReadonlyMap<string, PlayerMatchStatsPairAuthority>;
};

/** No `player_match_stats` records: the answer is `clear`, as it was before ISSUE-257. */
export const NO_PLAYER_MATCH_STATS_AUTHORITY: PlayerMatchStatsAuthority = {
  allIndeterminate: false,
  indeterminateMatchIds: new Set(),
  unresolvedMatchKeys: new Set(),
  byPair: new Map(),
};

export function playerMatchStatsPairKey(playerId: number, matchId: number): string {
  return `${playerId}:${matchId}`;
}

/**
 * The authority state, read once and then pure. Everything below this point
 * is DB-free and exhaustively testable.
 */
export type ManualAuthoritySnapshot = {
  /**
   * `true` only while all four conditions above hold. It gates ONLY the
   * unrepresentable entities (`match_period_scores`, `brownlow_round_votes`);
   * `matches` and `player_match_stats` are answered from rows and do not depend
   * on it.
   */
  overrideScopeProven: boolean;
  /** `match_key` -> the `field_group`s carrying an ACTIVE override. */
  matchOverrides: ReadonlyMap<string, ReadonlySet<string>>;
  /** `match_key`s whose canonical `attendance_source_id` is the manual source. */
  manualAttendanceMatches: ReadonlySet<string>;
  /** The season's active `player_match_stats` authority (AFLDB-ISSUE-257). */
  playerMatchStats: PlayerMatchStatsAuthority;
};

/** The editor's entity keys, sorted — conditions 3 and 4 above, read from the spec. */
export function editorEntityKeys(): readonly string[] {
  return Object.keys(EDITABLE_ENTITIES).sort();
}

/** The editor's `matches` field-group keys, sorted. */
export function matchGroupKeys(): readonly string[] {
  return Object.keys(EDITABLE_ENTITIES.matches.groups).sort();
}

/**
 * Condition 3: the editor exposes none of the three unrepresentable settle
 * targets. An editor entity that IS one of them would make an override for it
 * reachable from the browser, and the proposition would be false however narrow
 * the CHECK happened to be.
 *
 * The editor is deliberately NOT required to expose every admitted entity:
 * `coaches` is admitted by the CHECK and has its own admin route rather than a
 * `spec.ts` entry (`AFLDB-ISSUE-159` §3.1, §16.2).
 */
export function editorExposesNoUnrepresentableEntity(): boolean {
  const keys = editorEntityKeys();
  return UNREPRESENTABLE_OVERRIDE_ENTITIES.every((entity) => !keys.includes(entity));
}

/**
 * The `matches` field groups a proposal's changed fields fall into, using the
 * editor spec as the single mapping authority.
 *
 * A changed field belonging to no group — `venue_id`, `round_code`,
 * `attendance_status`, `attendance_source_id`, and every other source-owned
 * column — maps to nothing, because no human can have overridden a field the
 * editor does not expose.
 */
export function matchFieldGroupsFor(fields: readonly string[]): ReadonlySet<string> {
  const changed = new Set(fields);
  const touched = new Set<string>();
  for (const group of Object.values(EDITABLE_ENTITIES.matches.groups)) {
    if (group.fields.some((field) => changed.has(field))) touched.add(group.key);
  }
  return touched;
}

function matchKeyOf(query: ManualAuthorityQuery): string | null {
  const value = query.targetKey.match_key;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function positiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * The `player_match_stats` answer (AFLDB-ISSUE-257 §18.6 item 2), pure:
 * `indeterminate` when an undecodable key poisoned the whole table or the query's
 * match is marked; `conflict` when the pair's presence is `removed` or a queried
 * field is protected; otherwise `clear`. No records at all is `clear` — today's
 * answer — whatever the target key looks like; with records present, a question
 * that does not name a positive `player_id` and `match_id` cannot be placed and
 * refuses.
 */
function playerMatchStatsVerdict(
  authority: PlayerMatchStatsAuthority, query: ManualAuthorityQuery,
): ManualAuthorityVerdict {
  if (authority.allIndeterminate) return 'indeterminate';
  const queriedMatchKey = matchKeyOf(query);
  if (queriedMatchKey !== null && authority.unresolvedMatchKeys.has(queriedMatchKey)) {
    return 'indeterminate';
  }
  if (authority.byPair.size === 0 && authority.indeterminateMatchIds.size === 0) return 'clear';
  const { player_id: playerId, match_id: matchId } = query.targetKey;
  if (!positiveInt(playerId) || !positiveInt(matchId)) return 'indeterminate';
  if (authority.indeterminateMatchIds.has(matchId)) return 'indeterminate';
  const decided = authority.byPair.get(playerMatchStatsPairKey(playerId, matchId));
  if (decided === undefined) return 'clear';
  if (decided.presence === 'removed') return 'conflict';
  return query.fields.some((field) => decided.protectedColumns.has(field)) ? 'conflict' : 'clear';
}

/** What `buildPlayerMatchStatsAuthority` is given: rows already read, nothing else. */
export type PlayerMatchStatsAuthorityInput = {
  season: number;
  /** Every ACTIVE `player_match_stats` record (all seasons): the undecodable one must be seen. */
  records: readonly { entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: unknown }[];
  /** `match_key` -> the match. */
  matchesByKey: ReadonlyMap<string, { id: number; homeClubId: number; awayClubId: number }>;
  /** identity string (`afltables:<path>` / `manual_admin_edit:<token>`) -> distinct player ids. */
  playerIdsByIdentity: ReadonlyMap<string, readonly number[]>;
  /** club slug -> club id (slug is UNIQUE). */
  clubIdBySlug: ReadonlyMap<string, number>;
  /**
   * The tracked continuity contract (D-257-9). Omitted means "no rules" (today's
   * unfolded behaviour, kept for DB-free callers); the loader always supplies it.
   * An unreadable contract (`ok: false`) makes every answer indeterminate once any
   * record of the season exists: a path that cannot be shown to be in no rule is
   * not resolvable.
   */
  continuity?: ContinuityRulesLoad;
};

const NO_CONTINUITY_RULES: ContinuityRulesLoad = {
  ok: true,
  rules: [] as unknown as Extract<ContinuityRulesLoad, { ok: true }>['rules'],
};

/**
 * Decodes and resolves the active records onto `(player_id, match_id)`, DB-free.
 *
 * - an undecodable key names no match: every answer is indeterminate;
 * - records of another season are ignored (season = first match-key component);
 * - an unreadable payload, an identity that does not resolve to exactly one player,
 *   a `club_slug` that is not exactly the match's home or away club, or two records
 *   resolving to one `(player, match)` marks that MATCH indeterminate;
 * - a record whose match does not resolve names no match id to mark; the replay
 *   preflight, the rekey carry and the applier's per-unit reload are what catch it.
 */
export function buildPlayerMatchStatsAuthority(
  input: PlayerMatchStatsAuthorityInput,
): PlayerMatchStatsAuthority {
  type Decoded = NonNullable<ReturnType<typeof decodePlayerMatchStatsKey>>;
  const byKey = new Map<string, { decoded: Decoded; records: typeof input.records[number][] }>();
  for (const record of input.records) {
    const decoded = decodePlayerMatchStatsKey(record.entityKey);
    if (decoded === null) return { ...NO_PLAYER_MATCH_STATS_AUTHORITY, allIndeterminate: true };
    if (decoded.season !== input.season) continue;
    const entry = byKey.get(record.entityKey) ?? { decoded, records: [] };
    entry.records.push(record);
    byKey.set(record.entityKey, entry);
  }

  const continuity = input.continuity ?? NO_CONTINUITY_RULES;
  if (!continuity.ok && byKey.size > 0) {
    return { ...NO_PLAYER_MATCH_STATS_AUTHORITY, allIndeterminate: true };
  }

  const indeterminateMatchIds = new Set<number>();
  const unresolvedMatchKeys = new Set<string>();
  const byPair = new Map<string, PlayerMatchStatsPairAuthority>();
  for (const { decoded, records } of byKey.values()) {
    const match = input.matchesByKey.get(decoded.matchKey);
    if (match === undefined) {
      // No match id to mark: remembered by key instead (a record with no authority
      // in it is not worth refusing for, exactly as below).
      const unresolved = interpretKeyAuthority(records);
      if (!unresolved.ok || unresolved.fields !== null || unresolved.presence !== null) {
        unresolvedMatchKeys.add(decoded.matchKey);
      }
      continue;
    }
    const mark = () => { indeterminateMatchIds.add(match.id); };

    const interpreted = interpretKeyAuthority(records);
    if (!interpreted.ok) { mark(); continue; }
    if (interpreted.fields === null && interpreted.presence === null) continue; // no authority

    const resolved = resolveStoredIdentityToPlayer({
      identity: decoded.identity, playerIdsByIdentity: input.playerIdsByIdentity, continuity,
    });
    if (!resolved.ok) { mark(); continue; }
    const playerId = resolved.playerId;

    const slug = interpreted.fields?.club_slug;
    if (typeof slug === 'string') {
      const clubId = input.clubIdBySlug.get(slug);
      if (clubId === undefined || (clubId !== match.homeClubId && clubId !== match.awayClubId)) {
        mark(); continue;
      }
    }

    const pair = playerMatchStatsPairKey(playerId, match.id);
    if (byPair.has(pair)) { mark(); continue; }
    byPair.set(pair, {
      protectedColumns: interpreted.fields === null ? new Set() : protectedColumnsOf(interpreted.fields),
      presence: interpreted.presence,
    });
  }
  return { allIndeterminate: false, indeterminateMatchIds, unresolvedMatchKeys, byPair };
}

/** A field name no column carries: asks the provider about PRESENCE alone (removal). */
export const PRESENCE_PROBE_FIELD = '__match_sheet_presence__';

/** How a `player_match_stats` proposal sits against the active authority (Slice 4). */
export type PlayerMatchStatsScope =
  | { kind: 'indeterminate' }
  | { kind: 'removed' }
  | { kind: 'scoped'; keep: string[]; dropped: string[] };

/**
 * Splits `fields` into those the source may still propose and those a human decided,
 * using nothing but the provider (so it works on any snapshot, DB-free): a presence
 * probe separates a durable removal (`conflict` on a field no column carries) from a
 * protected field (`conflict` for that field only). `indeterminate` anywhere fails
 * closed. No authority at all: every field kept, which is today's behaviour.
 */
export function scopePlayerMatchStatsFields(
  provider: ManualAuthorityProvider,
  targetKey: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): PlayerMatchStatsScope {
  if (fields.length === 0) return { kind: 'scoped', keep: [], dropped: [] };
  const ask = (probe: readonly string[]) =>
    provider({ entity: PLAYER_MATCH_STATS_ENTITY, targetKey, fields: probe });
  const presence = ask([PRESENCE_PROBE_FIELD]);
  if (presence === 'indeterminate') return { kind: 'indeterminate' };
  if (presence === 'conflict') return { kind: 'removed' };
  const keep: string[] = [];
  const dropped: string[] = [];
  for (const field of fields) {
    const verdict = ask([field]);
    if (verdict === 'indeterminate') return { kind: 'indeterminate' };
    (verdict === 'conflict' ? dropped : keep).push(field);
  }
  return { kind: 'scoped', keep, dropped };
}

/**
 * The whole truth table, pure. `'clear'` is returned only when the snapshot
 * positively establishes that no active human decision covers the proposal.
 */
export function manualAuthorityVerdict(
  snapshot: ManualAuthoritySnapshot, query: ManualAuthorityQuery,
): ManualAuthorityVerdict {
  // A question with no fields in it is not a question this provider can
  // answer: there is nothing to compare against an override.
  if (!Array.isArray(query.fields) || query.fields.length === 0) return 'indeterminate';
  if (!query.fields.every((field) => typeof field === 'string' && field.length > 0)) {
    return 'indeterminate';
  }

  if (query.entity === PLAYER_MATCH_STATS_ENTITY) {
    return playerMatchStatsVerdict(snapshot.playerMatchStats, query);
  }

  if ((UNREPRESENTABLE_OVERRIDE_ENTITIES as readonly string[]).includes(query.entity)) {
    // Proven absent, or not proven at all. Never assumed.
    return snapshot.overrideScopeProven ? 'clear' : 'indeterminate';
  }

  if (query.entity !== 'matches') return 'indeterminate';

  const matchKey = matchKeyOf(query);
  if (matchKey === null) return 'indeterminate';

  const active = snapshot.matchOverrides.get(matchKey);
  if (active !== undefined && active.size > 0) {
    const known = new Set(matchGroupKeys());
    // An active override on a group the editor no longer defines cannot be
    // mapped onto the proposal at all. That is authority ambiguity, and it
    // refuses rather than being read as absence.
    for (const group of active) {
      if (!known.has(group)) return 'indeterminate';
    }
    for (const group of matchFieldGroupsFor(query.fields)) {
      if (active.has(group)) return 'conflict';
    }
  }

  // Provenance is authority too: an attendance figure already cited to
  // `manual_admin_edit` was typed by a human, whether or not the override row
  // survived, so a proposal that would move it conflicts.
  if (query.fields.includes('attendance') && snapshot.manualAttendanceMatches.has(matchKey)) {
    return 'conflict';
  }

  return 'clear';
}

/** A provider that refuses everything — the shape a failed load returns. */
export function refusingProvider(): ManualAuthorityProvider {
  return () => 'indeterminate';
}

/**
 * Condition 1: the entity types the live `data_overrides.entity_type` CHECK
 * admits, de-duplicated and sorted — or `null` when the constraint cannot be
 * read as a single unambiguous entity-type allowlist.
 *
 * `null` is returned for an absent constraint, for more than one constraint
 * definition mentioning `entity_type` (ambiguous: which one is the allowlist?),
 * and for a definition carrying no quoted literal at all. Every one of those is
 * an unreadable authority contract, and unreadable is not absent.
 */
export function checkAdmittedEntities(definitions: readonly string[]): readonly string[] | null {
  const entityChecks = definitions.filter((def) => /\bentity_type\b/.test(def));
  if (entityChecks.length !== 1) return null;
  const literals = [...entityChecks[0].matchAll(/'([^']*)'/g)].map((match) => match[1]);
  if (literals.length === 0) return null;
  return [...new Set(literals)].sort();
}

/**
 * The whole four-condition proof (`AFLDB-ISSUE-159` §3.1), pure and
 * order-independent. `false` fails the three unrepresentable targets closed.
 *
 * Widening the CHECK with an entity that is not a settle target does not move
 * this answer in either deploy order, which is what makes the migration safe to
 * ship before or after the code (D-1).
 */
export function overrideScopeProvenFrom(definitions: readonly string[]): boolean {
  // 1. Readable and unambiguous.
  const admitted = checkAdmittedEntities(definitions);
  if (admitted === null) return false;

  const unrepresentable = new Set<string>(UNREPRESENTABLE_OVERRIDE_ENTITIES);
  // 2. The CHECK admits no settle target — this is the proposition itself.
  if (admitted.some((entity) => unrepresentable.has(entity))) return false;

  // 3. The editor exposes no settle target either.
  if (!editorExposesNoUnrepresentableEntity()) return false;

  // 4. editor ⊆ CHECK. An editor entity the database would refuse means the two
  // authority contracts disagree about what an override even is, and a
  // disagreement is ambiguity, not absence.
  const admittedSet = new Set(admitted);
  return editorEntityKeys().every((entity) => admittedSet.has(entity));
}

/**
 * Reads the season's active `player_match_stats` records, then resolves their
 * matches, identities and clubs, all inside the caller's transaction and all
 * parameterised, and hands the rows to the pure `buildPlayerMatchStatsAuthority`.
 *
 * Identity reverse resolution splits the stored identity at the first `:` into a
 * source key and an external id; `afltables` additionally requires
 * `match_method = 'afltables_profile_url'` (the writer's own filter); status must
 * be `unique` or `resolved`; the builder then requires exactly one distinct player.
 *
 * Under the pre-ISSUE-257 CHECK (State A) no such record can exist, so the answer
 * is `NO_PLAYER_MATCH_STATS_AUTHORITY`, identical to today's. Returns `null` when a
 * result shape cannot be read; a thrown query error propagates to
 * `loadManualAuthority`'s catch (the whole-refusing provider).
 */
async function loadPlayerMatchStatsAuthority(
  sql: postgres.Sql | postgres.TransactionSql, season: number,
): Promise<PlayerMatchStatsAuthority | null> {
  const records = await sql<{
    entityKey: string; fieldGroup: string; isActive: boolean; overrideValues: string | null;
  }[]>`
    SELECT entity_key AS "entityKey", field_group AS "fieldGroup", is_active AS "isActive",
           override_values::text AS "overrideValues"
      FROM data_overrides
     WHERE entity_type = ${PLAYER_MATCH_STATS_ENTITY}
       AND is_active
  `;
  if (!Array.isArray(records)) return null;
  if (records.length === 0) return NO_PLAYER_MATCH_STATS_AUTHORITY;

  // D-257-9: an unreadable continuity contract fails closed (the builder answers
  // all-indeterminate once a record of the season exists).
  const continuity = loadContinuityRulesFailClosed();

  const matchKeys = new Set<string>();
  const externalIds = new Set<string>();
  for (const record of records) {
    if (typeof record.entityKey !== 'string' || typeof record.fieldGroup !== 'string') return null;
    const decoded = decodePlayerMatchStatsKey(record.entityKey);
    if (decoded === null || decoded.season !== season) continue;
    matchKeys.add(decoded.matchKey);
    externalIds.add(decoded.externalId);
    // The partner path's identity rows too: the pair rule needs both sides.
    if (decoded.sourceKey === 'afltables' && continuity.ok) {
      for (const partner of continuityPartnersOf(decoded.externalId, continuity.rules)) {
        externalIds.add(partner);
      }
    }
  }

  const matches = await sql<{ id: number; matchKey: string; homeClubId: number; awayClubId: number }[]>`
    SELECT id::int AS id, match_key AS "matchKey",
           home_club_id::int AS "homeClubId", away_club_id::int AS "awayClubId"
      FROM matches
     WHERE match_key = ANY(${[...matchKeys]}::text[])
  `;
  const identities = await sql<{
    sourceKey: string; externalId: string; matchMethod: string | null; playerId: number;
  }[]>`
    SELECT s.key AS "sourceKey", e.external_id AS "externalId",
           e.match_method AS "matchMethod", e.player_id::int AS "playerId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key IN ('afltables', 'manual_admin_edit')
       AND e.external_id = ANY(${[...externalIds]}::text[])
       AND e.status IN ('unique', 'resolved')
       AND e.player_id IS NOT NULL
  `;
  const clubs = await sql<{ id: number; slug: string }[]>`
    SELECT id::int AS id, slug FROM clubs
  `;
  if (![matches, identities, clubs].every(Array.isArray)) return null;

  const playerIdsByIdentity = new Map<string, number[]>();
  for (const row of identities) {
    if (row.sourceKey === 'afltables' && row.matchMethod !== 'afltables_profile_url') continue;
    const identity = `${row.sourceKey}:${row.externalId}`;
    const players = playerIdsByIdentity.get(identity) ?? [];
    if (!players.includes(row.playerId)) players.push(row.playerId);
    playerIdsByIdentity.set(identity, players);
  }

  return buildPlayerMatchStatsAuthority({
    season,
    records: records.map((record) => ({
      entityKey: record.entityKey,
      fieldGroup: record.fieldGroup,
      isActive: record.isActive === true,
      overrideValues: decodeJsonbObject(record.overrideValues),
    })),
    matchesByKey: new Map(matches.map((m) => [
      m.matchKey, { id: Number(m.id), homeClubId: Number(m.homeClubId), awayClubId: Number(m.awayClubId) },
    ])),
    playerIdsByIdentity,
    clubIdBySlug: new Map(clubs.map((c) => [c.slug, Number(c.id)])),
    continuity,
  });
}

/**
 * Does the live `data_overrides.entity_type` CHECK admit `player_match_stats`?
 * (AFLDB-ISSUE-257 State B.) For the Match Sheet writer to fail closed with a clear
 * message under State A rather than relying on a CHECK violation. `false` also when
 * the constraint cannot be read or is ambiguous: unreadable is not admitted.
 */
export async function playerMatchStatsAuthorityStorable(
  sql: postgres.Sql | postgres.TransactionSql,
): Promise<boolean> {
  try {
    const definitions = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
       WHERE c.conrelid = 'public.data_overrides'::regclass
         AND c.contype = 'c'
    `;
    if (!Array.isArray(definitions)) return false;
    return playerMatchStatsStorableFrom(definitions.map((row) => row.def));
  } catch {
    return false;
  }
}

/**
 * The forward counterpart of the identity rows `loadPlayerMatchStatsAuthority`
 * reads in reverse: each player's accepted AFL Tables paths (`afltables` +
 * `afltables_profile_url`, status `unique`/`resolved`) and manual tokens. The same
 * filter as the reverse lookup, parameterised by player id. Errors propagate: the
 * Match Sheet writer must roll back rather than guess an identity.
 */
export async function loadPlayerIdentityRows(
  sql: postgres.Sql | postgres.TransactionSql, playerIds: readonly number[],
): Promise<Map<number, { afltablesPaths: string[]; manualTokens: string[] }>> {
  const result = new Map<number, { afltablesPaths: string[]; manualTokens: string[] }>();
  if (playerIds.length === 0) return result;
  const rows = await sql<{
    sourceKey: string; externalId: string; matchMethod: string | null; playerId: number;
  }[]>`
    SELECT s.key AS "sourceKey", e.external_id AS "externalId",
           e.match_method AS "matchMethod", e.player_id::int AS "playerId"
      FROM external_identities e
      JOIN sources s ON s.id = e.source_id
     WHERE s.key IN ('afltables', 'manual_admin_edit')
       AND e.player_id = ANY(${[...playerIds]}::int[])
       AND e.status IN ('unique', 'resolved')
  `;
  for (const row of rows) {
    if (row.sourceKey === 'afltables' && row.matchMethod !== 'afltables_profile_url') continue;
    const entry = result.get(Number(row.playerId)) ?? { afltablesPaths: [], manualTokens: [] };
    const list = row.sourceKey === 'afltables' ? entry.afltablesPaths : entry.manualTokens;
    if (!list.includes(row.externalId)) list.push(row.externalId);
    result.set(Number(row.playerId), entry);
  }
  return result;
}

/** The pure half of `playerMatchStatsAuthorityStorable`. */
export function playerMatchStatsStorableFrom(definitions: readonly string[]): boolean {
  const admitted = checkAdmittedEntities(definitions);
  return admitted !== null && admitted.includes(PLAYER_MATCH_STATS_ENTITY);
}

/**
 * Read the authority state inside the caller's transaction and return the
 * synchronous provider `reconcile()` consumes.
 *
 * Any query error, or any result shape this cannot read, yields a provider
 * that answers `'indeterminate'` for everything. There is no force flag.
 */
export async function loadManualAuthority(
  sql: postgres.Sql | postgres.TransactionSql, season: number,
): Promise<ManualAuthorityProvider> {
  let snapshot: ManualAuthoritySnapshot;
  try {
    const definitions = await sql<{ def: string }[]>`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
       WHERE c.conrelid = 'public.data_overrides'::regclass
         AND c.contype = 'c'
    `;
    if (!Array.isArray(definitions)) return refusingProvider();

    const overrides = await sql<{ entityKey: string; fieldGroup: string }[]>`
      SELECT entity_key AS "entityKey", field_group AS "fieldGroup"
        FROM data_overrides
       WHERE entity_type = 'matches'
         AND is_active
    `;

    const manualAttendance = await sql<{ matchKey: string }[]>`
      SELECT m.match_key AS "matchKey"
        FROM matches m
        JOIN sources s ON s.id = m.attendance_source_id
       WHERE m.season = ${season}
         AND s.key = ${MANUAL_ATTENDANCE_SOURCE_KEY}
    `;

    const matchOverrides = new Map<string, Set<string>>();
    for (const row of overrides) {
      if (typeof row.entityKey !== 'string' || typeof row.fieldGroup !== 'string') {
        return refusingProvider();
      }
      const groups = matchOverrides.get(row.entityKey) ?? new Set<string>();
      groups.add(row.fieldGroup);
      matchOverrides.set(row.entityKey, groups);
    }

    const manualAttendanceMatches = new Set<string>();
    for (const row of manualAttendance) {
      if (typeof row.matchKey !== 'string') return refusingProvider();
      manualAttendanceMatches.add(row.matchKey);
    }

    const playerMatchStats = await loadPlayerMatchStatsAuthority(sql, season);
    if (playerMatchStats === null) return refusingProvider();

    snapshot = {
      overrideScopeProven: overrideScopeProvenFrom(definitions.map((row) => row.def)),
      matchOverrides,
      manualAttendanceMatches,
      playerMatchStats,
    };
  } catch {
    // Unreadable authority is not absent authority.
    return refusingProvider();
  }

  return (query) => manualAuthorityVerdict(snapshot, query);
}
