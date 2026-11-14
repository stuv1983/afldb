import { ClubComparisonControls } from '@/components/ClubComparisonControls';

import type { ClubComparisonRouteState } from './state';

/**
 * The "busy" state of /clubs/compare (review B-06). A valid pair whose load was
 * refused by the pair gate (queue full or wait timed out): nothing was queried
 * for it, and nothing about the pair is claimed. It is not an error page, so it
 * is not a 500, and it is never offered to an index: the `robots` meta below is
 * hoisted into the document head by React, the same way `generateMetadata`'s
 * own tags are. It is NOT the only robots tag: the measured document carries two,
 * the root layout's `index, follow` and this `noindex, nofollow`, and the most
 * restrictive directive applies (run-2 review LOW-4). Next cannot set a 503 from a
 * page, so the status is 200 on a `force-dynamic` (never cached) route.
 */
export function ClubCompareBusy({ state }: { state: Extract<ClubComparisonRouteState, { kind: 'busy' }> }) {
  return (
    <>
      <meta name="robots" content="noindex, nofollow" />
      <div className="page-header">
        <p className="eyebrow">Clubs</p>
        <h1>Compare clubs</h1>
        <p className="lede">
          Compare any two VFL/AFL clubs: their complete all-time head-to-head history, the
          rivalry’s records, and the players who have represented both.
        </p>
      </div>

      <ClubComparisonControls params={state.params} options={state.options} />

      <div className="empty" role="status">
        <h2>Comparisons are busy right now</h2>
        <p>
          Many comparisons are loading at the moment, so this one was not started. Nothing is wrong
          with the clubs you chose. <a href={state.sharePath}>Try again</a> in a few seconds.
        </p>
      </div>
    </>
  );
}
