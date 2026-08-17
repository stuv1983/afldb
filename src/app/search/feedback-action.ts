'use server';

import { recordNlFeedback } from '@/db/queries/nl/feedback';
import { isNlFeedbackVerdict, NL_FEEDBACK_MAX_LENGTH } from '@/search/nl/feedback-spec';

export type NlFeedbackState = { status: 'idle' | 'thanks' | 'error'; message?: string };

/**
 * The public "was this search correct?" submission.
 *
 * Deliberately anonymous and deliberately thin. It takes an opaque
 * per-search token and at most one paragraph of text; it reads no cookie,
 * no session and no account, and it returns the same cheerful state
 * whether the row was inserted, was a duplicate, or hit a database error.
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

  const result = await recordNlFeedback({ clientRef, verdict, expectedAnswer });
  if (!result.ok && result.reason === 'invalid') {
    return { status: 'error', message: 'That feedback could not be linked to a search.' };
  }
  return { status: 'thanks' };
}
