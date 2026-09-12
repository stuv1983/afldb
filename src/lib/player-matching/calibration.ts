import { MATCH_POLICY } from '@/lib/player-matching/confidence';

/**
 * Calibration-only override for the S3/S4 club-text weights
 * (AFLDB-ISSUE-164 P3B).
 *
 * The P3B grid had to measure four candidate weight pairs against the
 * same database, and the one thing that must not decide the answer is
 * which edit of confidence.ts happened to be in the tree when a row ran.
 * So the weights are resolved through this module instead of read
 * straight off MATCH_POLICY, and a measurement run declares the pair it
 * is measuring. The grid has since selected 15/15, which is now the
 * shipped policy; the mechanism stays because the next question about
 * these weights deserves the same reproducibility this one got.
 *
 * Three properties are deliberate:
 *
 *  - The SHIPPED values are the ones in MATCH_POLICY: 15/15 since P3B.
 *    Nothing here changes what the application, the admin page or the
 *    approval path score; an override exists only once a caller sets
 *    one, and nothing in src/app does. Clearing the override returns to
 *    the shipped 15/15, never to "not scored".
 *  - No environment variable. Production behaviour that can be moved by
 *    an exported shell variable is production behaviour nobody can
 *    reproduce, and this whole exercise exists to produce reproducible
 *    numbers. The override is set by an explicit call, from an explicit
 *    command-line option, in the measurement entry point only.
 *  - Every run records what it actually used (`clubTextCalibration()`),
 *    so a report is self-describing and a grid row can never be filed
 *    under the wrong weights.
 *
 * Only S3/S4 are overridable. Nothing else in the policy is, because
 * nothing else is being calibrated.
 */

export type ClubTextWeights = {
  clubTextInSpan: number;
  clubTextAnywhere: number;
};

export type ClubTextCalibration = ClubTextWeights & {
  /** Where the effective values came from, recorded in every report. */
  source: 'shipped' | 'calibration-override';
};

/** The shipped policy: what the application and the approval path use. */
const SHIPPED: ClubTextWeights = {
  clubTextInSpan: MATCH_POLICY.scoring.club.clubTextInSpan,
  clubTextAnywhere: MATCH_POLICY.scoring.club.clubTextAnywhere,
};

/**
 * Weights are points on the same 0-100 scale as every other signal, so
 * a value outside it is a mistyped option rather than an intention.
 */
export const MAX_CLUB_TEXT_WEIGHT = 100;

let override: ClubTextWeights | null = null;

/** Fail closed: a weight is a whole number of points in [0, 100]. */
export function validateClubTextWeight(option: string, value: unknown): number {
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < 0
    || value > MAX_CLUB_TEXT_WEIGHT
  ) {
    throw new Error(
      `${option} must be a whole number of points between 0 and ${MAX_CLUB_TEXT_WEIGHT}; got ${String(value)}`,
    );
  }
  return value;
}

/**
 * Parse one command-line value. Strict by construction: anything that is
 * not a run of digits is refused rather than coerced, so `--club-text-in-span -5`,
 * `15.5`, `1e1`, `fifteen` and a missing value all fail the run instead of
 * silently scoring something nobody chose.
 */
export function parseClubTextWeight(option: string, raw: string | null | undefined): number {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw.trim())) {
    throw new Error(
      `${option} must be a whole number of points between 0 and ${MAX_CLUB_TEXT_WEIGHT}; got ${
        raw === null || raw === undefined ? '(no value)' : `"${raw}"`
      }`,
    );
  }
  return validateClubTextWeight(option, Number(raw.trim()));
}

/**
 * Declare the candidate weights for a calibration run, or pass null to
 * return to the shipped 15/15 policy. Both weights move together: half
 * a grid row is not a grid row.
 */
export function setClubTextCalibration(weights: ClubTextWeights | null): void {
  if (weights === null) {
    override = null;
    return;
  }
  override = {
    clubTextInSpan: validateClubTextWeight('clubTextInSpan', weights.clubTextInSpan),
    clubTextAnywhere: validateClubTextWeight('clubTextAnywhere', weights.clubTextAnywhere),
  };
}

/** The weights scoring must use right now. */
export function clubTextWeights(): ClubTextWeights {
  return override ?? SHIPPED;
}

/** The same values plus their provenance, for reports and console output. */
export function clubTextCalibration(): ClubTextCalibration {
  return {
    ...clubTextWeights(),
    source: override === null ? 'shipped' : 'calibration-override',
  };
}

/**
 * MATCH_POLICY as this run actually behaves.
 *
 * A report that printed the shipped weights beside numbers produced
 * under an override would be a lie of exactly the kind the version
 * string exists to prevent, so the snapshot substitutes the effective
 * weights.
 */
export function policySnapshot(): typeof MATCH_POLICY {
  const weights = clubTextWeights();
  return {
    ...MATCH_POLICY,
    scoring: {
      ...MATCH_POLICY.scoring,
      club: { ...MATCH_POLICY.scoring.club, ...weights },
    },
  } as unknown as typeof MATCH_POLICY;
}
