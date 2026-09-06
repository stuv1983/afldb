import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type { ComparisonOrganization, H2HVenueRecord } from '@/db/queries/club-comparison';
import { formatDate, formatNumber } from '@/lib/format';

/**
 * Venue records for /clubs/compare, promoted to its own top-level,
 * collapsed section by the Club Rivalry Explorer follow-up, FR-3 (it was
 * previously a nested table inside the old "Rivalry records" section).
 * Always all-time — never era-scoped, per the approved design contract.
 */
export function ClubComparisonVenues({
  organizationA,
  organizationB,
  venues,
  era,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  venues: H2HVenueRecord[];
  era: number | null;
}) {
  const aName = organizationA.name;
  const bName = organizationB.name;

  return (
    <CollapsibleTable id="venues" title="Venues" defaultOpen={false}>
      {era !== null && (
        <p className="section-note">Venue records are always all-time.</p>
      )}
      {venues.length === 0 ? (
        <p className="empty">No venue is recorded for any meeting of these two clubs.</p>
      ) : (
        <div className="table-wrap">
          <SortableTable
            defaultSort="meetings"
            defaultDir="desc"
            caption={`Meetings by venue — ${aName} and ${bName}`}
            columns={[
              { key: 'venue', label: 'Venue', sortType: 'text' },
              { key: 'meetings', label: 'Meetings', sortType: 'number', className: 'num' },
              { key: 'aWins', label: `${aName} wins`, sortType: 'number', className: 'num' },
              { key: 'bWins', label: `${bName} wins`, sortType: 'number', className: 'num' },
              { key: 'draws', label: 'Draws', sortType: 'number', className: 'num' },
              { key: 'first', label: 'First', sortType: 'date', className: 'nowrap' },
              { key: 'latest', label: 'Latest', sortType: 'date', className: 'nowrap' },
            ]}
            items={venues.map((venue, index) => ({
              id: `${venue.venueId ?? 'raw'}-${venue.venueName ?? index}`,
              values: {
                venue: venue.venueName ?? '',
                meetings: venue.meetings,
                aWins: venue.aWins,
                bWins: venue.bWins,
                draws: venue.draws,
                first: venue.firstMeeting,
                latest: venue.latestMeeting,
              },
              element: (
                <tr key={`${venue.venueId ?? 'raw'}-${venue.venueName ?? index}`}>
                  <td className="wide">{venue.venueName ?? 'Venue not recorded'}</td>
                  <td className="num">{formatNumber(venue.meetings)}</td>
                  <td className="num">{formatNumber(venue.aWins)}</td>
                  <td className="num">{formatNumber(venue.bWins)}</td>
                  <td className="num">{formatNumber(venue.draws)}</td>
                  <td className="nowrap">{formatDate(venue.firstMeeting)}</td>
                  <td className="nowrap">{formatDate(venue.latestMeeting)}</td>
                </tr>
              ),
            }))}
          />
        </div>
      )}
    </CollapsibleTable>
  );
}
