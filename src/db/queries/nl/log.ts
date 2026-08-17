import 'server-only';

import { after } from 'next/server';

import { authSql } from '@/db/authClient';
import type { NlGrain } from '@/search/nl/plan';

/**
 * Mirrors nl_search_log's `outcome` CHECK constraint
 * (src/db/migrations/046_nl_search_log.sql) exactly -- one row per
 * terminal branch of answerNlQuestion.
 */
export type NlSearchLogOutcome =
  | 'answered' | 'answered_caveat' | 'no_results'
  | 'declined_low_confidence' | 'declined_ambiguous'
  | 'unrecognised' | 'unanswerable' | 'error';

export type NlSearchLogEntry = {
  question: string;
  outcome: NlSearchLogOutcome;
  grain?: NlGrain | null;
  metric?: string | null;
  /** Serialisable plan JSON, when one was built (declined_* and error may still have one). */
  plan?: unknown;
  confidence?: number | null;
  /** report.unsupportedTerms -- the vocabulary-mining signal phase F reads. */
  unsupportedTerms?: string[];
  resultCount?: number | null;
  durationMs: number;
};

/**
 * Fire-and-forget: scheduled via `after()` so a slow or unreachable log
 * write never adds latency to the answer a reader is waiting on, and a
 * failure here never turns into a failed search. Every /search render
 * that reaches the NL engine logs exactly one row, including declines
 * and unrecognised questions -- those are the rows that grow the
 * vocabulary (see plan.ts's NlParseReport.unsupportedTerms comment).
 */
export function logNlSearch(entry: NlSearchLogEntry): void {
  after(async () => {
    try {
      await authSql`
        INSERT INTO nl_search_log
          (question, outcome, grain, metric, plan, confidence, unsupported_terms, result_count, duration_ms)
        VALUES (
          ${entry.question.slice(0, 200)},
          ${entry.outcome},
          ${entry.grain ?? null},
          ${entry.metric ?? null},
          ${entry.plan ? JSON.stringify(entry.plan) : null},
          ${entry.confidence ?? null},
          ${entry.unsupportedTerms && entry.unsupportedTerms.length > 0 ? entry.unsupportedTerms : null},
          ${entry.resultCount ?? null},
          ${Math.max(0, Math.round(entry.durationMs))}
        )
      `;
    } catch (error) {
      console.error('failed to write nl_search_log row', error);
    }
  });
}
