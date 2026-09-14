import Link from 'next/link';

import { COACH_COMPARE_PATH } from '@/lib/coach-comparison-url';
import type { CoachCompareEffectiveParams, CoachCompareOptions } from '@/app/coaches/compare/state';

/**
 * The comparison selectors for /coaches/compare (AFLDB-ISSUE-170 Stage 2A),
 * following `ClubComparisonControls`'s convention.
 *
 * A plain GET form: there is no hidden client state on this surface, so a
 * reader can bookmark, share or reload anything they can see. Both lists
 * offer the full canonical coach population (Stage 0 §0.2's 386, not just
 * the 18 coach-only profiles) -- the second is deliberately NOT filtered to
 * exclude the first, the same reasoning `ClubComparisonControls` uses:
 * silently removing a choice is worse than the route saying "choose two
 * different coaches".
 *
 * `options.coaches` comes from `getCoachOptions()` -- a plain `<select>` is
 * enough here (unlike `PlayerPicker`'s autocomplete, built for ~13,000
 * players): 386 coaches is a small, already-labelled list, so no new API
 * route is needed.
 */
export function CoachComparisonControls({
  params,
  options,
  swapPath,
}: {
  params: CoachCompareEffectiveParams;
  options: CoachCompareOptions;
  /** Present only for a resolved pair; a swap of nothing is not a control. */
  swapPath?: string;
}) {
  const coachOptions = (
    <>
      <option value="">Choose a coach…</option>
      {options.coaches.map((c) => (
        <option key={c.id} value={c.id}>{c.name}</option>
      ))}
    </>
  );

  return (
    <form className="section" method="get" action={COACH_COMPARE_PATH}>
      <fieldset className="filter-group">
        <legend>Choose two coaches</legend>
        <div className="filter-grid">
          <div>
            <label htmlFor="coach-compare-a">First coach</label>
            <select id="coach-compare-a" name="a" defaultValue={params.a ?? ''}>
              {coachOptions}
            </select>
          </div>
          <div>
            <label htmlFor="coach-compare-b">Second coach</label>
            <select id="coach-compare-b" name="b" defaultValue={params.b ?? ''}>
              {coachOptions}
            </select>
          </div>
        </div>
        <p className="filter-help">
          Every listed coach can be compared, whether their canonical page is a standalone
          coach profile or a player profile.
        </p>
        <div className="filter-actions">
          <button className="btn" type="submit">Compare coaches</button>
          {swapPath && (
            <Link className="btn btn-secondary" href={swapPath} prefetch={false}>
              Swap the order of the two coaches
            </Link>
          )}
          <Link className="btn btn-secondary" href={COACH_COMPARE_PATH} prefetch={false}>Reset</Link>
        </div>
      </fieldset>
    </form>
  );
}
