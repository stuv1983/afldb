import 'server-only';

import { authSql } from '@/db/authClient';
import { isUuid } from '@/lib/nl-session';
import {
  isNlFeedbackVerdict, NL_FEEDBACK_MAX_LENGTH, type NlFeedbackVerdict,
} from '@/search/nl/feedback-spec';

/**
 * Reader feedback on one natural-language answer (migration 049).
 *
 * Writes go through afldb_auth, the same role the search log uses: the
 * public site's own role is read-only, and that stays true. The role
 * holds INSERT and SELECT on this table and deliberately no UPDATE or
 * DELETE, so the append-only shape is enforced by the grant rather than
 * by everyone remembering it.
 */

export type NlFeedbackResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'duplicate' | 'error' };

/**
 * Records one reader's verdict. Returns a result rather than throwing:
 * this is called from a form on the search page, and a feedback write
 * failing must never be the reason a reader loses their results.
 *
 * `clientRef` is the token the answer carried, and is validated as a
 * UUID before it reaches the `::uuid` cast -- it arrives from the
 * browser, so it is untrusted input like any other form field. An
 * unknown-but-well-formed ref is accepted rather than checked against
 * nl_search_log: the log row is written from `after()`, so a fast reply
 * can legitimately arrive first, and rejecting it would discard a real
 * report to protect a join.
 */
export async function recordNlFeedback(input: {
  clientRef: string;
  verdict: NlFeedbackVerdict;
  expectedAnswer?: string | null;
}): Promise<NlFeedbackResult> {
  if (!isUuid(input.clientRef)) return { ok: false, reason: 'invalid' };
  if (!isNlFeedbackVerdict(input.verdict)) return { ok: false, reason: 'invalid' };

  // "Yes, correct" carries no prose: accepting text there would create a
  // second place for a reader to report a problem that nothing reads.
  const trimmed = input.verdict === 'incorrect'
    ? (input.expectedAnswer ?? '').trim().slice(0, NL_FEEDBACK_MAX_LENGTH)
    : '';

  try {
    await authSql`
      INSERT INTO nl_search_feedback (client_ref, verdict, expected_answer)
      VALUES (
        ${input.clientRef}::uuid,
        ${input.verdict},
        ${trimmed.length > 0 ? trimmed : null}
      )
    `;
    return { ok: true };
  } catch (error) {
    // 23505 is unique_violation -- the UNIQUE on client_ref, i.e. this
    // search already has feedback. A reader double-submitting is not an
    // error worth showing them; the first answer stands.
    if (error && typeof error === 'object' && (error as { code?: unknown }).code === '23505') {
      return { ok: false, reason: 'duplicate' };
    }
    console.error('natural-language feedback could not be recorded', error);
    return { ok: false, reason: 'error' };
  }
}
