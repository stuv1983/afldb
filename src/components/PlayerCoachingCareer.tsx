import { CollapsiblePanel } from '@/components/CollapsiblePanel';
import { SortableTable } from '@/components/SortableTable';
import type { CoachCareer } from '@/db/queries/coaches';
import { coachingCareerSummary } from '@/lib/coaching-format';
import { formatNumber, formatPercentage, formatSpan } from '@/lib/format';

/**
 * A player's coaching career (AFLDB-ISSUE-118 §23.28), collapsed by default
 * so the playing profile stays the visually dominant content -- a reader
 * who also wants the coaching record opens it deliberately.
 *
 * `CoachingClubStint` carries a club id and name but no slug, so the club
 * column is plain text rather than a guessed URL; the player's own Clubs
 * section elsewhere on this page already links every club they are
 * associated with.
 */
export function PlayerCoachingCareer({ career }: { career: CoachCareer }) {
  const { totals } = career;

  return (
    <section className="section">
      <CollapsiblePanel
        title="Coaching Career"
        note={coachingCareerSummary(totals)}
        defaultOpen={false}
      >
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <th scope="row">Games</th>
                <td className="num">{formatNumber(totals.games)}</td>
                <th scope="row">Win %</th>
                <td className="num">{formatPercentage(totals.winPct)}</td>
              </tr>
              <tr>
                <th scope="row">Record</th>
                <td className="num nowrap">{totals.wins}W – {totals.losses}L – {totals.draws}D</td>
                <th scope="row">Finals</th>
                <td className="num">{formatNumber(totals.finals)}</td>
              </tr>
              <tr>
                <th scope="row">Grand Finals</th>
                <td className="num">{formatNumber(totals.grandFinals)}</td>
                <th scope="row">Premierships</th>
                <td className="num">{formatNumber(totals.premierships)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {career.clubs.length > 0 && (
          <div className="table-wrap">
            <SortableTable
              defaultSort="firstSeason"
              defaultDir="asc"
              columns={[
                { key: 'club', label: 'Club', sortType: 'text' },
                { key: 'firstSeason', label: 'Seasons', sortType: 'number', className: 'num nowrap' },
                { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
                { key: 'wld', label: 'W–L–D', sortType: 'number', className: 'num nowrap' },
                { key: 'winPct', label: 'Win %', sortType: 'number', className: 'num' },
                { key: 'finals', label: 'Finals', sortType: 'number', className: 'num' },
                { key: 'grandFinals', label: 'GF', sortType: 'number', className: 'num' },
                { key: 'premierships', label: 'Prem', sortType: 'number', className: 'num' },
              ]}
              items={career.clubs.map((c) => ({
                id: String(c.clubId),
                values: {
                  club: c.clubName,
                  firstSeason: c.firstSeason,
                  games: c.games,
                  wld: c.wins,
                  winPct: c.winPct ?? -1,
                  finals: c.finals,
                  grandFinals: c.grandFinals,
                  premierships: c.premierships,
                },
                element: (
                  <tr key={c.clubId}>
                    <td>{c.clubName}</td>
                    <td className="num nowrap">{formatSpan(c.firstSeason, c.lastSeason)}</td>
                    <td className="num">{formatNumber(c.games)}</td>
                    <td className="num nowrap">{c.wins}–{c.losses}–{c.draws}</td>
                    <td className="num">{formatPercentage(c.winPct)}</td>
                    <td className="num">{formatNumber(c.finals)}</td>
                    <td className="num">{formatNumber(c.grandFinals)}</td>
                    <td className="num">{formatNumber(c.premierships)}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        )}
      </CollapsiblePanel>
    </section>
  );
}
