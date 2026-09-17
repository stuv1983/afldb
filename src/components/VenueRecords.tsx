import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type { VenueRecords as VenueRecordsData } from '@/db/queries/venues';
import {
  clubPath, formatAttendance, formatDate, formatNumber, matchPath,
} from '@/lib/format';

/**
 * The venue page's compact record board (AFLDB-ISSUE-150): highest and
 * lowest recorded attendance, highest single-team score, and biggest
 * winning margin. The query ({@link getVenueRecords}) does the
 * deterministic pick; this only renders.
 *
 * "Lowest recorded attendance" is the smallest *recorded* crowd — a
 * match with no attendance figure is not a small crowd and is never
 * shown here, and a genuine recorded 0 is left as 0.
 */
export function VenueRecords({
  records,
  venueName,
}: {
  records: VenueRecordsData;
  venueName: string;
}) {
  const { highestAttendance, lowestAttendance, highestScore, biggestMargin } = records;
  if (!highestAttendance && !lowestAttendance && !highestScore && !biggestMargin) {
    return null;
  }

  const rows: {
    key: string;
    label: string;
    figure: React.ReactNode;
    matchId: number;
    matchDate: Date;
    homeName: string; homeSlug: string; homeScore: number;
    awayName: string; awaySlug: string; awayScore: number;
  }[] = [];

  if (highestAttendance) {
    rows.push({
      key: 'highest-attendance',
      label: 'Highest attendance',
      figure: <strong>{formatAttendance(highestAttendance.attendance)}</strong>,
      ...highestAttendance, matchId: highestAttendance.id,
    });
  }
  if (lowestAttendance) {
    rows.push({
      key: 'lowest-attendance',
      label: 'Lowest recorded attendance',
      figure: <strong>{formatAttendance(lowestAttendance.attendance)}</strong>,
      ...lowestAttendance, matchId: lowestAttendance.id,
    });
  }
  if (highestScore) {
    rows.push({
      key: 'highest-score',
      label: 'Highest team score',
      figure: (
        <>
          <strong>{formatNumber(highestScore.score)}</strong>
          <span className="muted"> — <Link href={clubPath(highestScore.scoringClubSlug)}>
            {highestScore.scoringClubName}</Link></span>
        </>
      ),
      ...highestScore, matchId: highestScore.id,
    });
  }
  if (biggestMargin) {
    rows.push({
      key: 'biggest-margin',
      label: 'Biggest winning margin',
      figure: <strong>{formatNumber(biggestMargin.margin)} pts</strong>,
      ...biggestMargin, matchId: biggestMargin.id,
    });
  }

  return (
    <section className="section">
      <p className="section-note">
        {venueName}&rsquo;s headline records, from every recorded VFL/AFL match at the
        ground. A match with no recorded attendance is never counted as a small crowd.
      </p>
      <CollapsibleTable title="Venue records">
        <div className="table-wrap">
          <table>
            <caption>{venueName} record board</caption>
            <thead>
              <tr>
                <th scope="col">Record</th>
                <th scope="col">Figure</th>
                <th scope="col">Home</th>
                <th scope="col" className="num nowrap">Score</th>
                <th scope="col">Away</th>
                <th scope="col" className="nowrap">Date</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">{r.label}</th>
                  <td>{r.figure}</td>
                  <td className="wide"><Link href={clubPath(r.homeSlug)}>{r.homeName}</Link></td>
                  <td className="num nowrap">{r.homeScore}&ndash;{r.awayScore}</td>
                  <td className="wide"><Link href={clubPath(r.awaySlug)}>{r.awayName}</Link></td>
                  <td className="nowrap">
                    <Link href={matchPath(r.matchId)}>{formatDate(r.matchDate)}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
    </section>
  );
}
