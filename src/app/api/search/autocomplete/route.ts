import { NextResponse } from 'next/server';

import { autocomplete } from '@/db/queries/search';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { requestIp } from '@/lib/auth/session';
import { AUTOCOMPLETE_LIMIT, MIN_QUERY_LENGTH } from '@/search/constants';

export const dynamic = 'force-dynamic';

// Unauthenticated, and the max-age=60 cache is trivially bypassed by varying
// q. Each hit fans out into several trigram/LIKE scans, so cap the per-caller
// rate to stop a single source holding the DB pool and starving page renders.
// 60/min comfortably clears real (debounced) typing.
const RATE_LIMIT = new RateLimiter(60, 60 * 1000);

/**
 * Player autocomplete.
 *
 * Bounded on every axis: the query is truncated, a minimum length is
 * enforced before any database work, and the result count is capped.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').slice(0, 100).trim();
  // Allowlisted, not passed through: an unrecognised value is treated as
  // no scope rather than reaching the query layer.
  const scopeParam = searchParams.get('scope');
  const scope = scopeParam === 'aflw' || scopeParam === 'players' ? scopeParam : undefined;

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [] });
  }

  if (RATE_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return NextResponse.json({ results: [], error: 'rate_limited' }, { status: 429 });
  }

  try {
    const results = await autocomplete(query, AUTOCOMPLETE_LIMIT, scope);
    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    // Log server-side; never leak query or database detail to the client.
    console.error('[autocomplete] query failed', error);
    return NextResponse.json({ results: [], error: 'search_unavailable' }, { status: 503 });
  }
}
