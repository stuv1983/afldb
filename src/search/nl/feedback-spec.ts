/**
 * The shared vocabulary for reader feedback on an NL answer.
 *
 * DB-free and free of `server-only`, like plan.ts and review-spec.ts, so
 * the client form and the server action can agree on one definition of
 * what a valid submission is. The database repeats the same bounds as a
 * CHECK constraint (migration 049) — three layers that must not drift,
 * which is exactly why the numbers live in one place.
 */

/** The longest reply the form accepts. Mirrors migration 049's CHECK. */
export const NL_FEEDBACK_MAX_LENGTH = 2000;

export const NL_FEEDBACK_VERDICTS = ['correct', 'incorrect'] as const;
export type NlFeedbackVerdict = (typeof NL_FEEDBACK_VERDICTS)[number];

export function isNlFeedbackVerdict(value: string): value is NlFeedbackVerdict {
  return (NL_FEEDBACK_VERDICTS as readonly string[]).includes(value);
}
