'use client';

import { useRef, useState } from 'react';

import { createFixtureAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';
import { MAX_HOME_AND_AWAY_ROUND, type FixtureRoundType } from '@/lib/fixtures/spec';

const OTHER_VENUE = 'other';

/**
 * Single-fixture entry (AFLDB-ISSUE-162 §13, §28). The round-at-a-time batch
 * form below is the same shape with N=1; this is the fast path for one game.
 *
 * Clubs and venues are `<select>`s sourced only from the eligible-club list
 * and the venue register (§12, §11) — the server never receives a free-text
 * identity for either. Home/away equality is prevented client-side for
 * convenience only; the server remains authoritative (§13).
 */
export function SingleFixtureForm({
  season, clubs, venues,
}: {
  season: number;
  clubs: { id: number; name: string }[];
  venues: { id: number; canonicalName: string }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const create = useFixtureActionSubmit(createFixtureAction, {});
  const [roundType, setRoundType] = useState<FixtureRoundType>('home_and_away');
  const [roundNumber, setRoundNumber] = useState('1');
  const [homeClubId, setHomeClubId] = useState('');
  const [awayClubId, setAwayClubId] = useState('');
  const [venueSelect, setVenueSelect] = useState('');
  const [matchDate, setMatchDate] = useState('');
  // Controlled, so that clearing the date can clear the time it qualified.
  // An uncontrolled time input keeps showing a value the disabled control can
  // no longer be used to correct, and the row is stored as TBC/TBC regardless
  // — what is shown has to be what is sent. Same rule as `updateRow()` in
  // RoundBatchForm.
  const [matchTime, setMatchTime] = useState('');

  const sameClub = homeClubId !== '' && homeClubId === awayClubId;

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!formRef.current || sameClub) return;
    const formData = new FormData(formRef.current);
    formData.set('season', String(season));
    create.submit(formData, event.currentTarget);
  };

  if (create.state.ok) {
    return (
      <section className="section">
        <p className="notice" role="status">{create.state.message}</p>
      </section>
    );
  }

  return (
    <section className="section">
      <form ref={formRef} onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: '0.6rem', maxWidth: '32rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Round type
            <select
              name="roundType"
              value={roundType}
              onChange={(event) => setRoundType(event.target.value as FixtureRoundType)}
              disabled={create.isPending}
            >
              <option value="home_and_away">Home and away</option>
              <option value="wildcard_final">Wildcard Final</option>
              <option value="elimination_final">Elimination Final</option>
              <option value="qualifying_final">Qualifying Final</option>
              <option value="semi_final">Semi Final</option>
              <option value="preliminary_final">Preliminary Final</option>
              <option value="grand_final">Grand Final</option>
            </select>
          </label>
          {roundType === 'home_and_away' && (
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
              Round number{season >= 2024 ? ' (Opening Round = 1)' : ''}
              <input
                type="number" name="roundNumber" min={1} max={MAX_HOME_AND_AWAY_ROUND}
                value={roundNumber} onChange={(event) => setRoundNumber(event.target.value)}
                disabled={create.isPending}
              />
            </label>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Home club
            <select name="homeClubId" value={homeClubId} onChange={(event) => setHomeClubId(event.target.value)} disabled={create.isPending}>
              <option value="">— select —</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Away club
            <select name="awayClubId" value={awayClubId} onChange={(event) => setAwayClubId(event.target.value)} disabled={create.isPending}>
              <option value="">— select —</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>
        {sameClub && <p className="notice" role="alert">A fixture needs two different clubs.</p>}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem' }}>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Date (leave blank for TBC)
            <input
              type="date"
              name="matchDate"
              value={matchDate}
              onChange={(event) => {
                setMatchDate(event.target.value);
                if (event.target.value === '') setMatchTime('');
              }}
              disabled={create.isPending}
            />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Local start time (HH:MM, leave blank for TBC)
            <input
              type="text"
              name="matchTime"
              placeholder="19:40"
              pattern="[0-9]{2}:[0-9]{2}"
              value={matchTime}
              onChange={(event) => setMatchTime(event.target.value)}
              disabled={create.isPending || !matchDate}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Venue
          <select name="venueId" value={venueSelect} onChange={(event) => setVenueSelect(event.target.value)} disabled={create.isPending}>
            <option value="">TBC</option>
            {venues.map((v) => <option key={v.id} value={v.id}>{v.canonicalName}</option>)}
            <option value={OTHER_VENUE}>Named venue not in the register…</option>
          </select>
        </label>
        {venueSelect === OTHER_VENUE && (
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Venue name (unmapped — no venue is created here)
            <input type="text" name="venueRaw" maxLength={200} disabled={create.isPending} />
          </label>
        )}

        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Notes
          <textarea name="notes" maxLength={2000} rows={2} disabled={create.isPending} />
        </label>

        {create.state.error && <p className="notice" role="alert">{create.state.error}</p>}

        <div>
          <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={create.isPending || sameClub}>
            {create.isPending ? 'Creating…' : 'Create fixture'}
          </button>
        </div>
      </form>
    </section>
  );
}
