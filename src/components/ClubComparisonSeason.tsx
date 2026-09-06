import Link from 'next/link';

import type { ComparisonOrganization, ClubSeasonComparison, ClubSeasonLeader, ClubSeasonTeamMetric } from '@/db/queries/club-comparison';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import {
  coverageLabel,
  didNotCompeteMessage,
  hasUnequalCoverage,
  teamMetricPresentation,
} from '@/lib/club-comparison-format';
import { clubPath, formatNumber, formatPercentage, formatStat, playerPath } from '@/lib/format';

/**
 * The selected-season half of /clubs/compare (AFLDB-ISSUE-144 Stage 8).
 *
 * Renders the Stage 4 result and adds no rule of its own. The three
 * things it must never do are the three things Stage 4 spent its effort
 * making decidable: substitute another season for a club that did not
 * compete, print `0` for a statistic that was never collected, and
 * declare a winner on a metric the two clubs' denominators disagree on.
 */
export function ClubComparisonSeason({
  organizationA,
  organizationB,
  season,
  seasonA,
  seasonB,
}: {
  organizationA: ComparisonOrganization;
  organizationB: ComparisonOrganization;
  season: number | null;
  seasonA: ClubSeasonComparison | null;
  seasonB: ClubSeasonComparison | null;
}) {
  if (season === null || !seasonA || !seasonB) {
    return (
      <section className="section" id="selected-season">
        <h2>Selected season</h2>
        <p className="empty">No season is on record, so there is no season to compare.</p>
      </section>
    );
  }

  const sides = [
    { org: organizationA, data: seasonA },
    { org: organizationB, data: seasonB },
  ];

  const metricKeys = seasonA.teamMetrics.metrics.map((m) => m.key);
  const metricsByKey = (data: ClubSeasonComparison) =>
    new Map(data.teamMetrics.metrics.map((m) => [m.key, m]));
  const aMetrics = metricsByKey(seasonA);
  const bMetrics = metricsByKey(seasonB);

  return (
    <section className="section" id="selected-season">
      <h2>Selected season — {season}</h2>

      <div className="grid grid-panels grid-shrink">
        {sides.map(({ org, data }) => (
          <div className="card" key={org.id}>
            <h3>
              <Link href={clubPath(org.slug)}>{org.name}</Link>
            </h3>
            {!data.participated || !data.record ? (
              <p className="meta">{didNotCompeteMessage(season)}</p>
            ) : (
              <>
                {data.identity?.clubName && data.identity.clubName !== org.name && (
                  <p className="meta">Played as {data.identity.clubName} in {season}.</p>
                )}
                <div className="table-wrap">
                  <table>
                    <caption>Home-and-away record — {org.name}, {season}</caption>
                    <tbody>
                      <RecordRow label="Played" value={formatNumber(data.record.played)} />
                      <RecordRow label="Wins" value={formatNumber(data.record.wins)} />
                      <RecordRow label="Draws" value={formatNumber(data.record.draws)} />
                      <RecordRow label="Losses" value={formatNumber(data.record.losses)} />
                      <RecordRow
                        label="Premiership points"
                        value={formatStat(data.record.premiershipPoints)}
                      />
                      <RecordRow
                        label="Win percentage"
                        value={data.record.winPercentage === null
                          ? formatStat(null)
                          : `${formatPercentage(data.record.winPercentage)}%`}
                      />
                      <RecordRow label="Points for" value={formatNumber(data.record.pointsFor)} />
                      <RecordRow
                        label="Points against"
                        value={formatNumber(data.record.pointsAgainst)}
                      />
                      <RecordRow
                        label="Percentage"
                        value={formatPercentage(data.record.percentage)}
                      />
                      <RecordRow
                        label="Average points for"
                        value={data.record.averagePointsFor === null
                          ? formatStat(null)
                          : data.record.averagePointsFor.toFixed(1)}
                      />
                      <RecordRow
                        label="Average points against"
                        value={data.record.averagePointsAgainst === null
                          ? formatStat(null)
                          : data.record.averagePointsAgainst.toFixed(1)}
                      />
                      <RecordRow
                        label="Ladder position"
                        value={formatStat(data.record.ladderRank)}
                      />
                    </tbody>
                  </table>
                </div>
                <p className="section-note">
                  Home-and-away record only. Finals are not part of these figures.
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      <CollapsibleTable
        id="season-team-stats"
        title="Team-stat averages"
        note={`${season}`}
        defaultOpen={false}
      >
        <p className="section-note">
          Averages are per match, over the matches in which each statistic was actually
          recorded. Where the two clubs’ denominators differ the figures cover different
          populations and are not a like-for-like contest, so neither is presented as the
          better of the two.
        </p>
        <div className="table-wrap">
          <table>
            <caption>Team-stat averages — {season}</caption>
            <thead>
              <tr>
                <th scope="col">Statistic</th>
                <th scope="col">{organizationA.name}</th>
                <th scope="col">{organizationB.name}</th>
                <th scope="col">Comparable</th>
              </tr>
            </thead>
            <tbody>
              {metricKeys.map((key) => {
                const a = aMetrics.get(key);
                const b = bMetrics.get(key);
                const unequal = hasUnequalCoverage(a, b);
                return (
                  <tr key={key}>
                    <th scope="row">{a?.label ?? b?.label ?? key}</th>
                    <MetricCell metric={a} />
                    <MetricCell metric={b} />
                    <td>{unequal ? 'Different coverage' : 'Yes'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleTable>

      <CollapsibleTable
        id="season-player-leaders"
        title="Season player leaders"
        note={`${season}`}
        defaultOpen={false}
      >
        <div className="grid grid-panels grid-shrink">
          {sides.map(({ org, data }) => (
            <div key={org.id}>
              <h3>{org.name}</h3>
              {!data.participated ? (
                <p className="muted">{didNotCompeteMessage(season)}</p>
              ) : (
                <>
                  <LeaderTable
                    caption={`Most games — ${org.name}, ${season}`}
                    valueLabel="Games"
                    leaders={data.leaders.games}
                    available
                    coverage="complete"
                  />
                  <LeaderTable
                    caption={`Most goals — ${org.name}, ${season}`}
                    valueLabel="Goals"
                    leaders={data.leaders.goals}
                    available={data.leaders.goalsAvailable}
                    coverage={data.leaders.goalsCoverage}
                  />
                  <LeaderTable
                    caption={`Most disposals — ${org.name}, ${season}`}
                    valueLabel="Disposals"
                    leaders={data.leaders.disposals}
                    available={data.leaders.disposalsAvailable}
                    coverage={data.leaders.disposalsCoverage}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      </CollapsibleTable>
    </section>
  );
}

function RecordRow({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="num">{value}</td>
    </tr>
  );
}

/**
 * One team-stat cell. An unavailable statistic renders the words for its
 * coverage state; it never renders a number, and it never renders `0`.
 */
function MetricCell({ metric }: { metric: ClubSeasonTeamMetric | undefined }) {
  if (!metric) return <td className="not-recorded">No coverage record</td>;
  const presentation = teamMetricPresentation(metric);
  if (presentation.kind === 'unavailable') {
    return <td className="not-recorded">{presentation.text}</td>;
  }
  return (
    <td className="num">
      {presentation.text}
      {presentation.note && <div className="meta">{presentation.note}</div>}
    </td>
  );
}

/**
 * A dense-ranked season leaderboard. Ties share a rank and every tied
 * player is listed, including at the cut: dropping the second holder of
 * fifth place would be an edit of the record.
 */
function LeaderTable({
  caption,
  valueLabel,
  leaders,
  available,
  coverage,
}: {
  caption: string;
  valueLabel: string;
  leaders: ClubSeasonLeader[];
  available: boolean;
  coverage: Parameters<typeof coverageLabel>[0];
}) {
  if (!available) {
    return (
      <p className="muted">
        {valueLabel}: {coverageLabel(coverage)} for this season.
      </p>
    );
  }
  if (leaders.length === 0) {
    return <p className="muted">{valueLabel}: no recorded leaders for this season.</p>;
  }
  return (
    <div className="table-wrap">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">#</th>
            <th scope="col">Player</th>
            <th scope="col" className="num">{valueLabel}</th>
            <th scope="col" className="num">Recorded games</th>
          </tr>
        </thead>
        <tbody>
          {leaders.map((leader) => (
            <tr key={`${leader.rank}-${leader.playerId}`}>
              <td className="num">{leader.rank}</td>
              <td className="wide">
                <Link href={playerPath(leader.slug, leader.playerId)}>{leader.displayName}</Link>
              </td>
              <td className="num">{formatNumber(leader.value)}</td>
              <td className="num">{formatStat(leader.recordedGames)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
