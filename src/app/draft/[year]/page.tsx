import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { Pagination } from '@/components/Pagination';
import { RouteSortHeader } from '@/components/RouteSortHeader';
import { TableFilters } from '@/components/TableFilters';
import { UnmatchedPlayer } from '@/components/UnmatchedPlayer';
import { getClubOptions } from '@/db/queries/advanced-search';
import { getDraftTypes, getDraftYears, listDraftPicks } from '@/db/queries/draft';
import { clubPath, formatNumber, isLinked, playerPath } from '@/lib/format';
import { firstValue, parsePage } from '@/lib/params';
import { pageMetadata } from '@/lib/seo';
import { DEFAULT_PAGE_SIZE } from '@/search/constants';
import { clubOptions, draftFilterFields } from '@/search/list-filters';
import {
  describeFilters,
  filterQueryParams,
  optionsFrom,
  parseFilterValues,
} from '@/search/table-filters';

import { Breadcrumbs } from '@/components/Breadcrumbs';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ year: string }>;
}): Promise<Metadata> {
  const { year } = await params;
  return pageMetadata({
    title: `${year} AFL Draft — Every Pick and Trade`,
    description: `Every selection from the ${year} AFL national and rookie drafts.`,
    path: `/draft/${year}`,
  });
}

export default async function DraftYearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { year } = await params;
  const sParams = await searchParams;
  const page = parsePage(firstValue(sParams.page));

  const [types, clubs] = await Promise.all([
    getDraftTypes(),
    getClubOptions(),
  ]);
  const fields = draftFilterFields({
    clubs: clubOptions(clubs),
    types: optionsFrom(types),
  });
  const values = parseFilterValues(fields, sParams);

  const { rows, total } = await listDraftPicks({
    year: Number(year),
    clubSlug: values.select.club,
    origin: values.text.origin,
    draftType: values.select.type,
    q: values.text.q,
    ranges: values,
    sort: firstValue(sParams.sort),
    dir: firstValue(sParams.dir),
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const linkParams = filterQueryParams(fields, values);
  const described = describeFilters(fields, values);

  const filters = (
    <TableFilters action={`/draft/${year}`} anchor="draft-picks" fields={fields} values={values} />
  );

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Draft', href: '/draft' },
        { label: year },
      ]} />

      <div className="page-header">
        <h1>{year} Draft</h1>
        <p className="subtitle">
          {formatNumber(total)} selections.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        id="draft-picks"
        title="Draft picks"
        note={`${formatNumber(total)} matching`}
        filters={filters}
      >
        {rows.length === 0 ? (
          <div className="empty">
            <h2>No draft picks match those filters</h2>
            <p>Try widening the year, club or search term.</p>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <caption>
                  Career games count everything the player went on to play, not
                  only for the club that drafted them. A selection never linked
                  to a player has no career total to show.
                </caption>
                <thead>
                  <tr>
                    <RouteSortHeader sortKey="year" defaultSort="pick" defaultDir="asc" className="num">Year</RouteSortHeader>
                    <RouteSortHeader sortKey="pick" defaultSort="pick" defaultDir="asc" className="num">Pick</RouteSortHeader>
                    <RouteSortHeader sortKey="player" defaultSort="pick" defaultDir="asc" className="wide">Player</RouteSortHeader>
                    <th scope="col">Drafted to</th>
                    <th scope="col" className="muted">Drafted from</th>
                    <RouteSortHeader sortKey="type" defaultSort="pick" defaultDir="asc">Type</RouteSortHeader>
                    <RouteSortHeader sortKey="age" defaultSort="pick" defaultDir="asc" className="num">Age</RouteSortHeader>
                    <RouteSortHeader sortKey="games" defaultSort="pick" defaultDir="asc" className="num">Games</RouteSortHeader>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((pick) => (
                    <tr key={pick.id}>
                      <td className="num">{pick.draftYear}</td>
                      <td className="num">{pick.pickNumber ?? '—'}</td>
                      <td className="wide">
                        {pick.playerId && isLinked(pick.linkStatus) ? (
                          <Link href={playerPath(pick.playerSlug!, pick.playerId)}>
                            {pick.playerDisplayName}
                          </Link>
                        ) : (
                          pick.playerNameRaw
                        )}
                        {!isLinked(pick.linkStatus) && (
                          <UnmatchedPlayer targetTable="draft_picks" targetId={pick.id} />
                        )}
                      </td>
                      <td>
                        {pick.clubSlug ? (
                          <Link href={clubPath(pick.clubSlug)}>{pick.clubName}</Link>
                        ) : (
                          pick.clubNameRaw ?? <span className="muted">—</span>
                        )}
                      </td>
                      <td className="muted">{pick.originClub ?? <span className="not-recorded">—</span>}</td>
                      <td className="nowrap muted">{pick.draftType}</td>
                      <td className="num">{pick.draftAge ?? '—'}</td>
                      <td className="num">
                        {pick.careerGames === null
                          ? <span className="not-recorded">—</span>
                          : formatNumber(pick.careerGames)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              basePath={`/draft/${year}`}
              params={linkParams}
              page={page}
              pageSize={DEFAULT_PAGE_SIZE}
              total={total}
            />
          </>
        )}
      </CollapsibleTable>
    </>
  );
}
