/**
 * AFLDB-ISSUE-096 S2 — the observation and reviewed-promotion semantics.
 *
 * The pure half of migration 074. Everything here is a decision, not a
 * write: given what the store currently holds and what a source just
 * returned, decide whether history moves, whether absence is asserted, and
 * whether a super admin may accept a promotion. Persisting those decisions
 * belongs to the family importers (ISSUE-099/100) and the promotion
 * transaction (S4).
 *
 * No database, no filesystem, no network, no clock of its own — every
 * timestamp is passed in — so the semantics are testable without a
 * database and deterministic in tests.
 *
 * Four rules shape the module:
 *
 *   1. **The payload hash is the change oracle.** Not a source timestamp,
 *      not fetch time. `source_updated_at` corroborates where one
 *      truthfully exists and is NULL everywhere else.
 *   2. **Version identity is `version_seq`, never the hash.** A -> B -> A
 *      is three ordered states over two payloads.
 *   3. **Fail closed.** Unknown authority, moved source, moved canonical
 *      baseline, foreign ownership, a season this pipeline does not own —
 *      each refuses. There is no force flag.
 *   4. **Nothing here promotes.** Acceptance is evaluated, never applied.
 */
import { createHash } from 'node:crypto';

import {
  type SourceFamilyContract,
  SourceFamilyContractError,
} from './source-families';

export class ObservationContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ObservationContractError';
  }
}

function fail(message: string): never {
  throw new ObservationContractError(message);
}

/* ------------------------------------------------------------------ *
 * Stable source addressing
 * ------------------------------------------------------------------ */

/**
 * Contracts address sources by stable key; only the persistence boundary
 * needs the database-local numeric id. This is that boundary, and it
 * refuses rather than inventing one — a numeric `sources.id` is never an
 * external identity and never travels back into a tracked contract.
 */
export function resolveSourceId(
  sourceIdsByKey: ReadonlyMap<string, number>, sourceKey: string,
): number {
  const id = sourceIdsByKey.get(sourceKey);
  if (id === undefined) {
    fail(`Source '${sourceKey}' has no sources row; run migrations before acquiring from it.`);
  }
  if (!Number.isInteger(id) || id <= 0) {
    fail(`Source '${sourceKey}' resolved to an invalid sources.id.`);
  }
  return id;
}

/* ------------------------------------------------------------------ *
 * Payload hashing
 * ------------------------------------------------------------------ */

export const HASH_ALGORITHM = 'sha256';
export const HASH_VERSION = 1;

export type JsonValue =
  | string | number | boolean | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * The stored description of how a hash was produced: algorithm, version
 * and the exact exclusion list applied. Persisted alongside every payload
 * so a later change to a family's exclusions is a reference-data edit
 * rather than a migration — see `decideObservation`.
 */
export function hashRecipe(contract: SourceFamilyContract): string {
  const excluded = [...contract.hashExclusions].sort();
  return `${HASH_ALGORITHM}/v${HASH_VERSION}(${excluded.join(',')})`;
}

/**
 * The one canonicalisation in the acquisition path: object keys sorted at
 * every depth, arrays left alone because their order is content, and a
 * non-finite number refused outright.
 *
 * `excluded` names are dropped at the TOP LEVEL only. Exclusions are
 * declared against a family's own column set, so a nested field of the same
 * name is different data and stays in the hash.
 */
function canonicalise(
  value: JsonValue, excluded: ReadonlySet<string>, depth: number,
): JsonValue {
  if (Array.isArray(value)) return value.map((item) => canonicalise(item, excluded, depth + 1));
  if (value !== null && typeof value === 'object') {
    const source = value as { readonly [key: string]: JsonValue };
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(source).sort()) {
      if (depth === 0 && excluded.has(key)) continue;
      out[key] = canonicalise(source[key], excluded, depth + 1);
    }
    return out;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    fail('A non-finite number cannot be hashed deterministically.');
  }
  return value;
}

const NO_EXCLUSIONS: ReadonlySet<string> = new Set<string>();

/**
 * The same canonicalisation with no exclusion list, for a value set that is
 * **not** a source payload — ISSUE-096 S4's canonical baseline is the case.
 * Exported so nothing downstream has to invent a second, subtly different
 * deterministic form; a family's payload exclusions must never be applied
 * to canonical AFLDB values, where a same-named column is different data.
 */
export function canonicalJson(value: JsonValue): string {
  return JSON.stringify(canonicalise(value, NO_EXCLUSIONS, 0));
}

/**
 * Canonical JSON: object keys sorted at every depth, declared volatile
 * fields dropped at the top level. Array order is content and is never
 * sorted — a reordered array is a genuinely different payload.
 */
export function canonicalisePayload(
  contract: SourceFamilyContract, payload: JsonValue,
): string {
  return JSON.stringify(canonicalise(payload, new Set(contract.hashExclusions), 0));
}

export type HashedPayload = { hash: string; recipe: string; canonical: string };

export function hashPayload(
  contract: SourceFamilyContract, payload: JsonValue,
): HashedPayload {
  const canonical = canonicalisePayload(contract, payload);
  return {
    hash: createHash(HASH_ALGORITHM).update(canonical, 'utf8').digest('hex'),
    recipe: hashRecipe(contract),
    canonical,
  };
}

/* ------------------------------------------------------------------ *
 * source_updated_at
 * ------------------------------------------------------------------ */

/**
 * A genuine upstream mutation timestamp, or NULL. The forbidden
 * substitutes — fetch time, `observed_from`, `first_seen_at`,
 * `last_seen_at`, AFL API `data_accessed`, a scheduled `utcStartTime` —
 * are not merely discouraged: this function has no access to any of them,
 * so it cannot reach for one. A family that declares no field returns
 * null, always.
 */
export function resolveSourceUpdatedAt(
  contract: SourceFamilyContract, payload: JsonValue,
): string | null {
  const field = contract.sourceUpdatedAtField;
  if (field === null) return null;
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    fail(`${contract.sourceKey}/${contract.family}: payload is not an object.`);
  }
  const value = (payload as { readonly [key: string]: JsonValue })[field];
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') {
    fail(
      `${contract.sourceKey}/${contract.family}.${field} is declared the upstream mutation `
      + 'timestamp but is neither a string nor a number.',
    );
  }
  return String(value);
}

/* ------------------------------------------------------------------ *
 * The observation decision
 * ------------------------------------------------------------------ */

/** The currently open version of one external record, or null if new. */
export type ObservationHead = {
  versionSeq: number;
  payloadHash: string;
  /** The recipe that produced `payloadHash`, as stored on the payload row. */
  hashRecipe: string;
  /** The stored payload, needed only when the recipe has since changed. */
  rawPayload: JsonValue;
  absentSince: string | null;
};

export type ObservationDecision =
  | {
    action: 'unchanged';
    versionSeq: number;
    /** True when the record had been marked absent and has now returned. */
    reappeared: boolean;
    payloadHash: string;
    recipe: string;
  }
  | {
    action: 'append_version';
    versionSeq: number;
    reappeared: boolean;
    payloadHash: string;
    recipe: string;
    sourceUpdatedAt: string | null;
    /** True when version_seq n-1 must be closed at `observedAt`. */
    closesPreviousVersion: boolean;
    /**
     * Set when the incoming content equals a payload the store already
     * holds — the A of an A -> B -> A. The version row is still appended;
     * only the payload insert is skipped.
     */
    payloadAlreadyStored: boolean;
  };

export type ObservationInput = {
  contract: SourceFamilyContract;
  head: ObservationHead | null;
  payload: JsonValue;
  observedAt: string;
  /** Hashes already present in `source_payloads` for this source+family. */
  knownPayloadHashes?: ReadonlySet<string>;
};

/**
 * The core of invariants I1 and I2.
 *
 * Identical consecutive content appends nothing: the caller advances
 * `last_seen_at` on the record row and stops. Changed content appends a
 * new `version_seq` and closes the previous interval — **including when
 * the new content equals an older payload**, which is exactly the second
 * A of A -> B -> A. Deduplicating that against the first A is the defect
 * this model exists to prevent, so the comparison is only ever against
 * the CURRENTLY OPEN version, never against history.
 *
 * If the family's hash recipe has changed since the head was written, the
 * head's hash is recomputed from its retained raw payload under the
 * current recipe before comparing. That is what makes moving a field to
 * the exclusion list — Kali's `sourcedAt`, if it ever proves volatile —
 * a reference-data edit with no migration and no spurious version.
 */
export function decideObservation(input: ObservationInput): ObservationDecision {
  const { contract, head, payload, observedAt } = input;
  if (contract.status !== 'declared') {
    fail(
      `${contract.sourceKey}/${contract.family} is '${contract.status}', so no observation may be `
      + 'recorded against a shape nobody has proven.',
    );
  }
  const incoming = hashPayload(contract, payload);
  const known = input.knownPayloadHashes ?? new Set<string>();

  if (head === null) {
    return {
      action: 'append_version',
      versionSeq: 1,
      reappeared: false,
      payloadHash: incoming.hash,
      recipe: incoming.recipe,
      sourceUpdatedAt: resolveSourceUpdatedAt(contract, payload),
      closesPreviousVersion: false,
      payloadAlreadyStored: known.has(incoming.hash),
    };
  }

  // The head may have been hashed under an older recipe. Recompute from
  // its stored payload rather than treating a recipe change as content.
  const headHash = head.hashRecipe === incoming.recipe
    ? head.payloadHash
    : hashPayload(contract, head.rawPayload).hash;

  const reappeared = head.absentSince !== null;

  if (headHash === incoming.hash) {
    return {
      action: 'unchanged',
      versionSeq: head.versionSeq,
      reappeared,
      payloadHash: head.payloadHash,
      recipe: head.hashRecipe,
    };
  }

  if (!observedAt) fail('observedAt is required to open a new version.');
  return {
    action: 'append_version',
    versionSeq: head.versionSeq + 1,
    reappeared,
    payloadHash: incoming.hash,
    recipe: incoming.recipe,
    sourceUpdatedAt: resolveSourceUpdatedAt(contract, payload),
    closesPreviousVersion: true,
    payloadAlreadyStored: known.has(incoming.hash),
  };
}

/* ------------------------------------------------------------------ *
 * Absence
 * ------------------------------------------------------------------ */

export type AbsenceCandidate = {
  externalRecordId: string;
  scopeKey: string;
  lastSeenAt: string;
  absentSince: string | null;
};

export type AbsenceSweep = {
  /** The scopes this fetch actually enumerated. Nothing outside is touched. */
  enumeratedScopeKeys: readonly string[];
  batchStartedAt: string;
  records: readonly AbsenceCandidate[];
};

/**
 * Which records to stamp `absent_since`. Absence is asserted only inside
 * a scope the fetch actually enumerated: a fetch of round 20 says nothing
 * about round 21, and a source that returns fewer rows than expected must
 * not be able to mark a whole season absent.
 *
 * This never deletes, never appends a version, and never touches canonical
 * data — it returns the keys whose record row should be stamped.
 */
export function sweepAbsences(sweep: AbsenceSweep): string[] {
  if (sweep.enumeratedScopeKeys.length === 0) {
    fail('An absence sweep with no enumerated scope would assert absence it never checked.');
  }
  const scopes = new Set(sweep.enumeratedScopeKeys);
  return sweep.records
    .filter((record) => scopes.has(record.scopeKey))
    .filter((record) => record.absentSince === null)
    .filter((record) => record.lastSeenAt < sweep.batchStartedAt)
    .map((record) => record.externalRecordId);
}

/* ------------------------------------------------------------------ *
 * Ownership
 * ------------------------------------------------------------------ */

export type OwnershipVerdict = 'ok' | 'foreign_owned_collision';

/**
 * Source containment: a promotion may write a canonical row only where it
 * is unowned or already owned by the promoting source. Expressed over
 * stable source KEYS; the SQL form of the same predicate
 * (`source_id IS NULL OR source_id = :source_id`) resolves ids at the
 * persistence boundary. Anything else fails closed — reconciliation never
 * adopts, and never deletes, another source's authority.
 */
export function evaluateOwnership(
  targetOwnerSourceKey: string | null, promotingSourceKey: string,
): OwnershipVerdict {
  if (!promotingSourceKey) fail('A promotion must name the source it is promoting for.');
  if (targetOwnerSourceKey === null) return 'ok';
  return targetOwnerSourceKey === promotingSourceKey ? 'ok' : 'foreign_owned_collision';
}

/* ------------------------------------------------------------------ *
 * Manual authority — the ISSUE-086 boundary
 * ------------------------------------------------------------------ */

/**
 * `AFLDB-ISSUE-086` owns durable editor-override persistence. ISSUE-096
 * owns only this boundary: a question, a fail-closed reading of the
 * answer, and no store of its own.
 *
 * The question is deliberately expressed over an opaque `targetKey` the
 * caller fills in, so the acquisition spine is not coupled to whatever
 * surrogate ids or storage ISSUE-086 settles on.
 */
export type ManualAuthorityQuery = {
  entity: string;
  targetKey: Readonly<Record<string, unknown>>;
  fields: readonly string[];
};

export type ManualAuthorityVerdict = 'clear' | 'conflict' | 'indeterminate';

export type ManualAuthorityProvider = (query: ManualAuthorityQuery) => ManualAuthorityVerdict;

/**
 * The provider used until ISSUE-086's contract lands. It answers
 * `indeterminate` — which refuses — so an un-implemented authority
 * mechanism blocks promotion rather than silently permitting it.
 */
export const UNAVAILABLE_MANUAL_AUTHORITY: ManualAuthorityProvider = () => 'indeterminate';

/* ------------------------------------------------------------------ *
 * Acceptance
 * ------------------------------------------------------------------ */

export const PROMOTABLE_VERBS = ['new', 'corrected', 'rescheduled'] as const;
export type PromotableVerb = (typeof PROMOTABLE_VERBS)[number];

export type RefusalReason =
  | 'not_pending'
  | 'verb_not_promotable'
  | 'stale_review'
  | 'stale_canonical_target'
  | 'season_not_in_progress'
  | 'foreign_owned_collision'
  | 'manual_authority_conflict'
  | 'manual_authority_indeterminate';

export type AcceptanceInput = {
  candidate: {
    status: 'pending' | 'accepted' | 'rejected' | 'superseded';
    verb: string;
    season: number;
    sourceKey: string;
    family: string;
    externalRecordId: string;
    /** The observation version the proposal was rendered from. */
    sourceVersionSeq: number;
    /** Null for a `new` candidate: there is no target row yet. */
    baselineCanonicalHash: string | null;
    fields: readonly string[];
    entity: string;
    targetKey: Readonly<Record<string, unknown>>;
  };
  /** Re-read inside the accept transaction, never trusted from render time. */
  current: {
    sourceVersionSeq: number;
    canonicalHash: string | null;
    targetOwnerSourceKey: string | null;
  };
  inProgressSeasons: readonly number[];
  manualAuthority: ManualAuthorityProvider;
};

export type AcceptanceVerdict =
  | { ok: true }
  | { ok: false; refusal: RefusalReason; requeue: boolean };

/**
 * Whether a super admin's accept may proceed. Every check re-reads current
 * state rather than trusting the rendered candidate, and the first failure
 * wins — checks are ordered cheapest and most structural first so a
 * refusal reason is the most specific true one.
 *
 * This function decides. It does not write, and there is no path through
 * it that promotes anything automatically: it is only ever reached from an
 * explicit human accept.
 */
export function evaluateAcceptance(input: AcceptanceInput): AcceptanceVerdict {
  const { candidate, current } = input;

  if (candidate.status !== 'pending') {
    return { ok: false, refusal: 'not_pending', requeue: false };
  }
  if (!(PROMOTABLE_VERBS as readonly string[]).includes(candidate.verb)) {
    // Every refusal verb — absent, unresolved_identity, source_disagreement,
    // foreign_owned_collision, manual_authority_conflict, stale_review —
    // lands here. The schema bars them from 'accepted' as well.
    return { ok: false, refusal: 'verb_not_promotable', requeue: false };
  }
  // The source moved between render and accept: the reviewer approved
  // evidence that is no longer the open version.
  if (candidate.sourceVersionSeq !== current.sourceVersionSeq) {
    return { ok: false, refusal: 'stale_review', requeue: true };
  }
  // The canonical target moved between render and accept.
  if (candidate.baselineCanonicalHash !== current.canonicalHash) {
    return { ok: false, refusal: 'stale_canonical_target', requeue: true };
  }
  // Only the in-progress season belongs to this pipeline.
  if (!input.inProgressSeasons.includes(candidate.season)) {
    return { ok: false, refusal: 'season_not_in_progress', requeue: false };
  }
  if (evaluateOwnership(current.targetOwnerSourceKey, candidate.sourceKey) !== 'ok') {
    return { ok: false, refusal: 'foreign_owned_collision', requeue: false };
  }
  // Human authority is the last and strongest gate, and the only one with
  // three answers. Unknown refuses exactly as conflict does.
  const authority = input.manualAuthority({
    entity: candidate.entity,
    targetKey: candidate.targetKey,
    fields: candidate.fields,
  });
  if (authority === 'conflict') {
    return { ok: false, refusal: 'manual_authority_conflict', requeue: true };
  }
  if (authority !== 'clear') {
    return { ok: false, refusal: 'manual_authority_indeterminate', requeue: true };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ *
 * Provider provenance
 * ------------------------------------------------------------------ */

/**
 * The storage key of one observation. It leads with the source key, so two
 * providers describing the same real-world event stay two observations
 * even when their projected payloads are identical — which is precisely
 * the case corroboration has to be able to see.
 *
 * It is a KEY, not an identity claim: that these two rows describe the
 * same match is a resolution decision made later, with evidence.
 */
export function observationKey(
  sourceKey: string, family: string, externalRecordId: string,
): string {
  if (!sourceKey || !family || !externalRecordId) {
    fail('An observation key needs a source key, a family and an external record id.');
  }
  // The separator is U+0000: no source key, family or external record id can
  // contain one, so the key cannot be ambiguous. It is written as an escape
  // rather than a literal byte — a raw NUL makes the source file binary to
  // `file`, `grep` and diff tools. The character itself is unchanged.
  return `${sourceKey}\u0000${family}\u0000${externalRecordId}`;
}

/**
 * The independence groups backing a set of observations, deduplicated.
 *
 * **Deliberately not a promotion rule.** It reports how many
 * provider/pipeline witnesses exist; it does not decide anything, and two
 * groups agreeing is not authority to promote. Provider independence is
 * not proven-distinct ultimate authority — Squiggle and Kali may still
 * share an upstream — so any future consensus rule must be an explicit
 * contract decision, never an inference from this count.
 */
export function witnessGroups(
  observations: readonly { contract: SourceFamilyContract }[],
): string[] {
  const groups = observations.map((o) => {
    if (!o.contract.independence?.group) {
      throw new SourceFamilyContractError('An observation carries no independence group.');
    }
    return o.contract.independence.group;
  });
  return [...new Set(groups)].sort();
}
