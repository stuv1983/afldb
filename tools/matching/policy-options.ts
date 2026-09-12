/**
 * Calibration-only command-line policy options (AFLDB-ISSUE-164 P3B).
 *
 * The S3/S4 weight grid measures four candidate pairs against the same
 * database. Editing confidence.ts between rows would make the grid
 * depend on the state of the working tree rather than on the numbers,
 * so the measurement entry points take the pair as an explicit option
 * and record what they used:
 *
 *   npm run match:backtest -- --club-text-in-span 15 --club-text-anywhere 15
 *
 * Both weights move together. Half a declared grid row is not a grid
 * row: it would silently mix a candidate S3 with the shipped S4 and
 * file the result under the wrong policy. Anything that is not a whole
 * number of points is refused outright rather than coerced.
 *
 * Omitting both options is the normal case and leaves the shipped
 * policy exactly as it is: 15/15 since P3B selected it.
 */
import {
  clubTextCalibration,
  parseClubTextWeight,
  setClubTextCalibration,
  type ClubTextCalibration,
  type ClubTextWeights,
} from '@/lib/player-matching/calibration';

export const CLUB_TEXT_IN_SPAN_OPTION = '--club-text-in-span';
export const CLUB_TEXT_ANYWHERE_OPTION = '--club-text-anywhere';

/** The value after a flag, or null when the flag is absent. */
function valueFor(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  if (index < 0) return null;
  return argv[index + 1] ?? null;
}

/**
 * The declared candidate weights, or null when the run uses the shipped
 * 15/15 policy. Throws on a half-declared or malformed pair.
 */
export function parseClubTextCalibration(argv: readonly string[]): ClubTextWeights | null {
  const hasInSpan = argv.includes(CLUB_TEXT_IN_SPAN_OPTION);
  const hasAnywhere = argv.includes(CLUB_TEXT_ANYWHERE_OPTION);
  if (!hasInSpan && !hasAnywhere) return null;
  if (!hasInSpan || !hasAnywhere) {
    throw new Error(
      `${CLUB_TEXT_IN_SPAN_OPTION} and ${CLUB_TEXT_ANYWHERE_OPTION} must be given together: `
      + 'a grid row declares both S3 and S4.',
    );
  }
  return {
    clubTextInSpan: parseClubTextWeight(
      CLUB_TEXT_IN_SPAN_OPTION, valueFor(argv, CLUB_TEXT_IN_SPAN_OPTION)),
    clubTextAnywhere: parseClubTextWeight(
      CLUB_TEXT_ANYWHERE_OPTION, valueFor(argv, CLUB_TEXT_ANYWHERE_OPTION)),
  };
}

/**
 * Parse, apply and return what this run will actually score with. Called
 * once, before any scoring, by the measurement entry points only.
 */
export function applyClubTextCalibration(argv: readonly string[]): ClubTextCalibration {
  setClubTextCalibration(parseClubTextCalibration(argv));
  return clubTextCalibration();
}

/** One line for the policy header, so a transcript identifies its grid row. */
export function describeClubTextCalibration(calibration: ClubTextCalibration): string {
  return (
    `S3 clubTextInSpan=${calibration.clubTextInSpan} `
    + `S4 clubTextAnywhere=${calibration.clubTextAnywhere} `
    + `[${calibration.source}]`
  );
}
