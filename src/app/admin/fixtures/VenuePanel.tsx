'use client';

import { useState } from 'react';

import { changeFixtureVenueAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';

const OTHER_VENUE = 'other';

/**
 * Venue edit (AFLDB-ISSUE-162 §11, §15). Existing venue, a typed
 * name-not-in-the-register, or TBC — never inline venue creation. If the
 * operator needs a genuinely new canonical venue, that is venue
 * administration, a separate surface (§31).
 */
export function VenuePanel({
  fixtureKey, venueId, venueRaw, venues, expectedUpdatedAt,
}: {
  fixtureKey: string;
  venueId: number | null;
  venueRaw: string | null;
  venues: { id: number; canonicalName: string }[];
  expectedUpdatedAt: string;
}) {
  const change = useFixtureActionSubmit(changeFixtureVenueAction, {});
  const initialSelect = venueId !== null ? String(venueId) : venueRaw !== null ? OTHER_VENUE : '';
  const [select, setSelect] = useState(initialSelect);
  const [raw, setRaw] = useState(venueId === null ? venueRaw ?? '' : '');

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('venueId', select);
    formData.set('venueRaw', select === OTHER_VENUE ? raw : '');
    change.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Venue</h2>
      <div style={{ display: 'grid', gap: '0.4rem', maxWidth: '24rem' }}>
        <select value={select} onChange={(event) => setSelect(event.target.value)} disabled={change.isPending}>
          <option value="">TBC</option>
          {venues.map((v) => <option key={v.id} value={v.id}>{v.canonicalName}</option>)}
          <option value={OTHER_VENUE}>Named venue not in the register…</option>
        </select>
        {select === OTHER_VENUE && (
          <input type="text" placeholder="Venue name" value={raw} onChange={(event) => setRaw(event.target.value)} disabled={change.isPending} maxLength={200} />
        )}
      </div>
      {change.state.error && <p className="notice" role="alert">{change.state.error}</p>}
      {change.state.ok && <p className="notice" role="status">{change.state.message}</p>}
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Save venue'}
        </button>
      </div>
    </section>
  );
}
