import type { ResolvedCoach } from '@/app/coaches/compare/state';
import { CoachBiggestWinLossTable, CoachTotalsTable, CoachVenueHistoryTable } from '@/components/CoachCareerRecord';
import type { CoachCareer } from '@/db/queries/coaches';

/**
 * Stage 2B: side-by-side career comparison for two selected coaches
 * (AFLDB-ISSUE-170 Stage 2B).
 *
 * This is career comparison only -- independent of whether the two coaches
 * ever directly opposed each other. Direct coach-v-coach head-to-head is
 * Stage 2C and is deliberately not attempted here.
 *
 * Reuses Stage 1D's shared per-coach renderers (`CoachTotalsTable`,
 * `CoachBiggestWinLossTable`, `CoachVenueHistoryTable`) verbatim, one
 * column per coach, rather than building a second parallel presentation of
 * the same `CoachCareer` data or recomputing any total. Each coach's own
 * career already carries its own safe empty/zero states -- a zero-game
 * coach's biggest-win/loss and venue tables already render their existing
 * "no record" text, and its totals are genuine zeros (a real absence of
 * canonical matches), not a fabricated stand-in for missing coverage -- so
 * no comparison-specific null/zero handling is needed once a pair of
 * careers has resolved.
 *
 * Side by side, deliberately neutral: no "leader" column and no winner
 * colouring. Several of these measures (losses, draws) have no single
 * "higher is better" direction, so any such contrast would be an
 * arbitrary judgement this component is not in a position to make.
 */
export function CoachComparisonCareer({
  coachA,
  coachB,
  careerA,
  careerB,
}: {
  coachA: ResolvedCoach;
  coachB: ResolvedCoach;
  /**
   * `null` only in the unexpected case where `getCoachCareer` fails to
   * resolve an otherwise-valid, already-resolved coach id -- fail safely
   * with an explicit message rather than throwing or rendering a
   * half-built comparison.
   */
  careerA: CoachCareer | null;
  careerB: CoachCareer | null;
}) {
  if (careerA === null || careerB === null) {
    const missingNames = [
      careerA === null ? coachA.coach.displayName : null,
      careerB === null ? coachB.coach.displayName : null,
    ].filter((name): name is string => name !== null);
    return (
      <div className="section">
        <p className="notice" role="status">
          Career data is not currently available for {missingNames.join(' or ')}. Try again shortly.
        </p>
      </div>
    );
  }

  const pairs: { coach: ResolvedCoach; career: CoachCareer }[] = [
    { coach: coachA, career: careerA },
    { coach: coachB, career: careerB },
  ];

  return (
    <>
      <section className="section">
        <h2>Career</h2>
        <div className="grid grid-panels">
          {pairs.map(({ coach, career }) => (
            <div key={coach.coach.id}>
              <h3>{coach.coach.displayName}</h3>
              <CoachTotalsTable totals={career.totals} />
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Biggest win and loss</h2>
        <div className="grid grid-panels">
          {pairs.map(({ coach, career }) => (
            <div key={coach.coach.id}>
              <h3>{coach.coach.displayName}</h3>
              <CoachBiggestWinLossTable
                biggestWin={career.biggestWin}
                biggestLoss={career.biggestLoss}
                showCoachedClub={career.clubs.length > 1}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <h2>Venue history</h2>
        <div className="grid grid-panels">
          {pairs.map(({ coach, career }) => (
            <div key={coach.coach.id}>
              <h3>{coach.coach.displayName}</h3>
              <CoachVenueHistoryTable venues={career.venues} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
