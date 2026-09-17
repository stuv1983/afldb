import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type { ClubPremiershipRow } from '@/db/queries/clubs';
import { clubPath, formatAttendance, formatDate, venuePath } from '@/lib/format';

/**
 * A club's premierships for a club page (AFLDB-ISSUE-148): one row per
 * won Grand Final, newest first. The data comes from
 * {@link getClubPremierships}; this only renders it, so the club page
 * keeps the same shape as its other sections.
 *
 * The opponent links to its club page and the venue to its
 * `/venues/[slug]` page (the same routes the rest of the public site
 * uses); an unlinked venue falls back to its plain name. The score is
 * shown from the premiership club's perspective, and the crowd is left
 * blank — never zero-filled — where `matches.attendance` is null.
 */
export function ClubPremierships({
  premierships,
  clubRecordName,
  hasLineage,
}: {
  premierships: ClubPremiershipRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  // A club with no premierships simply has no section, the same way
  // best-and-fairest and captains are omitted when empty.
  if (premierships.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        Every VFL/AFL premiership won by {clubRecordName}
        {hasLineage && ', across every era of the club'} — one row per Grand Final won,
        newest first. The score is shown from {clubRecordName}&rsquo;s perspective.
      </p>
      <CollapsibleTable title="Premierships">
        <div className="table-wrap">
          <SortableTable
            defaultSort="year"
            defaultDir="desc"
            caption={`${clubRecordName} premierships, from the canonical Grand Final record`}
            columns={[
              { key: 'year', label: 'Year', sortType: 'number', className: 'num' },
              { key: 'opponent', label: 'Opponent', sortType: 'text' },
              { key: 'score', label: 'Score', sortType: 'number', className: 'num nowrap' },
              { key: 'venue', label: 'Venue', sortType: 'text' },
              { key: 'date', label: 'Date', sortType: 'number', className: 'nowrap' },
              { key: 'crowd', label: 'Crowd', sortType: 'number', className: 'num' },
            ]}
            items={premierships.map((p) => ({
              id: String(p.matchId),
              values: {
                year: p.year,
                opponent: p.opponentName,
                // Sort "Score" by winning margin — biggest wins first.
                score: p.clubScore - p.opponentScore,
                venue: p.venueName,
                date: p.matchDate ? new Date(p.matchDate).getTime() : 0,
                crowd: p.crowd ?? -1,
              },
              element: (
                <tr key={p.matchId}>
                  <td className="num">{p.year}</td>
                  <td className="wide">
                    <Link href={clubPath(p.opponentSlug)}>{p.opponentName}</Link>
                  </td>
                  <td className="num nowrap">{p.clubScore}-{p.opponentScore}</td>
                  <td>
                    {p.venueSlug
                      ? <Link href={venuePath(p.venueSlug)}>{p.venueName}</Link>
                      : p.venueName}
                  </td>
                  <td className="nowrap">{formatDate(p.matchDate)}</td>
                  <td className="num">{formatAttendance(p.crowd)}</td>
                </tr>
              ),
            }))}
          />
        </div>
      </CollapsibleTable>
    </section>
  );
}
