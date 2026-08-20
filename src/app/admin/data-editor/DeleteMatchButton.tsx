'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { deleteMatchAction, type SimpleAdminActionState } from '@/app/admin/data-editor/actions';

const INITIAL: SimpleAdminActionState = {};

/**
 * Super Admin: Delete match button with confirmation (see changeLog.md).
 * Removes match, lineups, stats, and automatically recomputes affected player career stats.
 */
export function DeleteMatchButton({
  matchId,
  matchDescription,
}: {
  matchId: number;
  matchDescription?: string;
}) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [state, formAction, isPending] = useActionState(deleteMatchAction, INITIAL);

  useEffect(() => {
    if (state.message && !state.warning) {
      router.push('/admin/data-editor');
    }
  }, [state.message, state.warning, router]);

  if (!isConfirming) {
    return (
      <button
        type="button"
        onClick={() => setIsConfirming(true)}
        className="btn"
        style={{
          background: 'transparent',
          border: '1px solid var(--color-warn)',
          color: 'var(--color-warn)',
          fontSize: '0.85rem',
        }}
      >
        🗑 Delete match
      </button>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--color-warn)',
      borderRadius: '6px',
      padding: '0.75rem 1rem',
      background: 'var(--bg-raised)',
      display: 'grid',
      gap: '0.5rem',
      maxWidth: '30rem',
    }}>
      <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-warn)', fontSize: '0.85rem' }}>
        ⚠ Confirm Deletion of Match #{matchId}
      </p>
      <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
        {matchDescription ? `${matchDescription}. ` : ''}
        This will permanently remove the match, lineups, and in-game player statistics, and automatically recalculate career/season statistics for all affected players.
      </p>

      {state.error && (
        <p style={{ margin: 0, color: 'var(--color-warn)', fontSize: '0.8rem' }}>
          ⚠ {state.error}
        </p>
      )}

      {state.message && (
        <p style={{ margin: 0, color: 'var(--accent)', fontSize: '0.8rem' }}>
          ✓ {state.message}
        </p>
      )}

      {state.warning && (
        <p className="badge badge-warn" style={{ margin: 0, fontSize: '0.8rem' }}>
          {state.warning}
        </p>
      )}

      <form action={formAction} style={{ display: 'grid', gap: '0.5rem' }}>
        <input type="hidden" name="matchId" value={matchId} />
        <input
          type="text"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for deletion (optional, e.g. test match)"
          style={{ fontSize: '0.8rem' }}
        />

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            type="submit"
            disabled={isPending || Boolean(state.message)}
            style={{
              background: 'var(--color-warn)',
              color: '#fff',
              border: 'none',
              fontSize: '0.8rem',
              padding: '0.3rem 0.6rem',
            }}
          >
            {isPending ? 'Deleting & recalculating…' : 'Yes, delete match'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsConfirming(false)}
            style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
