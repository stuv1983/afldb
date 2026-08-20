'use client';

import { useEffect, useState } from 'react';

import { ResolveControls } from '@/app/admin/player-links/ResolveControls';

type OpenRow = {
  targets: { table: string; id: number }[];
  playerName: string;
  context: string;
  linkStatus: string;
  suggestions: { id: number; suggestedName: string; note: string | null }[];
};

export function ResolvePanel() {
  const [row, setRow] = useState<OpenRow | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<{table: string, id: number, name: string}[]>([]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const trigger = (event.target as Element).closest?.('[data-resolve-trigger]');
      if (trigger instanceof HTMLElement) {
        event.preventDefault();
        const d = trigger.dataset;
        let suggestions: OpenRow['suggestions'] = [];
        try {
          suggestions = d.suggestions ? JSON.parse(d.suggestions) : [];
        } catch { /* malformed data attribute: open with no tips rather than not at all */ }
        setRow({
          targets: [{ table: d.targetTable ?? '', id: Number(d.targetId) }],
          playerName: d.playerName ?? '',
          context: d.context ?? '',
          linkStatus: d.linkStatus ?? '',
          suggestions,
        });
        return;
      }
    }

    function onChange(event: Event) {
      const target = event.target as HTMLInputElement;
      if (target.classList?.contains('bulk-resolve-cb')) {
        const d = target.dataset;
        const table = d.targetTable!;
        const id = Number(d.targetId);
        const name = d.playerName!;
        if (target.checked) {
          setSelectedTargets(prev => [...prev, { table, id, name }]);
        } else {
          setSelectedTargets(prev => prev.filter(t => !(t.table === table && t.id === id)));
        }
      }
    }
    
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('change', onChange);
    };
  }, []);

  useEffect(() => {
    if (!row) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setRow(null);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [row]);

  const handleBulkResolve = () => {
    if (selectedTargets.length === 0) return;
    const name = selectedTargets[0].name;
    setRow({
      targets: selectedTargets.map(t => ({ table: t.table, id: t.id })),
      playerName: name,
      context: `Bulk resolving ${selectedTargets.length} records.`,
      linkStatus: 'mixed',
      suggestions: [],
    });
  };

  return (
    <>
      {selectedTargets.length > 0 && !row && (
        <div style={{
          position: 'fixed', bottom: '2rem', left: '50%', transform: 'translateX(-50%)',
          background: 'var(--bg-raised)', padding: '0.75rem 1.5rem',
          borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          border: '1px solid var(--border-strong)', zIndex: 30,
          display: 'flex', gap: '1rem', alignItems: 'center'
        }}>
          <strong>{selectedTargets.length} records selected</strong>
          <button type="button" className="btn btn-primary" onClick={handleBulkResolve}>
            Resolve Selected
          </button>
        </div>
      )}

      {row && (
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
              key={row.targets.map(t => `${t.table}:${t.id}`).join(',')}
              targets={row.targets}
              playerName={row.playerName}
              context={row.context}
              linkStatus={row.linkStatus}
              suggestions={row.suggestions}
            />
          </div>
        </div>
      )}
    </>
  );
}
