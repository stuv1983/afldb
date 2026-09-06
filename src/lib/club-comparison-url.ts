/**
 * URL and query-state helpers for /clubs/compare (AFLDB-ISSUE-144 Stage 7;
 * `season` removed by the Club Rivalry Explorer follow-up, FR-1 — the
 * comparison is all-time only; `era` added by FR-2 to narrow rivalry
 * records and the match history to one decade).
 *
 * Deliberately pure and database-free: every rule here is about what a
 * URL means, so it is testable without a database and reusable by both
 * the route and the presentation stage.
 *
 * Two different URLs matter on this surface and they must not be
 * confused:
 *
 *  - The CURRENT SHAREABLE URL carries everything the reader chose:
 *    the pair in the order they asked for it, the match filter and the
 *    page. `clubComparePath` builds it.
 *  - The SEO CANONICAL URL carries the pair only, alphabetically
 *    ordered, with no filter or page. `canonicalClubComparePath` builds
 *    it, and it is only ever used in metadata.
 *
 * A request is never redirected from the first to the second: folding
 * every view onto one canonical URL is a metadata statement, not a
 * navigation one.
 */
import type { MatchType } from '@/db/queries/club-comparison';

export const CLUB_COMPARE_PATH = '/clubs/compare';

export const MATCH_TYPES: readonly MatchType[] = ['all', 'home-and-away', 'finals'];

export const DEFAULT_MATCH_TYPE: MatchType = 'all';

/** Everything the compare surface keeps in the URL. */
export type ComparisonUrlParams = {
  club1?: string | null;
  club2?: string | null;
  matchType?: MatchType | null;
  /** A decade's first season (1990 for the 1990s), or absent/null for all time. */
  era?: number | null;
  page?: number | null;
};

export function isMatchType(value: string | undefined): value is MatchType {
  return value !== undefined && (MATCH_TYPES as readonly string[]).includes(value);
}

/**
 * The pair, alphabetically ordered. Ordering slugs rather than names
 * keeps the canonical URL stable if a club is ever renamed, and the
 * slug charset is `[a-z0-9-]`, so the default lexicographic sort is
 * locale-independent.
 */
export function canonicalPairOrder(slugA: string, slugB: string): [string, string] {
  return slugA <= slugB ? [slugA, slugB] : [slugB, slugA];
}

/**
 * The current shareable URL. Defaults are omitted rather than spelled
 * out, so the plain pair URL stays the short one people actually share.
 */
export function clubComparePath(params: ComparisonUrlParams): string {
  const query = new URLSearchParams();
  if (params.club1) query.set('club1', params.club1);
  if (params.club2) query.set('club2', params.club2);
  if (params.matchType && params.matchType !== DEFAULT_MATCH_TYPE) {
    query.set('matchType', params.matchType);
  }
  if (params.era !== undefined && params.era !== null) {
    query.set('era', String(params.era));
  }
  if (params.page !== undefined && params.page !== null && params.page > 1) {
    query.set('page', String(params.page));
  }
  const qs = query.toString();
  return qs ? `${CLUB_COMPARE_PATH}?${qs}` : CLUB_COMPARE_PATH;
}

/**
 * The SEO canonical URL for a pair: ordered slugs only. An incomplete
 * pair canonicalises to the bare surface, never to a guessed pair.
 */
export function canonicalClubComparePath(
  slugA: string | null | undefined,
  slugB: string | null | undefined,
): string {
  if (!slugA || !slugB) return CLUB_COMPARE_PATH;
  const [lower, higher] = canonicalPairOrder(slugA, slugB);
  return clubComparePath({ club1: lower, club2: higher });
}

/**
 * The same view with the two clubs the other way round. The match
 * filter and page survive untouched: swapping is a presentation
 * reversal, and it must not move the reader or change the population
 * being described.
 */
export function swapClubComparePath(params: ComparisonUrlParams): string {
  return clubComparePath({ ...params, club1: params.club2, club2: params.club1 });
}

/**
 * The pagination component builds hrefs from a raw parameter record, so
 * hand it exactly the state this surface keeps, minus the page itself.
 * `era` (FR-2) is included: paging through an era-filtered match history
 * must keep filtering by that era, exactly as it keeps the match type.
 */
export function clubCompareBaseParams(
  params: ComparisonUrlParams,
): Record<string, string | undefined> {
  return {
    club1: params.club1 ?? undefined,
    club2: params.club2 ?? undefined,
    matchType: params.matchType && params.matchType !== DEFAULT_MATCH_TYPE
      ? params.matchType
      : undefined,
    era: params.era !== undefined && params.era !== null ? String(params.era) : undefined,
  };
}
