/**
 * The closed vocabularies behind nl_search_review, and the labels the admin
 * UI shows for them.
 *
 * DB-free and free of `server-only`, exactly like plan.ts and
 * grid-solver-spec.ts: the review form is a Client Component and the
 * queries behind it are server-only, so the one place that states what a
 * status or category MAY be has to be importable from both. Every value
 * here mirrors a CHECK constraint in migration 047 -- if they ever
 * disagree, the database wins and the INSERT fails loudly, which is the
 * intended direction for that mistake.
 */

export const NL_REVIEW_STATUSES = [
  'unreviewed', 'reviewing', 'accepted', 'fixed', 'wont_fix', 'duplicate', 'not_a_problem',
] as const;
export type NlReviewStatus = (typeof NL_REVIEW_STATUSES)[number];

export const NL_REVIEW_CATEGORIES = [
  'parser_bug', 'new_alias', 'new_metric', 'new_semantic_rule',
  'ambiguous_language', 'missing_data', 'coverage_limitation',
  'correct_decline', 'performance', 'database_error', 'user_error', 'other',
] as const;
export type NlReviewCategory = (typeof NL_REVIEW_CATEGORIES)[number];

export function isNlReviewStatus(value: string): value is NlReviewStatus {
  return (NL_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isNlReviewCategory(value: string): value is NlReviewCategory {
  return (NL_REVIEW_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Human labels. Deliberately phrased as what an admin decided, not as a
 * database enum -- "Correct decline" reads as a judgement, `correct_decline`
 * reads as a column value.
 */
export const NL_REVIEW_STATUS_LABEL: Record<NlReviewStatus, string> = {
  unreviewed: 'Unreviewed',
  reviewing: 'Reviewing',
  accepted: 'Accepted — a real problem',
  fixed: 'Fixed',
  wont_fix: 'Won’t fix',
  duplicate: 'Duplicate',
  not_a_problem: 'Not a problem',
};

export const NL_REVIEW_CATEGORY_LABEL: Record<NlReviewCategory, string> = {
  parser_bug: 'Parser bug',
  new_alias: 'Needs a new alias or nickname',
  new_metric: 'Needs a new metric',
  new_semantic_rule: 'Needs a new semantic rule',
  ambiguous_language: 'Genuinely ambiguous language',
  missing_data: 'AFLDB does not hold this data',
  coverage_limitation: 'Era-coverage limitation',
  correct_decline: 'Correct decline — no fix wanted',
  performance: 'Performance',
  database_error: 'Database error',
  user_error: 'User error / nonsense input',
  other: 'Other',
};

/**
 * Statuses that mean "somebody has looked at this and it needs nothing
 * further". Drives the "outstanding" count on the overview: an accepted
 * problem is still outstanding (it is real and unfixed), a `fixed` or
 * `wont_fix` or `not_a_problem` one is not.
 */
export const NL_REVIEW_SETTLED_STATUSES: readonly NlReviewStatus[] = [
  'fixed', 'wont_fix', 'duplicate', 'not_a_problem',
];

/** Labels for nl_search_log.failure_reason (log.ts's NlFailureReason), for the problems table. */
export const NL_FAILURE_REASON_LABEL: Record<string, string> = {
  unsupported_topic: 'Unsupported topic',
  unsupported_term: 'Unsupported term',
  ambiguous_player: 'Ambiguous player',
  low_confidence: 'Low confidence',
  unrecognised: 'Unrecognised',
  coverage_unavailable: 'Coverage unavailable',
  empty_result: 'No results',
  query_timeout: 'Query timeout',
  database_error: 'Database error',
  internal_error: 'Internal error',
};

/** Labels for nl_search_log.outcome. */
export const NL_OUTCOME_LABEL: Record<string, string> = {
  answered: 'Answered',
  answered_caveat: 'Answered with caveat',
  no_results: 'No results',
  declined_low_confidence: 'Declined — low confidence',
  declined_ambiguous: 'Declined — ambiguous',
  unrecognised: 'Unrecognised',
  unanswerable: 'Unanswerable',
  error: 'Error',
};
