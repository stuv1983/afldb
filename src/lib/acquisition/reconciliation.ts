/**
 * AFLDB-ISSUE-096 S3 — the reconciliation verb set, the source-ownership
 * predicate and the ISSUE-086 authority interface.
 *
 * S2 decided whether HISTORY moves (`decideObservation`) and whether a
 * super admin's accept may WRITE (`evaluateAcceptance`). This module fills
 * the gap S2 deliberately left: given a live source payload and the stored
 * open observation, which of Decision C's ten verbs applies, and what — if
 * anything — may be proposed to a reviewer.
 *
 * Same four rules as S2, unchanged:
 *
 *   1. **The payload hash is the change oracle.** `unchanged` is decided by
 *      `decideObservation` under the family's hash contract, never by a
 *      timestamp and never by the projection.
 *   2. **Nothing here promotes.** Every outcome is a classification or a
 *      refusal. There is no write, no transaction and no code path that
 *      reaches canonical data.
 *   3. **Fail closed.** Unresolved identity, foreign or indeterminate
 *      ownership, an independent-source conflict, and an authority answer
 *      that is anything other than `clear` all refuse. There is no force
 *      flag, no override and no consensus shortcut.
 *   4. **Ten verbs, frozen.** `RECONCILIATION_VERBS` is Decision C's exact
 *      vocabulary. A verb outside it cannot be constructed or returned.
 *
 * No database, no filesystem, no network, no clock: every input is passed
 * in, so the semantics are testable without a database.
 */
import {
  decideObservation,
  evaluateOwnership,
  ObservationContractError,
  PROMOTABLE_VERBS,
  type JsonValue,
  type ManualAuthorityProvider,
  type ObservationDecision,
  type ObservationHead,
  type PromotableVerb,
} from './observations';
import {
  assertProjectableColumns,
  type SourceFamilyContract,
} from './source-families';

function fail(message: string): never {
  throw new ObservationContractError(message);
}

/* ------------------------------------------------------------------ *
 * The verb vocabulary
 * ------------------------------------------------------------------ */

/**
 * Decision C, exactly: ten verbs, no synonyms. `update`, `insert`,
 * `deleted`, `conflict` and friends are not members — a caller that wants
 * one has found a contract question, not a naming question.
 */
export const RECONCILIATION_VERBS = [
  'unchanged',
  'new',
  'corrected',
  'rescheduled',
  'absent',
  'unresolved_identity',
  'source_disagreement',
  'foreign_owned_collision',
  'manual_authority_conflict',
  'stale_review',
] as const;

export type ReconciliationVerb = (typeof RECONCILIATION_VERBS)[number];

/** The three verbs that propose a canonical write. Reused from S2 verbatim. */
export type ProposalVerb = PromotableVerb;

export type RefusalVerb =
  | 'unresolved_identity'
  | 'source_disagreement'
  | 'foreign_owned_collision'
  | 'manual_authority_conflict'
  | 'stale_review';

/**
 * The order in which `reconcile` decides, first match wins.
 *
 * Two principles fix it. Structural facts come before content: a stale
 * review, an absent key and an unchanged payload are all true regardless
 * of what any gate would say. And a refusal gate only runs when a
 * canonical write is actually being proposed — refusing a promotion nobody
 * proposed would fill the review queue with noise on every poll.
 */
export const VERB_PRECEDENCE = [
  'stale_review',
  'absent',
  'unchanged',
  'unresolved_identity',
  'foreign_owned_collision',
  'source_disagreement',
  'manual_authority_conflict',
  'new',
  'rescheduled',
  'corrected',
] as const;

export function assertReconciliationVerb(value: string): ReconciliationVerb {
  if (!(RECONCILIATION_VERBS as readonly string[]).includes(value)) {
    fail(
      `'${value}' is not a reconciliation verb. The vocabulary is fixed at `
      + `${RECONCILIATION_VERBS.join(', ')}.`,
    );
  }
  return value as ReconciliationVerb;
}

/* ------------------------------------------------------------------ *
 * Ownership — Decision E, extended for an unreadable owner
 * ------------------------------------------------------------------ */

/**
 * What is known about the canonical target's provenance.
 *
 * `unowned` is a target row whose `source_id` IS NULL — a **declared**
 * absence of ownership, which Decision E permits this source to write.
 * `indeterminate` is different in kind: the owner could not be read at
 * all. A natural key that matches is never sufficient reason to adopt a
 * row whose provenance is unknown.
 */
export type TargetOwnership =
  | { state: 'unowned' }
  | { state: 'owned'; sourceKey: string }
  | { state: 'indeterminate' };

export type OwnershipDecision =
  | { verdict: 'ok'; basis: 'unowned' | 'same_source' }
  | { verdict: 'foreign_owned_collision'; detail: 'foreign_source_owner' | 'ownership_indeterminate' };

/**
 * S2's `evaluateOwnership` is the predicate; this is the S3 reading of it
 * that keeps `indeterminate` distinct from NULL. The predicate itself is
 * unchanged — an unknown owner simply never reaches it.
 */
export function evaluateTargetOwnership(
  ownership: TargetOwnership, promotingSourceKey: string,
): OwnershipDecision {
  if (!promotingSourceKey) fail('A reconciliation must name the source it is reconciling for.');
  if (ownership.state === 'indeterminate') {
    return { verdict: 'foreign_owned_collision', detail: 'ownership_indeterminate' };
  }
  const owner = ownership.state === 'owned' ? ownership.sourceKey : null;
  if (evaluateOwnership(owner, promotingSourceKey) !== 'ok') {
    return { verdict: 'foreign_owned_collision', detail: 'foreign_source_owner' };
  }
  return { verdict: 'ok', basis: owner === null ? 'unowned' : 'same_source' };
}

/* ------------------------------------------------------------------ *
 * Identity resolution
 * ------------------------------------------------------------------ */

/**
 * How the source record resolved against canonical data. Resolution is the
 * family importer's job — clubs, venues, players and matches each resolve
 * differently — so this module consumes the answer and never guesses one.
 *
 * `new_target` means the natural key resolved and no canonical row exists.
 * `unresolved` means it did not resolve, or resolved ambiguously: no
 * source may create an identity, so that is a refusal, never an insert.
 */
export type IdentityResolution =
  | {
    status: 'resolved';
    entity: string;
    targetKey: Readonly<Record<string, unknown>>;
    ownership: TargetOwnership;
  }
  | {
    status: 'new_target';
    entity: string;
    targetKey: Readonly<Record<string, unknown>>;
  }
  | { status: 'unresolved'; reason: string };

/* ------------------------------------------------------------------ *
 * Corroboration — Decision F
 * ------------------------------------------------------------------ */

/** One other provider's view of the same proposed fact. */
export type ProviderClaim = {
  contract: SourceFamilyContract;
  values: Readonly<Record<string, JsonValue>>;
};

export type CorroborationReport = {
  ownGroup: string;
  /** Independence groups other than this source's that match on every shared field. */
  agreeingGroups: readonly string[];
  /** Independence groups other than this source's that conflict on a shared field. */
  disagreeingGroups: readonly string[];
  /**
   * Sources inside this source's OWN independence group that conflict. A
   * proxy drifting from its upstream is a data-quality signal, never a
   * second witness, so it can never raise `source_disagreement`.
   */
  sameGroupConflicts: readonly string[];
};

function groupOf(contract: SourceFamilyContract): string {
  const group = contract.independence?.group;
  if (!group) fail(`${contract.sourceKey}/${contract.family} carries no independence group.`);
  return group;
}

/**
 * Corroboration counts **independence groups**, never source rows: two
 * sources in one group are one witness, which is the whole point of the
 * per-family declaration.
 *
 * It reports; it does not decide. Agreement is recorded for the reviewer
 * and never shortens a gate — provider independence is not proven-distinct
 * ultimate authority (ISSUE-096 §15.3), so two agreeing groups authorise
 * exactly nothing.
 */
export function classifyCorroboration(
  contract: SourceFamilyContract,
  proposedValues: Readonly<Record<string, JsonValue>>,
  claims: readonly ProviderClaim[],
): CorroborationReport {
  const ownGroup = groupOf(contract);
  const agreeing = new Set<string>();
  const disagreeing = new Set<string>();
  const sameGroup = new Set<string>();

  for (const claim of claims) {
    const claimGroup = groupOf(claim.contract);
    const shared = Object.keys(proposedValues).filter((field) => field in claim.values);
    if (shared.length === 0) continue;
    const conflicts = shared.some(
      (field) => !sameValue(proposedValues[field], claim.values[field]),
    );
    if (claimGroup === ownGroup) {
      if (conflicts) sameGroup.add(claim.contract.sourceKey);
      continue;
    }
    if (conflicts) disagreeing.add(claimGroup);
    else agreeing.add(claimGroup);
  }

  return {
    ownGroup,
    agreeingGroups: [...agreeing].sort(),
    disagreeingGroups: [...disagreeing].sort(),
    sameGroupConflicts: [...sameGroup].sort(),
  };
}

/* ------------------------------------------------------------------ *
 * Field diffing
 * ------------------------------------------------------------------ */

function stableJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const row = value as { readonly [key: string]: JsonValue };
    const entries = Object.keys(row).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(row[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Value equality for corroboration and field diffing, by stable JSON.
 *
 * Exported so a caller that must EXPLAIN a disagreement compares fields with
 * exactly the semantics that classified it. A second implementation could
 * drift and produce a finding that names a disagreeing group with no
 * conflicting field to show for it.
 */
export function sameValue(a: JsonValue, b: JsonValue): boolean {
  return stableJson(a) === stableJson(b);
}

/**
 * The fields a promotion would actually write: those the source proposes
 * whose canonical value differs, or which the target does not carry at
 * all. A null target is a new row, so every proposed field is written.
 */
export function diffFields(
  proposedValues: Readonly<Record<string, JsonValue>>,
  targetValues: Readonly<Record<string, JsonValue>> | null,
): string[] {
  const fields = Object.keys(proposedValues).sort();
  if (targetValues === null) return fields;
  return fields.filter(
    (field) => !(field in targetValues) || !sameValue(proposedValues[field], targetValues[field]),
  );
}

/* ------------------------------------------------------------------ *
 * Review freshness
 * ------------------------------------------------------------------ */

/**
 * The evidence a rendered proposal was derived from, supplied only when a
 * previously rendered reconciliation is being re-derived. Its absence
 * means this is a first computation, which cannot be stale.
 */
export type ReviewContext = {
  /** The open `version_seq` the rendered proposal was derived from. */
  renderedSourceVersionSeq: number | null;
  /** The target's baseline hash captured at render time; null for a new target. */
  renderedBaselineCanonicalHash: string | null;
  /** The same hash recomputed now. */
  currentBaselineCanonicalHash: string | null;
};

export type StaleReviewDetail = 'source_version_moved' | 'canonical_baseline_moved';

/**
 * Kept deliberately separate from `corrected`: a source correction is the
 * upstream changing its mind, while a stale review is AFLDB's own evidence
 * having moved under a reviewer. The authoritative recheck still happens
 * inside the accept transaction (`evaluateAcceptance`); this is the same
 * question asked earlier, so a stale proposal is requeued rather than
 * rendered.
 */
export function evaluateReviewFreshness(
  review: ReviewContext, head: ObservationHead | null,
): StaleReviewDetail | null {
  if (review.renderedSourceVersionSeq !== (head?.versionSeq ?? null)) return 'source_version_moved';
  if (review.renderedBaselineCanonicalHash !== review.currentBaselineCanonicalHash) {
    return 'canonical_baseline_moved';
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The reconciliation
 * ------------------------------------------------------------------ */

export type RefusalDetail =
  | StaleReviewDetail
  | 'identity_unresolved'
  | 'foreign_source_owner'
  | 'ownership_indeterminate'
  | 'independent_sources_disagree'
  | 'authority_conflict'
  | 'authority_indeterminate';

export type ReconciliationProposal = {
  verb: ProposalVerb;
  entity: string;
  targetKey: Readonly<Record<string, unknown>>;
  /** Exactly the fields the promotion would write. */
  fields: readonly string[];
  proposedValues: Readonly<Record<string, JsonValue>>;
  corroboration: CorroborationReport;
};

/**
 * Every outcome carries the observation decision where one was made, so a
 * caller can move history and classify the record in one pass.
 *
 * `history_only` is the one outcome with no verb, and that is deliberate.
 * Decision C defines `corrected` as a new hash "differing in a **fact**
 * field"; when the payload genuinely changed but no projected fact did —
 * Squiggle's `complete` advancing 90 -> 100 is the everyday case — the
 * version must be appended and no candidate may be created. Reporting it
 * as `unchanged` would lie about the source state; reporting it as
 * `corrected` would create a candidate proposing nothing. So it is typed
 * as a kind rather than smuggled in as an eleventh verb.
 */
export type ReconciliationOutcome =
  | { kind: 'unchanged'; verb: 'unchanged'; observation: ObservationDecision }
  | { kind: 'history_only'; observation: ObservationDecision; changedFields: readonly [] }
  | {
    kind: 'absent';
    verb: 'absent';
    externalRecordId: string;
    scopeKey: string;
    /** Absence is an observation state. It is never a canonical deletion. */
    canonicalChange: 'none';
  }
  | {
    kind: 'refusal';
    verb: RefusalVerb;
    detail: RefusalDetail;
    requeue: boolean;
    observation: ObservationDecision | null;
    corroboration: CorroborationReport | null;
    note: string | null;
  }
  | {
    kind: 'candidate';
    verb: ProposalVerb;
    observation: ObservationDecision;
    proposal: ReconciliationProposal;
  };

export type ObservedRecord =
  | {
    present: true;
    payload: JsonValue;
    observedAt: string;
    /** Payload hashes already stored for this source+family, for A -> B -> A. */
    knownPayloadHashes?: ReadonlySet<string>;
    /** When supplied, the S1 projection gate runs: drift refuses, never NULLs. */
    observedColumns?: readonly string[];
  }
  | {
    present: false;
    scopeKey: string;
    /** The scopes this fetch actually enumerated. Absence outside them is unknowable. */
    enumeratedScopeKeys: readonly string[];
  };

/** Whether the record can still move: only an unplayed record reschedules. */
export type RecordState = 'played' | 'unplayed' | 'unknown';

export type ReconcileInput = {
  contract: SourceFamilyContract;
  externalRecordId: string;
  /** The currently open observation version, or null when never observed. */
  head: ObservationHead | null;
  observed: ObservedRecord;
  identity: IdentityResolution;
  /** The family's typed projection of the live payload — the promotable fact set. */
  proposedValues: Readonly<Record<string, JsonValue>>;
  /** The canonical row's current values for exactly those fields; null for a new target. */
  targetValues: Readonly<Record<string, JsonValue>> | null;
  /** Fields the family classifies as schedule movement (date, time, venue, round). */
  scheduleFields?: readonly string[];
  recordState?: RecordState;
  corroboration?: readonly ProviderClaim[];
  /**
   * Required, with no default: a caller cannot reconcile without naming an
   * authority provider, and `UNAVAILABLE_MANUAL_AUTHORITY` is the one that
   * ships until ISSUE-086's contract lands.
   */
  manualAuthority: ManualAuthorityProvider;
  review?: ReviewContext;
};

/**
 * A reschedule is schedule movement on a record that has not been played.
 * Anything else — a score, a statistic, a played record's date, or a
 * schedule field moving alongside a fact field — is a correction. An
 * unknown record state can never reschedule, so the fail-closed answer is
 * the one that keeps a score correction visible as a correction.
 */
function classifyChange(
  changedFields: readonly string[], scheduleFields: readonly string[], state: RecordState,
): Exclude<ProposalVerb, 'new'> {
  if (state !== 'unplayed') return 'corrected';
  if (scheduleFields.length === 0) return 'corrected';
  return changedFields.every((field) => scheduleFields.includes(field)) ? 'rescheduled' : 'corrected';
}

/**
 * Which of Decision C's verbs applies to one live source record.
 *
 * Decides only. It writes nothing, and no branch through it reaches
 * canonical data: the strongest outcome it can produce is a candidate —
 * a proposal a super admin must still accept, at which point
 * `evaluateAcceptance` re-runs every gate inside the transaction.
 */
export function reconcile(input: ReconcileInput): ReconciliationOutcome {
  const { contract, identity, observed } = input;
  if (!input.externalRecordId) fail('A reconciliation needs the external record id it describes.');
  if (typeof input.manualAuthority !== 'function') {
    fail('A reconciliation needs a manual-authority provider; there is no default and no bypass.');
  }

  // 1. Stale review. The evidence this result would be derived from has
  //    moved, so nothing computed from it can be trusted.
  if (input.review) {
    const stale = evaluateReviewFreshness(input.review, input.head);
    if (stale) {
      return {
        kind: 'refusal', verb: 'stale_review', detail: stale, requeue: true,
        observation: null, corroboration: null, note: null,
      };
    }
  }

  // 2. Absence, and only inside a scope the fetch actually enumerated.
  if (!observed.present) {
    if (!observed.enumeratedScopeKeys.includes(observed.scopeKey)) {
      fail(
        `Absence cannot be asserted for scope '${observed.scopeKey}': this fetch never checked it.`,
      );
    }
    return {
      kind: 'absent', verb: 'absent', externalRecordId: input.externalRecordId,
      scopeKey: observed.scopeKey, canonicalChange: 'none',
    };
  }

  // The S1 projection gate, when the caller supplies the observed shape: a
  // missing required column or an undeclared one refuses outright.
  if (observed.observedColumns) assertProjectableColumns(contract, observed.observedColumns);

  const observation = decideObservation({
    contract,
    head: input.head,
    payload: observed.payload,
    observedAt: observed.observedAt,
    knownPayloadHashes: observed.knownPayloadHashes,
  });

  // 3. Unchanged is decided by the family's hash contract alone. No
  //    candidate or canonical semantics participate.
  if (observation.action === 'unchanged') {
    return { kind: 'unchanged', verb: 'unchanged', observation };
  }

  // 4. Identity. No source creates an identity, and a weak name never
  //    stands in for one.
  if (identity.status === 'unresolved') {
    return {
      kind: 'refusal', verb: 'unresolved_identity', detail: 'identity_unresolved',
      requeue: false, observation, corroboration: null, note: identity.reason,
    };
  }

  const isNewTarget = identity.status === 'new_target';
  if (isNewTarget && input.targetValues !== null) {
    fail('A new target has no canonical values; targetValues must be null.');
  }
  if (!isNewTarget && input.targetValues === null) {
    fail('A resolved target must supply its current values for the proposed fields.');
  }
  if (isNewTarget && Object.keys(input.proposedValues).length === 0) {
    fail('A new-target proposal must name at least one field.');
  }

  const changedFields = diffFields(input.proposedValues, isNewTarget ? null : input.targetValues);

  // 5. The payload moved but no projected fact did. History advances and
  //    nothing is proposed, so no refusal gate runs — see the type note.
  if (changedFields.length === 0) {
    return { kind: 'history_only', observation, changedFields: [] };
  }

  // 6. Ownership. Only a target that exists can be collided with; a new
  //    target has no owner to displace.
  if (identity.status === 'resolved') {
    const ownership = evaluateTargetOwnership(identity.ownership, contract.sourceKey);
    if (ownership.verdict !== 'ok') {
      return {
        kind: 'refusal', verb: 'foreign_owned_collision', detail: ownership.detail,
        requeue: false, observation, corroboration: null, note: null,
      };
    }
  }

  // 7. Corroboration. Agreement is recorded and authorises nothing.
  //    Disagreement between independence groups blocks — UNLESS this family
  //    declares `corroboration_policy: "advisory"` (AFLDB-ISSUE-122 §10).
  //
  //    Under `advisory` the report is still computed and still travels on the
  //    outcome, so `disagreeing_groups` is recorded on the ledger row and the
  //    `source_disagreement` data_issue is still opened and deduplicated by
  //    the settle caller, which reads the report and not this verb. Only the
  //    VETO is withdrawn: a source being retired must not be able to refuse a
  //    proposal from the source that replaces it, and its agreement is never a
  //    prerequisite. An undeclared family is `blocking`, so nothing else moves.
  const corroboration = classifyCorroboration(contract, input.proposedValues, input.corroboration ?? []);
  if (corroboration.disagreeingGroups.length > 0 && contract.corroborationPolicy === 'blocking') {
    return {
      kind: 'refusal', verb: 'source_disagreement', detail: 'independent_sources_disagree',
      requeue: false, observation, corroboration, note: null,
    };
  }

  // 8. Human authority, last and strongest, and asked only where a
  //    promotion would overwrite an existing canonical row — ISSUE-096 §7
  //    scopes the invariant to overwriting an active human decision, and
  //    its implementation gate to `corrected`/update candidates. A row
  //    that does not exist carries no human decision to overwrite. The
  //    accept transaction asks unconditionally regardless, so a `new`
  //    candidate still cannot be written while authority is unavailable.
  if (identity.status === 'resolved') {
    const verdict = input.manualAuthority({
      entity: identity.entity,
      targetKey: identity.targetKey,
      fields: changedFields,
    });
    if (verdict !== 'clear') {
      return {
        kind: 'refusal',
        verb: 'manual_authority_conflict',
        detail: verdict === 'conflict' ? 'authority_conflict' : 'authority_indeterminate',
        requeue: true,
        observation,
        corroboration,
        note: null,
      };
    }
  }

  // 9. A proposal, for a human to review. Nothing is written here.
  const verb: ProposalVerb = isNewTarget
    ? 'new'
    : classifyChange(changedFields, input.scheduleFields ?? [], input.recordState ?? 'unknown');
  if (!(PROMOTABLE_VERBS as readonly string[]).includes(verb)) {
    fail(`'${verb}' is not a verb that may propose a canonical write.`);
  }

  return {
    kind: 'candidate',
    verb,
    observation,
    proposal: {
      verb,
      entity: identity.entity,
      targetKey: identity.targetKey,
      fields: changedFields,
      proposedValues: input.proposedValues,
      corroboration,
    },
  };
}
