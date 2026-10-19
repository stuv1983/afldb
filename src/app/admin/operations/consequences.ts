/**
 * What each operations-centre mutation will do, in the six terms the D9 action card shows BEFORE a
 * form is submitted (AFLDB V2 Stage 5, plan D9, ADR 0009; owner instruction "Each action must show"):
 *
 *   1. what it will change,
 *   2. the affected season or records,
 *   3. the validation state,
 *   4. whether it is reversible,
 *   5. the acting user,
 *   6. the resulting audit entries.
 *
 * PURE: no hooks, no data access, no `server-only`, so a Client Component form may import it and a
 * test can assert every field for every mutation. The wording is the source of truth in
 * `.phaneslight/returns/launchD-20261019/02-worker-WB1-server-wiring.md` ("What each mutation
 * changes, reversibility, audit rows"), which describes `src/lib/admin/operations-centre.ts`.
 *
 * The activity-trail action names are MIRRORED from `OPERATIONS_AUDIT_ACTIONS` in that server-only
 * module (a Client Component cannot import it). `tests/v2-admin-operations-ui.test.ts` fails when the
 * two drift apart, and when {@link REJECT_REASON_MIN_LENGTH} drifts from the service's own rule.
 */

export const CONSEQUENCE_KINDS = [
  'create_proposals',
  'validate_proposal',
  'approve_proposal',
  'reject_proposal',
  'revise_approved_winner',
  'publish_coleman',
] as const;
export type ConsequenceKind = (typeof CONSEQUENCE_KINDS)[number];

/** Mirror of `OPERATIONS_AUDIT_ACTIONS` (src/lib/admin/operations-centre.ts); drift-tested. */
export const CONSEQUENCE_AUDIT_ACTIONS = {
  curatedCreated: 'admin.curated_award_created',
  curatedValidated: 'admin.curated_award_validated',
  curatedApproved: 'admin.curated_award_approved',
  curatedRejected: 'admin.curated_award_rejected',
  curatedRevised: 'admin.curated_award_revised',
  curatedRefused: 'admin.curated_award_refused',
  colemanPublished: 'admin.coleman_published',
  colemanRefused: 'admin.coleman_publication_refused',
  brownlowEligibilityDecided: 'admin.brownlow_eligibility_decided',
  brownlowEligibilityRefused: 'admin.brownlow_eligibility_refused',
} as const;

/**
 * The sealed-season correction note bounds (`CORRECTION_NOTE_MIN_LENGTH` / `CORRECTION_NOTE_MAX_LENGTH`
 * in `@afldb/domain`). Mirrored, not imported, so a Client Component form does not pull the whole
 * domain barrel into the browser bundle; drift-tested.
 */
export const SEAL_NOTE_MIN_LENGTH = 20;
export const SEAL_NOTE_MAX_LENGTH = 2000;

/** The shortest rejection reason the service accepts (`REJECT_NOTE_MIN_LENGTH`); drift-tested. */
export const REJECT_REASON_MIN_LENGTH = 10;

export type ConsequenceProposalStatus =
  | 'proposed' | 'validated' | 'validation_failed' | 'approved' | 'rejected' | 'superseded';

/** What the page already knows when it renders the card. Every field is optional. */
export type ConsequenceContext = {
  /** The signed-in user's email: the actor the ledger and the activity trail will name. */
  actingEmail?: string | null;
  proposalId?: number | null;
  season?: number | null;
  proposalStatus?: ConsequenceProposalStatus | null;
  /** True/false when the season registry could be read; null/undefined when it could not. */
  sealedSeason?: boolean | null;
  /** The last read-only Coleman comparison this session ran, if any. */
  comparison?: {
    season: number;
    category: 'agree' | 'disagree' | 'not_derivable';
    plan: 'published' | 'unchanged' | 'superseded' | null;
    sealed: boolean;
    /**
     * What publishing would do to the canonical `award_winners` rows (ADR 0015), as counts, or the
     * refusal code it would hit. Absent/null when the comparison did not preview it.
     */
    projection?: {
      ok: true;
      inserted: number;
      updated: number;
      voided: number;
      retained: number;
    } | { ok: false; code: string } | null;
  } | null;
};

export type Consequences = {
  kind: ConsequenceKind;
  title: string;
  /** 1. What it will change. */
  changes: readonly string[];
  /** 2. The affected season or records. */
  affected: string;
  /** 3. The validation state. */
  validationState: string;
  /** 4. Whether it is reversible (the flag drives the badge; `reversibility` explains). */
  reversible: boolean;
  reversibility: string;
  /** 5. The acting user. */
  actingUser: string;
  /** 6. The resulting audit entries. */
  audit: {
    /** The durable, in-transaction record. */
    durable: string;
    /** The activity-trail (auth_audit_log) row, in words. */
    activity: string;
    /** The exact `auth_audit_log.action` values it can write. */
    activityActions: readonly string[];
  };
};

const STATUS_WORDS: Record<ConsequenceProposalStatus, string> = {
  proposed: 'proposed (not yet validated)',
  validated: 'validated',
  validation_failed: 'validation failed',
  approved: 'approved (terminal)',
  rejected: 'rejected (terminal)',
  superseded: 'superseded by a newer revision (terminal)',
};

function proposalLabel(context: ConsequenceContext): string {
  const id = context.proposalId === null || context.proposalId === undefined ? 'this proposal' : `proposal #${context.proposalId}`;
  const season = context.season === null || context.season === undefined ? '' : `, season ${context.season}`;
  return `${id}${season}`;
}

function statusWords(context: ConsequenceContext): string {
  return context.proposalStatus === null || context.proposalStatus === undefined
    ? 'not shown here'
    : STATUS_WORDS[context.proposalStatus];
}

function actor(context: ConsequenceContext): string {
  const email = context.actingEmail === null || context.actingEmail === undefined ? '' : context.actingEmail.trim();
  return email === ''
    ? 'The signed-in administrator (their email could not be shown here); the ledger and the activity trail record their user id.'
    : `${email}, the signed-in administrator. The ledger records their user id and the activity trail their email.`;
}

function sealWords(context: ConsequenceContext): string {
  if (context.sealedSeason === true) {
    return `The season is SEALED: the approval is an audited correction and needs a decision note of ${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters.`;
  }
  if (context.sealedSeason === false) return 'The season is open (in progress), so no seal correction note is required.';
  return 'Whether the season is sealed could not be read here; the approval is refused if the season registry cannot be read (it fails closed).';
}

function comparisonWords(context: ConsequenceContext): string {
  const c = context.comparison;
  if (c === null || c === undefined) return 'No comparison has been run in this session; run the read-only comparison first.';
  if (c.category === 'not_derivable') {
    return `Last comparison this session (season ${c.season}): NOT derivable, so publishing would be refused.`;
  }
  const plan = c.plan === null ? 'no publication is planned' : `publishing now would be recorded as "${c.plan}"`;
  return `Last comparison this session (season ${c.season}): the derived winners ${c.category === 'agree' ? 'agree with' : 'differ from'} the stored Coleman rows; ${plan}${c.sealed ? '' : '; the season is not sealed'}.`;
}

/** The comparison's preview of the `award_winners` effect, in words (or the fact that none was run). */
function projectionWords(context: ConsequenceContext): string {
  const p = context.comparison?.projection;
  if (p === null || p === undefined) {
    return 'Run the read-only comparison first to see how many award_winners rows publishing would insert, update, void or leave unchanged.';
  }
  if (!p.ok) {
    return `Preview: publishing would be REFUSED (${p.code}) and nothing would be written; the comparison lists the rows.`;
  }
  return `Preview: ${p.inserted} to insert, ${p.updated} to update, ${p.voided} to void, ${p.retained} unchanged.`;
}

/** The six D9 fields for one mutation. Pure and deterministic. */
export function describeConsequences(kind: ConsequenceKind, context: ConsequenceContext = {}): Consequences {
  const actingUser = actor(context);
  const A = CONSEQUENCE_AUDIT_ACTIONS;

  switch (kind) {
    case 'create_proposals':
      return {
        kind,
        title: 'Create award proposals from a local file',
        changes: [
          'Adds one proposal per row of the file (status "proposed") to award_proposals and one "create" row each to the append-only ledger award_proposal_decisions. All rows or none: one invalid row refuses the whole file.',
          'Validates nothing against the database, approves nothing and writes nothing to award_winners.',
        ],
        affected: 'The awards and seasons named inside the file; the created proposals are listed after submit. No existing proposal or winner is touched.',
        validationState: 'The file is shape-checked on submit and refused whole if any row is invalid. Database validation (player identity, award, season, club, duplicates) happens later, per proposal, when you validate it.',
        reversible: true,
        reversibility: 'Reversible in effect: each created proposal can be rejected (rejection is terminal) or simply left unapproved. Nothing reaches the public record without a separate approval.',
        actingUser,
        audit: {
          durable: 'award_proposal_decisions: one "create" ledger row per proposal.',
          activity: `One auth_audit_log row: ${A.curatedCreated} on success, ${A.curatedRefused} if the file is refused.`,
          activityActions: [A.curatedCreated, A.curatedRefused],
        },
      };

    case 'validate_proposal':
      return {
        kind,
        title: 'Validate this proposal',
        changes: [
          'Runs the database validation (player identity, award, season, club, duplicates) and moves the proposal to "validated" or "validation_failed".',
          'Writes one "validate" ledger row. Nothing else changes and award_winners is not touched.',
        ],
        affected: `${proposalLabel(context)}.`,
        validationState: `Current status: ${statusWords(context)}. Validation runs now, on submit; only an undecided proposal can be validated.`,
        reversible: true,
        reversibility: 'Reversible: an undecided proposal can be validated again, revised, or rejected.',
        actingUser,
        audit: {
          durable: 'award_proposal_decisions: one "validate" ledger row.',
          activity: `One auth_audit_log row: ${A.curatedValidated} on success, ${A.curatedRefused} if refused.`,
          activityActions: [A.curatedValidated, A.curatedRefused],
        },
      };

    case 'approve_proposal':
      return {
        kind,
        title: 'Approve this proposal into the public record',
        changes: [
          'In ONE transaction: re-validates the proposal, passes the season seal, writes the award_winners row (with its data_overrides and data_edits rows, and recomputes the span) through the production promotion port, sets the proposal to "approved" and writes the ledger row.',
          'Any failure rolls all of it back.',
          'Four eyes: the person who created this revision cannot approve it. A Super Admin may approve their own revision only with a written attestation (at least 20 characters), recorded in the ledger as a self-approval.',
        ],
        affected: `${proposalLabel(context)}. This writes the public award record for that season. ${sealWords(context)}`,
        validationState: `Requires status "validated" (current: ${statusWords(context)}). The approval re-validates inside its transaction, so a stale validation is refused.`,
        reversible: false,
        reversibility: 'Not reversible: "approved" is terminal. The winner can afterwards be changed only by revising the approved winner (a separate, audited action) or through the existing replace or correct flow in /admin/awards.',
        actingUser,
        audit: {
          durable: 'award_proposal_decisions: one "approve" ledger row, plus the data_edits audit row of the award_winners write (same transaction).',
          activity: `One auth_audit_log row: ${A.curatedApproved} on success, ${A.curatedRefused} if refused.`,
          activityActions: [A.curatedApproved, A.curatedRefused],
        },
      };

    case 'reject_proposal':
      return {
        kind,
        title: 'Reject this proposal',
        changes: [
          'Sets the proposal to "rejected" and keeps your reason in the ledger.',
          'Nothing reaches award_winners.',
        ],
        affected: `${proposalLabel(context)}.`,
        validationState: `Allowed for any undecided proposal (proposed, validated or validation failed); current status: ${statusWords(context)}. A reason of at least ${REJECT_REASON_MIN_LENGTH} characters is required.`,
        reversible: false,
        reversibility: 'Not reversible: "rejected" is terminal. A corrected entry is a new proposal.',
        actingUser,
        audit: {
          durable: 'award_proposal_decisions: one "reject" ledger row carrying your reason.',
          activity: `One auth_audit_log row: ${A.curatedRejected} on success, ${A.curatedRefused} if refused.`,
          activityActions: [A.curatedRejected, A.curatedRefused],
        },
      };

    case 'revise_approved_winner':
      return {
        kind,
        title: 'Revise this approved winner',
        changes: [
          'In ONE transaction: validates the new values against the database, passes the season seal for the old and the new season, then changes the award_winners row. Only votes, position, captain flags, note or club changed: the row is corrected in place. The award, season, player or player name changed: the row is voided and a replacement is created.',
          'Supersedes this approved revision and records one new revision, already approved, that names the resulting winner. Writes two ledger rows (supersede_approved, revise_approved) with the data_overrides and data_edits rows of the canonical change.',
          'Any failure rolls all of it back: the proposal stays approved and award_winners is unchanged.',
        ],
        affected: `${proposalLabel(context)}. This changes the public award record. ${context.sealedSeason === true ? `The season is SEALED: the revision is an audited correction under the season seal (decision note of ${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters).` : context.sealedSeason === false ? 'The season is open (in progress). If you move the winner to a sealed season, the seal applies to that season too.' : 'Whether the season is sealed could not be read here; the revision is refused if the season registry cannot be read (it fails closed).'}`,
        validationState: `Requires status "approved" (current: ${context.proposalStatus ?? 'not shown here'}) and an active winner row. A decision note of ${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters is ALWAYS required. A revision that changes nothing in the winner row is refused.`,
        reversible: false,
        reversibility: 'Not reversible except by another revision: the superseded revision and, for a replacement, the voided winner stay on record as history.',
        actingUser,
        audit: {
          durable: 'award_proposal_decisions: one "supersede_approved" and one "revise_approved" ledger row (the latter records selfApproval: true), plus the data_edits and data_overrides rows of the canonical change, all in one transaction.',
          activity: `One auth_audit_log row: ${A.curatedRevised} on success, ${A.curatedRefused} if refused.`,
          activityActions: [A.curatedRevised, A.curatedRefused],
        },
      };

    case 'publish_coleman':
      return {
        kind,
        title: 'Publish the derived Coleman result',
        changes: [
          'Writes the derivation ledger: appends ONE row to derived_award_results for the season, derived from the database at the moment you submit (a first publication, or a superseding one that points at the previous row). If nothing changed since the current ledger row, no ledger row is added.',
          `Then projects the derived winners into the public Coleman rows in award_winners, in the same transaction: inserts new winners, updates a row whose values moved, voids a winner the facts no longer support, and leaves a row that already matches untouched. Joint winners are separate rows. ${projectionWords(context)}`,
          'If the stored winners already match, only a provenance row (derived_award_projections) is recorded and no award_winners row changes. Re-publishing never duplicates a winner.',
          'It is refused whole, and nothing is written, when a manual or legacy Coleman row, a voided derived row or an administrator override stands in the way.',
        ],
        affected: context.season === null || context.season === undefined
          ? 'The season you enter below. It must be a sealed season. Public pages for the Coleman award, that season, and the winners and clubs involved are refreshed after success.'
          : `Season ${context.season}. It must be a sealed season. Public pages for the Coleman award, that season, and the winners and clubs involved are refreshed after success.`,
        validationState: `Derived fresh inside the publisher from home-and-away goals only (finals are excluded) and refused if the season is not sealed, not attested as settled, or not derivable (for example goals not recorded). Publishing is a correction of sealed history: it needs the settled attestation and a note of ${SEAL_NOTE_MIN_LENGTH} to ${SEAL_NOTE_MAX_LENGTH} characters. ${comparisonWords(context)}`,
        reversible: false,
        reversibility: 'Not reversible in place: the derivation ledger is append-only and every award_winners change is audited, so a publication is never rewritten. A correction is a later publish; a void is recorded with its reason and is never a delete.',
        actingUser,
        audit: {
          durable: 'derived_award_results.correction (workflow derived_award_publication, you as the actor, your note, the evidence reference coleman_derivation:<season>:<input checksum>); derived_award_projections (what was inserted, updated, voided or retained); and one data_edits row per award_winners row changed.',
          activity: `One auth_audit_log row: ${A.colemanPublished} on success (including "unchanged"), ${A.colemanRefused} if refused.`,
          activityActions: [A.colemanPublished, A.colemanRefused],
        },
      };
  }
}
