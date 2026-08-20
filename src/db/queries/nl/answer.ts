import 'server-only';

import { randomUUID } from 'node:crypto';

import { executePlan } from '@/db/queries/nl/execute';
import { logNlSearch, type NlFailureReason, type NlSearchLogEntry, type NlSearchLogOutcome } from '@/db/queries/nl/log';
import { buildNlParseContext } from '@/db/queries/nl/resolve';
import {
  describePlan,
  encodePlanToken,
  nlCoverageFor,
  PARSER_VERSION,
  validatePlan,
  type NlDeclineReason,
  type NlParseReport,
  type NlQueryPlan,
} from '@/search/nl/plan';
import { parseNlQuestion } from '@/search/nl/parser';
import { describeAnswer } from '@/search/nl/describe';
import type { NlAnswer, NlAnswerPayload } from '@/search/nl/answer-types';

/**
 * Parse and answer a natural-language question end to end: question ->
 * parseNlQuestion -> validatePlan (defence in depth, even though the
 * parser just built this plan) -> executePlan -> a rendered NlAnswer, or
 * null when there is nothing to show (the question wasn't recognised,
 * confidence was too low, or the recognised plan matched no rows -- the
 * same "fall through to ordinary search, no empty-state panel" rule
 * db/queries/search.ts's answerPlayerQuestion/answerClubQuestion
 * already follow).
 *
 * Every failure mode degrades to null rather than throwing: a reader's
 * ordinary player/club/venue results must never be lost because the
 * question-answering layer hit a bug.
 *
 * `sessionId` is the anonymous nl_sid cookie (lib/nl-session.ts), passed
 * through purely for telemetry -- it never affects parsing or the answer.
 * `runTag` is the `x-afldb-run-tag` header (migration 051), present only on
 * a synthetic qualification run; like sessionId, it never affects parsing
 * or the answer, only what gets written to nl_search_log.
 */
// One row per NlDeclineReason, matching nl_search_log's outcome CHECK
// (unrecognised gets its own bucket, distinct from the two decline reasons).
const DECLINE_OUTCOME: Record<NlDeclineReason, NlSearchLogOutcome> = {
  unrecognised: 'unrecognised',
  low_confidence: 'declined_low_confidence',
  ambiguous: 'declined_ambiguous',
};

/**
 * The fine-grained reason under a decline. Ambiguity is checked before
 * unsupported terms: a mention the resolver returned candidates for but
 * would not commit to ("ablett") is a word the engine UNDERSTOOD --
 * calling it an unsupported term told the reader their spelling was the
 * problem when the actual problem was two Gary Abletts. The 'ambiguous'
 * decline reason collapses to the same label because entity resolution
 * can only land below certainty 1 for a player today (see log.ts's
 * NlFailureReason comment).
 */
function declineFailureReason(reason: NlDeclineReason, report: NlParseReport): NlFailureReason {
  if (report.ambiguousPlayer !== undefined) return 'ambiguous_player';
  if (reason === 'ambiguous') return 'ambiguous_player';
  if (report.unsupportedTerms.length > 0) return 'unsupported_term';
  return reason;
}

/** SQLSTATE 57014 is query_canceled -- exactly what a statement_timeout abort raises. Any other 5-character SQLSTATE is a real database error; anything else is a bug in this code, not the database. */
function classifyError(error: unknown): NlFailureReason {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (code === '57014') return 'query_timeout';
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return 'database_error';
  }
  return 'internal_error';
}

export async function answerNlQuestion(
  question: string,
  sessionId: string | null = null,
  runTag: string | null = null,
): Promise<NlAnswer | null> {
  const startedAt = Date.now();
  const elapsed = () => Date.now() - startedAt;

  // Minted here rather than read from the log row's id, because logging
  // is deferred to after() -- the response is already sent by the time
  // the row exists, so its id can never reach the page that needs it.
  // This is the token the feedback widget sends back (migration 049).
  // Random and meaningless: deliberately NOT the session id, which spans
  // many searches and would let feedback land on the wrong one.
  const clientRef = randomUUID();

  // Fields every log call shares; each call site layers on outcome-specific ones.
  const log = (entry: Omit<NlSearchLogEntry, 'question' | 'durationMs' | 'sessionId' | 'runTag'>) => logNlSearch({
    question, durationMs: elapsed(), sessionId, clientRef, runTag, ...entry,
  });

  try {
    const ctx = await buildNlParseContext();
    const parsed = await parseNlQuestion(question, ctx);

    if (parsed.status === 'unanswerable') {
      log({
        outcome: 'unanswerable', failureReason: 'unsupported_topic', topic: parsed.topic,
        confidence: parsed.report.confidence, confidenceComponents: parsed.report.components,
        unsupportedTerms: parsed.report.unsupportedTerms, entityResolution: parsed.report.entityResolution,
        parserVersion: PARSER_VERSION,
      });
      return {
        headline: 'AFLDB can’t answer this yet',
        interpretation: parsed.topic,
        caveats: [],
        coverageNote: null,
        explain: [parsed.reason],
        planToken: null,
        clientRef,
        payload: { kind: 'unanswerable', topic: parsed.topic, reason: parsed.reason },
      };
    }

    if (parsed.status === 'none') {
      log({
        outcome: DECLINE_OUTCOME[parsed.reason], failureReason: declineFailureReason(parsed.reason, parsed.report),
        confidence: parsed.report.confidence, confidenceComponents: parsed.report.components,
        unsupportedTerms: parsed.report.unsupportedTerms, entityResolution: parsed.report.entityResolution,
        parserVersion: PARSER_VERSION,
      });
      return null;
    }

    const validated = validatePlan(parsed.plan);
    if ('error' in validated) {
      // The parser's own plan failed defence-in-depth validation --
      // in practice always an era-coverage rejection ("tackles weren't
      // recorded before 1987"), the only rejection validatePlan can
      // reach from a plan the parser itself produced -- which is a
      // genuine, useful answer in its own right, not a bug to hide.
      log({
        outcome: 'unanswerable', failureReason: 'coverage_unavailable',
        grain: parsed.plan.grain, metric: parsed.plan.metric, plan: parsed.plan,
        confidence: parsed.report.confidence, confidenceComponents: parsed.report.components,
        unsupportedTerms: parsed.report.unsupportedTerms, entityResolution: parsed.report.entityResolution,
        parserVersion: PARSER_VERSION,
      });
      return {
        headline: 'AFLDB can’t answer this',
        interpretation: validated.error,
        caveats: [],
        coverageNote: null,
        explain: [validated.error],
        planToken: null,
        clientRef,
        payload: { kind: 'unanswerable', topic: question, reason: validated.error },
      };
    }

    const payload = await executePlan(validated);
    const resultCount = payloadTotal(payload);
    if (resultCount === 0) {
      log({
        outcome: 'no_results', failureReason: 'empty_result',
        grain: validated.grain, metric: validated.metric, plan: validated,
        confidence: parsed.report.confidence, confidenceComponents: parsed.report.components,
        unsupportedTerms: parsed.report.unsupportedTerms, entityResolution: parsed.report.entityResolution,
        resultCount: 0, parserVersion: PARSER_VERSION,
      });
      return null;
    }

    const answer = buildAnswer(validated, payload, parsed.report.notes, clientRef);
    log({
      outcome: (answer.caveats.length > 0 || answer.coverageNote) ? 'answered_caveat' : 'answered',
      grain: validated.grain, metric: validated.metric, plan: validated,
      confidence: parsed.report.confidence, confidenceComponents: parsed.report.components,
      unsupportedTerms: parsed.report.unsupportedTerms, entityResolution: parsed.report.entityResolution,
      resultCount, parserVersion: PARSER_VERSION,
    });
    return answer;
  } catch (error) {
    console.error('natural-language question could not be answered', error);
    log({ outcome: 'error', failureReason: classifyError(error) });
    return null;
  }
}

function payloadTotal(payload: NlAnswerPayload): number {
  switch (payload.kind) {
    case 'player_game': case 'player_career': case 'player_season':
    case 'team_match': case 'club_season': case 'team_streak':
      return payload.total;
    case 'count':
      return 1;
    case 'achievement_summary':
      // How many groups came back, matching every other branch's "rows the
      // reader is shown" reading -- payload.total counts the achievement's
      // holders, which is a different number and belongs in the answer text.
      return payload.rows.length;
    case 'unanswerable':
      return 0;
  }
}

function buildAnswer(
  plan: NlQueryPlan,
  payload: NlAnswerPayload,
  notes: string[],
  clientRef: string,
): NlAnswer {
  // One source of truth for what is recorded and when. nlCoverageFor
  // applies the rule's own grain scope, so a career or season Brownlow
  // TOTAL -- which exists for every year the medal has been awarded --
  // does not inherit the per-game figure's gap the way a bare
  // NL_COVERAGE[metric] lookup would.
  //
  // A plan that reaches here has already passed validatePlan, so its
  // scope overlaps coverage somewhere; the note explains the part of the
  // range that does not, rather than contradicting the answer above it.
  const coverageNote = nlCoverageFor(plan.grain, plan.metric)?.note ?? null;
  const { headline, interpretation } = describeAnswer(plan, payload);

  return {
    headline,
    interpretation,
    caveats: notes,
    coverageNote,
    explain: describePlan(plan),
    planToken: encodePlanToken(plan),
    clientRef,
    payload,
  };
}
