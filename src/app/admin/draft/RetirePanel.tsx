'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { retireManualPickAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

/**
 * Retire a manual selection: an audited DELETE of the canonical row (D-4).
 * This is destructive and requires an explicit confirmation step -- no
 * tombstone workflow exists or is invented here; the `data_edits` row
 * carries the whole retired selection in `old_values`, against the player,
 * who outlives the deleted id.
 */
export function RetirePanel({ pickId, expectedRevision }: { pickId: number; expectedRevision: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const retire = useDraftActionSubmit(retireManualPickAction);

  const handleRetire = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('pickId', String(pickId));
    formData.set('confirmRetire', '1');
    formData.set('expectedRevision', expectedRevision);
    retire.submit(formData, event.currentTarget);
  };

  // The row this page is about no longer exists once this succeeds --
  // navigate away rather than let a refresh land on the detail page's own
  // 404, per §18: no stale detail page remains misleading.
  useEffect(() => {
    if (retire.state.ok) router.push('/admin/draft');
  }, [retire.state.ok, router]);

  if (retire.state.ok) {
    return (
      <section className="section">
        <p className="notice" role="status">{retire.state.message} Returning to the draft list…</p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Retire this selection</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        This permanently deletes the selection row. It should be used only for a manual selection
        that should never have existed — a duplicate entry, or a mistake. To replace a manual
        selection with a source-owned one that has since been published, use "Supersede" instead,
        which retires this row and links the source selection in one step.
      </p>
      {!confirming ? (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Retire this selection…
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '26rem' }}>
          <p role="alert" className="notice">
            This cannot be undone from this page. The selection will be permanently deleted.
          </p>
          {retire.state.error && <p className="notice" role="alert">{retire.state.error}</p>}
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button type="button" className="btn btn-primary" onClick={handleRetire} disabled={retire.isPending}>
              {retire.isPending ? 'Retiring…' : 'Confirm retirement'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={retire.isPending}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
