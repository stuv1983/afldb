import 'server-only';

import { createHash } from 'node:crypto';

import { after } from 'next/server';

import { authSql } from '@/db/authClient';
import { isUuid, isValidNlSessionId } from '@/lib/nl-session';
import type { NlConfidenceComponents, NlEntityResolution, NlGrain } from '@/search/nl/plan';

/**
 * Mirrors nl_search_log's `outcome` CHECK constraint
 * (src/db/migrations/046_nl_search_log.sql) exactly -- one row per
 * terminal branch of answerNlQuestion.
 */
export type NlSearchLogOutcome =
  | 'answered' | 'answered_caveat' | 'no_results'
  | 'declined_low_confidence' | 'declined_ambiguous'
  | 'unrecognised' | 'unanswerable' | 'error';

/**
 * The fine-grained taxonomy under `outcome`, matching migration 047's
 * CHECK constraint exactly. Deliberately limited to what this codebase
 * can actually produce today:
 *
 *   - no ambiguous_club / ambiguous_venue: club and venue matching is
 *     exact-or-nothing (directory + alias lookup), so the only entity
 *     that can resolve with certainty < 1 is a player (fuzzy
 *     trigram/prominence match). Add those once fuzzy club/venue
 *     matching exists.
 *   - no compiler_not_available: moot since phase D -- all five grains
 *     compile, so validatePlan's only realistic rejection is era
 *     coverage.
 *   - no partial_coverage / suspicious_empty_result: both are explicitly
 *     future work per the review this taxonomy is drawn from (a
 *     coverage note is currently shown whenever a metric has ANY
 *     coverage entry, whether or not the requested range actually
 *     overlaps the gap, so classifying from it today would be noise,
 *     not signal).
 */
export type NlFailureReason =
  | 'unsupported_topic' | 'unsupported_term' | 'ambiguous_player'
  | 'low_confidence' | 'unrecognised' | 'coverage_unavailable'
  | 'empty_result' | 'query_timeout' | 'database_error' | 'internal_error';

export type NlSearchLogEntry = {
  question: string;
  outcome: NlSearchLogOutcome;
  failureReason?: NlFailureReason | null;
  /** Populated only alongside failureReason 'unsupported_topic'. */
  topic?: string | null;
  grain?: NlGrain | null;
  metric?: string | null;
  /** Serialisable plan JSON, when one was built (declined_* and error may still have one). */
  plan?: unknown;
  confidence?: number | null;
  confidenceComponents?: NlConfidenceComponents | null;
  entityResolution?: NlEntityResolution[];
  /** report.unsupportedTerms -- the vocabulary-mining signal phase F reads. */
  unsupportedTerms?: string[];
  resultCount?: number | null;
  durationMs: number;
  parserVersion?: number | null;
  /** The nl_sid cookie value (lib/nl-session.ts), or null/absent for no session. */
  sessionId?: string | null;
  /**
   * Opaque per-search token returned to the browser, so reader feedback
   * can be attached to this exact search (migration 049). Random and
   * meaningless -- and NOT the session id, which spans many searches.
   */
  clientRef?: string | null;
  /**
   * Set only by a synthetic qualification run (migration 051), via the
   * `x-afldb-run-tag` request header -- never by a genuine reader, so a
   * NULL here means real traffic. See that migration's header comment.
   */
  runTag?: string | null;
};

/** Recursively sorts object keys so semantically identical plans hash identically regardless of construction order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonicalize(v)]),
    );
  }
  return value;
}

/** SHA-256 of a plan's canonical JSON -- groups distinct phrasings of the same semantic question (plan.ts's LLM-seam comment: any producer of a valid plan lands here the same way). */
function hashPlan(plan: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(plan))).digest('hex');
}

/**
 * jsonb columns must be bound with `sql.json()`, never `JSON.stringify()`.
 *
 * postgres.js JSON-encodes whatever JS value it is given for a jsonb
 * parameter, so handing it an already-stringified object stores a jsonb
 * *string scalar* containing JSON text -- `plan->>'grain'` then returns
 * NULL and the column is effectively opaque to SQL. An explicit `::jsonb`
 * cast does NOT rescue it (verified empirically: the driver encodes before
 * the cast applies). Migration 048 repairs the rows written the wrong way
 * before this was noticed; `auth_audit_log.detail` still carries the same
 * shape from lib/auth/session.ts's audit(), which is a separate,
 * pre-existing case and deliberately untouched here.
 */
function jsonbOrNull(value: unknown) {
  return value === undefined || value === null ? null : authSql.json(value as never);
}

/**
 * Fire-and-forget: scheduled via `after()` so a slow or unreachable log
 * write never adds latency to the answer a reader is waiting on, and a
 * failure here never turns into a failed search. Every /search render
 * that reaches the NL engine logs exactly one row, including declines
 * and unrecognised questions -- those are the rows that grow the
 * vocabulary (see plan.ts's NlParseReport.unsupportedTerms comment).
 *
 * The reformulation link (parent_search_id) is resolved in the same
 * INSERT via a correlated subquery rather than a separate round trip:
 * the most recent row from the same session within 60 seconds, if any.
 *
 * answerNlQuestion is also called outside a Next.js request scope --
 * vitest integration suites and server-side scripts -- where Next 16's
 * after() throws synchronously. The row is still wanted there, so the
 * write falls back to running detached -- but ONLY for that recognised
 * no-request-scope failure. Any other synchronous after() exception is a
 * scheduler invariant breaking inside a real request, not a legitimate
 * non-request caller; it is reported and swallowed (never rethrown into
 * the answer, never misread as permission to write detached). Either
 * way write()'s own catch keeps a telemetry failure out of the answer.
 */
export function logNlSearch(entry: NlSearchLogEntry): void {
  const write = async () => {
    try {
      const sessionId = isValidNlSessionId(entry.sessionId) ? entry.sessionId : null;
      await authSql`
        INSERT INTO nl_search_log (
          question, outcome, failure_reason, topic, grain, metric, plan, plan_hash,
          confidence, confidence_components, unsupported_terms, entity_resolution,
          result_count, duration_ms, parser_version, session_id, client_ref, run_tag, parent_search_id
        )
        VALUES (
          ${entry.question.slice(0, 200)},
          ${entry.outcome},
          ${entry.failureReason ?? null},
          ${entry.topic ?? null},
          ${entry.grain ?? null},
          ${entry.metric ?? null},
          ${jsonbOrNull(entry.plan)},
          ${entry.plan ? hashPlan(entry.plan) : null},
          ${entry.confidence ?? null},
          ${jsonbOrNull(entry.confidenceComponents)},
          ${entry.unsupportedTerms && entry.unsupportedTerms.length > 0 ? entry.unsupportedTerms : null},
          ${jsonbOrNull(entry.entityResolution && entry.entityResolution.length > 0 ? entry.entityResolution : null)},
          ${entry.resultCount ?? null},
          ${Math.max(0, Math.round(entry.durationMs))},
          ${entry.parserVersion ?? null},
          ${sessionId}::uuid,
          ${isUuid(entry.clientRef) ? entry.clientRef : null}::uuid,
          ${entry.runTag ?? null},
          (SELECT id FROM nl_search_log
             WHERE session_id = ${sessionId}::uuid
               AND at > now() - interval '60 seconds'
             ORDER BY at DESC LIMIT 1)
        )
      `;
    } catch (error) {
      console.error('failed to write nl_search_log row', error);
    }
  };

  try {
    after(write);
  } catch (error) {
    if (isOutsideRequestScope(error)) {
      void write();
    } else {
      console.error('unexpected synchronous after() failure scheduling nl_search_log write', error);
    }
  }
}

/**
 * True only for the one synchronous error Next 16 defines to mean "no
 * request scope exists": after() throws an Error with this exact message
 * prefix and the non-enumerable error code E468 when neither work store
 * is populated (node_modules/next/dist/server/after/after.js). Both
 * characteristics of the installed implementation are accepted -- the
 * code survives message edits across Next versions (codes are
 * append-only), the prefix survives a code renumbering -- but nothing
 * else does: an unrelated after() exception must not be classified as
 * normal non-request execution.
 */
function isOutsideRequestScope(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (error as { __NEXT_ERROR_CODE?: unknown }).__NEXT_ERROR_CODE === 'E468'
    || error.message.startsWith('`after` was called outside a request scope');
}
