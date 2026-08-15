import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { ReorderableSections } from '@/components/ReorderableSections';
import { TableFilters } from '@/components/TableFilters';
import { getClubOptions } from '@/db/queries/advanced-search';
import { getBrownlowCareerLeaders, getBrownlowWinners } from '@/db/queries/brownlow';
import { clubPath, formatNumber, playerPath } from '@/lib/format';
import {
  brownlowLeaderFilterFields,
  brownlowWinnerFilterFields,
  clubOptions,
} from '@/search/list-filters';
import { describeFilters, filterQueryParams, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brownlow Medal',
  description:
    'Brownlow Medal winners and vote counts from 1924, with career vote leaders.',
  alternates: { canonical: '/brownlow' },
};

/** Career leaders are a leaderboard, so the list stays bounded. */
const LEADER_LIMIT = 50;

export default async function BrownlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clubs = await getClubOptions();

  // Two independent tables on one URL, so each panel owns its own
  // parameter names and neither can disturb the other's controls. Each
  // form also carries the other's applied values as hidden inputs: a GET
  // form submits only the inputs it contains, so without them applying
  // one panel would silently clear the other table's filters.
  const winnerFields = brownlowWinnerFilterFields(clubOptions(clubs));
  const leaderFields = brownlowLeaderFilterFields();
  const winnerValues = parseFilterValues(winnerFields, params);
  const leaderValues = parseFilterValues(leaderFields, params);
  const winnerCarried = filterQueryParams(winnerFields, winnerValues);
  const leaderCarried = filterQueryParams(leaderFields, leaderValues);

  const [winners, leaders] = await Promise.all([
    getBrownlowWinners({
      q: winnerValues.text.q,
      club: winnerValues.select.club,
      ranges: winnerValues,
    }),
    getBrownlowCareerLeaders({
      q: leaderValues.text.lq,
      ranges: leaderValues,
      limit: LEADER_LIMIT,
    }),
  ]);

  const errors = [...winnerValues.errors, ...leaderValues.errors];
  const winnersDescribed = describeFilters(winnerFields, winnerValues);
  const leadersDescribed = describeFilters(leaderFields, leaderValues);
  const seasonCount = new Set(winners.map((w) => w.season)).size;

  const sections: { id: string; label: string; node: React.ReactNode }[] = [];

  sections.push({
    id: 'career-vote-leaders',
    label: 'Career vote leaders',
    node: (
      <section className="section">
        {/* Anchor target for /brownlow#brownlow-leaders links from search. */}
        <div id="brownlow-leaders" style={{ scrollMarginTop: '4rem' }}>
        <CollapsibleTable
          id="leaders"
          title="Career vote leaders"
          note={
            leaders.total > LEADER_LIMIT
              ? `Top ${LEADER_LIMIT} of ${formatNumber(leaders.total)}`
              : `${formatNumber(leaders.total)} players`
          }
          filters={
            <TableFilters
              action="/brownlow"
              anchor="leaders"
              fields={leaderFields}
              values={leaderValues}
              title="Filter career leaders"
              hidden={winnerCarried}
            />
          }
        >
          {leadersDescribed.length > 0 && (
            <p className="section-note">{leadersDescribed.join(' · ')}</p>
          )}
          {leaders.rows.length === 0 ? (
            <div className="empty">
              <h2>No players match those filters</h2>
              <p>Try widening the vote or games range.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>Most career Brownlow votes</caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">#</th>
                    <th scope="col">Player</th>
                    <th scope="col" className="num">Votes</th>
                    <th scope="col" className="num">Medals</th>
                    <th scope="col" className="num">Games</th>
                  </tr>
                </thead>
                <tbody>
                  {leaders.rows.map((row) => (
                    <tr key={row.playerId}>
                      <td className="num">{row.rank}</td>
                      <td className="wide">
                        <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                      </td>
                      <td className="num"><strong>{formatNumber(row.votes)}</strong></td>
                      <td className="num">{row.medals > 0 ? row.medals : '—'}</td>
                      <td className="num">{formatNumber(row.games)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleTable>
        </div>
      </section>
    ),
  });

  sections.push({
    id: 'winners-by-season',
    label: 'Winners by season',
    node: (
      <section className="section">
        {/* Anchor target for /brownlow#brownlow-winners links from search. */}
        <div id="brownlow-winners" style={{ scrollMarginTop: '4rem' }}>
        <CollapsibleTable
          id="winners"
          title="Winners by season"
          note={`${winners.length} winners`}
          filters={
            <TableFilters
              action="/brownlow"
              anchor="winners"
              fields={winnerFields}
              values={winnerValues}
              title="Filter winners"
              hidden={leaderCarried}
            />
          }
        >
          {winnersDescribed.length > 0 && (
            <p className="section-note">{winnersDescribed.join(' · ')}</p>
          )}
          {winners.length === 0 ? (
            <div className="empty">
              <h2>No winners match those filters</h2>
              <p>Try widening the season range or clearing the club.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                {/* Shared counts put more than one winner in a season, so these
                    two numbers are genuinely different. */}
                <caption>
                  {winners.length} winners across {seasonCount} seasons
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Season</th>
                    <th scope="col">Winner</th>
                    <th scope="col">Club</th>
                    <th scope="col" className="num">Votes</th>
                  </tr>
                </thead>
                <tbody>
                  {winners.map((row) => (
                    <tr key={`${row.season}-${row.playerId}`}>
                      <td><Link href={`/brownlow/${row.season}`}>{row.season}</Link></td>
                      <td className="wide">
                        <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                      </td>
                      <td>
                        {row.clubSlug ? (
                          <Link href={clubPath(row.clubSlug)}>{row.clubName}</Link>
                        ) : (
                          <span className="not-recorded">—</span>
                        )}
                      </td>
                      <td className="num">{row.votes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleTable>
        </div>
      </section>
    ),
  });

  return (
    <>
      <div className="page-header">
        <h1>Brownlow Medal</h1>
        <p className="subtitle">
          Awarded to the fairest and best player of the season, first presented in 1924.
        </p>
      </div>

      <p className="notice">
        Vote totals come from the official season counts. Round-by-round votes are
        available from 1984; per-game votes were also published for 1931–1934. For
        the seasons in between, only the season total is on record — an absent
        per-game vote means it was not published, not that no vote was polled.
      </p>

      <FilterErrors errors={errors} />

      <ReorderableSections storageKey="/brownlow" sections={sections} />
    </>
  );
}
