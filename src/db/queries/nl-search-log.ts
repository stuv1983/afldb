import 'server-only';

import { authSql } from '@/db/authClient';
import type { NlReviewCategory, NlReviewStatus } from '@/search/nl/review-spec';

/**
 * Read-only reporting over nl_search_log (migrations 046/047), plus the
 * one write path for nl_search_review.
 *
 * Everything here runs as afldb_auth, which is the only role holding any
 * privilege on these two tables -- afldb_app cannot read them at all (039
 * made app read fail closed and neither table calls grant_app_read). That
 * is deliberate: the log stores raw reader questions, so it stays out of
 * reach of the public site entirely rather than relying on nobody writing
 * a query against it.
 *
 * No user input reaches an identifier in this file. The two things a
 * reader of /admin/nl-search can vary -- the period and the failure-reason
 * filter -- are a bound integer and a bound text value respectively, and
 * the filter is additionally checked against a closed set before it gets
 * here. Same allowlist-then-bind discipline as everywhere else.
 *
 * Bigint discipline: every count(*) comes back from the driver as a
 * string, so each one is cast at the SQL boundary or Number()-ed on the
 * way out. Getting this wrong shows up as "12" + 5 = "125" in a total,
 * which is exactly the class of bug this codebase has hit three times in
 * the NL work already.
 */

// --- Period ---

/** The periods the UI offers. Closed so the value reaching SQL is always one of four integers. */
export const NL_LOG_PERIODS = [7, 30, 90, 365] as const;
export type NlLogPeriod = (typeof NL_LOG_PERIODS)[number];
export const NL_LOG_DEFAULT_PERIOD: NlLogPeriod = 30;

export function parseNlLogPeriod(value: string | undefined): NlLogPeriod {
  const n = Number(value);
  return (NL_LOG_PERIODS as readonly number[]).includes(n) ? (n as NlLogPeriod) : NL_LOG_DEFAULT_PERIOD;
}

// --- Overview ---

export type NlLogOverview = {
  total: number;
  answered: number;
  answeredCaveat: number;
  declined: number;
  unanswerable: number;
  noResults: number;
  errors: number;
  /** Searches that followed another from the same session within 60s. */
  reformulated: number;
  withUnsupportedTerms: number;
  avgConfidence: number | null;
  medianConfidence: number | null;
  medianDurationMs: number | null;
  p95DurationMs: number | null;
  /** Problems (anything with a failure_reason) that no admin has settled yet. */
  outstanding: number;
};

export async function getNlLogOverview(days: number): Promise<NlLogOverview> {
  const [row] = await authSql<{
    total: string; answered: string; answeredCaveat: string; declined: string;
    unanswerable: string; noResults: string; errors: string; reformulated: string;
    withUnsupportedTerms: string; outstanding: string;
    avgConfidence: number | null; medianConfidence: number | null;
    medianDurationMs: number | null; p95DurationMs: number | null;
  }[]>`
    SELECT
      count(*)                                                        AS total,
      count(*) FILTER (WHERE l.outcome = 'answered')                  AS answered,
      count(*) FILTER (WHERE l.outcome = 'answered_caveat')            AS "answeredCaveat",
      count(*) FILTER (WHERE l.outcome IN
        ('declined_low_confidence', 'declined_ambiguous', 'unrecognised')) AS declined,
      count(*) FILTER (WHERE l.outcome = 'unanswerable')               AS unanswerable,
      count(*) FILTER (WHERE l.outcome = 'no_results')                 AS "noResults",
      count(*) FILTER (WHERE l.outcome = 'error')                      AS errors,
      count(*) FILTER (WHERE l.parent_search_id IS NOT NULL)           AS reformulated,
      count(*) FILTER (WHERE l.unsupported_terms IS NOT NULL)          AS "withUnsupportedTerms",
      count(*) FILTER (
        WHERE l.failure_reason IS NOT NULL
          AND COALESCE(r.status, 'unreviewed') <> ALL (ARRAY['fixed', 'wont_fix', 'duplicate', 'not_a_problem'])
      )                                                                AS outstanding,
      avg(l.confidence)::float8                                        AS "avgConfidence",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.confidence)         AS "medianConfidence",
      percentile_cont(0.5) WITHIN GROUP (ORDER BY l.duration_ms)        AS "medianDurationMs",
      percentile_cont(0.95) WITHIN GROUP (ORDER BY l.duration_ms)       AS "p95DurationMs"
      FROM nl_search_log l
      LEFT JOIN nl_search_review r ON r.search_log_id = l.id
     WHERE l.at >= now() - ${days} * interval '1 day'
  `;

  return {
    total: Number(row.total),
    answered: Number(row.answered),
    answeredCaveat: Number(row.answeredCaveat),
    declined: Number(row.declined),
    unanswerable: Number(row.unanswerable),
    noResults: Number(row.noResults),
    errors: Number(row.errors),
    reformulated: Number(row.reformulated),
    withUnsupportedTerms: Number(row.withUnsupportedTerms),
    outstanding: Number(row.outstanding),
    avgConfidence: row.avgConfidence,
    medianConfidence: row.medianConfidence,
    medianDurationMs: row.medianDurationMs,
    p95DurationMs: row.p95DurationMs,
  };
}

// --- Problem breakdown ---

export type NlFailureCount = { failureReason: string; count: number; outstanding: number };

/**
 * The report the whole page exists for: "458 failed searches" tells an
 * engineer nothing, this tells them what to fix first.
 */
export async function getNlFailureBreakdown(days: number): Promise<NlFailureCount[]> {
  const rows = await authSql<{ failureReason: string; count: string; outstanding: string }[]>`
    SELECT l.failure_reason AS "failureReason",
           count(*)         AS count,
           count(*) FILTER (
             WHERE COALESCE(r.status, 'unreviewed') <> ALL (ARRAY['fixed', 'wont_fix', 'duplicate', 'not_a_problem'])
           )              AS outstanding
      FROM nl_search_log l
      LEFT JOIN nl_search_review r ON r.search_log_id = l.id
     WHERE l.at >= now() - ${days} * interval '1 day'
       AND l.failure_reason IS NOT NULL
     GROUP BY l.failure_reason
     ORDER BY count(*) DESC
  `;
  return rows.map((r) => ({
    failureReason: r.failureReason,
    count: Number(r.count),
    outstanding: Number(r.outstanding),
  }));
}

// --- Vocabulary mining ---

export type NlTermCount = { term: string; count: number; example: string; exampleId: number };

/**
 * The single most actionable report here: what AFL words readers use that
 * the parser does not know. `unsupported_terms` is text[], so this is a
 * LATERAL unnest rather than the jsonb_array_elements_text the original
 * proposal assumed.
 *
 * Frequency is evidence, not authority -- "gazza" may be two different
 * players, so nothing here is auto-promoted into the vocabulary. The
 * review workflow is the gate (see docs/search.md).
 */
export async function getTopUnsupportedTerms(days: number, limit = 30): Promise<NlTermCount[]> {
  const rows = await authSql<{ term: string; count: string; example: string; exampleId: string }[]>`
    SELECT t.value                       AS term,
           count(*)                      AS count,
           (array_agg(l.question ORDER BY l.at DESC))[1] AS example,
           (array_agg(l.id ORDER BY l.at DESC))[1]       AS "exampleId"
      FROM nl_search_log l
     CROSS JOIN LATERAL unnest(l.unsupported_terms) AS t(value)
     WHERE l.at >= now() - ${days} * interval '1 day'
     GROUP BY t.value
     ORDER BY count(*) DESC, t.value
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    term: r.term,
    count: Number(r.count),
    example: r.example,
    exampleId: Number(r.exampleId),
  }));
}

export type NlTopicCount = { topic: string; count: number };

/**
 * What readers ask for that AFLDB has decided not to answer yet (streaks,
 * coaching, positions...). This is the data roadmap, not the parser
 * roadmap: every row here parsed fine and was declined on purpose.
 */
export async function getUnsupportedTopics(days: number): Promise<NlTopicCount[]> {
  const rows = await authSql<{ topic: string; count: string }[]>`
    SELECT topic, count(*) AS count
      FROM nl_search_log
     WHERE at >= now() - ${days} * interval '1 day'
       AND topic IS NOT NULL
     GROUP BY topic
     ORDER BY count(*) DESC
  `;
  return rows.map((r) => ({ topic: r.topic, count: Number(r.count) }));
}

// --- Semantic grouping ---

export type NlPlanGroup = {
  planHash: string; searches: number; distinctQuestions: number;
  example: string; exampleId: number; grain: string | null; metric: string | null;
};

/**
 * Distinct phrasings collapse to one plan_hash, so this answers "what are
 * people actually asking for", as opposed to "what did they type".
 */
export async function getTopPlans(days: number, limit = 25): Promise<NlPlanGroup[]> {
  const rows = await authSql<{
    planHash: string; searches: string; distinctQuestions: string;
    example: string; exampleId: string; grain: string | null; metric: string | null;
  }[]>`
    SELECT plan_hash                                   AS "planHash",
           count(*)                                    AS searches,
           count(DISTINCT question)                    AS "distinctQuestions",
           (array_agg(question ORDER BY at DESC))[1]   AS example,
           (array_agg(id ORDER BY at DESC))[1]         AS "exampleId",
           min(grain)                                  AS grain,
           min(metric)                                 AS metric
      FROM nl_search_log
     WHERE at >= now() - ${days} * interval '1 day'
       AND plan_hash IS NOT NULL
     GROUP BY plan_hash
     ORDER BY count(*) DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    planHash: r.planHash,
    searches: Number(r.searches),
    distinctQuestions: Number(r.distinctQuestions),
    example: r.example,
    exampleId: Number(r.exampleId),
    grain: r.grain,
    metric: r.metric,
  }));
}

// --- Reformulations ---

export type NlReformulation = {
  id: number; question: string; outcome: string;
  parentId: number; parentQuestion: string; parentOutcome: string;
  secondsApart: number;
};

/**
 * Pairs where a reader immediately rephrased. The high-value case is the
 * pair where the FIRST search was answered -- nothing failed, so no error
 * log would ever show it, yet the reader plainly did not get what they
 * meant.
 */
export async function getReformulations(days: number, limit = 40): Promise<NlReformulation[]> {
  const rows = await authSql<{
    id: string; question: string; outcome: string;
    parentId: string; parentQuestion: string; parentOutcome: string; secondsApart: number;
  }[]>`
    SELECT l.id                                              AS id,
           l.question,
           l.outcome,
           p.id                                              AS "parentId",
           p.question                                        AS "parentQuestion",
           p.outcome                                         AS "parentOutcome",
           extract(epoch FROM (l.at - p.at))::float8         AS "secondsApart"
      FROM nl_search_log l
      JOIN nl_search_log p ON p.id = l.parent_search_id
     WHERE l.at >= now() - ${days} * interval '1 day'
     ORDER BY l.at DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    id: Number(r.id),
    question: r.question,
    outcome: r.outcome,
    parentId: Number(r.parentId),
    parentQuestion: r.parentQuestion,
    parentOutcome: r.parentOutcome,
    secondsApart: r.secondsApart,
  }));
}

// --- The problem list ---

export type NlProblemRow = {
  id: number; at: Date; question: string;
  outcome: string; failureReason: string | null; topic: string | null;
  confidence: number | null; grain: string | null; metric: string | null;
  unsupportedTerms: string[] | null; resultCount: number | null; durationMs: number | null;
  reviewStatus: NlReviewStatus | null; reviewCategory: NlReviewCategory | null;
};

export async function listNlProblems(
  days: number,
  options: { failureReason?: string; limit?: number } = {},
): Promise<NlProblemRow[]> {
  const limit = options.limit ?? 100;
  // A NULL filter means "every problem"; the closed-set check happens in
  // the page before this is called, and the value is bound either way.
  const filter = options.failureReason ?? null;

  const rows = await authSql<{
    id: string; at: Date; question: string;
    outcome: string; failureReason: string | null; topic: string | null;
    confidence: number | null; grain: string | null; metric: string | null;
    unsupportedTerms: string[] | null; resultCount: number | null; durationMs: number | null;
    reviewStatus: NlReviewStatus | null; reviewCategory: NlReviewCategory | null;
  }[]>`
    SELECT l.id, l.at, l.question, l.outcome,
           l.failure_reason      AS "failureReason",
           l.topic,
           l.confidence,
           l.grain, l.metric,
           l.unsupported_terms   AS "unsupportedTerms",
           l.result_count        AS "resultCount",
           l.duration_ms         AS "durationMs",
           r.status              AS "reviewStatus",
           r.category            AS "reviewCategory"
      FROM nl_search_log l
      LEFT JOIN nl_search_review r ON r.search_log_id = l.id
     WHERE l.at >= now() - ${days} * interval '1 day'
       AND l.failure_reason IS NOT NULL
       AND (${filter}::text IS NULL OR l.failure_reason = ${filter})
     ORDER BY l.at DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

// --- One search, in full ---

export type NlSearchDetail = {
  id: number; at: Date; question: string;
  outcome: string; failureReason: string | null; topic: string | null;
  grain: string | null; metric: string | null;
  plan: unknown; planHash: string | null;
  confidence: number | null;
  confidenceComponents: Record<string, number> | null;
  entityResolution: { mention: string; resolvedTo: string; certainty: number }[] | null;
  unsupportedTerms: string[] | null;
  resultCount: number | null; durationMs: number | null;
  parserVersion: number | null;
  sessionId: string | null; parentSearchId: number | null;
  reviewStatus: NlReviewStatus | null;
  reviewCategory: NlReviewCategory | null;
  reviewNotes: string | null;
  reviewFixedInVersion: string | null;
  reviewedAt: Date | null;
  reviewedByEmail: string | null;
};

export async function getNlSearchDetail(id: number): Promise<NlSearchDetail | null> {
  const [row] = await authSql<{
    id: string; at: Date; question: string;
    outcome: string; failureReason: string | null; topic: string | null;
    grain: string | null; metric: string | null;
    plan: unknown; planHash: string | null;
    confidence: number | null;
    confidenceComponents: Record<string, number> | null;
    entityResolution: { mention: string; resolvedTo: string; certainty: number }[] | null;
    unsupportedTerms: string[] | null;
    resultCount: number | null; durationMs: number | null;
    parserVersion: number | null;
    sessionId: string | null; parentSearchId: string | null;
    reviewStatus: NlReviewStatus | null; reviewCategory: NlReviewCategory | null;
    reviewNotes: string | null; reviewFixedInVersion: string | null;
    reviewedAt: Date | null; reviewedByEmail: string | null;
  }[]>`
    SELECT l.id, l.at, l.question, l.outcome,
           l.failure_reason         AS "failureReason",
           l.topic, l.grain, l.metric,
           l.plan, l.plan_hash      AS "planHash",
           l.confidence,
           l.confidence_components  AS "confidenceComponents",
           l.entity_resolution      AS "entityResolution",
           l.unsupported_terms      AS "unsupportedTerms",
           l.result_count           AS "resultCount",
           l.duration_ms            AS "durationMs",
           l.parser_version         AS "parserVersion",
           l.session_id             AS "sessionId",
           l.parent_search_id       AS "parentSearchId",
           r.status                 AS "reviewStatus",
           r.category               AS "reviewCategory",
           r.notes                  AS "reviewNotes",
           r.fixed_in_version       AS "reviewFixedInVersion",
           r.reviewed_at            AS "reviewedAt",
           u.email                  AS "reviewedByEmail"
      FROM nl_search_log l
      LEFT JOIN nl_search_review r ON r.search_log_id = l.id
      LEFT JOIN auth_users u       ON u.id = r.reviewed_by
     WHERE l.id = ${id}
  `;
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    parentSearchId: row.parentSearchId === null ? null : Number(row.parentSearchId),
  };
}

export type NlSessionSearch = {
  id: number; at: Date; question: string; outcome: string; confidence: number | null;
};

/**
 * The rest of the session this search belonged to, oldest first -- the
 * reformulation chain in context. Capped, and only ever reachable from a
 * search the admin is already looking at.
 */
export async function getNlSessionSearches(sessionId: string, limit = 20): Promise<NlSessionSearch[]> {
  const rows = await authSql<{
    id: string; at: Date; question: string; outcome: string; confidence: number | null;
  }[]>`
    SELECT id, at, question, outcome, confidence
      FROM nl_search_log
     WHERE session_id = ${sessionId}::uuid
     ORDER BY at
     LIMIT ${limit}
  `;
  return rows.map((r) => ({ ...r, id: Number(r.id) }));
}

// --- Export ---

export type NlExportRow = {
  id: number; at: Date; question: string;
  outcome: string; failureReason: string | null; topic: string | null;
  grain: string | null; metric: string | null;
  confidence: number | null;
  tokenRatio: number | null; playerCertainty: number | null;
  structuralPenalty: number | null; unresolvedPenalty: number | null;
  unsupportedTerms: string | null;
  entityResolution: unknown; plan: unknown; planHash: string | null;
  resultCount: number | null; durationMs: number | null;
  parserVersion: number | null;
  sessionId: string | null; parentSearchId: number | null;
  reviewStatus: string | null; reviewCategory: string | null; reviewNotes: string | null;
};

/**
 * Every logged search in the period, flattened for CSV.
 *
 * The confidence components are lifted out of their jsonb object into
 * four real columns, because the point of an export is that a
 * spreadsheet (or a reviewer reading it) can sort and filter on them --
 * a JSON blob in one cell is not analysable. Those `->>` extractions are
 * exactly what migration 048 restored the ability to do.
 *
 * `unsupported_terms` is collapsed to a semicolon-joined string for the
 * same reason: one cell per field, no nested structure. `plan` and
 * `entity_resolution` stay as JSON, since flattening a plan would mean a
 * column per possible scope key.
 */
export async function listNlSearchesForExport(days: number, limit = 20000): Promise<NlExportRow[]> {
  const rows = await authSql<{
    id: string; at: Date; question: string;
    outcome: string; failureReason: string | null; topic: string | null;
    grain: string | null; metric: string | null;
    confidence: number | null;
    tokenRatio: number | null; playerCertainty: number | null;
    structuralPenalty: number | null; unresolvedPenalty: number | null;
    unsupportedTerms: string | null;
    entityResolution: unknown; plan: unknown; planHash: string | null;
    resultCount: number | null; durationMs: number | null;
    parserVersion: number | null;
    sessionId: string | null; parentSearchId: string | null;
    reviewStatus: string | null; reviewCategory: string | null; reviewNotes: string | null;
  }[]>`
    SELECT l.id, l.at, l.question, l.outcome,
           l.failure_reason  AS "failureReason",
           l.topic, l.grain, l.metric, l.confidence,
           (l.confidence_components->>'tokenRatio')::float8        AS "tokenRatio",
           (l.confidence_components->>'playerCertainty')::float8   AS "playerCertainty",
           (l.confidence_components->>'structuralPenalty')::float8 AS "structuralPenalty",
           (l.confidence_components->>'unresolvedPenalty')::float8 AS "unresolvedPenalty",
           array_to_string(l.unsupported_terms, '; ')              AS "unsupportedTerms",
           l.entity_resolution AS "entityResolution",
           l.plan, l.plan_hash AS "planHash",
           l.result_count     AS "resultCount",
           l.duration_ms      AS "durationMs",
           l.parser_version   AS "parserVersion",
           l.session_id       AS "sessionId",
           l.parent_search_id AS "parentSearchId",
           r.status           AS "reviewStatus",
           r.category         AS "reviewCategory",
           r.notes            AS "reviewNotes"
      FROM nl_search_log l
      LEFT JOIN nl_search_review r ON r.search_log_id = l.id
     WHERE l.at >= now() - ${days} * interval '1 day'
     ORDER BY l.at DESC
     LIMIT ${limit}
  `;
  return rows.map((r) => ({
    ...r,
    id: Number(r.id),
    parentSearchId: r.parentSearchId === null ? null : Number(r.parentSearchId),
  }));
}

// --- The one write ---

/**
 * Upsert a human's judgement about one logged search. The telemetry row
 * itself is never touched: nl_search_log is append-only by grant
 * (afldb_auth holds SELECT, INSERT and nothing else on it), so a review
 * genuinely cannot corrupt the evidence it is about, whatever this
 * function does.
 */
export async function saveNlSearchReview(input: {
  searchLogId: number;
  status: NlReviewStatus;
  category: NlReviewCategory | null;
  notes: string | null;
  fixedInVersion: string | null;
  reviewedBy: number;
}): Promise<void> {
  await authSql`
    INSERT INTO nl_search_review
      (search_log_id, status, category, notes, fixed_in_version, reviewed_by, reviewed_at)
    VALUES (${input.searchLogId}, ${input.status}, ${input.category},
            ${input.notes}, ${input.fixedInVersion}, ${input.reviewedBy}, now())
    ON CONFLICT (search_log_id) DO UPDATE
       SET status           = EXCLUDED.status,
           category         = EXCLUDED.category,
           notes            = EXCLUDED.notes,
           fixed_in_version = EXCLUDED.fixed_in_version,
           reviewed_by      = EXCLUDED.reviewed_by,
           reviewed_at      = now()
  `;
}

// --------------------------------------------------------------- feedback

export type NlFeedbackRow = {
  id: number;
  verdict: 'correct' | 'incorrect';
  expectedAnswer: string | null;
  createdAt: Date;
  /** Null when the log row has not landed yet, or has since been pruned. */
  searchId: number | null;
  question: string | null;
  outcome: string | null;
  failureReason: string | null;
  grain: string | null;
  metric: string | null;
  parserVersion: number | null;
};

/**
 * What readers said, newest first.
 *
 * A LEFT JOIN rather than an inner one, and on client_ref rather than a
 * foreign key: the log row is written from `after()`, so a reader who
 * answers the prompt quickly can genuinely arrive first. Their report is
 * still worth reading with the question attached a moment later, and is
 * still worth reading even if it never is.
 */
export async function listNlFeedback(
  options: { verdict?: 'correct' | 'incorrect'; limit?: number } = {},
): Promise<NlFeedbackRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  const rows = await authSql<{
    id: string; verdict: 'correct' | 'incorrect'; expectedAnswer: string | null; createdAt: Date;
    searchId: string | null; question: string | null; outcome: string | null;
    failureReason: string | null; grain: string | null; metric: string | null;
    parserVersion: number | null;
  }[]>`
    SELECT f.id,
           f.verdict,
           f.expected_answer AS "expectedAnswer",
           f.created_at      AS "createdAt",
           l.id              AS "searchId",
           l.question,
           l.outcome,
           l.failure_reason  AS "failureReason",
           l.grain,
           l.metric,
           l.parser_version  AS "parserVersion"
      FROM nl_search_feedback f
      LEFT JOIN nl_search_log l ON l.client_ref = f.client_ref
     WHERE ${options.verdict ? authSql`f.verdict = ${options.verdict}` : authSql`TRUE`}
     ORDER BY f.created_at DESC
     LIMIT ${limit}
  `;
  return rows.map((row) => ({
    ...row,
    id: Number(row.id),
    searchId: row.searchId === null ? null : Number(row.searchId),
  }));
}

export type NlFeedbackSummary = {
  correct: number;
  incorrect: number;
  withText: number;
};

/** Headline counts over the recent window the rest of the dashboard uses. */
export async function getNlFeedbackSummary(days: number): Promise<NlFeedbackSummary> {
  const [row] = await authSql<{ correct: string; incorrect: string; withText: string }[]>`
    SELECT count(*) FILTER (WHERE verdict = 'correct')                    AS correct,
           count(*) FILTER (WHERE verdict = 'incorrect')                  AS incorrect,
           count(*) FILTER (WHERE expected_answer IS NOT NULL)            AS "withText"
      FROM nl_search_feedback
     WHERE created_at > now() - make_interval(days => ${days})
  `;
  return {
    correct: Number(row?.correct ?? 0),
    incorrect: Number(row?.incorrect ?? 0),
    withText: Number(row?.withText ?? 0),
  };
}
