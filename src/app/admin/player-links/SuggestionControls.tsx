'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';

import {
  reviewSuggestion,
  type PlayerLinkActionState,
} from '@/app/admin/player-links/actions';

const INITIAL: PlayerLinkActionState = {};

/** Accept/dismiss for one reader suggestion. Both buttons are real submits. */
export function SuggestionControls({ suggestionId }: { suggestionId: number }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(reviewSuggestion, INITIAL);

  // Post-settle refresh instead of in-action revalidation — see actions.ts.
  useEffect(() => {
    if (state.message) router.refresh();
  }, [state.message, router]);

  if (state.message) return <span className="muted" style={{ fontSize: '0.85rem' }}>{state.message}</span>;

  return (
    <form action={formAction} style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
      <input type="hidden" name="suggestionId" value={suggestionId} />
      <button type="submit" name="status" value="accepted" disabled={pending} style={{ fontSize: '0.85rem' }}>
        Accept
      </button>
      <button type="submit" name="status" value="dismissed" disabled={pending} style={{ fontSize: '0.85rem' }}>
        Dismiss
      </button>
      {state.error && <span className="muted" style={{ fontSize: '0.8rem' }}>{state.error}</span>}
    </form>
  );
}
