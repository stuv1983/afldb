import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type { ClubCrowdRecordKind, ClubCrowdRecordRow } from '@/db/queries/clubs';
import {
  clubPath, formatAttendance, formatDate, formatRoundShort, seasonPath, venuePath,
} from '@/lib/format';

/**
 * The club page's Record Crowds section (AFLDB-ISSUE-149): the highest
 * home-and-away, finals and Grand Final crowds, and the five largest
 * crowds at any match involving the club, from {@link getClubCrowdRecords}.
 *
 * Every figure here is a real recorded attendance — the query drops
 * matches with no recorded crowd, so nothing is a fabricated zero. Scores
 * are shown from the club's perspective.
 */

const RECORD_LABEL: Record<ClubCrowdRecordKind, string> = {
  record_home_and_away: 'Highest home-and-away crowd',
  record_finals: 'Highest finals crowd',
  record_grand_final: 'Highest Grand Final crowd',
};

function MatchCells({ row }: { row: ClubCrowdRecordRow }) {
  return (
    <>
      <td className="num">{formatAttendance(row.crowd)}</td>
      <td className="wide">
        <Link href={clubPath(row.opponentSlug)}>{row.opponentName}</Link>
      </td>
      <td className="num nowrap">{row.clubScore}&ndash;{row.opponentScore}</td>
      <td className="num">
        <Link href={seasonPath(row.season)}>{row.season}</Link>
      </td>
      <td className="nowrap">{formatRoundShort(row.roundType, row.roundNumber)}</td>
      <td>
        {row.venueSlug
          ? <Link href={venuePath(row.venueSlug)}>{row.venueName}</Link>
          : row.venueName}
      </td>
      <td className="nowrap">{formatDate(row.matchDate)}</td>
    </>
  );
}

export function ClubCrowdRecords({
  records,
  top,
  clubRecordName,
  hasLineage,
}: {
  records: ClubCrowdRecordRow[];
  top: ClubCrowdRecordRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  // Nothing to show if the club has never played a match with a recorded
  // crowd — the same "omit when empty" rule the other sections use.
  if (records.length === 0 && top.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        The biggest crowds at {clubRecordName} matches
        {hasLineage && ', across every era of the club'} — home or away. Matches with
        no recorded attendance are not counted; a blank crowd is never shown as zero.
      </p>
      <CollapsibleTable title="Record crowds">
        {records.length > 0 && (
          <div className="table-wrap">
            <table>
              <caption>{clubRecordName} attendance records</caption>
              <thead>
                <tr>
                  <th scope="col">Record</th>
                  <th scope="col" className="num">Crowd</th>
                  <th scope="col">Opponent</th>
                  <th scope="col" className="num nowrap">Score</th>
                  <th scope="col" className="num">Season</th>
                  <th scope="col">Rd</th>
                  <th scope="col">Venue</th>
                  <th scope="col" className="nowrap">Date</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.kind}>
                    <th scope="row">{RECORD_LABEL[r.kind as ClubCrowdRecordKind]}</th>
                    <MatchCells row={r} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {top.length > 0 && (
          <div className="table-wrap">
            <table>
              <caption>{clubRecordName}&rsquo;s five largest crowds</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">#</th>
                  <th scope="col" className="num">Crowd</th>
                  <th scope="col">Opponent</th>
                  <th scope="col" className="num nowrap">Score</th>
                  <th scope="col" className="num">Season</th>
                  <th scope="col">Rd</th>
                  <th scope="col">Venue</th>
                  <th scope="col" className="nowrap">Date</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr key={r.matchId}>
                    <td className="num">{i + 1}</td>
                    <MatchCells row={r} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CollapsibleTable>
    </section>
  );
}
