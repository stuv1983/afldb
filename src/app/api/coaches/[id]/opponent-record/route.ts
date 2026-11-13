import { NextResponse } from 'next/server';

import { getCoach } from '@/db/queries/coaches';
import { RateLimiter } from '@/lib/auth/rate-limit';
import { requestIp } from '@/lib/auth/session';
import { resolveCoachOpponentSelection, type CoachOpponentSelection } from '@/lib/coach-opponent-history';
import { isOversizedCanonicalId, parseCanonicalId } from '@/lib/params';

export const dynamic = 'force-dynamic';

/**
 * Backs the player-linked coaching surface's client-side opponent
 * selector (AFLDB-ISSUE-170 Stage 1D — see CoachOpponentHistoryClient).
 * `/players/[slug]` stays static ISR and never calls this itself; only
 * the browser does, one bounded lookup per selector change, so this is
 * looser than autocomplete's per-keystroke limit.
 */
const RATE_LIMIT = new RateLimiter(30, 60 * 1000);

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<CoachOpponentSelection>> {
  const { id } = await params;
  // Canonical id only (AFLDB-ISSUE-357). A well-formed id above int4 can never
  // name a coach, so it answers exactly as an unknown id does (AFLDB-ISSUE-359)
  // instead of reaching the database and raising 22003 as a 500.
  const coachId = parseCanonicalId(id);
  if (coachId === undefined) {
    return isOversizedCanonicalId(id)
      ? NextResponse.json({ kind: 'invalid', requested: id }, { status: 404 })
      : NextResponse.json({ kind: 'invalid', requested: id }, { status: 400 });
  }

  if (RATE_LIMIT.check(`ip:${(await requestIp()) ?? 'unknown'}`)) {
    return NextResponse.json({ kind: 'invalid', requested: '' }, { status: 429 });
  }

  const coach = await getCoach(coachId);
  if (!coach) {
    return NextResponse.json({ kind: 'invalid', requested: id }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get('organization') ?? undefined;

  try {
    const selection = await resolveCoachOpponentSelection(coachId, requested);
    return NextResponse.json(selection);
  } catch (error) {
    console.error('[opponent-record] query failed', error);
    return NextResponse.json({ kind: 'invalid', requested: requested ?? '' }, { status: 503 });
  }
}
