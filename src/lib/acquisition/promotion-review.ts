/**
 * AFLDB-ISSUE-096 S4 — the promotion-review contract.
 *
 * S2 decided whether history moves and whether an accept may write. S3
 * decided which verb a live payload earns. This module is the third and
 * last piece the runbook asks for: **what a super admin is shown, and what
 * the accept path must re-prove before a canonical write could ever
 * happen.** It is the domain model behind the review screen, deliberately
 * kept free of React so the rules can be tested without rendering
 * anything.
 *
 * Five rules shape it, and none of them is new:
 *
 *   1. **A candidate is a proposal.** Nothing here writes, and there is no
 *      code path from a review item to canonical data.
 *   2. **The baseline covers exactly the fields the promotion would
 *      write** — no timestamps, no untouched columns, no source metadata.
 *      An unrelated canonical column moving must not invalidate a review;
 *      a proposed field moving must.
 *   3. **Render and accept ask the same question.** Both run S2's
 *      `evaluateAcceptance`, so the screen can never offer a button that
 *      the accept transaction would refuse.
 *   4. **Fail closed.** Not pending, moved source evidence, a moved
 *      baseline, a season this pipeline does not own, foreign or unreadable
 *      ownership, and any authority answer other than `clear` all refuse.
 *      There is no force flag, no override and no consensus shortcut:
 *      agreeing independence groups are reported to the reviewer and
 *      authorise exactly nothing (ISSUE-096 §15.3).
 *   5. **The canonical write is NOT implemented here.** ISSUE-096 §7 gates
 *      promotion onto an existing canonical row on ISSUE-086's authority
 *      contract landing, and `UNAVAILABLE_MANUAL_AUTHORITY` enforces that
 *      by construction. So this module can produce a refusal, a reject
 *      decision or a requeue decision — and never an `accept` decision.
 *      `PromotionDecisionDraft` makes that unrepresentable rather than
 *      merely undone: its `decision` type has no `'accept'` member and its
 *      value columns are typed `null`.
 *
 * No database, no filesystem, no network, no clock: every input is passed
 * in, exactly as in S2 and S3.
 */
import { createHash } from 'node:crypto';

import {
  canonicalJson,
  evaluateAcceptance,
  HASH_ALGORITHM,
  HASH_VERSION,
  ObservationContractError,
  PROMOTABLE_VERBS,
  type AcceptanceVerdict,
  type JsonValue,
  type ManualAuthorityProvider,
  type ManualAuthorityVerdict,
  type RefusalReason,
} from './observations';
import {
  diffFields,
  evaluateTargetOwnership,
  RECONCILIATION_VERBS,
  type OwnershipDecision,
  type ReconciliationOutcome,
  type ReconciliationVerb,
  type TargetOwnership,
} from './reconciliation';
import type { SourceFamilyContract } from './source-families';

function fail(message: string): never {
  throw new ObservationContractError(message);
}

/* ------------------------------------------------------------------ *
 * The candidate, as migration 074 stores it
 * ------------------------------------------------------------------ */

/** Canonical AFLDB values, keyed by canonical field name. */
export type CanonicalValues = Readonly<Record<string, JsonValue>>;

export type CandidateStatus = 'pending' | 'accepted' | 'rejected' | 'superseded';

/**
 * Every reconciliation verb except `unchanged`, which produces no diff and
 * therefore no candidate. This is `promotion_candidates_verb_ck`, in
 * TypeScript.
 */
export type CandidateVerb = Exclude<ReconciliationVerb, 'unchanged'>;

export const CANDIDATE_VERBS: readonly CandidateVerb[] =
  RECONCILIATION_VERBS.filter((verb): verb is CandidateVerb => verb !== 'unchanged');

/**
 * One row of `promotion_candidates`, plus the two things the table stores
 * implicitly: the source's independence group (declared in reference data)
 * and the opaque target key the ISSUE-086 authority question is asked
 * against. `targetId` is the surrogate id the canonical write would use and
 * is **never** part of the authority question.
 */
export type PromotionCandidateRecord = {
  /** Null until the row is inserted. A decision can only name a stored candidate. */
  id: number | null;
  status: CandidateStatus;
  sourceKey: string;
  family: string;
  independenceGroup: string;
  externalRecordId: string;
  /** The observation version the proposal was derived from. */
  sourceVersionSeq: number;
  verb: CandidateVerb;
  season: number;
  /** The ISSUE-086 authority namespace. */
  entity: string;
  targetTable: string;
  targetId: number | null;
  targetKey: Readonly<Record<string, unknown>>;
  /** Exactly the fields the promotion would write. */
  fields: readonly string[];
  /** `proposed_fields`: those same fields mapped to the values that would be written. */
  proposedValues: CanonicalValues;
  baselineCanonicalHash: string | null;
  agreeingGroups: readonly string[];
  disagreeingGroups: readonly string[];
};

/**
 * The CHECK constraints of `promotion_candidates`, enforced before a row is
 * ever built rather than only at INSERT. Keeping them here means the review
 * contract is testable without applying migration 074.
 */
export function assertCandidateShape(candidate: PromotionCandidateRecord): void {
  if (!(CANDIDATE_VERBS as readonly string[]).includes(candidate.verb)) {
    fail(`'${candidate.verb}' cannot be stored as a promotion candidate.`);
  }
  const promotable = (PROMOTABLE_VERBS as readonly string[]).includes(candidate.verb);
  if (candidate.status === 'accepted' && !promotable) {
    fail(`A '${candidate.verb}' candidate can never reach 'accepted'.`);
  }
  if (candidate.verb === 'new') {
    if (candidate.targetId !== null || candidate.baselineCanonicalHash !== null) {
      fail('A new-target candidate has no target id and no baseline to go stale.');
    }
  } else if ((candidate.targetId === null) !== (candidate.baselineCanonicalHash === null)) {
    fail('A candidate must carry both a target id and a baseline hash, or neither.');
  }
  if (candidate.verb === 'absent') {
    if (candidate.targetId !== null || candidate.fields.length > 0) {
      fail('An absent candidate proposes nothing: no target, no fields.');
    }
  }
  if (promotable && candidate.fields.length === 0) {
    fail(`A '${candidate.verb}' candidate must name at least one field to write.`);
  }
  const named = [...candidate.fields].sort();
  const carried = Object.keys(candidate.proposedValues).sort();
  if (named.length !== carried.length || named.some((field, i) => field !== carried[i])) {
    fail(
      'A candidate\'s proposed field set and proposed values must be exactly the same fields: '
      + `named [${named.join(', ')}], carried [${carried.join(', ')}].`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * The baseline canonical hash
 * ------------------------------------------------------------------ */

/**
 * The recipe stamped into every baseline preimage, so a later change to
 * this scheme cannot be mistaken for a canonical value having moved. It
 * reuses S2's algorithm and version rather than inventing a second one, and
 * carries **no exclusion list**: a family's payload exclusions are declared
 * against source columns and must never be applied to canonical values.
 */
export const BASELINE_HASH_RECIPE = `${HASH_ALGORITHM}/v${HASH_VERSION}(canonical-fields)`;

/**
 * The exact string the baseline hashes. Exported because it is the honest
 * way to show what is and is not covered: the recipe, then the canonical
 * JSON of **only** the named fields.
 *
 * Field order cannot alter it (the names are sorted), property order cannot
 * alter it (`canonicalJson` sorts keys at every depth), and a canonical
 * column the promotion does not touch cannot alter it because it is never
 * projected in. A named field missing from the read refuses: an absent key
 * and a NULL value are different facts, and guessing between them is
 * exactly the ambiguity a baseline exists to prevent.
 */
export function baselineCanonicalPreimage(
  fields: readonly string[], values: CanonicalValues,
): string {
  if (fields.length === 0) {
    fail('A canonical baseline must name the fields it covers; an empty set proves nothing.');
  }
  const unique = new Set(fields);
  if (unique.size !== fields.length) {
    fail('A canonical baseline field set cannot repeat a field.');
  }
  const projected: Record<string, JsonValue> = {};
  for (const field of [...unique].sort()) {
    if (!(field in values)) {
      fail(
        `Canonical field '${field}' was not read from the target row, so no baseline can be `
        + 'computed for it. A missing read is not a NULL value.',
      );
    }
    projected[field] = values[field];
  }
  return `${BASELINE_HASH_RECIPE}\n${canonicalJson(projected)}`;
}

/**
 * The hash migration 074 stores in `baseline_canonical_hash char(64)`, or
 * null when there is no target row to have a baseline — which is precisely
 * the `new` case `promotion_candidates_target_ck` describes.
 */
export function baselineCanonicalHash(
  fields: readonly string[], values: CanonicalValues | null,
): string | null {
  if (values === null) return null;
  return createHash(HASH_ALGORITHM)
    .update(baselineCanonicalPreimage(fields, values), 'utf8')
    .digest('hex');
}

/* ------------------------------------------------------------------ *
 * What the reviewer is shown
 * ------------------------------------------------------------------ */

export type FieldDiff = {
  field: string;
  proposed: JsonValue;
  /** The canonical row's current value, or null where the target has none. */
  current: JsonValue | null;
  /** True for a new row, or a field the target does not carry at all. */
  absentFromTarget: boolean;
  changed: boolean;
};

/**
 * The per-field diff §6 requires the screen to show. `changed` comes from
 * S3's `diffFields`, so the review and the reconciliation agree on what
 * "different" means by construction rather than by convention.
 */
export function reviewDiff(
  fields: readonly string[],
  proposedValues: CanonicalValues,
  currentValues: CanonicalValues | null,
): FieldDiff[] {
  const changed = new Set(diffFields(proposedValues, currentValues));
  return [...fields].sort().map((field) => {
    if (!(field in proposedValues)) {
      fail(`Field '${field}' is named by the proposal but carries no proposed value.`);
    }
    const absentFromTarget = currentValues === null || !(field in currentValues);
    return {
      field,
      proposed: proposedValues[field],
      current: absentFromTarget ? null : (currentValues as CanonicalValues)[field],
      absentFromTarget,
      changed: changed.has(field),
    };
  });
}

/**
 * Everything re-read at render time, and again inside the accept
 * transaction. Nothing on a candidate row is trusted for any of it.
 */
export type ReviewEvidence = {
  /** The currently open observation version for this source record. */
  sourceVersionSeq: number;
  /** The target row's values for exactly the candidate's fields; null when there is no target. */
  canonicalValues: CanonicalValues | null;
  /**
   * The target row's provenance, or null when there is no target row. An
   * owner that cannot be read is `indeterminate` and refuses — a matching
   * natural key is never a reason to adopt provenance nobody can attribute.
   */
  ownership: TargetOwnership | null;
  /** Observation lineage, for the reviewer only. */
  firstSeenAt: string | null;
  sourceUpdatedAt: string | null;
};

/** Whether the screen may offer an accept at all. */
export type ReviewState = 'reviewable' | 'blocked' | 'stale';

export type PromotionReviewItem = {
  candidateId: number | null;
  status: CandidateStatus;
  source: {
    key: string;
    family: string;
    independenceGroup: string;
    externalRecordId: string;
    versionSeq: number;
  };
  verb: CandidateVerb;
  season: number;
  target: {
    entity: string;
    table: string;
    id: number | null;
    /** Opaque, and the only target identifier the authority question sees. */
    key: Readonly<Record<string, unknown>>;
  };
  fields: readonly string[];
  proposedValues: CanonicalValues;
  currentValues: CanonicalValues | null;
  diff: readonly FieldDiff[];
  baseline: {
    /** As captured when the candidate was created. */
    rendered: string | null;
    /** Recomputed now, over exactly the same fields. */
    current: string | null;
    matches: boolean;
  };
  corroboration: {
    agreeingGroups: readonly string[];
    disagreeingGroups: readonly string[];
  };
  /** `not_asked` when an earlier gate refused first — never assumed clear. */
  authority: ManualAuthorityVerdict | 'not_asked';
  ownership: OwnershipDecision | null;
  reviewState: ReviewState;
  reviewable: boolean;
  /** S2's vocabulary, unchanged: the most specific true refusal. */
  refusalReason: RefusalReason | null;
  requeue: RequeueAction | null;
  lineage: {
    firstSeenAt: string | null;
    sourceVersionSeq: number;
    sourceUpdatedAt: string | null;
  };
};

/* ------------------------------------------------------------------ *
 * Running the gates
 * ------------------------------------------------------------------ */

/**
 * A value no source key can hold, used only to make S2's containment
 * predicate refuse when S3's three-state reading has already said ownership
 * is not ok. Passing it keeps **S2's gate order** authoritative instead of
 * pre-empting it with an ownership check of our own; it is never persisted
 * and never leaves this module.
 */
const OWNERSHIP_REFUSED = '!ownership-refused';

function ownerForContainment(
  decision: OwnershipDecision | null, promotingSourceKey: string,
): string | null {
  if (promotingSourceKey === OWNERSHIP_REFUSED) {
    fail('That is not a usable source key.');
  }
  // No target row: there is no owner to displace, and S2 reads null as
  // adoptable exactly as Decision E does.
  if (decision === null) return null;
  if (decision.verdict !== 'ok') return OWNERSHIP_REFUSED;
  return decision.basis === 'same_source' ? promotingSourceKey : null;
}

export type GateRun = {
  verdict: AcceptanceVerdict;
  currentBaseline: string | null;
  ownership: OwnershipDecision | null;
  authority: ManualAuthorityVerdict | 'not_asked';
};

/**
 * The single evaluation both the review screen and the accept path use.
 *
 * The S4 addition is step 3 of §6: the baseline is **recomputed here** from
 * freshly read canonical values over exactly the proposed fields, rather
 * than being handed in as an opaque hash. Everything after that is S2's
 * `evaluateAcceptance`, reused rather than restated, so the gate order and
 * the `stale_review` / `stale_canonical_target` distinction stay exactly
 * where they were proven:
 *
 *   not_pending -> verb_not_promotable -> stale_review (source moved) ->
 *   stale_canonical_target (baseline moved) -> season_not_in_progress ->
 *   foreign_owned_collision -> manual authority.
 *
 * Every gate fails closed, so ordering decides only which true reason is
 * reported first, never whether a gate is skipped.
 */
export function runPromotionGates(
  candidate: PromotionCandidateRecord,
  evidence: ReviewEvidence,
  inProgressSeasons: readonly number[],
  manualAuthority: ManualAuthorityProvider,
): GateRun {
  assertCandidateShape(candidate);
  if (typeof manualAuthority !== 'function') {
    fail('A promotion review needs a manual-authority provider; there is no default and no bypass.');
  }
  // A refusal candidate proposes no fields, so it has no baseline. It is
  // barred from acceptance by verb, not by hash.
  const currentBaseline = candidate.fields.length === 0
    ? null
    : baselineCanonicalHash(candidate.fields, evidence.canonicalValues);
  const ownership = evidence.ownership === null
    ? null
    : evaluateTargetOwnership(evidence.ownership, candidate.sourceKey);

  let authority: ManualAuthorityVerdict | 'not_asked' = 'not_asked';
  const probe: ManualAuthorityProvider = (query) => {
    const answer = manualAuthority(query);
    authority = answer;
    return answer;
  };

  const verdict = evaluateAcceptance({
    candidate: {
      status: candidate.status,
      verb: candidate.verb,
      season: candidate.season,
      sourceKey: candidate.sourceKey,
      family: candidate.family,
      externalRecordId: candidate.externalRecordId,
      sourceVersionSeq: candidate.sourceVersionSeq,
      baselineCanonicalHash: candidate.baselineCanonicalHash,
      fields: candidate.fields,
      entity: candidate.entity,
      // Opaque, and deliberately not `targetId`: the ISSUE-086 question is
      // asked over a key the caller fills in, never over a surrogate id.
      targetKey: candidate.targetKey,
    },
    current: {
      sourceVersionSeq: evidence.sourceVersionSeq,
      canonicalHash: currentBaseline,
      targetOwnerSourceKey: ownerForContainment(ownership, candidate.sourceKey),
    },
    inProgressSeasons,
    manualAuthority: probe,
  });

  return { verdict, currentBaseline, ownership, authority };
}

const STALE_REFUSALS: readonly RefusalReason[] = ['stale_review', 'stale_canonical_target'];

/**
 * The review item §6 says the super admin sees: the verb, the target's
 * current values, the proposed values, a per-field diff, which independence
 * groups agree and disagree, and the observation lineage — plus, because
 * the screen must fail closed rather than merely inform, whether an accept
 * would be refused and why.
 *
 * It renders. It does not decide anything the accept transaction will not
 * re-decide from freshly read state.
 */
export function renderReviewItem(input: {
  candidate: PromotionCandidateRecord;
  evidence: ReviewEvidence;
  inProgressSeasons: readonly number[];
  manualAuthority: ManualAuthorityProvider;
}): PromotionReviewItem {
  const { candidate, evidence } = input;
  const gates = runPromotionGates(
    candidate, evidence, input.inProgressSeasons, input.manualAuthority,
  );
  const refusalReason = gates.verdict.ok ? null : gates.verdict.refusal;
  const reviewState: ReviewState = gates.verdict.ok
    ? 'reviewable'
    : (STALE_REFUSALS.includes(gates.verdict.refusal) ? 'stale' : 'blocked');

  return {
    candidateId: candidate.id,
    status: candidate.status,
    source: {
      key: candidate.sourceKey,
      family: candidate.family,
      independenceGroup: candidate.independenceGroup,
      externalRecordId: candidate.externalRecordId,
      versionSeq: candidate.sourceVersionSeq,
    },
    verb: candidate.verb,
    season: candidate.season,
    target: {
      entity: candidate.entity,
      table: candidate.targetTable,
      id: candidate.targetId,
      key: candidate.targetKey,
    },
    fields: candidate.fields,
    proposedValues: candidate.proposedValues,
    currentValues: evidence.canonicalValues,
    diff: reviewDiff(candidate.fields, candidate.proposedValues, evidence.canonicalValues),
    baseline: {
      rendered: candidate.baselineCanonicalHash,
      current: gates.currentBaseline,
      matches: candidate.baselineCanonicalHash === gates.currentBaseline,
    },
    corroboration: {
      agreeingGroups: candidate.agreeingGroups,
      disagreeingGroups: candidate.disagreeingGroups,
    },
    authority: gates.authority,
    ownership: gates.ownership,
    reviewState,
    reviewable: gates.verdict.ok,
    refusalReason,
    requeue: refusalReason === null ? null : requeueActionFor(refusalReason),
    lineage: {
      firstSeenAt: evidence.firstSeenAt,
      sourceVersionSeq: evidence.sourceVersionSeq,
      sourceUpdatedAt: evidence.sourceUpdatedAt,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Requeue and supersede
 * ------------------------------------------------------------------ */

/**
 * What must happen to the candidate row when an accept refuses.
 *
 * The two stale reasons are deliberately NOT collapsed, because they need
 * different handling. `stale_canonical_target` means the evidence is still
 * the open version and only the baseline moved, so the same candidate is
 * re-rendered in place against a recomputed baseline. `stale_review` means
 * the source itself moved on: the reviewed version is no longer open, so
 * the proposal must be **superseded** and reconciliation must produce a
 * replacement — which `ux_promotion_candidates_pending` requires anyway,
 * since only one pending candidate per (source, family, record, table) may
 * exist at a time.
 */
export type RequeueAction = {
  action: 'rerender_in_place' | 'supersede_and_reconcile';
  candidateStatus: 'pending' | 'superseded';
  recomputeBaseline: true;
};

export function requeueActionFor(refusal: RefusalReason): RequeueAction | null {
  switch (refusal) {
    case 'stale_review':
      return {
        action: 'supersede_and_reconcile', candidateStatus: 'superseded', recomputeBaseline: true,
      };
    case 'stale_canonical_target':
    case 'manual_authority_conflict':
    case 'manual_authority_indeterminate':
      // Queued for review, exactly as ISSUE-096 §7 requires: the candidate
      // stays pending and unacceptable until authority answers `clear`.
      return {
        action: 'rerender_in_place', candidateStatus: 'pending', recomputeBaseline: true,
      };
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ *
 * Decisions — append-only, and never an accept
 * ------------------------------------------------------------------ */

/**
 * The refusal reasons `promotion_decisions_reason_ck` accepts that this
 * evaluation can actually produce. `not_pending` and `verb_not_promotable`
 * are absent on purpose: neither is a decision about a promotion, and
 * neither is representable in the ledger.
 */
export const RECORDABLE_REFUSALS = [
  'stale_review',
  'stale_canonical_target',
  'manual_authority_conflict',
  'manual_authority_indeterminate',
  'foreign_owned_collision',
  'season_not_in_progress',
] as const;

export type RecordableRefusal = (typeof RECORDABLE_REFUSALS)[number];

export function isRecordableRefusal(refusal: RefusalReason): refusal is RecordableRefusal {
  return (RECORDABLE_REFUSALS as readonly string[]).includes(refusal);
}

/**
 * What the candidate row becomes. `promotion_candidates` requires
 * `(status = 'pending') = (resolved_at IS NULL) = (resolved_decision_id IS
 * NULL)`, so the two halves can never be set independently.
 */
export type CandidateTransition = {
  status: CandidateStatus;
  /** Sets `resolved_at` and `resolved_decision_id` together, or neither. */
  setsResolution: boolean;
};

function assertTransition(transition: CandidateTransition): CandidateTransition {
  if ((transition.status === 'pending') === transition.setsResolution) {
    fail(
      'A pending candidate carries no resolution and a resolved candidate must carry one: '
      + `'${transition.status}' with setsResolution=${transition.setsResolution} is neither.`,
    );
  }
  return transition;
}

/**
 * One row of the append-only `promotion_decisions` ledger.
 *
 * **`decision` has no `'accept'` member, and both value columns are typed
 * `null`.** That is ISSUE-096 §7's implementation gate expressed in the
 * type system: S4 cannot construct an acceptance, so it cannot pretend a
 * canonical write happened. When ISSUE-086's authority contract lands and
 * the canonical transaction is built, that is where an accept decision —
 * carrying real `previous_values` / `new_values` — becomes constructible.
 */
export type PromotionDecisionDraft = {
  candidateId: number;
  decision: 'reject' | 'requeue';
  refusalReason: RecordableRefusal | null;
  adminUserId: number;
  previousValues: null;
  newValues: null;
  note: string | null;
  /** Neither a reject nor a requeue touches canonical data. Ever. */
  canonicalChange: 'none';
  candidateTransition: CandidateTransition;
};

function decidableCandidateId(candidate: PromotionCandidateRecord): number {
  if (candidate.id === null) {
    fail('A decision can only be recorded against a stored candidate.');
  }
  if (candidate.status !== 'pending') {
    fail(`A '${candidate.status}' candidate has already been decided.`);
  }
  return candidate.id;
}

function normaliseNote(note: string | null | undefined): string | null {
  if (note === null || note === undefined || note === '') return null;
  if (note.length > 2000) fail('A decision note is limited to 2000 characters.');
  return note;
}

function requireAdmin(adminUserId: number): number {
  if (!Number.isInteger(adminUserId) || adminUserId <= 0) {
    fail('A promotion decision must name the super admin who made it.');
  }
  return adminUserId;
}

/**
 * A rejection. It writes the decision row and **nothing else**: no
 * canonical fact changes, no source record is deleted, no observation
 * version is rewritten, and no `absent_since` is stamped. The draft carries
 * no source-mutation fields at all, so a reject cannot become a source
 * deletion by accident later.
 */
export function buildRejectDecision(input: {
  candidate: PromotionCandidateRecord;
  adminUserId: number;
  note?: string | null;
}): PromotionDecisionDraft {
  return {
    candidateId: decidableCandidateId(input.candidate),
    decision: 'reject',
    refusalReason: null,
    adminUserId: requireAdmin(input.adminUserId),
    previousValues: null,
    newValues: null,
    note: normaliseNote(input.note),
    canonicalChange: 'none',
    candidateTransition: assertTransition({ status: 'rejected', setsResolution: true }),
  };
}

/**
 * The decision recorded when an accept was attempted and a gate refused.
 * `promotion_decisions_requeue_ck` requires the reason, which is why an
 * unrecordable refusal (`not_pending`, `verb_not_promotable`) produces no
 * ledger row rather than a row with an invented reason.
 */
export function buildRequeueDecision(input: {
  candidate: PromotionCandidateRecord;
  refusal: RefusalReason;
  adminUserId: number;
  note?: string | null;
}): PromotionDecisionDraft {
  if (!isRecordableRefusal(input.refusal)) {
    fail(`'${input.refusal}' is not a refusal the decision ledger can record.`);
  }
  const action = requeueActionFor(input.refusal);
  if (action === null) {
    fail(`'${input.refusal}' does not requeue: the candidate is not returned to the queue.`);
  }
  return {
    candidateId: decidableCandidateId(input.candidate),
    decision: 'requeue',
    refusalReason: input.refusal,
    adminUserId: requireAdmin(input.adminUserId),
    previousValues: null,
    newValues: null,
    note: normaliseNote(input.note),
    canonicalChange: 'none',
    candidateTransition: assertTransition({
      status: action.candidateStatus,
      setsResolution: action.candidateStatus !== 'pending',
    }),
  };
}

/* ------------------------------------------------------------------ *
 * The accept path — evaluated, never applied
 * ------------------------------------------------------------------ */

/**
 * Why a cleared evaluation still writes nothing.
 *
 * `canonical_write_unimplemented` is the honest state of ISSUE-096 S4: the
 * production acceptance transaction — the canonical write, its provenance
 * quartet and the accept decision row — is not built here. Under the
 * shipped `UNAVAILABLE_MANUAL_AUTHORITY` provider this branch is
 * unreachable anyway, which is ISSUE-096 §7's implementation gate holding
 * by construction rather than by discipline.
 */
export type WriteBlocker = 'canonical_write_unimplemented';

export type AcceptEvaluation =
  | {
    verdict: 'refused';
    refusal: RefusalReason;
    /** S3's ownership detail, so a foreign owner and an unreadable one stay distinct. */
    ownershipDetail: 'foreign_source_owner' | 'ownership_indeterminate' | null;
    authority: ManualAuthorityVerdict | 'not_asked';
    requeue: RequeueAction | null;
    canonicalChange: 'none';
    /** Null when the refusal is not representable in the ledger. */
    decision: PromotionDecisionDraft | null;
  }
  | {
    verdict: 'gates_cleared';
    authority: ManualAuthorityVerdict | 'not_asked';
    canonicalChange: 'none';
    write: { implemented: false; blockedBy: WriteBlocker };
    /** No accept decision exists to record, because no write happened. */
    decision: null;
  };

/**
 * Step 1 of ISSUE-096 §6's accept sequence, and every step up to — but
 * deliberately not including — the canonical write.
 *
 * Each gate re-reads current state through `runPromotionGates`; nothing is
 * trusted from render time. A refusal is returned with its ledger draft
 * where one is representable, and `gates_cleared` says exactly what it
 * means: the gates passed and the write is still not implemented. There is
 * no third outcome, and no argument that makes one appear.
 */
export function evaluateAcceptRequest(input: {
  candidate: PromotionCandidateRecord;
  evidence: ReviewEvidence;
  inProgressSeasons: readonly number[];
  manualAuthority: ManualAuthorityProvider;
  adminUserId: number;
  note?: string | null;
}): AcceptEvaluation {
  const gates = runPromotionGates(
    input.candidate, input.evidence, input.inProgressSeasons, input.manualAuthority,
  );

  if (gates.verdict.ok) {
    return {
      verdict: 'gates_cleared',
      authority: gates.authority,
      canonicalChange: 'none',
      write: { implemented: false, blockedBy: 'canonical_write_unimplemented' },
      decision: null,
    };
  }

  const { refusal } = gates.verdict;
  const requeue = requeueActionFor(refusal);
  const decision = input.candidate.id !== null
    && input.candidate.status === 'pending'
    && isRecordableRefusal(refusal)
    && requeue !== null
    ? buildRequeueDecision({
      candidate: input.candidate,
      refusal,
      adminUserId: input.adminUserId,
      note: input.note,
    })
    : null;

  return {
    verdict: 'refused',
    refusal,
    ownershipDetail: gates.ownership !== null && gates.ownership.verdict !== 'ok'
      ? gates.ownership.detail
      : null,
    authority: gates.authority,
    requeue,
    canonicalChange: 'none',
    decision,
  };
}

/* ------------------------------------------------------------------ *
 * Building a candidate from an S3 outcome
 * ------------------------------------------------------------------ */

/**
 * The bridge from S3's classification to a reviewable row. Both a proposal
 * and a refusal become candidates — ISSUE-096 §7 requires an authority
 * refusal to be *queued for review* — but only a proposal carries fields,
 * because a refusal has nothing to propose.
 *
 * `unchanged` and `history_only` produce no candidate at all: history moves
 * and the review queue stays quiet, which is what stops every poll from
 * filling the screen with noise.
 */
export function draftCandidate(input: {
  contract: SourceFamilyContract;
  externalRecordId: string;
  outcome: ReconciliationOutcome;
  season: number;
  targetTable: string;
  targetId: number | null;
  /** The target's current values for the proposed fields; null for a new target. */
  currentValues: CanonicalValues | null;
  sourceVersionSeq?: number;
}): PromotionCandidateRecord {
  const { outcome, contract } = input;
  if (outcome.kind === 'unchanged' || outcome.kind === 'history_only') {
    fail(`A '${outcome.kind}' outcome proposes nothing and creates no candidate.`);
  }
  const group = contract.independence?.group;
  if (!group) fail(`${contract.sourceKey}/${contract.family} carries no independence group.`);

  const versionSeq = input.sourceVersionSeq
    ?? (outcome.kind !== 'absent' && outcome.observation !== null
      ? outcome.observation.versionSeq
      : null);
  if (versionSeq === null || versionSeq === undefined) {
    fail('A candidate must name the observation version it was derived from.');
  }

  const proposal = outcome.kind === 'candidate' ? outcome.proposal : null;
  const fields = proposal ? [...proposal.fields].sort() : [];
  const proposedValues: Record<string, JsonValue> = {};
  for (const field of fields) {
    if (proposal === null || !(field in proposal.proposedValues)) {
      fail(`Field '${field}' is named by the proposal but carries no proposed value.`);
    }
    proposedValues[field] = proposal.proposedValues[field];
  }

  // A candidate that proposes nothing carries no target and no baseline —
  // there are no fields to hash, and `promotion_candidates_target_ck`
  // requires the target id and the baseline to be present or absent
  // together. That is the same rule the `absent` verb already states.
  const isNew = outcome.kind === 'candidate' && outcome.verb === 'new';
  const targetId = isNew || proposal === null ? null : input.targetId;
  const candidate: PromotionCandidateRecord = {
    id: null,
    status: 'pending',
    sourceKey: contract.sourceKey,
    family: contract.family,
    independenceGroup: group,
    externalRecordId: input.externalRecordId,
    sourceVersionSeq: versionSeq,
    verb: outcome.verb as CandidateVerb,
    season: input.season,
    entity: proposal ? proposal.entity : input.targetTable,
    targetTable: input.targetTable,
    targetId,
    targetKey: proposal ? proposal.targetKey : {},
    fields,
    proposedValues,
    baselineCanonicalHash: targetId === null || fields.length === 0
      ? null
      : baselineCanonicalHash(fields, input.currentValues),
    agreeingGroups: outcome.kind === 'candidate'
      ? outcome.proposal.corroboration.agreeingGroups
      : (outcome.kind === 'refusal' && outcome.corroboration !== null
        ? outcome.corroboration.agreeingGroups
        : []),
    disagreeingGroups: outcome.kind === 'candidate'
      ? outcome.proposal.corroboration.disagreeingGroups
      : (outcome.kind === 'refusal' && outcome.corroboration !== null
        ? outcome.corroboration.disagreeingGroups
        : []),
  };

  assertCandidateShape(candidate);
  return candidate;
}
