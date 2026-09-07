import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import type { VenueClubRecordRow } from '@/db/queries/venues';
import { clubPath, formatNumber, formatPercentage } from '@/lib/format';

/**
 * The venue page's club-records section (AFLDB-ISSUE-150): win–draw–loss
 * and win percentage of every historical club identity that has played
 * at the venue, most games first.
 *
 * Historical identities are kept apart — Footscray and the Western
 * Bulldogs are two rows for the eras they each played under, never
 * merged into the modern club. Win percentage is `wins / games * 100`; a
 * draw is not counted as half a win. The query fixes the order
 * (`games DESC, wins DESC, name, id`), so it is deterministic.
 */
export function VenueClubRecords({
  clubs,
  venueName,
}: {
  clubs: VenueClubRecordRow[];
  venueName: string;
}) {
  if (clubs.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        Every club to have played at {venueName}, by matches played there. Each
        historical club identity is listed separately. Win % is wins ÷ games; a draw
        is not half a win.
      </p>
      <CollapsibleTable title="Club records">
        <div className="table-wrap">
          <table>
            <caption>Club win–draw–loss records at {venueName}</caption>
            <thead>
              <tr>
                <th scope="col">Club</th>
                <th scope="col" className="num">Games</th>
                <th scope="col" className="num">W</th>
                <th scope="col" className="num">D</th>
                <th scope="col" className="num">L</th>
                <th scope="col" className="num">Win %</th>
              </tr>
            </thead>
            <tbody>
              {clubs.map((c) => (
                <tr key={c.clubId}>
                  <th scope="row" className="wide">
                    <Link href={clubPath(c.clubSlug)}>{c.clubName}</Link>
                  </th>
                  <td className="num">{formatNumber(c.games)}</td>
                  <td className="num">{formatNumber(c.wins)}</td>
                  <td className="num">{formatNumber(c.draws)}</td>
                  <td className="num">{formatNumber(c.losses)}</td>
                  <td className="num">{formatPercentage(c.winPct)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>
    </section>
  );
}
