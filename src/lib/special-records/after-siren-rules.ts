/**
 * AFLDB-ISSUE-167 Stage 6 — the after-the-siren coupled-event rules, in
 * application code, so an administrator reads a sentence about football rather
 * than a raw PostgreSQL constraint name.
 *
 * WHY THIS FILE EXISTS AT ALL. Migration 089 carries four CHECK constraints
 * over `after_siren_kicks`, and three of them couple columns that a generic
 * form would treat as independent fields:
 *
 *   after_siren_kicks_effect_ck      kick_effect x kicker_result x kick_scored
 *                                    x the margin arithmetic over
 *                                    kicker_points / opponent_points
 *   after_siren_kicks_regulation_ck  siren x kick_effect
 *   after_siren_kicks_match_ck       premiership_season x match_id
 *   after_siren_kicks_points_ck      both point totals non-negative
 *
 * The database is still the authority: everything here is ALSO enforced by the
 * CHECKs, inside the same transaction, so a payload that slipped past this
 * module is refused by PostgreSQL rather than written. What this module buys is
 * the refusal an operator can act on. AFLDB-ISSUE-167 §10.3 requires exactly
 * that — "validate the relationships IN THE ACTION and return a readable error,
 * rather than surfacing a raw PostgreSQL constraint violation".
 *
 * DELIBERATELY PURE. No `server-only`, no database handle, no import that has
 * either: the Server Action, the mutation transaction and the unit suite all
 * need to reach the same rules, and a rule that exists in two places is a rule
 * that will eventually disagree with itself.
 *
 * THE RULES ARE TRANSCRIBED FROM THE CONSTRAINT, NOT REMEMBERED. Each function
 * below quotes the fragment of migration 089 it mirrors, so a future change to
 * one is visibly a change to the other. `tests/special-records-admin.test.ts`
 * reads migration 089 as source and fails if the constraint text moves.
 */

export const AFTER_SIREN_SCORES = ['goal', 'behind', 'none'] as const;
export const AFTER_SIREN_EFFECTS = ['won', 'drew', 'none'] as const;
export const AFTER_SIREN_RESULTS = ['win', 'loss', 'draw'] as const;
export const AFTER_SIREN_SIRENS = ['final', 'end_of_extra_time', 'end_of_regulation'] as const;

export type AfterSirenScore = (typeof AFTER_SIREN_SCORES)[number];
export type AfterSirenEffect = (typeof AFTER_SIREN_EFFECTS)[number];
export type AfterSirenResult = (typeof AFTER_SIREN_RESULTS)[number];
export type AfterSirenSiren = (typeof AFTER_SIREN_SIRENS)[number];

export function isAfterSirenScore(value: unknown): value is AfterSirenScore {
  return (AFTER_SIREN_SCORES as readonly unknown[]).includes(value);
}
export function isAfterSirenEffect(value: unknown): value is AfterSirenEffect {
  return (AFTER_SIREN_EFFECTS as readonly unknown[]).includes(value);
}
export function isAfterSirenResult(value: unknown): value is AfterSirenResult {
  return (AFTER_SIREN_RESULTS as readonly unknown[]).includes(value);
}
export function isAfterSirenSiren(value: unknown): value is AfterSirenSiren {
  return (AFTER_SIREN_SIRENS as readonly unknown[]).includes(value);
}

/**
 * The whole coupled state of one after-siren row, as the five event fields plus
 * the two figures the margin is computed from and the two facts `_match_ck`
 * needs.
 *
 * A CORRECTION supplies this as "the row as it will stand once the delta is
 * applied", never as "the fields the administrator touched": three of the four
 * constraints are satisfied or broken by a COMBINATION, so validating a partial
 * set would pass a change that breaks the row it lands on.
 */
export type AfterSirenEvent = {
  kickScored: AfterSirenScore;
  kickEffect: AfterSirenEffect;
  kickerResult: AfterSirenResult;
  siren: AfterSirenSiren;
  kickerPoints: number;
  opponentPoints: number;
  premiershipSeason: boolean;
  /** Whether the row is (or would be) linked to a `matches` row. */
  hasMatch: boolean;
};

const EFFECT_WORDS: Record<AfterSirenEffect, string> = {
  won: 'won the match',
  drew: 'drew the match',
  none: 'changed nothing',
};

const RESULT_WORDS: Record<AfterSirenResult, string> = {
  win: 'a win',
  loss: 'a loss',
  draw: 'a draw',
};

/** The largest margin a kick of this kind can have created (`_effect_ck`). */
export function maxWinningMargin(kickScored: AfterSirenScore): number {
  return kickScored === 'goal' ? 6 : 1;
}

/**
 * `after_siren_kicks_points_ck`:
 *   CHECK (kicker_points >= 0 AND opponent_points >= 0)
 */
function checkPoints(event: AfterSirenEvent): string | null {
  if (!Number.isInteger(event.kickerPoints) || !Number.isInteger(event.opponentPoints)) {
    return 'Both final scores must be whole numbers of points.';
  }
  if (event.kickerPoints < 0 || event.opponentPoints < 0) {
    return 'A final score cannot be negative.';
  }
  // smallint, and the largest VFL/AFL score ever recorded is well inside it.
  if (event.kickerPoints > 1000 || event.opponentPoints > 1000) {
    return 'A final score of more than 1000 points is not a score this record can hold.';
  }
  return null;
}

/**
 * `after_siren_kicks_regulation_ck`:
 *   CHECK (siren <> 'end_of_regulation' OR kick_effect = 'none')
 *
 * A kick after the end-of-regulation siren in a match that then went to extra
 * time cannot have settled the result, because the result was not settled yet.
 */
function checkRegulation(event: AfterSirenEvent): string | null {
  if (event.siren === 'end_of_regulation' && event.kickEffect !== 'none') {
    return 'A kick after the end-of-regulation siren cannot have won or drawn the match: '
      + 'the match went on to extra time, so the result was not settled at that siren. '
      + 'Set the effect to "changed nothing", or choose a different siren.';
  }
  return null;
}

/**
 * `after_siren_kicks_match_ck`:
 *   CHECK (premiership_season OR match_id IS NULL)
 *
 * `matches` holds premiership seasons only, so a pre-season or night-series row
 * keeps its competition name and never resolves to a match.
 */
function checkMatchCoupling(event: AfterSirenEvent): string | null {
  if (!event.premiershipSeason && event.hasMatch) {
    return 'Only a premiership-season kick can be linked to a match: AFLDB records matches for '
      + 'the premiership season alone, so a pre-season or night-series record carries its '
      + 'competition name and no match.';
  }
  return null;
}

/**
 * `after_siren_kicks_effect_ck`, the three-branch one:
 *
 *   (kick_effect = 'won'  AND kicker_result = 'win'  AND kick_scored <> 'none'
 *      AND kicker_points - opponent_points BETWEEN 1 AND CASE kick_scored WHEN 'goal' THEN 6 ELSE 1 END)
 *   OR (kick_effect = 'drew' AND kicker_result = 'draw' AND kick_scored <> 'none'
 *      AND kicker_points = opponent_points)
 *   OR (kick_effect = 'none' AND (kicker_result <> 'win' OR siren = 'end_of_regulation'))
 */
function checkEffect(event: AfterSirenEvent): string | null {
  const margin = event.kickerPoints - event.opponentPoints;

  if (event.kickEffect === 'won') {
    if (event.kickerResult !== 'win') {
      return `A kick that won the match cannot be recorded against ${RESULT_WORDS[event.kickerResult]}.`;
    }
    if (event.kickScored === 'none') {
      return 'A kick that won the match must have scored: a kick that registered nothing '
        + 'cannot have changed the result.';
    }
    const max = maxWinningMargin(event.kickScored);
    if (margin < 1 || margin > max) {
      return `A ${event.kickScored} that won the match leaves a final margin of 1 to ${max} `
        + `points; these scores leave ${margin}. Check the two final scores, or the effect.`;
    }
    return null;
  }

  if (event.kickEffect === 'drew') {
    if (event.kickerResult !== 'draw') {
      return `A kick that drew the match cannot be recorded against ${RESULT_WORDS[event.kickerResult]}.`;
    }
    if (event.kickScored === 'none') {
      return 'A kick that drew the match must have scored: a kick that registered nothing '
        + 'cannot have levelled the scores.';
    }
    if (margin !== 0) {
      return 'A kick that drew the match leaves the scores level; these two final scores differ '
        + `by ${Math.abs(margin)} points.`;
    }
    return null;
  }

  // kick_effect = 'none'
  if (event.kickerResult === 'win' && event.siren !== 'end_of_regulation') {
    return 'A kick that changed nothing cannot be recorded against a win after the final siren: '
      + 'if the kicker\'s side won, the kick either won the match or followed the '
      + 'end-of-regulation siren. Choose the effect that happened, or the siren.';
  }
  return null;
}

/**
 * Every coupled rule, in the order an operator would meet them: the figures
 * first, then the two single couplings, then the three-branch one whose message
 * depends on the figures already being sane.
 *
 * Returns `null` when the row is admissible, or ONE readable sentence. One,
 * deliberately: a form that reports four objections to a single wrong choice
 * reads as four problems.
 */
export function validateAfterSirenEvent(event: AfterSirenEvent): string | null {
  return checkPoints(event)
    ?? checkRegulation(event)
    ?? checkMatchCoupling(event)
    ?? checkEffect(event);
}

/** The same rules, phrased for a caller that wants the offending relationship named. */
export function describeAfterSirenEvent(event: AfterSirenEvent): string {
  return `a ${event.kickScored} after the ${event.siren.replace(/_/g, ' ')} siren that `
    + `${EFFECT_WORDS[event.kickEffect]}, in ${RESULT_WORDS[event.kickerResult]} `
    + `(${event.kickerPoints}-${event.opponentPoints})`;
}
