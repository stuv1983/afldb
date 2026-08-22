import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { SortableTable } from '@/components/SortableTable';
import { TableFilters } from '@/components/TableFilters';
import { getClubOptions } from '@/db/queries/advanced-search';
import { getSeasonLeagues, listSeasons } from '@/db/queries/seasons';
import { clubPath, formatNumber, seasonPath } from '@/lib/format';
import { firstValue, parseSeason } from '@/lib/params';
import { pageMetadata } from '@/lib/seo';
import { clubOptions, seasonFilterFields } from '@/search/list-filters';
import {
  describeFilters,
  optionsFrom,
  parseFilterValues,
  toSearchParams,
} from '@/search/table-filters';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = pageMetadata({
  title: 'AFL & VFL Seasons — Ladders, Premiers & Results Since 1897',
  description: 'Every VFL/AFL season from 1897, with premiers, match counts and ladders.',
  path: '/seasons',
});

export default async function SeasonsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;

  // This page filtered on ?from=/?to= before it moved to the declarative
  // fields, and those links are bookmarked and shared. Translating them
  // to the current names keeps them filtering; ignoring them would render
  // the full list with no sign that the range had been dropped.
  const legacyFrom = parseSeason(firstValue(params.from));
  const legacyTo = parseSeason(firstValue(params.to));
  if (legacyFrom !== undefined || legacyTo !== undefined) {
    const { from: _from, to: _to, ...rest } = params;
    const search = toSearchParams(rest);
    if (legacyFrom !== undefined && !search.has('year_min')) {
      search.set('year_min', String(legacyFrom));
    }
    if (legacyTo !== undefined && !search.has('year_max')) {
      search.set('year_max', String(legacyTo));
    }
    redirect(`/seasons?${search}`);
  }

  const [leagues, clubs] = await Promise.all([getSeasonLeagues(), getClubOptions()]);
  const fields = seasonFilterFields({
    leagues: optionsFrom(leagues),
    premiers: clubOptions(clubs),
  });
  const values = parseFilterValues(fields, params);

  const seasons = await listSeasons({
    league: values.select.league,
    status: values.select.status,
    premier: values.select.premier,
    ranges: values,
  });
  const described = describeFilters(fields, values);

  const filters = (
    <TableFilters action="/seasons" anchor="seasons" fields={fields} values={values} />
  );

  return (
    <>
      <div className="page-header">
        <h1>Seasons</h1>
        <p className="subtitle">
          {formatNumber(seasons.length)} seasons from 1897.
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      <FilterErrors errors={values.errors} />

      <CollapsibleTable
        id="seasons"
        title="Seasons"
        note={`${formatNumber(seasons.length)} matching`}
        filters={filters}
      >
        {seasons.length === 0 ? (
          <div className="empty">
            <h2>No seasons match those filters</h2>
            <p>Try widening the season range or clearing the premier.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <SortableTable
              defaultSort="season"
              defaultDir="desc"
              columns={[
                { key: 'season', label: 'Season', sortType: 'number' },
                { key: 'league', label: 'League', sortType: 'text' },
                { key: 'premier', label: 'Premier', sortType: 'text' },
                { key: 'matches', label: 'Matches', sortType: 'number', className: 'num' },
                { key: 'clubs', label: 'Clubs', sortType: 'number', className: 'num' },
                { key: 'status', label: 'Status', sortType: 'text' },
              ]}
              items={seasons.map((s) => ({
                id: s.year,
                values: {
                  season: s.year,
                  league: s.league,
                  premier: s.premierName ?? '',
                  matches: s.matchCount,
                  clubs: s.clubCount,
                  status: s.isComplete ? 'Complete' : 'In progress',
                },
                element: (
                  <tr key={s.year}>
                    <td><Link href={seasonPath(s.year)}>{s.year}</Link></td>
                    <td>{s.league}</td>
                    <td className="wide">
                      {s.premierSlug ? (
                        <Link href={clubPath(s.premierSlug)}>{s.premierName}</Link>
                      ) : (
                        <span className="not-recorded">—</span>
                      )}
                    </td>
                    <td className="num">{formatNumber(s.matchCount)}</td>
                    <td className="num">{formatNumber(s.clubCount)}</td>
                    <td>
                      {s.isComplete
                        ? <span className="muted">Complete</span>
                        : <span className="badge badge-warn">In progress</span>}
                    </td>
                  </tr>
                ),
              }))}
            />
          </div>
        )}
      </CollapsibleTable>
    </>
  );
}
