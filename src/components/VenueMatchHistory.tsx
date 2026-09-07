import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type { VenueMatchRow } from '@/db/queries/venues';
import {
  clubPath, formatAttendance, formatDate, formatRoundShort, matchPath,
} from '@/lib/format';

/**
 * The complete venue match history, newest first (AFLDB-ISSUE-150). One
 * page of {@link getVenueMatches}; the caller renders `<Pagination>`
 * beneath it. The old venue page truncated this at 50 matches — the MCG
 * alone has many thousands — so it now lives on its own paged route.
 *
 * `matches.attendance` is NULL when the crowd was never recorded and is
 * shown as an em dash, never 0.
 */
export function VenueMatchHistory({
  matches,
  venueName,
  from,
  to,
  total,
}: {
  matches: VenueMatchRow[];
  venueName: string;
  from: number;
  to: number;
  total: number;
}) {
  return (
    <CollapsibleTable title="Match history">
      <div className="table-wrap">
        <table>
          <caption>
            {venueName} — matches {from.toLocaleString('en-AU')}–{to.toLocaleString('en-AU')}{' '}
            of {total.toLocaleString('en-AU')}, newest first
          </caption>
          <thead>
            <tr>
              <th scope="col" className="nowrap">Date</th>
              <th scope="col" className="nowrap">Rd</th>
              <th scope="col">Home</th>
              <th scope="col" className="num nowrap">Score</th>
              <th scope="col">Away</th>
              <th scope="col" className="num">Crowd</th>
            </tr>
          </thead>
          <tbody>
            {matches.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">
                  <Link href={matchPath(m.id)}>{formatDate(m.matchDate)}</Link>
                </td>
                <td className="nowrap">
                  {m.season} {formatRoundShort(m.roundType, m.roundNumber)}
                </td>
                <td className="wide"><Link href={clubPath(m.homeSlug)}>{m.homeName}</Link></td>
                <td className="num nowrap">{m.homeScore}&ndash;{m.awayScore}</td>
                <td className="wide"><Link href={clubPath(m.awaySlug)}>{m.awayName}</Link></td>
                <td className="num">{formatAttendance(m.attendance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CollapsibleTable>
  );
}
