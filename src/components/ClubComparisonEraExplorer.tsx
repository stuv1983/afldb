import Link from 'next/link';

import type { H2HDecade } from '@/db/queries/club-comparison';
import type { ComparisonEffectiveParams } from '@/app/clubs/compare/state';
import { decadeLabel } from '@/lib/club-comparison-format';
import { clubComparePath } from '@/lib/club-comparison-url';
import { formatNumber } from '@/lib/format';

/**
 * The era explorer (Club Rivalry Explorer follow-up, FR-2): a chip for
 * every decade this pair has actually met in, plus "All time".
 *
 * Eras are DISCOVERED from the pair's own decade population
 * (`getHeadToHeadByDecade`) and nothing else -- never a fixed decade
 * list, so a pair that has only ever met since 2000 offers no 1990s chip,
 * and a pair spanning the 1900s offers one without this file naming it.
 *
 * Choosing an era narrows rivalry records and the match history below it
 * on the page; it deliberately does not touch the hero summary, streaks,
 * venues, players or Brownlow sections, which stay all-time regardless
 * (approved design contract). Selecting a chip drops any page number, the
 * same way changing the match-type filter does -- a new era is a new
 * population, so paging resets to its first page.
 */
export function ClubComparisonEraExplorer({
  decades,
  params,
}: {
  decades: H2HDecade[];
  params: ComparisonEffectiveParams;
}) {
  if (decades.length === 0) return null;

  const hrefFor = (era: number | null) => clubComparePath({
    club1: params.club1,
    club2: params.club2,
    matchType: params.matchType,
    era,
  });

  return (
    <nav className="sort-nav" aria-label="Filter rivalry records and match history by era">
      <span className="sort-label">Era</span>
      {/* prefetch={false} on every chip: see the same note in
          ClubComparisonControls.tsx (Swap/Reset) — sibling-link prefetch on
          this dynamic segment can leak a different chip's cached <head> into
          whichever one is actually clicked (AFLDB-ISSUE-144). */}
      <Link
        href={hrefFor(null)}
        className="sort-link"
        aria-current={params.era === null ? 'true' : undefined}
        prefetch={false}
      >
        All time
      </Link>
      {decades.map((decade) => (
        <Link
          key={decade.decade}
          href={hrefFor(decade.decade)}
          className="sort-link"
          aria-current={params.era === decade.decade ? 'true' : undefined}
          prefetch={false}
        >
          {decadeLabel(decade.decade)}{' '}
          <span className="meta">({formatNumber(decade.meetings)})</span>
        </Link>
      ))}
    </nav>
  );
}
