'use client';

import { useState } from 'react';

import { rescheduleFixtureAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';

/**
 * Date/time edit (AFLDB-ISSUE-162 §15). The fixture's identity
 * (`fixture_key`) never moves — this is an ordinary UPDATE under CAS.
 * Refused `played_locked` server-side once the fixture is played; this panel
 * is not rendered at all in that state (§28's played-state UX).
 */
export function ReschedulePanel({
  fixtureKey, matchDate, matchTime, expectedUpdatedAt,
}: {
  fixtureKey: string;
  matchDate: string | null;
  matchTime: string | null;
  expectedUpdatedAt: string;
}) {
  const reschedule = useFixtureActionSubmit(rescheduleFixtureAction, {});
  const [date, setDate] = useState(matchDate ?? '');
  const [time, setTime] = useState(matchTime ?? '');

  /**
   * Clearing the date clears the time with it. A time with no date is refused
   * server-side -- "7:20pm on a day nobody has announced" is two halves of one
   * fact (§10) -- and the time input is disabled while the date is blank, so
   * without this the operator would be refused on account of a value they
   * could no longer see or edit. Blanking the date is how a date is returned
   * to TBC, and TBC date means TBC time.
   */
  const handleDateChange = (value: string) => {
    setDate(value);
    if (value === '') setTime('');
  };

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('matchDate', date);
    formData.set('matchTime', time);
    reschedule.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Reschedule</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', maxWidth: '24rem' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
          Date (blank = TBC)
          <input type="date" value={date} onChange={(event) => handleDateChange(event.target.value)} disabled={reschedule.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
          Local start time {date ? '(blank = TBC)' : '(needs a date first)'}
          <input type="text" placeholder="19:40" value={time} onChange={(event) => setTime(event.target.value)} disabled={reschedule.isPending || !date} />
        </label>
      </div>
      {reschedule.state.error && <p className="notice" role="alert">{reschedule.state.error}</p>}
      {reschedule.state.ok && <p className="notice" role="status">{reschedule.state.message}</p>}
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={reschedule.isPending}>
          {reschedule.isPending ? 'Saving…' : 'Save schedule'}
        </button>
      </div>
    </section>
  );
}
