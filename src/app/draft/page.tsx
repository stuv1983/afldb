import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { Pagination } from '@/components/Pagination';
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

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL Draft History — Every Pick by Year and Club',
  description:
    'AFL national and rookie draft history from 1981, with every pick, club and player.',
  path: '/draft',
});

export default async function DraftPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const page = parsePage(firstValue(params.page));

  const [years, types, clubs] = await Promise.all([
    getDraftYears(),
    getDraftTypes(),
    getClubOptions(),
  ]);
  const fields = draftFilterFields({
    years: optionsFrom(years.map(String)),
    clubs: clubOptions(clubs),
    types: optionsFrom(types),
  });
  const values = parseFilterValues(fields, params);

  const { rows, total } = await listDraftPicks({
    year: values.select.year ? Number(values.select.year) : undefined,
    clubSlug: values.select.club,
    origin: values.text.origin,
    draftType: values.select.type,
    q: values.text.q,
    ranges: values,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
  });

  const linkParams = filterQueryParams(fields, values);
  const described = describeFilters(fields, values);

  const filters = (
    <TableFilters action="/draft" anchor="draft-picks" fields={fields} values={values} />
  );

  return (
    <>
      <div className="page-header">
        <h1>Draft</h1>
        <p className="subtitle">
          {formatNumber(total)} draft and recruitment selections since 1981.
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
                    <th scope="col" className="num">Year</th>
                    <th scope="col" className="num">Pick</th>
                    <th scope="col">Player</th>
                    <th scope="col">Drafted to</th>
                    <th scope="col">Drafted from</th>
                    <th scope="col">Type</th>
                    <th scope="col" className="num">Age</th>
                    <th scope="col" className="num">Games</th>
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
              basePath="/draft"
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
