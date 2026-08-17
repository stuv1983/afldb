'use server';

import { recordNlFeedback } from '@/db/queries/nl/feedback';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { requestIp } from '@/lib/auth/session';
import { isNlFeedbackVerdict, NL_FEEDBACK_MAX_LENGTH } from '@/search/nl/feedback-spec';

export type NlFeedbackState = { status: 'idle' | 'thanks' | 'error'; message?: string };

// Unauthenticated by design, so it is rate-limited by IP like every other
// public write here. The UNIQUE on client_ref is NOT a brake: an unknown
// but well-formed ref is accepted on purpose (see recordNlFeedback), so a
// script posting random UUIDs is posting distinct rows every time, each
// carrying up to 2000 characters. 12 per 15 minutes is far more feedback
// than a reader has searches to give it on.
const FEEDBACK_LIMIT = new RateLimiter(12, 15 * 60 * 1000);

/**
 * The public "was this search correct?" submission.
 *
 * Deliberately anonymous and deliberately thin. It takes an opaque
 * per-search token and at most one paragraph of text; it reads no cookie,
 * no session and no account -- only the client IP the proxy observed, and
 * only to key the rate limiter, never stored -- and it returns the same
 * cheerful state whether the row was inserted, was a duplicate, or hit a
 * database error.
 *
 * That last part is a choice, not laziness. The reader has told us
 * something useful and cannot act on our storage problems, so surfacing
 * them would only make an unpaid contribution feel like a failure. Real
 * errors are logged server-side in recordNlFeedback, which is where
 * someone can actually see them.
 */
export async function submitNlFeedback(
  _prev: NlFeedbackState,
  formData: FormData,
): Promise<NlFeedbackState> {
  const clientRef = String(formData.get('clientRef') ?? '');
  const verdict = String(formData.get('verdict') ?? '');
  const expectedAnswer = String(formData.get('expectedAnswer') ?? '').slice(0, NL_FEEDBACK_MAX_LENGTH);

  if (!isNlFeedbackVerdict(verdict)) {
    return { status: 'error', message: 'Please choose yes or no.' };
  }

  // Checked after the shape of the submission and before the insert, so a
  // flood is bounded before it reaches the database rather than after.
  if (FEEDBACK_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { status: 'error', message: 'Thanks — that is enough feedback for now. Try again later.' };
  }

  const result = await recordNlFeedback({ clientRef, verdict, expectedAnswer });
  if (!result.ok && result.reason === 'invalid') {
    return { status: 'error', message: 'That feedback could not be linked to a search.' };
  }
  return { status: 'thanks' };
}
