'use client';

import { useState } from 'react';

import { supersedeManualPickBySourceRowAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

/**
 * The J-14 resolution (§6.7): DraftGuru has now published the selection this
 * manual row was standing in for. Link the source row to the player and
 * retire the manual row in one transaction, so the database is never
 * briefly holding two selections for one event or none at all.
 */
export function SupersedePanel({
  manualPickId,
  sourcePickId,
  sourcePlayerNameRaw,
}: {
  manualPickId: number;
  sourcePickId: number;
  sourcePlayerNameRaw: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const supersede = useDraftActionSubmit(supersedeManualPickBySourceRowAction);

  const handleSupersede = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('manualPickId', String(manualPickId));
    formData.set('sourcePickId', String(sourcePickId));
    supersede.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Duplicate selection detected</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        DraftGuru now lists a source-owned selection #{sourcePickId} (&ldquo;{sourcePlayerNameRaw}&rdquo;) for
        the same player, year and kind as this manual selection. Superseding links the source
        selection to the player and retires this manual one — leaving exactly one selection for
        this event, never two and never none.
      </p>
      {!confirming ? (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Supersede with the source selection…
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '26rem' }}>
          {supersede.state.error && <p className="notice" role="alert">{supersede.state.error}</p>}
          {supersede.state.ok && supersede.state.message && <p className="notice" role="status">{supersede.state.message}</p>}
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" className="btn btn-primary" onClick={handleSupersede} disabled={supersede.isPending}>
              {supersede.isPending ? 'Superseding…' : 'Confirm supersede'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={supersede.isPending}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
