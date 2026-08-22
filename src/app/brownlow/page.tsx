import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { ReorderableSections } from '@/components/ReorderableSections';
import { SortableTable } from '@/components/SortableTable';
import { TableFilters } from '@/components/TableFilters';
import { getClubOptions } from '@/db/queries/advanced-search';
import { getBrownlowCareerLeaders, getBrownlowWinners, getMultipleBrownlowWinners } from '@/db/queries/brownlow';
import { getSiteSettings } from '@/db/queries/site-settings';
import { clubPath, formatNumber, playerPath } from '@/lib/format';
import { pageMetadata } from '@/lib/seo';
import {
  brownlowLeaderFilterFields,
  brownlowWinnerFilterFields,
  clubOptions,
} from '@/search/list-filters';
import { describeFilters, filterQueryParams, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'Brownlow Medal — Winners, Votes & Career Leaders',
  description:
    'Every Brownlow Medal winner since 1924, the full vote count for each season, '
    + 'and the career vote leaders — totalled from the official season counts.',
  path: '/brownlow',
});

/** Career leaders are a leaderboard, so the list stays bounded. */
const LEADER_LIMIT = 50;

export default async function BrownlowPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clubs = await getClubOptions();
  const settings = await getSiteSettings();

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

  const [winners, leaders, multipleWinners] = await Promise.all([
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
    getMultipleBrownlowWinners(),
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
        <div id="brownlow-leaders" className="anchor">
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
          {leaders.rows.length === 0 ? (
            <div className="empty">
              <h2>No players match those filters</h2>
              <p>Try widening the vote or games range.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <SortableTable
                defaultSort="rank"
                defaultDir="asc"
                caption="Most career Brownlow votes"
                columns={[
                  { key: 'rank', label: '#', sortType: 'number', className: 'num' },
                  { key: 'player', label: 'Player', sortType: 'text' },
                  { key: 'votes', label: 'Votes', sortType: 'number', className: 'num' },
                  { key: 'medals', label: 'Medals', sortType: 'number', className: 'num' },
                  { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
                ]}
                items={leaders.rows.map((row) => ({
                  id: String(row.playerId),
                  values: {
                    rank: row.rank,
                    player: row.displayName,
                    votes: row.votes,
                    medals: row.medals,
                    games: row.games,
                  },
                  element: (
                    <tr key={row.playerId}>
                      <td className="num">{row.rank}</td>
                      <td className="wide">
                        <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                      </td>
                      <td className="num"><strong>{formatNumber(row.votes)}</strong></td>
                      <td className="num">{row.medals > 0 ? row.medals : '—'}</td>
                      <td className="num">{formatNumber(row.games)}</td>
                    </tr>
                  ),
                }))}
              />
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
        <div id="brownlow-winners" className="anchor">
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
          {winners.length === 0 ? (
            <div className="empty">
              <h2>No winners match those filters</h2>
              <p>Try widening the season range or clearing the club.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <SortableTable
                defaultSort="season"
                defaultDir="desc"
                caption={`${winners.length} winners across ${seasonCount} seasons`}
                columns={[
                  { key: 'season', label: 'Season', sortType: 'number' },
                  { key: 'winner', label: 'Winner', sortType: 'text' },
                  { key: 'club', label: 'Club', sortType: 'text' },
                  { key: 'votes', label: 'Votes', sortType: 'number', className: 'num' },
                ]}
                items={winners.map((row) => ({
                  id: `${row.season}-${row.playerId}`,
                  values: {
                    season: row.season,
                    winner: row.displayName,
                    club: row.clubName ?? '',
                    votes: row.votes,
                  },
                  element: (
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
                  ),
                }))}
              />
            </div>
          )}
        </CollapsibleTable>
        </div>
      </section>
    ),
  });

  sections.push({
    id: 'multiple-winners',
    label: 'Multiple winners',
    node: (
      <section className="section">
        <div id="multiple-winners" className="anchor">
          <CollapsibleTable
            id="multiple"
            title="Multiple winners"
            note={`${multipleWinners.length} players`}
          >
            {multipleWinners.length === 0 ? (
              <div className="empty">
                <h2>No multiple winners found</h2>
              </div>
            ) : (
              <div className="table-wrap">
                <SortableTable
                  defaultSort="medals"
                  defaultDir="desc"
                  caption="Players with more than one Brownlow Medal"
                  columns={[
                    { key: 'player', label: 'Player', sortType: 'text' },
                    { key: 'medals', label: 'Medals', sortType: 'number', className: 'num' },
                    { key: 'seasons', label: 'Seasons', sortType: 'text' },
                  ]}
                  items={multipleWinners.map((row) => ({
                    id: String(row.playerId),
                    values: {
                      player: row.displayName,
                      medals: row.medals,
                      seasons: row.seasons.join(', '),
                    },
                    element: (
                      <tr key={row.playerId}>
                        <td className="wide">
                          <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                        </td>
                        <td className="num"><strong>{row.medals}</strong></td>
                        <td>
                          {row.seasons.map((season, i) => (
                            <span key={season}>
                              <Link href={`/brownlow/${season}`}>{season}</Link>
                              {i < row.seasons.length - 1 ? ', ' : ''}
                            </span>
                          ))}
                        </td>
                      </tr>
                    ),
                  }))}
                />
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
        {settings.pageIntros.brownlow && (
          <p className="subtitle" style={{ whiteSpace: 'pre-wrap' }}>
            {settings.pageIntros.brownlow}
          </p>
        )}
        {(leadersDescribed.length > 0 || winnersDescribed.length > 0) && (
          <p className="subtitle">
            {/* Both tables' active filters surface here, the way every other
                index page states what the reader is looking at. The two are
                named because this page carries two independent lists. */}
            {leadersDescribed.length > 0 && `Leaders: ${leadersDescribed.join(' · ')}`}
            {leadersDescribed.length > 0 && winnersDescribed.length > 0 && ' · '}
            {winnersDescribed.length > 0 && `Winners: ${winnersDescribed.join(' · ')}`}
          </p>
        )}
      </div>

      <FilterErrors errors={errors} />

      <ReorderableSections storageKey="/brownlow" sections={sections} />
    </>
  );
}
