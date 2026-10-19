/**
 * What recording a Brownlow eligibility decision does, in the six terms the D9 action card shows
 * BEFORE the form is submitted (AFLDB V2 Stage 5, plan D9; Launch F F-D; ADR 0014):
 * what it changes, the affected season and player, the validation state, whether it is reversible,
 * the acting user, and the resulting audit entries.
 *
 * PURE: no hooks, no data access, no `server-only`, so a Client Component form may import it and a
 * test can assert every sentence. It lives beside the Brownlow page rather than in the shared
 * `consequences.ts` because that file's `ConsequenceKind` set is closed and owned by the Stage 5
 * forms; the card shape is the same.
 *
 * The activity-trail action names are MIRRORED from `OPERATIONS_AUDIT_ACTIONS` in the server-only
 * operations-centre module (a Client Component cannot import it); `tests/v2-admin-operations.test.ts`
 * fails when the two drift apart.
 */

/** Mirror of the Brownlow entries of `OPERATIONS_AUDIT_ACTIONS` (src/lib/admin/operations-centre.ts); drift-tested. */
export const BROWNLOW_ELIGIBILITY_AUDIT_ACTIONS = {
  brownlowEligibilityDecided: 'admin.brownlow_eligibility_decided',
  brownlowEligibilityRefused: 'admin.brownlow_eligibility_refused',
} as const;

/** Mirrors `CORRECTION_NOTE_MIN_LENGTH` / `_MAX_LENGTH` (@afldb/domain), as `consequences.ts` does; drift-tested there. */
const NOTE_MIN = 20;
const NOTE_MAX = 2000;

export type BrownlowEligibilityConsequencesContext = {
  /** The signed-in user's email: the actor the ledger and the activity trail will name. */
  actingEmail?: string | null;
  season: number;
  playerId: number;
  /** The player's durable identity string, when it is known. */
  identity?: string | null;
  /** True/false when the season registry could be read; null/undefined when it could not. */
  sealedSeason?: boolean | null;
  /** The id of the decision this one would supersede, or null for a first decision. */
  supersedesId?: number | null;
};

export type BrownlowEligibilityConsequences = {
  title: string;
  changes: readonly string[];
  affected: string;
  validationState: string;
  reversible: false;
  reversibility: string;
  actingUser: string;
  audit: {
    durable: string;
    activity: string;
    activityActions: readonly string[];
  };
};

function sealWords(sealed: boolean | null | undefined): string {
  if (sealed === true) {
    return `The season is SEALED: this is an audited correction. The note (${NOTE_MIN} to ${NOTE_MAX} characters, required for every decision) is stored as the correction note beside the citation.`;
  }
  if (sealed === false) return 'The season is open (in progress), so no seal correction is recorded; the note is still required.';
  return 'Whether the season is sealed could not be read here; a decision is refused if the season registry cannot be read (it fails closed).';
}

export function describeBrownlowEligibilityConsequences(
  context: BrownlowEligibilityConsequencesContext,
): BrownlowEligibilityConsequences {
  const email = context.actingEmail === null || context.actingEmail === undefined ? '' : context.actingEmail.trim();
  const identity = context.identity === null || context.identity === undefined ? 'not shown here' : context.identity;
  return {
    title: `rule on eligibility for player ${context.playerId}, season ${context.season}`,
    changes: [
      'Adds ONE append-only decision row (verdict, citation, note) to the eligibility ledger.',
      'Recomputes the medal result and publishes its winner flags in the same transaction; joint eligible leaders share the medal.',
      'Preserves every raw vote. Updates eligibility metadata with the medal flags and audits the previous source statement. If relevant eligibility remains unresolved, no medal winner is published.',
    ],
    affected: `Season ${context.season}, player ${context.playerId} (durable identity ${identity}).`,
    validationState: `${sealWords(context.sealedSeason)} A citation (1 to 2000 characters) is required. ${
      context.supersedesId === null || context.supersedesId === undefined
        ? 'No earlier decision exists for this player.'
        : `This will supersede decision #${context.supersedesId}.`
    } If the current decision changes before you submit, the decision is refused and nothing is written.`,
    reversible: false,
    reversibility: 'A decision is never edited or deleted. To change a ruling, record a later decision: it supersedes this one and both stay in the history.',
    actingUser: email === ''
      ? 'The signed-in Super Admin (their email could not be shown here); the ledger records their user id and the activity trail their email.'
      : `${email}, the signed-in Super Admin. The ledger records their user id and the activity trail their email.`,
    audit: {
      durable: 'The decision ledger (actor, timestamp, verdict, citation, note and seal record), plus a required data_edits publication audit when winner flags change.',
      activity: 'One administrative activity row, whatever the outcome (done or refused):',
      activityActions: [
        BROWNLOW_ELIGIBILITY_AUDIT_ACTIONS.brownlowEligibilityDecided,
        BROWNLOW_ELIGIBILITY_AUDIT_ACTIONS.brownlowEligibilityRefused,
      ],
    },
  };
}
