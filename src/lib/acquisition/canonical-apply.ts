/**
 * AFLDB-ISSUE-122 stage S5 — the canonical applier.
 *
 * `AFLDB-ISSUE-099` built acquire -> observe -> project -> reconcile and
 * deliberately stopped at a review row. This module is the stage its §7 named
 * and left unbuilt: the one place in the repository where AFL Tables
 * current-season evidence becomes a canonical fact, unattended.
 *
 * Four rules govern everything below.
 *
 *   1. **Nothing is trusted from earlier in the run.** Runbook §5.1 requires
 *      every one of E1-E6 to be re-evaluated inside the savepoint, against
 *      state re-read in the same transaction. Ownership, the canonical
 *      baseline and the manual-authority snapshot are therefore all read
 *      HERE, not carried in. An override an administrator commits after the
 *      proposal was generated must still be able to stop the write, which is
 *      exactly the S2 snapshot race S3/S4 recorded as binding on this stage.
 *   2. **Fail closed, with no bypass.** There is no force flag, no override
 *      and no adoption. A source-less canonical row is refused, a
 *      foreign-owned row is refused, an unreadable owner is refused, and an
 *      unreadable authority is refused. `autoApplyOwnership()` below is
 *      strictly stronger than the generic `evaluateTargetOwnership()` gate
 *      and does not replace it: a human may still promote a source-less row
 *      through the reviewed queue.
 *   3. **A canonical change and its audit row are inseparable.** Every
 *      mutation writes its `canonical_applications` row inside the same
 *      savepoint (§13), so a committed canonical change with no ledger row is
 *      impossible and a rolled-back attempt leaves no ledger row. Stop
 *      conditions SC1 and SC2 are the mechanical statement of that.
 *   4. **Failure is isolated to its unit.** A match family — the `matches`
 *      row and its `match_period_scores` — is all or none. A player-match
 *      record — its `player_match_stats` and its `brownlow_round_votes` — is
 *      all or none for that player. One unresolved debutant cannot reject 43
 *      team-mates, and a constraint violation on one match cannot stop the
 *      round (SC4).
 *
 * The applier never creates an identity. No player, club, venue or venue
 * alias is created here, no fuzzy or name-only fallback exists, and
 * `createMatch()` is never called — its `match_key` rendering is one of three
 * incompatible ones in this repository (§7.1), and a wrong rendering inserts a
 * duplicate fixture instead of conflicting. The key used is the bundle
 * projection's `match_key`, verbatim.
 */
import type postgres from 'postgres';

import type { ImportBatchId } from '@/lib/import-batch-id';

import { loadManualAuthority } from './manual-authority';
import {
  carryMatchOverrides, findRetiredMatchIdentities,
  type MatchRekeyIdentity, type MatchRekeyScope,
} from './match-rekey';
import { canonicalJson, ObservationContractError, type JsonValue } from './observations';
import { baselineCanonicalHash } from './promotion-review';
import { diffFields, type IdentityResolution, type TargetOwnership } from './reconciliation';

type Tx = postgres.TransactionSql;

function fail(message: string): never {
  throw new ObservationContractError(message);
}

/* ------------------------------------------------------------------ *
 * Targets
 * ------------------------------------------------------------------ */

/**
 * The four canonical targets migration 083's
 * `canonical_applications_target_table_ck` admits, and the only tables this
 * module writes.
 *
 * Declared here rather than imported from `settle-afltables.ts` so the
 * dependency runs one way only: the settle pass imports the applier, never
 * the reverse. The union is structurally identical to `SettleTargetTable`,
 * and `tests/current-season-import.test.ts` pins the two together.
 */
export const CANONICAL_TARGET_TABLES = [
  'matches', 'match_period_scores', 'player_match_stats', 'brownlow_round_votes',
] as const;

export type CanonicalTargetTable = (typeof CANONICAL_TARGET_TABLES)[number];

/* ------------------------------------------------------------------ *
 * E3 — the automatic-path ownership predicate (§5.1, §7.2)
 * ------------------------------------------------------------------ */

/**
 * **Strictly stronger than the generic gate, and it does not replace it.**
 *
 * `evaluateOwnership()` (`observations.ts`) and `evaluateTargetOwnership()`
 * (`reconciliation.ts`) still answer `'ok'` for a NULL owner, and stage S3
 * changed neither: a source-less row remains promotable by a HUMAN through
 * the reviewed `promotion_candidates` queue and the §14 transition. Only the
 * unattended path is narrowed, and only here.
 *
 * A source-less canonical row cannot be proven unowned from anything the
 * settle role can read (§7.2): `applyDataEdit` does not re-stamp
 * `matches.source_id` for the score group, `createMatch` writes no provenance
 * at all, the CSV/email promote path upserts `matches` with none, and
 * `afldb_import` holds INSERT-only on `data_edits` so edit provenance is
 * unreadable by design (stop condition SC5). NULL therefore means "provenance
 * unknown", never "free to adopt".
 *
 * | Identity state | Verdict |
 * |---|---|
 * | no canonical row (`new_target`) | `insertable` — an INSERT adopts nothing |
 * | owner resolves to the promoting source | `updateable` |
 * | owner resolves to another source | `refused` / `foreign_source_owner` |
 * | `source_id IS NULL` (`unowned`) | `refused` / `ownership_indeterminate` |
 * | owner unreadable (`indeterminate`) | `refused` / `ownership_indeterminate` |
 * | identity `unresolved` | `refused` / `ownership_indeterminate` |
 *
 * S3 introduced this predicate; S5 is its caller, and it feeds it ownership
 * re-read inside the savepoint — never the value `resolveTarget()` computed
 * earlier in the pass.
 */
export type AutoApplyOwnership =
  | { verdict: 'insertable' }
  | { verdict: 'updateable' }
  | { verdict: 'refused'; detail: 'foreign_source_owner' | 'ownership_indeterminate' };

export function autoApplyOwnership(
  identity: IdentityResolution, promotingSourceKey: string,
): AutoApplyOwnership {
  if (!promotingSourceKey) {
    fail('An automatic canonical application must name the source it is applying for.');
  }
  // No row: there is nothing to adopt, so an INSERT cannot take another
  // owner's authority. Eligibility still depends on E1, E2 and E4-E6.
  if (identity.status === 'new_target') return { verdict: 'insertable' };
  // Never resolved, never ambiguous: no source may create an identity.
  if (identity.status === 'unresolved') {
    return { verdict: 'refused', detail: 'ownership_indeterminate' };
  }
  const { ownership } = identity;
  if (ownership.state === 'owned') {
    return ownership.sourceKey === promotingSourceKey
      ? { verdict: 'updateable' }
      : { verdict: 'refused', detail: 'foreign_source_owner' };
  }
  // 'unowned' AND 'indeterminate' both land here. The generic gate separates
  // them and admits the first; the automatic path deliberately does not.
  return { verdict: 'refused', detail: 'ownership_indeterminate' };
}

/**
 * Read an owner `source_id` as ownership. An id that resolves to no readable
 * key is `indeterminate`, never `unowned`: an unreadable owner is not an
 * absent one.
 */
function ownershipOf(
  sourceKeysById: ReadonlyMap<number, string>, ownerSourceId: number | null,
): TargetOwnership {
  if (ownerSourceId === null || ownerSourceId === undefined) return { state: 'unowned' };
  const key = sourceKeysById.get(ownerSourceId);
  return key === undefined ? { state: 'indeterminate' } : { state: 'owned', sourceKey: key };
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

/**
 * Why the settle pass invited this target into the savepoint.
 *
 * `candidate` is E1 proper. The other two are the two cases the runbook names
 * explicitly and which `reconcile()` structurally cannot express, because it
 * answers "did the SOURCE move?" and neither of these is a question about the
 * source:
 *
 *   - `pending_match` (§13) — `match_period_scores` keys on `match_id`, so
 *     before the canonical match exists its identity cannot resolve and
 *     `reconcile()` must refuse it. The match family is nevertheless required
 *     to be all-or-none, so the dependent target is re-resolved inside the
 *     same savepoint, AFTER the match row has been inserted. Offered only
 *     when the `matches` target of the same record is itself being applied.
 *   - `retry` (§9.3) — the source payload is unchanged, so `reconcile()`
 *     returns `unchanged` at gate 4 and proposes nothing, but the canonical
 *     target shows the dependent write never landed. The everyday case is a
 *     debutant whose identity is resolved between runs. Retry keys on TARGET
 *     state, never on payload change, and it cannot weaken ordinary
 *     idempotence: a target already carrying the proposed values differs in
 *     no field, so it is never invited.
 *
 * Whichever the invitation, every gate below runs identically. An invitation
 * authorises nothing; it only opens the question.
 */
export type CanonicalApplyInvitation = 'candidate' | 'pending_match' | 'retry';

export type CanonicalApplyTargetInput = {
  targetTable: CanonicalTargetTable;
  invitation: CanonicalApplyInvitation;
  /** The full proposed field set for this target. Never empty. */
  proposedValues: Readonly<Record<string, JsonValue>>;
  /**
   * Exactly the fields the pre-savepoint proposal would have written, and the
   * baseline hash computed over them. E5 recomputes the hash over the SAME
   * field set inside the savepoint, so like is compared with like; `null`
   * asserts that no canonical row existed when the proposal was derived.
   */
  renderedFields: readonly string[];
  renderedBaselineCanonicalHash: string | null;
  /** The exact evidence version the ledger row must cite. */
  sourceVersionSeq: number;
};

export type CanonicalApplyUnitInput = {
  /** The contract family, as `canonical_applications.family` stores it. */
  family: string;
  externalRecordId: string;
  season: number;
  sourceId: number;
  sourceKey: string;
  sourceKeysById: ReadonlyMap<number, string>;
  batchId: ImportBatchId;
  /** `data/reference/seasons.json.in_progress_seasons` — E2. */
  inProgressSeasons: readonly number[];
  /**
   * E6, the completion predicate (§9.5). There is no boolean "completed"
   * column in the AFL Tables results feed; `MatchFact.has_player_rows` is the
   * predicate, and `import_fitzroy_core.py` enforces it by emitting an
   * incomplete match as a REJECTED, unprojected record
   * (`incomplete_match_evidence`, `:1909-1912`). So the fact this carries is
   * "the emitter projected this record as a played match", which is that
   * predicate as it reaches TypeScript. It is bundle state rather than
   * database state, and so is immutable for the run.
   */
  completionProven: boolean;
  /** The bundle projection's `match_key`, used verbatim. Never re-rendered. */
  matchKey: string;
  /**
   * AFLDB-ISSUE-131 §5.3 — what this run still publishes, and the fixture
   * identity the proposal resolved, so a canonical row under a RETIRED
   * rendering of the same match can be proven rather than guessed.
   *
   * Supplied for the match family only; `null` disables the search entirely,
   * which is the correct answer for every other family and for any caller that
   * cannot prove an enumeration complete. It authorises nothing on its own —
   * the search is re-run here, under `FOR UPDATE`, inside the savepoint.
   */
  matchRekey: {
    scope: MatchRekeyScope;
    identity: Omit<MatchRekeyIdentity, 'season' | 'sourceId' | 'family' | 'matchKey'>;
  } | null;
  /** Player-family units only. */
  playerId: number | null;
  /** Player-family units only: the polled home-and-away round. */
  brownlowRoundNumber: number | null;
  targets: readonly CanonicalApplyTargetInput[];
};

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

export type CanonicalApplyRefusal =
  | 'season_not_in_progress'
  | 'match_incomplete'
  | 'no_canonical_match'
  | 'foreign_source_owner'
  | 'ownership_indeterminate'
  | 'manual_authority_conflict'
  | 'manual_authority_indeterminate'
  | 'stale_canonical_target'
  /**
   * AFLDB-ISSUE-131 §5.10. Three fail-closed refusals, no force flag and no
   * adoption, exactly as rule 2 requires.
   *
   *   - `rekey_ambiguous` — more than one canonical row is a possible rekey
   *     of this record. Two clubs can meet twice in a season, so this is real
   *     rather than theoretical, and guessing would corrupt a second fixture.
   *   - `rekey_would_merge` — the incoming rendering ALREADY has a canonical
   *     row and a retired one also exists. That is two canonical rows for one
   *     fixture before this run touched anything. Merging two populated
   *     canonical graphs is a supervised operation, never an automatic one.
   *   - `rekey_override_conflict` — both renderings carry a live human
   *     override for the same field group (§5.7). A human decides which one
   *     stands; nothing is overwritten here.
   */
  | 'rekey_ambiguous'
  | 'rekey_would_merge'
  | 'rekey_override_conflict'
  | 'nothing_to_write'
  | 'write_failed';

/** The three refusals AFLDB-ISSUE-131 added, for the caller's finding writer. */
export const REKEY_REFUSALS = [
  'rekey_ambiguous', 'rekey_would_merge', 'rekey_override_conflict',
] as const;

export function isRekeyRefusal(refusal: CanonicalApplyRefusal | null): boolean {
  return refusal !== null && (REKEY_REFUSALS as readonly string[]).includes(refusal);
}

export type CanonicalApplyTargetResult = {
  targetTable: CanonicalTargetTable;
  applied: boolean;
  verb: 'insert' | 'update' | null;
  rowsInserted: number;
  rowsUpdated: number;
  refusal: CanonicalApplyRefusal | null;
};

export type CanonicalApplyUnitResult = {
  results: readonly CanonicalApplyTargetResult[];
  /** Non-null when the whole unit rolled back to its savepoint. */
  failure: { targetTable: CanonicalTargetTable; message: string } | null;
  /**
   * The canonical id of a `matches` row this unit inserted, so the run's
   * reference map learns about its own write and dependent player records in
   * the same run resolve against it.
   */
  insertedMatchId: number | null;
  /**
   * AFLDB-ISSUE-131 — the canonical `matches` row this unit REKEYED in place,
   * and the rendering it carried before. The run's reference map retires the
   * old key and registers the new one against the SAME id, so the rest of the
   * run — the player family above all — resolves against the preserved row
   * rather than looking for a match that was never inserted.
   */
  rekeyedMatch: { id: number; previousMatchKey: string } | null;
  /**
   * AFLDB-ISSUE-131 §5.10 — the rekey refusal that stopped this unit's
   * `matches` target, if one did.
   *
   * A rekey refusal is a statement about the FIXTURE, not about one table: the
   * evidence says this run cannot tell which canonical row denotes this real-
   * world match, or that two already do. Every later target of that fixture
   * would therefore be written against a row this run has just declined to
   * identify. So the refusal blocks the rest of the unit here, and the caller
   * carries it forward to the fixture's other families for the rest of the run
   * (`player_match_stats` above all, which is settled in a later unit).
   */
  fixtureBlocked: CanonicalApplyRefusal | null;
  /**
   * AFLDB-ISSUE-131 §5.7 — active human overrides carried from a retired
   * rendering to the live one by this unit. Surfaced as a run counter so an
   * automatic carry is visible in the settle summary rather than silent.
   */
  overridesCarried: number;
};

function refused(
  targetTable: CanonicalTargetTable, refusal: CanonicalApplyRefusal,
): CanonicalApplyTargetResult {
  return { targetTable, applied: false, verb: null, rowsInserted: 0, rowsUpdated: 0, refusal };
}

/* ------------------------------------------------------------------ *
 * Freshly-read canonical state
 * ------------------------------------------------------------------ */

type FreshTarget = {
  identity: IdentityResolution;
  /** The canonical row id, or null for a target that does not exist yet. */
  targetId: number | null;
  /** Current values for the proposed field set, or null for a new target. */
  currentValues: Record<string, JsonValue> | null;
  /**
   * AFLDB-ISSUE-131. Non-null when the row was found under a RETIRED rendering
   * rather than the incoming one: the `match_key` this row carries right now,
   * which the write is about to move. `match_key` is in the proposed field set
   * on this path only, so it diffs, it is audited in `previous_values` /
   * `new_values`, and the ordinary UPDATE writes it with no special case.
   */
  rekeyFromMatchKey: string | null;
};

/** What `readFreshTarget()` returns instead of a target when it must refuse. */
type FreshTargetRefusal =
  | 'no_canonical_match' | 'rekey_ambiguous' | 'rekey_would_merge';

/**
 * A `date` column arrives as a Date; every other canonical value arrives as
 * itself. Rendered exactly as `currentMatchValues()` renders it in the settle
 * pass, so the diff compares like with like rather than a Date against a
 * string.
 */
function canonicalValue(value: unknown): JsonValue {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value as JsonValue;
}

function projectRow(
  row: Record<string, unknown>, fields: readonly string[],
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  for (const field of fields) values[field] = canonicalValue(row[field]);
  return values;
}

type PeriodRow = {
  club_id: number; period: number;
  goals: number | null; behinds: number | null; points: number | null;
};

/** The `match_period_scores` set, in the shape `proposedPeriodScoreValues()` builds. */
function periodSetValues(rows: readonly PeriodRow[]): Record<string, JsonValue> {
  return {
    period_scores: rows.map((row) => ({
      club_id: row.club_id,
      period: row.period,
      goals: row.goals,
      behinds: row.behinds,
      points: row.points,
    })) as unknown as JsonValue,
  };
}

async function readFreshTarget(
  sp: Tx, unit: CanonicalApplyUnitInput, target: CanonicalApplyTargetInput,
  matchId: number | null,
): Promise<FreshTarget | FreshTargetRefusal> {
  const fields = Object.keys(target.proposedValues);
  const { sourceKeysById } = unit;

  if (target.targetTable === 'matches') {
    const [row] = await sp<Record<string, unknown>[]>`
      SELECT * FROM matches WHERE match_key = ${unit.matchKey}
    `;
    const targetKey = { match_key: unit.matchKey };
    // AFLDB-ISSUE-131 §5.3. Re-derived HERE, under `FOR UPDATE`, against state
    // read inside the savepoint — never carried in from the pass that built
    // the proposal. Two concurrent settles therefore cannot both claim the
    // same retired row, and a candidate that stopped being one between the
    // proposal and the write is simply not one.
    const retired = unit.matchRekey === null ? [] : await findRetiredMatchIdentities(
      sp,
      {
        season: unit.season,
        sourceId: unit.sourceId,
        family: unit.family,
        matchKey: unit.matchKey,
        ...unit.matchRekey.identity,
      },
      { kind: 'run_enumeration', scope: unit.matchRekey.scope },
      true,
    );
    if (row) {
      // The incoming rendering already has a row AND a retired one exists:
      // one fixture, two canonical rows, before this run wrote anything.
      // Never merged automatically (§5.3).
      if (retired.length > 0) return 'rekey_would_merge';
      return {
        identity: {
          status: 'resolved',
          entity: 'matches',
          targetKey,
          ownership: ownershipOf(sourceKeysById, (row.source_id as number | null) ?? null),
        },
        targetId: row.id as number,
        currentValues: projectRow(row, fields),
        rekeyFromMatchKey: null,
      };
    }
    if (retired.length > 1) return 'rekey_ambiguous';
    if (retired.length === 1) {
      const [stale] = await sp<Record<string, unknown>[]>`
        SELECT * FROM matches WHERE id = ${retired[0].id}
      `;
      // The row was locked a statement ago inside this savepoint, so it is
      // still there; a disappearance would be a contract breach, not a race.
      if (!stale) fail('A locked rekey candidate vanished inside its own savepoint.');
      return {
        identity: {
          status: 'resolved',
          entity: 'matches',
          targetKey,
          ownership: ownershipOf(sourceKeysById, (stale.source_id as number | null) ?? null),
        },
        targetId: stale.id as number,
        currentValues: projectRow(stale, fields),
        rekeyFromMatchKey: stale.match_key as string,
      };
    }
    return {
      identity: { status: 'new_target', entity: 'matches', targetKey },
      targetId: null,
      currentValues: null,
      rekeyFromMatchKey: null,
    };
  }

  if (target.targetTable === 'match_period_scores') {
    if (matchId === null) return 'no_canonical_match';
    const rows = await sp<(PeriodRow & { source_id: number | null })[]>`
      SELECT club_id, period, goals, behinds, points, source_id
        FROM match_period_scores WHERE match_id = ${matchId}
       ORDER BY club_id, period
    `;
    const targetKey = { match_key: unit.matchKey };
    if (rows.length === 0) {
      return {
        identity: { status: 'new_target', entity: 'match_period_scores', targetKey },
        targetId: null,
        currentValues: null,
        rekeyFromMatchKey: null,
      };
    }
    // The whole period set is ONE target keyed on match_id, so its ownership
    // is the ownership of the rows composing it: a single readable owner
    // shared by every row is that owner; a mixed set is indeterminate and
    // fails closed.
    const owners = new Set(rows.map((row) => row.source_id));
    const ownership: TargetOwnership = owners.size === 1
      ? ownershipOf(sourceKeysById, [...owners][0])
      : { state: 'indeterminate' };
    return {
      identity: { status: 'resolved', entity: 'match_period_scores', targetKey, ownership },
      targetId: matchId,
      currentValues: periodSetValues(rows),
      rekeyFromMatchKey: null,
    };
  }

  if (target.targetTable === 'player_match_stats') {
    if (matchId === null) return 'no_canonical_match';
    if (unit.playerId === null) fail('A player_match_stats application needs a resolved player.');
    const [row] = await sp<Record<string, unknown>[]>`
      SELECT * FROM player_match_stats
       WHERE player_id = ${unit.playerId} AND match_id = ${matchId}
    `;
    const targetKey = { player_id: unit.playerId, match_id: matchId };
    if (!row) {
      return {
        identity: { status: 'new_target', entity: 'player_match_stats', targetKey },
        targetId: null,
        currentValues: null,
        rekeyFromMatchKey: null,
      };
    }
    return {
      identity: {
        status: 'resolved',
        entity: 'player_match_stats',
        targetKey,
        ownership: ownershipOf(sourceKeysById, (row.source_id as number | null) ?? null),
      },
      targetId: row.id as number,
      currentValues: projectRow(row, fields),
      rekeyFromMatchKey: null,
    };
  }

  if (unit.playerId === null || unit.brownlowRoundNumber === null) {
    fail('A brownlow_round_votes application needs a resolved player and a polled round.');
  }
  const [row] = await sp<Record<string, unknown>[]>`
    SELECT * FROM brownlow_round_votes
     WHERE season = ${unit.season} AND player_id = ${unit.playerId}
       AND round_number = ${unit.brownlowRoundNumber}
  `;
  const targetKey = {
    season: unit.season, player_id: unit.playerId, round_number: unit.brownlowRoundNumber,
  };
  if (!row) {
    return {
      identity: { status: 'new_target', entity: 'brownlow_round_votes', targetKey },
      targetId: null,
      currentValues: null,
      rekeyFromMatchKey: null,
    };
  }
  return {
    identity: {
      status: 'resolved',
      entity: 'brownlow_round_votes',
      targetKey,
      ownership: ownershipOf(sourceKeysById, (row.source_id as number | null) ?? null),
    },
    targetId: row.id as number,
    currentValues: projectRow(row, fields),
    rekeyFromMatchKey: null,
  };
}

/* ------------------------------------------------------------------ *
 * The ledger (§12.2(c))
 * ------------------------------------------------------------------ */

/**
 * The machine audit row, written inside the SAME savepoint as the mutation it
 * describes. `previous_values` is NULL exactly when the verb is `insert`,
 * which migration 083's `canonical_applications_previous_ck` enforces, and
 * both value sets are serialised through `canonicalJson()` so key order is
 * deterministic and the ≤ 64-key CHECK is met by construction.
 *
 * `promotion_decisions` is NEVER written here: it is the human review ledger,
 * `admin_user_id` stays `NOT NULL`, and `afldb_import` holds no grant on it
 * (SC5, SC8).
 *
 * **Every jsonb value goes through `jsonbOf()`, never `${canonicalJson(v)}::jsonb`.**
 * postgres.js resolves `$1::jsonb` to a jsonb parameter and then JSON-encodes
 * whatever JavaScript value it was handed, so passing a JSON *string* stores
 * the string — `jsonb_typeof` reads `'string'`, and migration 083's
 * `.keyvalue()` key-count CHECK then refuses the row outright. That is the
 * double-encoding hazard this repository has hit before; `sql.json()` on the
 * parsed object is the correct binding.
 */
async function writeLedgerRow(
  sp: Tx,
  unit: CanonicalApplyUnitInput,
  target: CanonicalApplyTargetInput,
  input: {
    targetKey: Readonly<Record<string, unknown>>;
    verb: 'insert' | 'update';
    previousValues: Readonly<Record<string, JsonValue>> | null;
    newValues: Readonly<Record<string, JsonValue>>;
  },
): Promise<void> {
  await sp`
    INSERT INTO canonical_applications (
      import_batch_id, source_id, family, external_record_id, source_version_seq,
      target_table, target_key, verb, previous_values, new_values
    ) VALUES (
      ${unit.batchId}, ${unit.sourceId}, ${unit.family}, ${unit.externalRecordId},
      ${target.sourceVersionSeq}, ${target.targetTable},
      ${jsonbOf(sp, input.targetKey as JsonValue)}, ${input.verb},
      ${input.previousValues === null
        ? null
        : jsonbOf(sp, input.previousValues as JsonValue)},
      ${jsonbOf(sp, input.newValues as JsonValue)}
    )
  `;
}

/**
 * Bind one value as jsonb, serialised through `canonicalJson()` so key order
 * is deterministic at every depth. The round trip is deliberate: the canonical
 * string fixes the ordering, and `sql.json()` is what makes PostgreSQL store
 * an object rather than a JSON-encoded string (see the note above).
 */
function jsonbOf(sp: Tx, value: JsonValue): postgres.Parameter<unknown> {
  return sp.json(JSON.parse(canonicalJson(value)) as never);
}

/* ------------------------------------------------------------------ *
 * The four canonical writers (§7.1)
 * ------------------------------------------------------------------ */

/** The provenance quartet every written canonical row carries (§7.1). */
function provenance(unit: CanonicalApplyUnitInput): Record<string, JsonValue> {
  return {
    source_id: unit.sourceId,
    source_record_id: unit.externalRecordId,
    import_batch_id: unit.batchId as unknown as JsonValue,
  };
}

/**
 * `matches` — INSERT a new row by the bundle's `match_key` verbatim, or UPDATE
 * an existing one by canonical id, touching only the changed proposed fields.
 *
 * Attendance semantics are the proposal's and are not re-derived here:
 * `proposedMatchValues()` already sets `attendance_status = 'complete'` with
 * `attendance_source_id = afltables` when a figure exists — a genuine `0`
 * included, which is storable precisely because it cites a source
 * (`matches_zero_attendance_ck`) — and `'not_collected'` with a NULL source
 * otherwise. **NULL is never 0.** `venue_id` may be NULL while `venue_raw`
 * carries the real string (§7.3); the literal `'Unknown'` is never written.
 *
 * `createMatch()` is deliberately not reused: it renders `match_key` from club
 * IDs, which is one of three incompatible renderings in this repository, and a
 * wrong one would insert a duplicate fixture instead of conflicting (§7.1).
 */
async function writeMatch(
  sp: Tx, unit: CanonicalApplyUnitInput, plan: WritePlan,
): Promise<{ rowsInserted: number; rowsUpdated: number; targetId: number }> {
  if (plan.verb === 'insert') {
    const row: Record<string, JsonValue> = {
      match_key: unit.matchKey,
      season: unit.season,
      ...plan.newValues,
      ...provenance(unit),
    };
    const [written] = await sp<{ id: number }[]>`
      INSERT INTO matches ${sp(row as never)} RETURNING id::int AS id
    `;
    return { rowsInserted: 1, rowsUpdated: 0, targetId: written.id };
  }
  const patch = { ...plan.newValues, ...provenance(unit) };
  await sp`
    UPDATE matches SET ${sp(patch as never)}, imported_at = now()
     WHERE id = ${plan.targetId as number}
  `;
  return { rowsInserted: 0, rowsUpdated: 1, targetId: plan.targetId as number };
}

/**
 * `match_period_scores` — upsert periods 1-4 on `(match_id, club_id, period)`.
 *
 * **Never a delete.** Absence of a value means no row, so a side/period the
 * source did not publish is left exactly as it is; a set whose goals, behinds
 * AND points are all NULL writes no row at all; and extra time is never
 * invented — periods outside 1-4 are refused rather than stored. The canonical
 * match must exist in this same savepoint, which is what makes the family
 * atomic.
 */
async function writePeriodScores(
  sp: Tx, unit: CanonicalApplyUnitInput, matchId: number, plan: WritePlan,
): Promise<{ rowsInserted: number; rowsUpdated: number }> {
  const proposed = plan.newValues.period_scores as unknown as readonly PeriodRow[] | undefined;
  if (!Array.isArray(proposed)) {
    fail('A match_period_scores application must carry a period_scores array.');
  }
  let rowsInserted = 0;
  let rowsUpdated = 0;
  for (const period of proposed) {
    if (!Number.isInteger(period.period) || period.period < 1 || period.period > 4) {
      fail(
        `match_period_scores period ${String(period.period)} is outside the published `
        + 'quarters 1-4; extra time is never invented.',
      );
    }
    // Not recorded is not zero: a side/period with nothing published at all
    // writes no row rather than a row of NULLs.
    if (period.goals === null && period.behinds === null && period.points === null) continue;
    const [written] = await sp<{ inserted: boolean }[]>`
      INSERT INTO match_period_scores (
        match_id, club_id, period, goals, behinds, points,
        source_id, source_record_id, import_batch_id
      ) VALUES (
        ${matchId}, ${period.club_id}, ${period.period},
        ${period.goals}, ${period.behinds}, ${period.points},
        ${unit.sourceId}, ${unit.externalRecordId}, ${unit.batchId}
      )
      ON CONFLICT (match_id, club_id, period) DO UPDATE SET
        goals = EXCLUDED.goals, behinds = EXCLUDED.behinds, points = EXCLUDED.points,
        source_id = EXCLUDED.source_id, source_record_id = EXCLUDED.source_record_id,
        import_batch_id = EXCLUDED.import_batch_id, imported_at = now()
      RETURNING (xmax = 0) AS inserted
    `;
    if (written?.inserted) rowsInserted += 1;
    else rowsUpdated += 1;
  }
  return { rowsInserted, rowsUpdated };
}

/**
 * `player_match_stats` — insert or update at the resolved `(player_id,
 * match_id)` grain, writing only the projected `STAT_MAP` fields.
 *
 * A NULL statistic stays NULL: **not recorded is never 0**. `brownlow_votes`
 * is deliberately absent from the proposed field set — it is genuine
 * per-round data and is proposed once, to `brownlow_round_votes`, rather than
 * to two targets from one observation — so this writer never touches it.
 */
async function writePlayerMatchStats(
  sp: Tx, unit: CanonicalApplyUnitInput, matchId: number, plan: WritePlan,
): Promise<{ rowsInserted: number; rowsUpdated: number }> {
  if (plan.verb === 'insert') {
    const row: Record<string, JsonValue> = {
      player_id: unit.playerId as number,
      match_id: matchId,
      ...plan.newValues,
      ...provenance(unit),
    };
    await sp`INSERT INTO player_match_stats ${sp(row as never)}`;
    return { rowsInserted: 1, rowsUpdated: 0 };
  }
  // `player_match_stats` carries source_id / source_record_id / import_batch_id
  // but NOT `imported_at` — migration 001's quartet helper was never applied
  // to it, unlike the other three targets. Found by the S6 identical-rerun
  // proof, which was the first thing to reach this branch.
  const patch = { ...plan.newValues, ...provenance(unit) };
  await sp`
    UPDATE player_match_stats SET ${sp(patch as never)}
     WHERE id = ${plan.targetId as number}
  `;
  return { rowsInserted: 0, rowsUpdated: 1 };
}

/**
 * `brownlow_round_votes` — written only where the source published a vote.
 *
 * NA is not 0 and never becomes a filler row: `proposedBrownlowValues()`
 * returns null when the source published nothing, so no target exists and this
 * is never reached. Home-and-away rounds only — a final carries no
 * `round_number` and is refused here as well as being unrepresentable in the
 * schema. `brownlow_season_votes` is never written and no season total is
 * derived from a partial round set. Zero rows in-season is the correct
 * outcome, not a defect.
 */
async function writeBrownlowRoundVotes(
  sp: Tx, unit: CanonicalApplyUnitInput, plan: WritePlan,
): Promise<{ rowsInserted: number; rowsUpdated: number }> {
  const round = unit.brownlowRoundNumber;
  if (round === null || !Number.isInteger(round) || round < 1) {
    fail(
      'brownlow_round_votes is a home-and-away round grain; a record with no polled round '
      + 'number is never written.',
    );
  }
  if (plan.verb === 'insert') {
    const row: Record<string, JsonValue> = {
      season: unit.season,
      player_id: unit.playerId as number,
      round_number: round,
      ...plan.newValues,
      ...provenance(unit),
    };
    await sp`INSERT INTO brownlow_round_votes ${sp(row as never)}`;
    return { rowsInserted: 1, rowsUpdated: 0 };
  }
  const patch = { ...plan.newValues, ...provenance(unit) };
  await sp`
    UPDATE brownlow_round_votes SET ${sp(patch as never)}, imported_at = now()
     WHERE id = ${plan.targetId as number}
  `;
  return { rowsInserted: 0, rowsUpdated: 1 };
}

/** What the gates decided should be written, once they all passed. */
type WritePlan = {
  verb: 'insert' | 'update';
  targetId: number | null;
  targetKey: Readonly<Record<string, unknown>>;
  /** Only the fields that actually change; the full proposed set on an insert. */
  newValues: Readonly<Record<string, JsonValue>>;
  previousValues: Readonly<Record<string, JsonValue>> | null;
};

/* ------------------------------------------------------------------ *
 * The unit
 * ------------------------------------------------------------------ */

/**
 * Apply one record's canonical targets inside one savepoint (§13).
 *
 * The savepoint boundary is the RECORD, which is exactly the runbook's two
 * units: a match family is a `matches` row plus its `match_period_scores`,
 * and a player-match record is a `player_match_stats` row plus its
 * `brownlow_round_votes`. Both or neither, and their `canonical_applications`
 * rows with them.
 *
 * A constraint or write failure rolls back that unit alone, leaves no ledger
 * row behind, and is reported to the caller so the run can open the
 * `canonical_apply_failed` finding and continue. It is never absorbed.
 */
export async function applyCanonicalUnit(
  tx: Tx, unit: CanonicalApplyUnitInput,
): Promise<CanonicalApplyUnitResult> {
  if (unit.targets.length === 0) {
    return {
      results: [],
      failure: null,
      insertedMatchId: null,
      rekeyedMatch: null,
      fixtureBlocked: null,
      overridesCarried: 0,
    };
  }
  if (!unit.sourceKey) fail('A canonical application must name the source it applies for.');

  const results: CanonicalApplyTargetResult[] = [];
  let insertedMatchId: number | null = null;
  let rekeyedMatch: { id: number; previousMatchKey: string } | null = null;
  /**
   * AFLDB-ISSUE-131 §5.10. Set the moment a rekey refusal stops the `matches`
   * target, and it stops the whole fixture family with it: the remaining
   * targets of this unit are refused unwritten, and the caller withholds the
   * fixture's other families for the rest of the run.
   */
  let fixtureBlocked: CanonicalApplyRefusal | null = null;
  let overridesCarried = 0;
  /** The target being written when a failure fires, for the finding's key. */
  let attempting: CanonicalTargetTable = unit.targets[0].targetTable;

  try {
    await tx.savepoint(async (scope) => {
      const sp = scope as Tx;
      results.length = 0;
      insertedMatchId = null;
      rekeyedMatch = null;
      fixtureBlocked = null;
      overridesCarried = 0;

      // §8 / E4. The authority snapshot is re-read HERE, inside the savepoint
      // and before any write in it, so an override committed after the
      // proposal was generated still stops the mutation. `ManualAuthority-
      // Provider` is synchronous by contract, so it is loaded once per unit
      // rather than per target — the unit is atomic, so "before the
      // mutation" and "before the unit's mutations" are the same instant.
      const authority = await loadManualAuthority(sp, unit.season);

      // The canonical match id this unit may write against, RE-READ here
      // rather than carried in from `resolveTarget()`'s earlier pass. A
      // player-grain target keys on it, and a match family refreshes it from
      // its own INSERT below, which is what makes that family atomic.
      const [existingMatch] = await sp<{ id: number }[]>`
        SELECT id::int AS id FROM matches WHERE match_key = ${unit.matchKey}
      `;
      let matchId: number | null = existingMatch?.id ?? null;

      for (const target of unit.targets) {
        attempting = target.targetTable;
        // AFLDB-ISSUE-131 §5.10. A rekey refusal on this fixture's `matches`
        // target is not a refusal of one table: this run cannot say which
        // canonical row IS this fixture, so every dependent target would be
        // written against a row it just declined to identify. The specific
        // refusal is carried onto the dependent rather than flattened, so the
        // report still names the evidence that stopped it.
        if (fixtureBlocked !== null) {
          results.push(refused(target.targetTable, fixtureBlocked));
          continue;
        }
        // E2. The season gate, re-evaluated rather than inherited from the
        // bundle validation that ran before PostgreSQL was opened.
        if (!unit.inProgressSeasons.includes(unit.season)) {
          results.push(refused(target.targetTable, 'season_not_in_progress'));
          continue;
        }

        // E6. The completion predicate, for the match family only.
        if (
          (target.targetTable === 'matches' || target.targetTable === 'match_period_scores')
          && !unit.completionProven
        ) {
          results.push(refused(target.targetTable, 'match_incomplete'));
          continue;
        }

        const fresh = await readFreshTarget(sp, unit, target, matchId);
        // AFLDB-ISSUE-131 §5.10 — every one of these writes nothing, opens a
        // finding through the caller and leaves the record for a human. There
        // is no force flag and no adoption.
        if (typeof fresh === 'string') {
          // §5.10 again: the rekey refusals are fixture-wide, so the matchId
          // this unit was carrying is retired with them. Nothing may be
          // written against a row whose identity was just refused.
          if (target.targetTable === 'matches' && isRekeyRefusal(fresh)) {
            fixtureBlocked = fresh;
            matchId = null;
          }
          results.push(refused(target.targetTable, fresh));
          continue;
        }
        if (target.targetTable === 'matches' && fresh.targetId !== null) {
          matchId = fresh.targetId;
        }

        // E3. Ownership, from state read in this savepoint.
        const ownership = autoApplyOwnership(fresh.identity, unit.sourceKey);
        if (ownership.verdict === 'refused') {
          results.push(refused(target.targetTable, ownership.detail));
          continue;
        }

        // E5. The canonical baseline the proposal was derived from must still
        // describe the row. Recomputed over the SAME field set the proposal
        // used, so like is compared with like; a `new` proposal asserts the
        // absence of a row, and a row that appeared underneath it is just as
        // stale as one whose values moved.
        const currentBaseline = fresh.currentValues === null
          ? null
          : baselineCanonicalHash(target.renderedFields, fresh.currentValues);
        if (currentBaseline !== target.renderedBaselineCanonicalHash) {
          results.push(refused(target.targetTable, 'stale_canonical_target'));
          continue;
        }

        // What would actually change, against the freshly-read row.
        const changedFields = diffFields(target.proposedValues, fresh.currentValues);
        if (changedFields.length === 0) {
          // Nothing to write, so nothing to audit. An `unchanged` outcome
          // writes no canonical row and no ledger row (§6).
          results.push(refused(target.targetTable, 'nothing_to_write'));
          continue;
        }

        // E4. Human authority, asked unconditionally — including for a target
        // that does not exist yet, which `reconcile()` deliberately does not
        // do (its gate 8 is scoped to overwriting an existing row).
        //
        // AFLDB-ISSUE-131: on a rekey the authority is asked under BOTH
        // renderings, and the strongest answer wins. The human's decision was
        // recorded against the key the row carried at the time, which is the
        // OLD one, so asking only under the incoming key would read a live
        // override as absence — precisely the orphaning §5.7 exists to stop.
        let verdict = authority({
          entity: target.targetTable,
          targetKey: fresh.identity.status === 'unresolved' ? {} : fresh.identity.targetKey,
          fields: changedFields,
        });
        if (verdict === 'clear' && fresh.rekeyFromMatchKey !== null) {
          verdict = authority({
            entity: target.targetTable,
            targetKey: { match_key: fresh.rekeyFromMatchKey },
            fields: changedFields,
          });
        }
        if (verdict !== 'clear') {
          results.push(refused(
            target.targetTable,
            verdict === 'conflict'
              ? 'manual_authority_conflict'
              : 'manual_authority_indeterminate',
          ));
          continue;
        }

        const verb: 'insert' | 'update' = ownership.verdict === 'insertable' ? 'insert' : 'update';
        const newValues: Record<string, JsonValue> = {};
        for (const field of changedFields) newValues[field] = target.proposedValues[field];
        const previousValues: Record<string, JsonValue> | null = verb === 'insert'
          ? null
          : Object.fromEntries(
            changedFields.map((field) => [field, (fresh.currentValues as Record<string, JsonValue>)[field]]),
          );
        const plan: WritePlan = {
          verb,
          targetId: fresh.targetId,
          targetKey: fresh.identity.status === 'unresolved' ? {} : fresh.identity.targetKey,
          newValues,
          previousValues,
        };

        // §5.7. The human overrides move with the match BEFORE the canonical
        // row does, so a refusal leaves this savepoint with nothing written at
        // all rather than a rekeyed row whose override was left behind.
        if (fresh.rekeyFromMatchKey !== null) {
          const carry = await carryMatchOverrides(sp, fresh.rekeyFromMatchKey, unit.matchKey);
          if ('conflict' in carry) {
            // The rekey is refused, so the row this unit was about to write
            // against keeps the RETIRED rendering. Blocking the fixture is
            // what stops a dependent target landing on it (§5.10).
            if (target.targetTable === 'matches') {
              fixtureBlocked = 'rekey_override_conflict';
              matchId = null;
            }
            results.push(refused(target.targetTable, 'rekey_override_conflict'));
            continue;
          }
          overridesCarried += carry.carried;
        }

        let written: { rowsInserted: number; rowsUpdated: number };
        if (target.targetTable === 'matches') {
          const outcome = await writeMatch(sp, unit, plan);
          written = { rowsInserted: outcome.rowsInserted, rowsUpdated: outcome.rowsUpdated };
          matchId = outcome.targetId;
          if (verb === 'insert') insertedMatchId = outcome.targetId;
          if (fresh.rekeyFromMatchKey !== null) {
            rekeyedMatch = {
              id: outcome.targetId, previousMatchKey: fresh.rekeyFromMatchKey,
            };
          }
        } else if (target.targetTable === 'match_period_scores') {
          written = await writePeriodScores(sp, unit, matchId as number, plan);
        } else if (target.targetTable === 'player_match_stats') {
          written = await writePlayerMatchStats(sp, unit, matchId as number, plan);
        } else {
          written = await writeBrownlowRoundVotes(sp, unit, plan);
        }

        // A period set whose every published row was all-NULL writes nothing,
        // and nothing written is nothing to audit.
        if (written.rowsInserted + written.rowsUpdated === 0) {
          results.push(refused(target.targetTable, 'nothing_to_write'));
          continue;
        }

        // §12 / SC2. The audit row, in the SAME savepoint as the mutation.
        await writeLedgerRow(sp, unit, target, {
          targetKey: plan.targetKey,
          verb,
          previousValues,
          newValues,
        });

        results.push({
          targetTable: target.targetTable,
          applied: true,
          verb,
          rowsInserted: written.rowsInserted,
          rowsUpdated: written.rowsUpdated,
          refusal: null,
        });
      }
    });
  } catch (error) {
    // §9.1. The savepoint has rolled back, so no canonical row and no ledger
    // row survives from this unit. The outer transaction is intact and the
    // run continues; the caller opens the `canonical_apply_failed` finding
    // and routes the record to the exception queue.
    return {
      results: unit.targets.map((target) => refused(target.targetTable, 'write_failed')),
      failure: {
        targetTable: attempting,
        message: error instanceof Error ? error.message : String(error),
      },
      insertedMatchId: null,
      rekeyedMatch: null,
      fixtureBlocked: null,
      overridesCarried: 0,
    };
  }

  return {
    results, failure: null, insertedMatchId, rekeyedMatch, fixtureBlocked, overridesCarried,
  };
}
