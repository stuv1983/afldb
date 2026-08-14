import { NextResponse } from 'next/server';

import { autocomplete } from '@/db/queries/search';
import { AUTOCOMPLETE_LIMIT, MIN_QUERY_LENGTH } from '@/search/constants';

export const dynamic = 'force-dynamic';

/**
 * Player autocomplete.
 *
 * Bounded on every axis: the query is truncated, a minimum length is
 * enforced before any database work, and the result count is capped.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = (searchParams.get('q') ?? '').slice(0, 100).trim();

  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ results: [] });
  }

  try {
    const results = await autocomplete(query, AUTOCOMPLETE_LIMIT);
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
