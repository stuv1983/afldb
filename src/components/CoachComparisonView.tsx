import Link from 'next/link';

import { CoachComparisonControls } from '@/components/CoachComparisonControls';
import type { CoachCompareRouteState } from '@/app/coaches/compare/state';

/**
 * The public presentation of /coaches/compare (AFLDB-ISSUE-170 Stage 2A),
 * following `ClubComparisonView`'s convention.
 *
 * It renders the discriminated route state the resolver already decided
 * and does nothing else: no search parameter is re-parsed here, no query
 * is run here, and no identity/routing rule is decided here. Every one of
 * the four states -- unselected, invalid, same coach and selected -- has a
 * usable page.
 *
 * Stage 2A deliberately renders only the comparison shell: the selected
 * state shows each coach's identity and their canonical public link
 * (player page for a player-linked coach, coach page for a coach-only
 * identity), never career, venue, opponent or head-to-head data -- that is
 * Stage 2B/2C/2D.
 */
export function CoachComparisonView({ state }: { state: CoachCompareRouteState }) {
  return (
    <>
      <div className="page-header">
        <p className="eyebrow">Coaches</p>
        <h1>
          {state.kind === 'selected'
            ? `${state.coachA.coach.displayName} v ${state.coachB.coach.displayName}`
            : 'Compare coaches'}
        </h1>
        <p className="lede">
          Compare any two VFL/AFL coaches — coach-only or player-linked — side by side.
        </p>
      </div>

      <CoachComparisonControls
        params={state.params}
        options={state.options}
        swapPath={state.kind === 'selected' ? state.swapPath : undefined}
      />

      {state.kind === 'unselected' && (
        <div className="empty">
          <h2>Choose two coaches</h2>
          <p>
            Pick a coach in each list above and compare them. Nothing is chosen for you, and
            every comparison you reach has its own shareable address.
          </p>
        </div>
      )}

      {state.kind === 'invalid' && (
        <div className="empty">
          <h2>That coach could not be found</h2>
          <p>
            {state.invalidRaw.length === 1
              ? `“${state.invalidRaw[0]}” is not a coach on record.`
              : `“${state.invalidRaw.join('” and “')}” are not coaches on record.`}{' '}
            Choose from the lists above.
          </p>
        </div>
      )}

      {state.kind === 'same-coach' && (
        <div className="empty">
          <h2>Choose two different coaches</h2>
          <p>
            {state.coach.coach.displayName} cannot be compared with themself. Choose a second,
            different coach above.
          </p>
        </div>
      )}

      {state.kind === 'selected' && (
        <div className="section">
          <div className="stat-strip">
            {[state.coachA, state.coachB].map(({ coach, profilePath }) => (
              <div className="stat" key={coach.id}>
                <div className="value">
                  <Link href={profilePath}>{coach.displayName}</Link>
                </div>
                <div className="label">
                  {coach.playerId !== null ? 'Player-linked coach' : 'Coach-only profile'}
                </div>
              </div>
            ))}
          </div>
          <p className="muted">
            Career, venue and head-to-head comparison for these two coaches is coming in a
            later stage.
          </p>
        </div>
      )}
    </>
  );
}
