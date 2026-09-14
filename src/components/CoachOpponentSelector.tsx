import Link from 'next/link';

import type { ComparisonOrganization } from '@/db/queries/club-comparison';

/**
 * The standalone coach page's Stage 1C selector (AFLDB-ISSUE-170 Stage
 * 1D): a plain GET form, following {@link ClubComparisonControls}'s own
 * convention — no hidden client state, so the selection is exactly what
 * the URL says, works with no JavaScript, and is bookmarkable/shareable
 * by construction. `/coaches/[slug]` has no ISR cost to protect (18
 * coach-only identities), unlike `/players/[slug]` — see
 * `CoachOpponentHistoryClient` for the player-linked surface's different,
 * deliberately scoped, client-side equivalent.
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
  const current = organizations.filter((o) => o.isActive);
  const former = organizations.filter((o) => !o.isActive);

  return (
    <form className="section" method="get" action={basePath}>
      <fieldset className="filter-group">
        <legend>Choose an opponent</legend>
        <div className="filter-grid">
          <div>
            <label htmlFor="coach-opponent">Opponent club</label>
            <select id="coach-opponent" name="opponent" defaultValue={selected ?? ''}>
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
        <div className="filter-actions">
          <button className="btn" type="submit">Show record</button>
          {selected && (
            <Link className="btn btn-secondary" href={basePath} prefetch={false}>Clear</Link>
          )}
        </div>
      </fieldset>
    </form>
  );
}
