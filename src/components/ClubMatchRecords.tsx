import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type { ClubMatchRecordKind, ClubMatchRecordRow } from '@/db/queries/clubs';
import {
  clubPath, formatAttendance, formatDate, formatNumber, seasonPath, venuePath,
} from '@/lib/format';

/**
 * The club page's Club Records section (AFLDB-ISSUE-149): one row per
 * headline match record — biggest win / loss, highest / lowest club
 * score, highest / lowest combined match score — from
 * {@link getClubMatchRecords}. The query does the perspective flip and
 * the deterministic tie-break; this only renders.
 *
 * The score is always shown from the club's perspective
 * (`clubScore–opponentScore`), whichever side of the match the club was.
 */

const RECORD_LABEL: Record<ClubMatchRecordKind, string> = {
  biggest_win: 'Biggest win',
  biggest_loss: 'Biggest loss',
  highest_score: 'Highest score',
  lowest_score: 'Lowest score',
  highest_scoring_match: 'Highest-scoring match',
  lowest_scoring_match: 'Lowest-scoring match',
};

function annotation(row: ClubMatchRecordRow): string {
  switch (row.kind) {
    case 'biggest_win':
      return `${formatNumber(row.value)}-point win`;
    case 'biggest_loss':
      return `${formatNumber(row.value)}-point loss`;
    case 'highest_score':
    case 'lowest_score':
      return `${formatNumber(row.clubScore)} points`;
    case 'highest_scoring_match':
    case 'lowest_scoring_match':
      return `${formatNumber(row.value)} points combined`;
  }
}

export function ClubMatchRecords({
  records,
  clubRecordName,
  hasLineage,
}: {
  records: ClubMatchRecordRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  if (records.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        {clubRecordName}&rsquo;s headline match records
        {hasLineage && ', across every era of the club'}. The score is shown from{' '}
        {clubRecordName}&rsquo;s perspective. Where a record is shared, the most recent
        match is shown.
      </p>
      <CollapsibleTable title="Club records">
        <div className="table-wrap">
          <table>
            <caption>{clubRecordName} match records, from the canonical match record</caption>
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col" className="num nowrap">Score</th>
                <th scope="col">Opponent</th>
                <th scope="col" className="num">Season</th>
                <th scope="col" className="nowrap">Date</th>
                <th scope="col">Venue</th>
                <th scope="col" className="num">Crowd</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.kind}>
                  <th scope="row">
                    {RECORD_LABEL[r.kind]}
                    <span className="muted"> — {annotation(r)}</span>
                  </th>
                  <td className="num nowrap">{r.clubScore}&ndash;{r.opponentScore}</td>
                  <td className="wide">
                    <Link href={clubPath(r.opponentSlug)}>{r.opponentName}</Link>
                  </td>
                  <td className="num">
                    <Link href={seasonPath(r.season)}>{r.season}</Link>
                  </td>
                  <td className="nowrap">{formatDate(r.matchDate)}</td>
                  <td>
                    {r.venueSlug
                      ? <Link href={venuePath(r.venueSlug)}>{r.venueName}</Link>
                      : r.venueName}
                  </td>
                  <td className="num">{formatAttendance(r.crowd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
    </section>
  );
}
