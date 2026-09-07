import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type { ClubCoachRecordRow } from '@/db/queries/coaches';
import { coachPath, formatNumber, formatPercentage, formatSpan, playerPath } from '@/lib/format';
import { coachSlug } from '@/lib/slugs';

/**
 * Club-specific coaching records for a club page (AFLDB-ISSUE-148): one
 * row per coach, that coach's record for THIS club only. The data comes
 * from {@link getClubCoachRecords}; this only renders it, so the club
 * page keeps the same shape as its other sections.
 *
 * A coach who also played at senior level links to their player profile
 * (the same rule the /records/coaches board and the linked-coach redirect
 * apply); a coach-only person links to the `/coaches/[slug]-id` route.
 */
function coachCell(row: ClubCoachRecordRow) {
  const href = row.playerId !== null && row.playerSlug !== null
    ? playerPath(row.playerSlug, row.playerId)
    : coachPath(coachSlug(row.displayName), row.coachId);
  return <Link href={href}>{row.displayName}</Link>;
}

export function ClubCoachRecords({
  records,
  clubRecordName,
  hasLineage,
}: {
  records: ClubCoachRecordRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  // A club with no per-match coaching data simply has no section, the
  // same way best-and-fairest and captains are omitted when empty.
  if (records.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        Each coach&rsquo;s record for {clubRecordName}
        {hasLineage && ', across every era of the club'}, counted from the canonical
        per-match coaching record. A coach who was in charge for more than one
        separate period is shown once, with the periods combined. Win percentage
        counts a draw as half a win.
      </p>
      <CollapsibleTable title="Coaches">
        <div className="table-wrap">
          <SortableTable
            defaultSort="span"
            defaultDir="desc"
            caption={`Every coach of ${clubRecordName}, with their record for the club`}
            columns={[
              { key: 'coach', label: 'Coach', sortType: 'text' },
              { key: 'span', label: 'Span', sortType: 'number', className: 'num nowrap' },
              { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
              { key: 'wins', label: 'W', sortType: 'number', className: 'num' },
              { key: 'draws', label: 'D', sortType: 'number', className: 'num' },
              { key: 'losses', label: 'L', sortType: 'number', className: 'num' },
              { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
            ]}
            items={records.map((r) => ({
              id: String(r.coachId),
              values: {
                coach: r.displayName,
                // The Span column is first/last season coached (a range, not
                // a claim every year in it was coached); sorting it ranks by
                // the last season in charge, so the default view is
                // most-recent-first.
                span: r.lastSeason,
                games: r.games,
                wins: r.wins,
                draws: r.draws,
                losses: r.losses,
                winPct: Number(r.winPct),
              },
              element: (
                <tr key={r.coachId}>
                  <td className="wide">{coachCell(r)}</td>
                  <td className="num nowrap">{formatSpan(r.firstSeason, r.lastSeason)}</td>
                  <td className="num">{formatNumber(r.games)}</td>
                  <td className="num">{r.wins}</td>
                  <td className="num">{r.draws}</td>
                  <td className="num">{r.losses}</td>
                  <td className="num">{formatPercentage(r.winPct)}</td>
                </tr>
              ),
            }))}
          />
        </div>
      </CollapsibleTable>
    </section>
  );
}
