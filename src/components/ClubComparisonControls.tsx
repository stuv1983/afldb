import Link from 'next/link';

import { CLUB_COMPARE_PATH } from '@/lib/club-comparison-url';
import type { ComparisonEffectiveParams, ComparisonOptions } from '@/app/clubs/compare/state';

/**
 * The comparison selectors (AFLDB-ISSUE-144 Stage 8).
 *
 * A plain GET form, which is what keeps this a Server Component and
 * every view a shareable URL: there is no hidden client state on this
 * surface, so a reader can bookmark, share or reload anything they can
 * see. Submitting drops `page`, which is correct — changing the pair or
 * the filter starts the history at its first page.
 *
 * Both club lists offer every organisation. The second is deliberately
 * NOT filtered to exclude the first: silently removing or switching a
 * club is a worse answer than letting the route say "Choose two
 * different clubs", and a reader who wants to change only the first club
 * would otherwise find their second choice gone.
 *
 * Options come from `state.options`, which the route reads from
 * canonical rows on every request. No club is named here. The
 * comparison itself is all-time only (Club Rivalry Explorer follow-up,
 * FR-1); there is no season field. The match-type field lived here
 * temporarily after FR-1 and has been relocated into Match History's own
 * local form (FR-3) — it only ever filters that section, so it now lives
 * with the section it filters.
 */
export function ClubComparisonControls({
  params,
  options,
  swapPath,
}: {
  params: ComparisonEffectiveParams;
  options: ComparisonOptions;
  /** Present only for a resolved pair; a swap of nothing is not a control. */
  swapPath?: string;
}) {
  const current = options.organizations.filter((o) => o.isActive);
  const former = options.organizations.filter((o) => !o.isActive);

  const clubOptions = (
    <>
      <option value="">Choose a club…</option>
      {current.length > 0 && (
        <optgroup label="Current clubs">
          {current.map((o) => <option key={o.id} value={o.slug}>{o.name}</option>)}
        </optgroup>
      )}
      {former.length > 0 && (
        <optgroup label="Former clubs">
          {former.map((o) => <option key={o.id} value={o.slug}>{o.name}</option>)}
        </optgroup>
      )}
    </>
  );

  return (
    <form className="section" method="get" action={CLUB_COMPARE_PATH}>
      <fieldset className="filter-group">
        <legend>Choose two clubs</legend>
        <div className="filter-grid">
          <div>
            <label htmlFor="club-compare-club1">First club</label>
            <select id="club-compare-club1" name="club1" defaultValue={params.club1 ?? ''}>
              {clubOptions}
            </select>
          </div>
          <div>
            <label htmlFor="club-compare-club2">Second club</label>
            <select id="club-compare-club2" name="club2" defaultValue={params.club2 ?? ''}>
              {clubOptions}
            </select>
          </div>
        </div>
        <p className="filter-help">
          Choose two different clubs. A club’s earlier names — Footscray, South Melbourne,
          Kangaroos — are part of the same club here, so they are not separate choices.
        </p>
        <div className="filter-actions">
          <button className="btn" type="submit">Compare clubs</button>
          {swapPath && (
            <Link className="btn btn-secondary" href={swapPath}>
              Swap the order of the two clubs
            </Link>
          )}
          <Link className="btn btn-secondary" href={CLUB_COMPARE_PATH}>Reset</Link>
        </div>
      </fieldset>
    </form>
  );
}
