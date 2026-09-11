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
 * The proposition is exactly this: an override for `match_period_scores`,
 * `player_match_stats` or `brownlow_round_votes` is unrepresentable at the
 * database level — not merely unobserved. Those three targets answer `'clear'`
 * on proof rather than on optimism, and `AFLDB-ISSUE-099` A4 is satisfied
 * without widening the `data_overrides` CHECK to admit them. When the proof
 * cannot be established the targets answer `'indeterminate'` instead, which
 * refuses.
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
 * settle reads or writes it — so it too changes no answer here). Listed in the
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
] as const;

/**
 * The settle targets for which a human override is unrepresentable while both
 * pinned contracts hold. `matches` is deliberately absent: it IS representable
 * and is answered from real rows.
 */
export const UNREPRESENTABLE_OVERRIDE_ENTITIES = [
  'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
] as const;

/** The provenance source key an attendance figure typed by a human carries. */
export const MANUAL_ATTENDANCE_SOURCE_KEY = 'manual_admin_edit';

/**
 * The authority state, read once and then pure. Everything below this point
 * is DB-free and exhaustively testable.
 */
export type ManualAuthoritySnapshot = {
  /**
   * `true` only while all four conditions above hold. It gates ONLY the three
   * unrepresentable entities; `matches` is answered from rows and does not
   * depend on it.
   */
  overrideScopeProven: boolean;
  /** `match_key` -> the `field_group`s carrying an ACTIVE override. */
  matchOverrides: ReadonlyMap<string, ReadonlySet<string>>;
  /** `match_key`s whose canonical `attendance_source_id` is the manual source. */
  manualAttendanceMatches: ReadonlySet<string>;
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

    snapshot = {
      overrideScopeProven: overrideScopeProvenFrom(definitions.map((row) => row.def)),
      matchOverrides,
      manualAttendanceMatches,
    };
  } catch {
    // Unreadable authority is not absent authority.
    return refusingProvider();
  }

  return (query) => manualAuthorityVerdict(snapshot, query);
}
