/**
 * AFLDB V2 Stage 3 — the seal on historical seasons, as a pure write decision
 * (V2-GAP-006; docs/v2/historical-baseline.md §1-§2; docs/v2/known-gaps.md).
 *
 * A write that targets a SEALED season (see `sealedSeasonsFrom`/`isSealedSeason` in
 * ./historical-manifest) is refused unless it is carried by an explicit, audited correction.
 * Settle and promotion are NOT corrections: an automatic canonical application is the routine
 * ingestion path (historical-baseline.md §2 table, line 39) and never rewrites sealed history,
 * so the settle CLIs pass `correction: null`.
 *
 * Pure: no I/O, no clock, no database. The caller supplies the sealed range (built from
 * data/reference/seasons.json) and, where one exists, the correction record. Making the audit
 * row durable remains the job of the workflow named in the correction (its own audit table).
 */

import { isSealedSeason, type SealedSeasons } from './historical-manifest';

/**
 * The closed list of human/audited correction workflows that may change a sealed row, one stable
 * id per row of the table in docs/v2/historical-baseline.md §2 — EXCEPT line 39 (automatic canonical application
 * by a settle: routine ingestion, not a correction). Stage 4 added `derived_award_publication` and `curated_award_approval`; Launch F added `brownlow_eligibility_decision` (the last rows of §2).
 */
export const AUDITED_CORRECTION_WORKFLOWS = [
  // line 37: super-admin data editor -> data_edits / data_overrides.
  'data_editor',
  // line 38: reviewed promotion of a source candidate -> promotion_candidates + promotion_decisions.
  'promotion_review',
  // line 40: AFL API player identity adjudication -> afl_api_identity_adjudications.
  'identity_adjudication',
  // line 41: Brownlow authority and vote entry -> brownlow_season_authority / brownlow_vote_entry_state.
  'brownlow_authority',
  // line 42: user-submitted CSV correction, promoted by an admin -> data_submissions(+_rows).
  'csv_submission_promotion', 'derived_award_publication', 'curated_award_approval', // last two: Coleman publisher (112); curated award approval (111).
  // Brownlow eligibility decision (113).
  'brownlow_eligibility_decision',
] as const;

export type AuditedCorrectionWorkflow = (typeof AUDITED_CORRECTION_WORKFLOWS)[number];

/**
 * Mirrors ADJUDICATION_NOTE_MIN_LENGTH / _MAX_LENGTH in src/lib/acquisition/afl-api-adjudication.ts
 * (OD-4: every manual correction needs a non-trivial note). Domain may not import that module
 * (it reaches the database layer), so tests/v2-season-seal.test.ts asserts the values agree.
 */
export const CORRECTION_NOTE_MIN_LENGTH = 20;
export const CORRECTION_NOTE_MAX_LENGTH = 2000;

export interface AuditedCorrection {
  readonly workflow: AuditedCorrectionWorkflow;
  /** The authenticated actor (users.id) who answers for the correction. */
  readonly actorUserId: number;
  /** Why; trimmed length must be CORRECTION_NOTE_MIN_LENGTH..CORRECTION_NOTE_MAX_LENGTH. */
  readonly note: string;
  /** A pointer to the evidence (an issue id, a ledger row, a manifest comparison). Non-empty. */
  readonly evidenceRef: string;
}

export interface SeasonWriteInput {
  /**
   * The season the write targets. `null` (undated), NaN or a non-integer is UNKNOWN: it cannot be
   * proved open, so it is treated as sealed — the same fail-closed rule as `isSealedBucket` for an
   * undated fact row (historical-manifest.ts).
   */
  readonly season: number | null;
  readonly sealed: SealedSeasons;
  /** `null` for any caller that is not an audited correction workflow (every settle CLI). */
  readonly correction: AuditedCorrection | null;
}

export type SeasonWriteDecision =
  | { readonly allowed: true; readonly basis: 'open_season' }
  | {
    readonly allowed: true;
    readonly basis: 'audited_correction';
    readonly audit: Readonly<{
      season: number | null;
      workflow: AuditedCorrectionWorkflow;
      actorUserId: number;
      note: string;
      evidenceRef: string;
    }>;
  }
  | {
    readonly allowed: false;
    readonly code: 'season_sealed' | 'correction_invalid';
    readonly message: string;
  };

function describeSeason(season: number | null): string {
  return typeof season === 'number' && Number.isInteger(season)
    ? `season ${season}`
    : `an unknown or undated season (${String(season)})`;
}

function sealedMessage(season: number | null, sealed: SealedSeasons): string {
  return `Refused: ${describeSeason(season)} is sealed historical data (sealed seasons ${sealed.from}-${sealed.through} `
    + 'per data/reference/seasons.json). Settle and promotion never rewrite sealed history. A change to a sealed '
    + `season must go through an audited correction workflow (${AUDITED_CORRECTION_WORKFLOWS.join(', ')}), `
    + 'see docs/v2/historical-baseline.md §2.';
}

/** The reasons a correction record is not acceptable; empty when it is valid. */
function correctionProblems(correction: AuditedCorrection): string[] {
  const problems: string[] = [];
  if (!(AUDITED_CORRECTION_WORKFLOWS as readonly string[]).includes(correction.workflow)) {
    problems.push(`workflow '${String(correction.workflow)}' is not an audited correction workflow`);
  }
  if (!Number.isSafeInteger(correction.actorUserId) || correction.actorUserId <= 0) {
    problems.push('actorUserId must be a positive integer');
  }
  const noteLength = typeof correction.note === 'string' ? correction.note.trim().length : -1;
  if (noteLength < CORRECTION_NOTE_MIN_LENGTH || noteLength > CORRECTION_NOTE_MAX_LENGTH) {
    problems.push(
      `note must be ${CORRECTION_NOTE_MIN_LENGTH}-${CORRECTION_NOTE_MAX_LENGTH} characters after trimming`,
    );
  }
  if (typeof correction.evidenceRef !== 'string' || correction.evidenceRef.trim().length === 0) {
    problems.push('evidenceRef must be non-empty');
  }
  return problems;
}

/** Decides whether a write to `season` may proceed. Pure and total. */
export function evaluateSeasonWrite(input: SeasonWriteInput): SeasonWriteDecision {
  const { season, sealed, correction } = input;
  const known = typeof season === 'number' && Number.isInteger(season);
  const isSealed = !known || isSealedSeason(sealed, season);
  if (!isSealed) return { allowed: true, basis: 'open_season' };

  if (correction === null) {
    return { allowed: false, code: 'season_sealed', message: sealedMessage(season, sealed) };
  }
  const problems = correctionProblems(correction);
  if (problems.length > 0) {
    return {
      allowed: false,
      code: 'correction_invalid',
      message: `Refused: ${describeSeason(season)} is sealed and the supplied correction is invalid: `
        + `${problems.join('; ')}. See docs/v2/historical-baseline.md §2.`,
    };
  }
  return {
    allowed: true,
    basis: 'audited_correction',
    audit: {
      season: known ? season : null,
      workflow: correction.workflow,
      actorUserId: correction.actorUserId,
      note: correction.note.trim(),
      evidenceRef: correction.evidenceRef.trim(),
    },
  };
}

/** Thrown by `assertSeasonWritable`; `code` is the refusal code, `season` the targeted season. */
export class SealedSeasonRefusal extends Error {
  readonly code: 'season_sealed' | 'correction_invalid';

  readonly season: number | null;

  constructor(code: 'season_sealed' | 'correction_invalid', season: number | null, message: string) {
    super(message);
    this.name = 'SealedSeasonRefusal';
    this.code = code;
    this.season = season;
  }
}

/** Throws `SealedSeasonRefusal` when the write is refused; otherwise returns the allowing decision. */
export function assertSeasonWritable(
  input: SeasonWriteInput,
): Extract<SeasonWriteDecision, { allowed: true }> {
  const decision = evaluateSeasonWrite(input);
  if (!decision.allowed) throw new SealedSeasonRefusal(decision.code, input.season, decision.message);
  return decision;
}
