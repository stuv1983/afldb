import { permanentRedirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * The grid solver moved to /grid-solver when who may reach it became a
 * setting rather than a route (migration 034): /admin is gated by middleware
 * that always demands an admin cookie, which a page that can be published to
 * everyone cannot live behind.
 *
 * Board links are shareable by design and admins have bookmarked them, so
 * this carries the query string across rather than dropping people on an
 * empty board.
 */
export default async function MovedGridSolverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : [value]) {
      if (one !== undefined) query.append(key, one);
    }
  }
  const suffix = query.toString();
  permanentRedirect(suffix ? `/grid-solver?${suffix}` : '/grid-solver');
}
