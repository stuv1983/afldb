'use client';

import { useState } from 'react';

import { changeFixtureRoundAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';
import { MAX_HOME_AND_AWAY_ROUND, type FixtureRoundType } from '@/lib/fixtures/spec';

/**
 * Round change (AFLDB-ISSUE-162 §15). Moving round re-runs the §13
 * duplicate/collision/already-played checks for the NEW round — the server
 * names the collision if one exists; nothing is guessed client-side.
 */
export function RoundPanel({
  fixtureKey, roundType, roundNumber, expectedUpdatedAt,
}: {
  fixtureKey: string;
  roundType: FixtureRoundType;
  roundNumber: number | null;
  expectedUpdatedAt: string;
}) {
  const change = useFixtureActionSubmit(changeFixtureRoundAction, {});
  const [type, setType] = useState<FixtureRoundType>(roundType);
  const [number, setNumber] = useState(roundNumber !== null ? String(roundNumber) : '1');

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('roundType', type);
    if (type === 'home_and_away') formData.set('roundNumber', number);
    change.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Round</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.6rem', maxWidth: '24rem' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Round type
          <select value={type} onChange={(event) => setType(event.target.value as FixtureRoundType)} disabled={change.isPending}>
            <option value="home_and_away">Home and away</option>
            <option value="wildcard_final">Wildcard Final</option>
            <option value="elimination_final">Elimination Final</option>
            <option value="qualifying_final">Qualifying Final</option>
            <option value="semi_final">Semi Final</option>
            <option value="preliminary_final">Preliminary Final</option>
            <option value="grand_final">Grand Final</option>
          </select>
        </label>
        {type === 'home_and_away' && (
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
            Round number
            <input type="number" min={1} max={MAX_HOME_AND_AWAY_ROUND} value={number} onChange={(event) => setNumber(event.target.value)} disabled={change.isPending} />
          </label>
        )}
      </div>
      {change.state.error && <p className="notice" role="alert">{change.state.error}</p>}
      {change.state.ok && <p className="notice" role="status">{change.state.message}</p>}
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={change.isPending}>
          {change.isPending ? 'Saving…' : 'Save round'}
        </button>
      </div>
    </section>
  );
}
