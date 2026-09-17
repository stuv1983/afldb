'use client';

import { useRef, useState } from 'react';

import { adoptLegacyPickAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

type EventPair = { draftType: string; draftKind: string };

/**
 * Adopt a pre-ISSUE-160 admin row (`source_id IS NULL`) into the durable,
 * replayable, promotable manual contract (§6.8, D-7). The legacy row already
 * carries a `draft_type` but never a `draft_kind` (069): the admin supplies
 * the `(draft_type, draft_kind)` pair from the frozen enumeration, and the
 * action derives nothing.
 */
export function AdoptPanel({
  pickId,
  eventPairs,
  defaultDraftType,
}: {
  pickId: number;
  eventPairs: readonly EventPair[];
  defaultDraftType: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const adopt = useDraftActionSubmit(adoptLegacyPickAction);
  const [confirmed, setConfirmed] = useState(false);

  const matching = eventPairs.filter((p) => p.draftType === defaultDraftType);
  const initial = matching[0] ?? eventPairs[0];

  const handleAdopt = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set('pickId', String(pickId));
    if (confirmed) formData.set('confirmed', '1');
    adopt.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Adopt this selection</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        This selection carries no provenance: it predates AFLDB-ISSUE-160 and cannot survive a
        source reload or a database promotion as it stands. Adopting it gives it a durable manual
        identity (and, if the linked player has no durable identity of their own, gives the player
        one too, in the same step) — making both replay- and promotion-safe.
      </p>
      <form ref={formRef} onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: '0.6rem', maxWidth: '26rem' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Draft event
          <select name="eventPair" defaultValue={initial ? `${initial.draftType}|${initial.draftKind}` : ''} disabled={adopt.isPending}>
            {eventPairs.map((p) => (
              <option key={`${p.draftType}|${p.draftKind}`} value={`${p.draftType}|${p.draftKind}`}>
                {p.draftType} ({p.draftKind})
              </option>
            ))}
          </select>
        </label>

        {adopt.state.needsConfirmation && (
          <div className="notice" role="alert">
            <p style={{ margin: '0 0 0.4rem' }}>{adopt.state.error}</p>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              Confirm and adopt anyway.
            </label>
          </div>
        )}
        {!adopt.state.needsConfirmation && adopt.state.error && <p className="notice" role="alert">{adopt.state.error}</p>}
        {adopt.state.ok && adopt.state.message && <p className="notice" role="status">{adopt.state.message}</p>}

        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleAdopt}
            disabled={adopt.isPending || (adopt.state.needsConfirmation === true && !confirmed)}
          >
            {adopt.isPending ? 'Adopting…' : 'Adopt this selection'}
          </button>
        </div>
      </form>
    </section>
  );
}
