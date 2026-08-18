'use server';

import { recordSuggestion } from '@/db/queries/player-links';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { requestIp } from '@/lib/auth/session';

export type LinkSuggestionState = { status: 'idle' | 'thanks' | 'error'; message?: string };

// Unauthenticated by design, so it is rate-limited by IP like the NL
// feedback action it mirrors. Every accepted submission is a distinct
// row of up to ~1.1KB of text, so the brake is the limiter, not the
// table's constraints.
const SUGGESTION_LIMIT = new RateLimiter(12, 15 * 60 * 1000);

/**
 * The public "I know who this unmatched player is" submission.
 *
 * Anonymous and thin, like submitNlFeedback: it reads no cookie and no
 * session, only the client IP for the rate limiter. The name is free
 * text on purpose — the person a reader recognises is often a
 * state-league footballer with no AFLDB player row to point at — and a
 * super admin verifies every tip against external sources before
 * anything is linked. Storage errors are logged server-side and the
 * reader still gets a thank-you; they cannot act on our problems.
 */
export async function submitPlayerLinkSuggestion(
  _prev: LinkSuggestionState,
  formData: FormData,
): Promise<LinkSuggestionState> {
  const targetTable = String(formData.get('targetTable') ?? '');
  const targetId = Number(formData.get('targetId'));
  const suggestedName = String(formData.get('suggestedName') ?? '').slice(0, 120);
  const note = String(formData.get('note') ?? '').slice(0, 1000);

  if (!suggestedName.trim()) {
    return { status: 'error', message: 'Please give the player’s name.' };
  }

  if (SUGGESTION_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return { status: 'error', message: 'Thanks — that is enough suggestions for now. Try again later.' };
  }

  const result = await recordSuggestion({ targetTable, targetId, suggestedName, note });
  if (!result.ok && result.reason === 'invalid') {
    return { status: 'error', message: 'That suggestion could not be linked to a record.' };
  }
  return { status: 'thanks' };
}
