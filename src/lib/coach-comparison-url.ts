/**
 * URL and query-state helpers for /coaches/compare (AFLDB-ISSUE-170 Stage 2A).
 *
 * Deliberately pure and database-free, mirroring `@/lib/club-comparison-url`:
 * every rule here is about what a URL means, so it is testable without a
 * database and reusable by both the route and the presentation stage.
 *
 * Identity is `coaches.id`, not a slug (Stage 2A's identity rule -- two
 * coaches can share a display name, so only the id is unambiguous), the
 * same convention `/players/compare` already uses for its `a`/`b` params.
 *
 * Two different URLs matter here and must not be confused, exactly as on
 * `/clubs/compare`:
 *
 *  - The CURRENT SHAREABLE URL carries the pair in the order the reader
 *    chose it. `coachComparePath` builds it.
 *  - The SEO CANONICAL URL carries the pair only, ordered by id ascending,
 *    so `?a=5&b=12` and `?a=12&b=5` never become two indexed documents.
 *    `canonicalCoachComparePath` builds it, and it is only ever used in
 *    metadata -- a request is never redirected from one to the other.
 */

export const COACH_COMPARE_PATH = '/coaches/compare';

/** Everything the compare surface keeps in the URL. */
export type CoachCompareUrlParams = {
  a?: number | null;
  b?: number | null;
};

/**
 * The current shareable URL. A missing side is simply omitted, so the
 * plain no-selection surface stays the short bare path.
 */
export function coachComparePath(params: CoachCompareUrlParams): string {
  const query = new URLSearchParams();
  if (params.a !== undefined && params.a !== null) query.set('a', String(params.a));
  if (params.b !== undefined && params.b !== null) query.set('b', String(params.b));
  const qs = query.toString();
  return qs ? `${COACH_COMPARE_PATH}?${qs}` : COACH_COMPARE_PATH;
}

/** The pair, ordered by id ascending -- stable and locale-independent. */
export function canonicalPairOrder(idA: number, idB: number): [number, number] {
  return idA <= idB ? [idA, idB] : [idB, idA];
}

/**
 * The SEO canonical URL for a pair: ordered ids only. An incomplete pair
 * canonicalises to the bare surface, never to a guessed pair.
 */
export function canonicalCoachComparePath(
  idA: number | null | undefined,
  idB: number | null | undefined,
): string {
  if (idA == null || idB == null) return COACH_COMPARE_PATH;
  const [lower, higher] = canonicalPairOrder(idA, idB);
  return coachComparePath({ a: lower, b: higher });
}

/**
 * The same view with the two coaches the other way round. A presentation
 * reversal only -- it must not change which pair is being described.
 */
export function swapCoachComparePath(params: CoachCompareUrlParams): string {
  return coachComparePath({ a: params.b, b: params.a });
}
