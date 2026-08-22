'use client';

import { useEffect, useState } from 'react';

import { BulkApproveControls } from '@/app/admin/player-links/BulkApproveControls';
import {
  ResolveControls,
  type SourceRecordView,
  type SuggestedMatch,
} from '@/app/admin/player-links/ResolveControls';

type OpenRow = {
  targets: { table: string; id: number; linkStatus?: string }[];
  playerName: string;
  context: string;
  linkStatus: string;
  suggestions: { id: number; suggestedName: string; note: string | null }[];
  /** The cached suggestion for this row, when the model produced one. */
  match: SuggestedMatch | null;
  /** What KIND of record this is, in its own terms. */
  sourceRecord: SourceRecordView | null;
};

type SelectedTarget = {
  table: string;
  id: number;
  name: string;
  linkStatus: string;
  bulkEligible: boolean;
  suggestPlayerId: number | null;
};

export function ResolvePanel() {
  const [row, setRow] = useState<OpenRow | null>(null);
  const [selectedTargets, setSelectedTargets] = useState<SelectedTarget[]>([]);

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
        let match: SuggestedMatch | null = null;
        try {
          match = d.match ? JSON.parse(d.match) as SuggestedMatch : null;
        } catch { /* same rule: a broken payload must not block manual resolution */ }
        let sourceRecord: SourceRecordView | null = null;
        try {
          sourceRecord = d.sourceRecord ? JSON.parse(d.sourceRecord) as SourceRecordView : null;
        } catch { /* likewise */ }
        setRow({
          targets: [{ table: d.targetTable ?? '', id: Number(d.targetId), linkStatus: d.linkStatus ?? '' }],
          playerName: d.playerName ?? '',
          context: d.context ?? '',
          linkStatus: d.linkStatus ?? '',
          suggestions,
          match,
          sourceRecord,
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
        const linkStatus = d.linkStatus!;
        const bulkEligible = d.bulkEligible === '1';
        const suggestPlayerId = d.suggestPlayerId ? Number(d.suggestPlayerId) : null;
        if (target.checked) {
          setSelectedTargets(prev => [...prev, { table, id, name, linkStatus, bulkEligible, suggestPlayerId }]);
        } else {
          setSelectedTargets(prev => prev.filter(t => !(t.table === table && t.id === id)));
        }
      } else if (target.classList?.contains('bulk-select-all-cb')) {
        const table = target.dataset.targetTable!;
        const isChecked = target.checked;
        const rowCheckboxes = document.querySelectorAll<HTMLInputElement>(`.bulk-resolve-cb[data-target-table="${table}"]`);
        
        const newTargets: SelectedTarget[] = [];
        rowCheckboxes.forEach(cb => {
            cb.checked = isChecked;
            newTargets.push({
                table: cb.dataset.targetTable!,
                id: Number(cb.dataset.targetId),
                name: cb.dataset.playerName!,
                linkStatus: cb.dataset.linkStatus!,
                bulkEligible: cb.dataset.bulkEligible === '1',
                suggestPlayerId: cb.dataset.suggestPlayerId ? Number(cb.dataset.suggestPlayerId) : null,
            });
        });

        setSelectedTargets(prev => {
            const filtered = prev.filter(p => p.table !== table);
            if (isChecked) {
                return [...filtered, ...newTargets];
            }
            return filtered;
        });
      }
    }

    function onResolved() {
      setSelectedTargets([]);
      document.querySelectorAll<HTMLInputElement>('.bulk-resolve-cb, .bulk-select-all-cb').forEach(cb => {
         cb.checked = false;
      });
    }
    
    document.addEventListener('click', onClick);
    document.addEventListener('change', onChange);
    document.addEventListener('player-links-resolved', onResolved);
    return () => {
      document.removeEventListener('click', onClick);
      document.removeEventListener('change', onChange);
      document.removeEventListener('player-links-resolved', onResolved);
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
      targets: selectedTargets.map(t => ({ table: t.table, id: t.id, linkStatus: t.linkStatus })),
      playerName: name,
      context: `Bulk resolving ${selectedTargets.length} records.`,
      linkStatus: 'mixed',
      suggestions: [],
      // A bulk resolve links one chosen player to many rows, which is a
      // different act from approving each row's own suggestion.
      match: null,
      sourceRecord: null,
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
          <button type="button" className="btn btn-secondary" onClick={handleBulkResolve}>
            Resolve Selected
          </button>
          <BulkApproveControls
            targets={selectedTargets.filter((t) => t.bulkEligible && t.suggestPlayerId !== null)}
            totalSelected={selectedTargets.length}
          />
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
              match={row.match}
              sourceRecord={row.sourceRecord}
            />
          </div>
        </div>
      )}
    </>
  );
}
