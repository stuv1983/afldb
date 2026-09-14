import { Suspense } from 'react';

import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { CoachCareerBody } from '@/components/CoachCareerRecord';
import { CoachOpponentHistoryClient } from '@/components/CoachOpponentHistoryClient';
import type { ComparisonOrganization } from '@/db/queries/club-comparison';
import type { CoachCareer } from '@/db/queries/coaches';
import { coachingCareerSummary } from '@/lib/coaching-format';

/**
 * A player's coaching career (AFLDB-ISSUE-118 §23.28), collapsed by default
 * so the playing profile stays the visually dominant content -- a reader
 * who also wants the coaching record opens it deliberately.
 *
 * The career body (totals, club-by-club record, biggest win/loss, venue
 * history) is {@link CoachCareerBody} — the same shared renderer the
 * standalone `/coaches/[slug]` page uses (AFLDB-ISSUE-170 Stage 1D) —
 * with `linkClubs={false}`: the player's own Clubs section elsewhere on
 * this page already links every club they are associated with, so a
 * second link here would be redundant.
 *
 * The Stage 1C opponent-history selector is a client-side addition (see
 * {@link CoachOpponentHistoryClient} for why) wrapped in `<Suspense>`.
 * `organizations` is resolved by the player page loader, not here: this
 * stays a plain, synchronous, prop-driven component -- no data fetching
 * of its own -- so it keeps rendering (and testing, via
 * `renderToStaticMarkup`) exactly as it always has for a caller that has
 * no opponent history to offer at all.
 *
 * The selector renders only when `organizations` is non-empty, not
 * merely when `totals.games > 0`: `CoachOpponentHistoryClient` calls
 * `next/navigation`'s `useRouter()`, which throws outside an actual
 * mounted Next.js App Router (there is no such context in a plain
 * `renderToStaticMarkup` unit render, and this repo has no
 * jsdom/testing-library harness to fake one — the same reason
 * `SearchBox.tsx`, the repo's other client-hook component, has no render
 * test either). The real player page always supplies a non-empty list
 * for a real coaching career, so this is a no-op gate in production and
 * simply keeps a caller that passes no `organizations` (every existing
 * test) rendering exactly as before.
 */
export function PlayerCoachingCareer({
  career,
  organizations = [],
}: {
  career: CoachCareer;
  /** The Stage 1C selector's option list; `[]` for a zero-game career or a caller with none to offer. */
  organizations?: ComparisonOrganization[];
}) {
  const { totals } = career;

  return (
    <section className="section">
      <CollapsiblePanel title="Coaching Career" note={coachingCareerSummary(totals)} defaultOpen={false}>
        <CoachCareerBody career={career} linkClubs={false} />

        {organizations.length > 0 && (
          <Suspense fallback={<p className="muted">Loading opponent history…</p>}>
            <CoachOpponentHistoryClient
              coachId={career.coachId}
              organizations={organizations}
              showCoachedClub={career.clubs.length > 1}
            />
          </Suspense>
        )}
      </CollapsiblePanel>
    </section>
  );
}
