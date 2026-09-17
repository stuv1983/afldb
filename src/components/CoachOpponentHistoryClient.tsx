'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import { CoachOpponentRecordBody } from '@/components/CoachCareerRecord';
import type { ComparisonOrganization } from '@/db/queries/club-comparison';
import type { CoachOpponentSelection } from '@/lib/coach-opponent-history';

/**
 * The player-linked coaching surface's Stage 1C opponent selector
 * (AFLDB-ISSUE-170 Stage 1D).
 *
 * A deliberate, narrowly scoped exception to two conventions the shared
 * presentation in `CoachCareerRecord` never breaks anywhere else on this
 * surface: it fetches over the network, and it does not work without
 * JavaScript.
 *
 * `/players/[slug]` is static ISR, seeded for ~13,000 players, and its
 * own comment says reading `searchParams` there "would force dynamic
 * rendering and cost roughly 2s per request under load" — this repo does
 * not set `cacheComponents`, so that cost is real and would apply to
 * every player page, not only linked coaches. Reading the URL here
 * instead, via `useSearchParams` inside the `<Suspense>` boundary
 * `PlayerCoachingCareer` wraps this in, only bails that one subtree out
 * to client-side rendering (the standard Next.js CSR-bailout pattern for
 * `useSearchParams` under static rendering) — the rest of the player page
 * stays exactly as static as before.
 *
 * The standalone `/coaches/[slug]` page has no such constraint (18
 * coach-only identities) and resolves the identical selection fully
 * server-rendered, with a plain GET form and no client fetch at all — see
 * `CoachOpponentSelector` and `resolveCoachOpponentSelection`, which this
 * component's target route handler also calls, so an unresolvable
 * opponent reads the same "is not a club on record" way on both surfaces.
 */
export function CoachOpponentHistoryClient({
  coachId,
  organizations,
  showCoachedClub,
}: {
  coachId: number;
  organizations: ComparisonOrganization[];
  showCoachedClub: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requested = searchParams.get('opponent') ?? '';

  const [selection, setSelection] = useState<CoachOpponentSelection>({ kind: 'none' });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!requested) {
      setSelection({ kind: 'none' });
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/coaches/${coachId}/opponent-record?organization=${encodeURIComponent(requested)}`)
      .then((res) => res.json() as Promise<CoachOpponentSelection>)
      .then((data) => {
        if (!cancelled) setSelection(data);
      })
      .catch(() => {
        if (!cancelled) setSelection({ kind: 'invalid', requested });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [coachId, requested]);

  function onChange(slug: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set('opponent', slug);
    else params.delete('opponent');
    const query = params.toString();
    router.push(query ? `?${query}` : '?', { scroll: false });
  }

  const current = organizations.filter((o) => o.isActive);
  const former = organizations.filter((o) => !o.isActive);

  return (
    <div className="filter-group">
      <label htmlFor="player-coach-opponent">History against club</label>{' '}
      <select id="player-coach-opponent" value={requested} onChange={(e) => onChange(e.target.value)}>
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

      {loading && <p className="muted">Loading…</p>}
      {!loading && selection.kind === 'invalid' && (
        <p className="muted">{selection.requested} is not a club on record.</p>
      )}
      {!loading && selection.kind === 'resolved' && (
        <>
          <h4>vs {selection.organization.name}</h4>
          <CoachOpponentRecordBody record={selection.record} showCoachedClub={showCoachedClub} />
        </>
      )}
    </div>
  );
}
