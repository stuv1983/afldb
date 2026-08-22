'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect } from 'react';

import {
  bulkApproveSuggestions,
  type PlayerLinkActionState,
} from '@/app/admin/player-links/actions';

const INITIAL: PlayerLinkActionState = {};

/**
 * Approve the suggestions of the selected rows.
 *
 * Only rows the SERVER marked bulk-eligible are ever submitted, and the
 * server checks eligibility again for each one while it holds the row's
 * lock. The count is shown honestly: if six rows are selected and two
 * qualify, the button says two.
 */
export function BulkApproveControls({
  targets,
  totalSelected,
}: {
  targets: { table: string; id: number; linkStatus: string; suggestPlayerId: number | null }[];
  totalSelected: number;
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(bulkApproveSuggestions, INITIAL);

  useEffect(() => {
    if (state.message) {
      document.dispatchEvent(new CustomEvent('player-links-resolved'));
      router.refresh();
    }
  }, [state.message, router]);

  if (targets.length === 0) {
    return (
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        None of the {totalSelected} selected are bulk-ready
      </span>
    );
  }

  return (
    <form action={formAction} style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <input
        type="hidden"
        name="targets"
        value={targets.map((t) => `${t.table}:${t.id}:${t.linkStatus}`).join(',')}
      />
      <input
        type="hidden"
        name="playerIds"
        value={targets.map((t) => t.suggestPlayerId ?? '').join(',')}
      />
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending
          ? 'Approving…'
          : `Approve ${targets.length} suggested match${targets.length === 1 ? '' : 'es'}`}
      </button>
      {state.error && (
        <span className="badge badge-warn" style={{ fontSize: '0.8rem' }}>{state.error}</span>
      )}
      {state.warning && (
        <span className="badge badge-warn" style={{ fontSize: '0.8rem' }}>{state.warning}</span>
      )}
    </form>
  );
}
