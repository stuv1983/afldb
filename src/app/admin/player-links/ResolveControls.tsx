'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import {
  confirmUnlinked,
  linkPlayer,
  type PlayerLinkActionState,
} from '@/app/admin/player-links/actions';
import { PlayerPicker } from '@/components/PlayerPicker';

const INITIAL: PlayerLinkActionState = {};

/**
 * The resolve panel for one unresolved honours row.
 *
 * Two decisions, two real submits: link the row to a player found via
 * the site's own autocomplete, or record that the name was vetted and
 * is genuinely not an AFLDB player (the common case for state-league
 * footballers). PlayerPicker holds the selection as local state and
 * this component passes it through a hidden field, the same shape the
 * compare page uses.
 */
export function ResolveControls({
  targetTable,
  targetId,
  linkStatus,
  suggestions,
}: {
  targetTable: string;
  targetId: number;
  linkStatus: string;
  suggestions: { id: number; suggestedName: string; note: string | null }[];
}) {
  const router = useRouter();
  const [linkState, linkAction, linkPending] = useActionState(linkPlayer, INITIAL);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmUnlinked, INITIAL);
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);

  const done = linkState.message ?? confirmState.message;

  // The actions no longer revalidate this route themselves (doing so from
  // inside the action hangs the pending transition on this Next 15.5 line —
  // see actions.ts). Refreshing here, after the action state has settled,
  // takes the ordinary router path: the resolved row leaves the queue and
  // no in-flight form gets unmounted mid-action.
  useEffect(() => {
    if (done) router.refresh();
  }, [done, router]);
  if (done) return <p className="muted" style={{ fontSize: '0.85rem' }}>{done}</p>;

  return (
    <div style={{ display: 'grid', gap: '0.6rem', padding: '0.5rem 0' }}>
      {suggestions.length > 0 && (
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          <strong>Reader suggestions:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.1rem' }}>
            {suggestions.map((s) => (
              <li key={s.id}>
                {s.suggestedName}
                {s.note && <> — {s.note}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={linkAction} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'end' }}>
        <input type="hidden" name="targetTable" value={targetTable} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="playerId" value={picked?.id ?? ''} />
        <PlayerPicker label="AFLDB player" onSelect={setPicked} />
        <input
          type="text"
          name="note"
          maxLength={2000}
          placeholder="How was this verified? (optional)"
          style={{ fontSize: '0.85rem' }}
        />
        <button type="submit" disabled={linkPending || !picked}>
          Link player
        </button>
        {linkState.error && (
          <span className="muted" style={{ flexBasis: '100%', fontSize: '0.8rem' }}>{linkState.error}</span>
        )}
      </form>

      <form action={confirmAction} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <input type="hidden" name="targetTable" value={targetTable} />
        <input type="hidden" name="targetId" value={targetId} />
        <input type="hidden" name="previousStatus" value={linkStatus} />
        <input
          type="text"
          name="note"
          maxLength={2000}
          placeholder="Why is this not an AFLDB player? (optional)"
          style={{ fontSize: '0.85rem' }}
        />
        <button type="submit" disabled={confirmPending} className="btn btn-secondary">
          Confirm not an AFL/VFL player
        </button>
        {confirmState.error && (
          <span className="muted" style={{ flexBasis: '100%', fontSize: '0.8rem' }}>{confirmState.error}</span>
        )}
      </form>
    </div>
  );
}
