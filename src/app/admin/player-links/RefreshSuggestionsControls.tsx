'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';

import {
  refreshSuggestions,
  type PlayerLinkActionState,
} from '@/app/admin/player-links/actions';

const INITIAL: PlayerLinkActionState = {};

/**
 * Recompute the whole suggestion cache.
 *
 * Post-settle refresh rather than in-action revalidation, the same way
 * SuggestionControls works -- see actions.ts.
 */
export function RefreshSuggestionsControls({ computedAt }: { computedAt: Date | null }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(refreshSuggestions, INITIAL);

  useEffect(() => {
    if (state.message) router.refresh();
  }, [state.message, router]);

  return (
    <form
      action={formAction}
      style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}
    >
      <button type="submit" className="btn btn-secondary" disabled={pending}>
        {pending ? 'Scoring the queue…' : 'Recompute suggestions'}
      </button>
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        {state.message
          ?? state.error
          ?? (computedAt
            ? `Suggestions last computed ${computedAt.toISOString().slice(0, 16).replace('T', ' ')}.`
            : 'No suggestions have been computed yet.')}
      </span>
    </form>
  );
}
