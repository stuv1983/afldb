'use client';

import { useState } from 'react';

import { changeFixtureClubsAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';

/**
 * Swap home/away or replace a club (AFLDB-ISSUE-162 §15). One primitive for
 * both, matching the backend: both are the same edit to the same two
 * columns and both re-run the §13 eligibility and collision checks against
 * the new pair.
 */
export function ClubsPanel({
  fixtureKey, homeClubId, homeClubName, awayClubId, awayClubName, clubs, expectedUpdatedAt,
}: {
  fixtureKey: string;
  homeClubId: number;
  homeClubName: string;
  awayClubId: number;
  awayClubName: string;
  clubs: { id: number; name: string }[];
  expectedUpdatedAt: string;
}) {
  const change = useFixtureActionSubmit(changeFixtureClubsAction, {});
  const [home, setHome] = useState(String(homeClubId));
  const [away, setAway] = useState(String(awayClubId));
  const sameClub = home !== '' && home === away;

  // The option list is the season's ELIGIBLE clubs (§12), which is not
  // guaranteed to contain this fixture's current pair: `clubs.json` can change
  // between the day a fixture was entered and the day it is edited. A `<select>`
  // whose `value` matches no option renders as its FIRST option, so the panel
  // would silently show a club the fixture does not name and save that club on
  // the next submit. The current pair is therefore always present, marked as
  // no-longer-eligible; the server still refuses it if it is chosen (the
  // `club_ineligible` precheck), so this reveals the state rather than widening
  // what may be written.
  const eligibleIds = new Set(clubs.map((c) => c.id));
  const options = [
    ...clubs.map((c) => ({ ...c, eligible: true })),
    ...[{ id: homeClubId, name: homeClubName }, { id: awayClubId, name: awayClubName }]
      .filter((c) => !eligibleIds.has(c.id))
      .map((c) => ({ ...c, eligible: false })),
  ];

  const handleSwap = () => {
    setHome(away);
    setAway(home);
  };

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (sameClub) return;
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('homeClubId', home);
    formData.set('awayClubId', away);
    change.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Clubs</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '0.6rem', maxWidth: '28rem', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
          Home
          <select value={home} onChange={(event) => setHome(event.target.value)} disabled={change.isPending}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>{c.eligible ? c.name : `${c.name} (no longer eligible)`}</option>
            ))}
          </select>
        </label>
        <button type="button" className="btn btn-secondary" onClick={handleSwap} disabled={change.isPending} title="Swap home and away" aria-label="Swap home and away">
          ⇄
        </button>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', minWidth: 0 }}>
          Away
          <select value={away} onChange={(event) => setAway(event.target.value)} disabled={change.isPending}>
            {options.map((c) => (
              <option key={c.id} value={c.id}>{c.eligible ? c.name : `${c.name} (no longer eligible)`}</option>
            ))}
          </select>
        </label>
      </div>
      {sameClub && <p className="notice" role="alert">A fixture needs two different clubs.</p>}
      {change.state.error && <p className="notice" role="alert">{change.state.error}</p>}
      {change.state.ok && <p className="notice" role="status">{change.state.message}</p>}
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={change.isPending || sameClub}>
          {change.isPending ? 'Saving…' : 'Save clubs'}
        </button>
      </div>
    </section>
  );
}
