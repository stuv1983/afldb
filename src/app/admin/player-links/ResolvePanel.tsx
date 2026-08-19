'use client';

import { useEffect, useState } from 'react';

import { ResolveControls } from '@/app/admin/player-links/ResolveControls';

type OpenRow = {
  targetTable: string;
  targetId: number;
  playerName: string;
  context: string;
  linkStatus: string;
  suggestions: { id: number; suggestedName: string; note: string | null }[];
};

/**
 * The ONE resolve control for the whole queue.
 *
 * The queue used to mount a ResolveControls (two action forms plus a
 * PlayerPicker with its own document-level listener) inside a closed
 * <details> on every row — 2,116 rows meant ~48,900 DOM nodes, ~4,200
 * forms and seconds of client render on every navigation, because a
 * closed <details> defers nothing in React. The rows are now plain
 * server-rendered HTML with a lightweight trigger button, and this panel
 * is the single client component that mounts controls, for one row at a
 * time, when the admin actually asks for them.
 *
 * The bridge is a single delegated click listener reading data-*
 * attributes off the trigger, not a per-row client component: zero
 * per-row hydration cost, one listener for the whole page.
 *
 * Keyed remount: `key` on ResolveControls resets its action state when a
 * different row is opened, so one row's success message can never bleed
 * into the next.
 */
export function ResolvePanel() {
  const [row, setRow] = useState<OpenRow | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const trigger = (event.target as Element).closest?.('[data-resolve-trigger]');
      if (!(trigger instanceof HTMLElement)) return;
      event.preventDefault();
      const d = trigger.dataset;
      let suggestions: OpenRow['suggestions'] = [];
      try {
        suggestions = d.suggestions ? JSON.parse(d.suggestions) : [];
      } catch { /* malformed data attribute: open with no tips rather than not at all */ }
      setRow({
        targetTable: d.targetTable ?? '',
        targetId: Number(d.targetId),
        playerName: d.playerName ?? '',
        context: d.context ?? '',
        linkStatus: d.linkStatus ?? '',
        suggestions,
      });
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  useEffect(() => {
    if (!row) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRow(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row]);

  if (!row) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Resolve ${row.playerName}`}
      style={{
        position: 'fixed',
        right: 0,
        top: 0,
        bottom: 0,
        width: 'min(30rem, 100vw)',
        zIndex: 40,
        background: 'var(--bg-raised)',
        borderLeft: '1px solid var(--border-strong)',
        boxShadow: '-8px 0 24px rgba(0,0,0,0.18)',
        padding: '1rem 1.25rem',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{row.playerName}</h2>
          <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.9rem' }}>{row.context}</p>
          <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>status: {row.linkStatus}</p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => setRow(null)} aria-label="Close">
          Close
        </button>
      </div>
      <div style={{ marginTop: '0.75rem' }}>
        <ResolveControls
          key={`${row.targetTable}:${row.targetId}`}
          targetTable={row.targetTable}
          targetId={row.targetId}
          playerName={row.playerName}
          context={row.context}
          linkStatus={row.linkStatus}
          suggestions={row.suggestions}
        />
      </div>
    </div>
  );
}
