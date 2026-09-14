'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

import type { ComparisonOrganization } from '@/db/queries/club-comparison';

/**
 * The standalone coach page's Stage 1C selector (AFLDB-ISSUE-170 Stage
 * 1D), converted to client-side navigation (AFLDB-ISSUE-172): a plain GET
 * `<form>` submission is a full browser navigation, which reloaded the
 * whole page and threw the reader back to the top on every opponent
 * change. `/coaches/[slug]` is `dynamic = 'force-dynamic'`, so
 * `router.push(..., { scroll: false })` re-renders the same server
 * component with the new `?opponent=` value — `resolveCoachOpponentSelection`
 * still runs server-side, per request, exactly as before. No client fetch
 * or API route is introduced; this mirrors `CoachOpponentHistoryClient`'s
 * `onChange` (the player-linked coaching surface's equivalent selector),
 * minus that component's own client fetch, which exists only because
 * `/players/[slug]` is static ISR and this route is not.
 *
 * The one thing this deliberately gives up is the previous no-JavaScript
 * form submission — a known, accepted trade-off for fixing the reload/
 * scroll-to-top regression, recorded in `AFLDB-ISSUE-172`.
 */
export function CoachOpponentSelector({
  organizations,
  selected,
  basePath,
}: {
  organizations: ComparisonOrganization[];
  selected: string | undefined;
  basePath: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const current = organizations.filter((o) => o.isActive);
  const former = organizations.filter((o) => !o.isActive);

  function onChange(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set('opponent', slug);
    else params.delete('opponent');
    const query = params.toString();
    router.push(query ? `${basePath}?${query}` : basePath, { scroll: false });
  }

  return (
    <div className="section">
      <fieldset className="filter-group">
        <legend>Choose an opponent</legend>
        <div className="filter-grid">
          <div>
            <label htmlFor="coach-opponent">Opponent club</label>
            <select
              id="coach-opponent"
              name="opponent"
              value={selected ?? ''}
              onChange={(e) => onChange(e.target.value)}
            >
              <option value="">Choose an opponent…</option>
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
            </select>
          </div>
        </div>
        {selected && (
          <div className="filter-actions">
            <Link className="btn btn-secondary" href={basePath} prefetch={false} scroll={false}>Clear</Link>
          </div>
        )}
      </fieldset>
    </div>
  );
}
