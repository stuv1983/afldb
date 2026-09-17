import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SortableTable } from '@/components/SortableTable';
import type { ClubBrownlowMedallistRow, ClubHonourRow } from '@/db/queries/awards';
import { formatNumber, isLinked, playerPath } from '@/lib/format';

/**
 * The club page's Awards / Honours section (AFLDB-ISSUE-149): individual
 * honours earned by a player while representing this club.
 *
 * Two canonical, club-attributed sources:
 * - **Brownlow Medallists** — {@link getClubBrownlowMedallists}, real
 *   `brownlow_season_votes.is_winner` rows attributed to the player's
 *   same-season club (`brownlow_season_votes.club_id` is unpopulated), the
 *   club then filtered to the club's lineage.
 * - **National honours** — {@link getClubHonours}, from `award_winners`
 *   (`awards.category = 'award'`, `club_id` in the club's lineage):
 *   Coleman, Norm Smith, All-Australian, Rising Star and the like.
 *
 * Both are filtered on the club the player represented in the award
 * season, so an honour won at another club never appears here. Honour-team
 * membership (Team of the Century etc.) has no `club_id` and is not shown.
 */
export function ClubHonours({
  brownlow,
  honours,
  clubRecordName,
  hasLineage,
}: {
  brownlow: ClubBrownlowMedallistRow[];
  honours: ClubHonourRow[];
  clubRecordName: string;
  hasLineage: boolean;
}) {
  if (brownlow.length === 0 && honours.length === 0) return null;

  return (
    <section className="section">
      <p className="section-note">
        Major individual honours won by a player while at {clubRecordName}
        {hasLineage && ', across every era of the club'}. Each is attributed to the club
        the player represented that season, so an honour earned elsewhere is not listed.
      </p>
      <CollapsibleTable title="Awards & honours">
        {brownlow.length > 0 && (
          <div className="table-wrap">
            <table>
              <caption>{clubRecordName} Brownlow Medallists</caption>
              <thead>
                <tr>
                  <th scope="col" className="num">Year</th>
                  <th scope="col">Player</th>
                  <th scope="col">Award</th>
                  <th scope="col" className="num">Votes</th>
                </tr>
              </thead>
              <tbody>
                {brownlow.map((b) => (
                  <tr key={`${b.season}-${b.playerId}`}>
                    <td className="num">{b.season}</td>
                    <td className="wide">
                      <Link href={playerPath(b.playerSlug, b.playerId)}>{b.playerName}</Link>
                      {hasLineage && b.identityName !== clubRecordName && (
                        <span className="muted nowrap"> · {b.identityName}</span>
                      )}
                    </td>
                    <td>Brownlow Medal</td>
                    <td className="num">{formatNumber(b.votes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {honours.length > 0 && (
          <div className="table-wrap">
            <SortableTable
              defaultSort="year"
              defaultDir="desc"
              caption={`${clubRecordName} national honours, from award_winners`}
              columns={[
                { key: 'year', label: 'Year', sortType: 'number', className: 'num' },
                { key: 'player', label: 'Player', sortType: 'text' },
                { key: 'honour', label: 'Honour', sortType: 'text' },
              ]}
              items={honours.map((h) => ({
                id: String(h.id),
                values: {
                  year: h.season ?? 0,
                  player: h.playerName,
                  honour: h.awardName,
                },
                element: (
                  <tr key={h.id}>
                    <td className="num">{h.season ?? '—'}</td>
                    <td className="wide">
                      {h.playerId && h.playerSlug && isLinked(h.linkStatus) ? (
                        <Link href={playerPath(h.playerSlug, h.playerId)}>{h.playerName}</Link>
                      ) : (
                        h.playerName
                      )}
                      {hasLineage && h.identityName && h.identityName !== clubRecordName && (
                        <span className="muted nowrap"> · {h.identityName}</span>
                      )}
                    </td>
                    <td>{h.awardName}</td>
                  </tr>
                ),
              }))}
            />
          </div>
        )}
      </CollapsibleTable>
    </section>
  );
}
