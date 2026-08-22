import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
import { JsonLd } from '@/components/JsonLd';
import { SortableTable } from '@/components/SortableTable';
import { TableFilters } from '@/components/TableFilters';
import { getClubOptions } from '@/db/queries/advanced-search';
import {
  RECORD_CATEGORIES,
  getCareerRecord,
  getMatchRecord,
  getRecordCategory,
  getSeasonRecord,
} from '@/db/queries/records';
import {
  clubPath,
  formatDate,
  formatNumber,
  formatRoundShort,
  formatSpan,
  matchPath,
  playerPath,
  seasonPath,
} from '@/lib/format';
import { isFilteredView, notFoundMetadata, pageMetadata } from '@/lib/seo';
import { itemListSchema } from '@/lib/structured-data';
import { SEASON_MAX, SEASON_MIN, clubOptions } from '@/search/list-filters';
import {
  type FilterField,
  describeFilters,
  parseFilterValues,
} from '@/search/table-filters';

// Reading searchParams already makes this render per request; the route
// keeps its generateStaticParams so the category list still seeds the cache.
export const revalidate = 3600;

export function generateStaticParams() {
  return Object.keys(RECORD_CATEGORIES).map((category) => ({ category }));
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const [{ category }, query] = await Promise.all([params, searchParams]);
  const definition = getRecordCategory(category);
  if (!definition) return notFoundMetadata('Record');

  // A record board filtered to one club is a genuinely useful VIEW and a
  // poor search RESULT: it is the same ranking, cut down, under a title
  // that no longer describes it. It stays crawlable so the players on it are
  // still reached, and stops competing with the board it came from.
  return pageMetadata({
    title: `${definition.title} — ${scopeLabel(category)} VFL/AFL Record`,
    description: `${definition.definition} ${
      definition.coverage ?? 'Ranked from AFLDB’s complete match record since 1897.'
    }`,
    path: `/records/${definition.slug}`,
    noindex: isFilteredView(query),
  });
}

/** What the board ranks, so a single-match board is not titled a career one. */
function scopeLabel(category: string): string {
  if (MATCH.has(category)) return 'Single-Match';
  if (category === 'most-goals-in-a-season') return 'Single-Season';
  return 'Career';
}

const CAREER = new Set([
  'most-games', 'most-goals', 'most-finals', 'most-premierships', 'most-brownlow-votes',
]);
const MATCH = new Set(['most-goals-in-a-game', 'most-disposals-in-a-game']);

export default async function RecordCategoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ category: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ category }, query] = await Promise.all([params, searchParams]);
  const definition = getRecordCategory(category);
  if (!definition) notFound();

  const isCareer = CAREER.has(category);
  const isMatch = MATCH.has(category);
  const isSeason = category === 'most-goals-in-a-season';

  const clubs = await getClubOptions();
  const fields: FilterField[] = [
    { kind: 'text', key: 'q', label: 'Player', placeholder: 'Search by name' },
    {
      kind: 'select', key: 'club', label: 'Club',
      options: clubOptions(clubs), anyLabel: 'Any club',
      help: isCareer
        ? 'Any club the player appeared for, at any point in their career.'
        : 'The club the player represented on that occasion.',
    },
    { kind: 'range', key: 'value', label: definition.unit, min: 0, max: 5000 },
  ];

  // A career board spans a career; a match or season board sits in one
  // season. Offering "debut season" on a single-match record would be a
  // filter with nothing behind it.
  if (isCareer) {
    fields.push(
      { kind: 'range', key: 'games', label: 'Career games', min: 0, max: 1000 },
      {
        kind: 'range', key: 'debut', label: 'Debut season',
        min: SEASON_MIN, max: SEASON_MAX,
      },
      {
        kind: 'range', key: 'final', label: 'Final season',
        min: SEASON_MIN, max: SEASON_MAX,
      },
    );
  } else {
    fields.push({
      kind: 'range', key: 'season', label: 'Season',
      min: SEASON_MIN, max: SEASON_MAX,
    });
  }
  if (isSeason) {
    fields.push({
      kind: 'range', key: 'games', label: 'Games that season', min: 0, max: 30,
    });
  }
  const values = parseFilterValues(fields, query);
  const recordFilters = { q: values.text.q, club: values.select.club, ranges: values };

  const [careerRows, matchRows, seasonRows] = await Promise.all([
    isCareer ? getCareerRecord(category, 100, recordFilters) : Promise.resolve([]),
    isMatch ? getMatchRecord(category, 50, recordFilters) : Promise.resolve([]),
    isSeason ? getSeasonRecord(50, recordFilters) : Promise.resolve([]),
  ]);

  const described = describeFilters(fields, values);

  // Bars are drawn against the largest value ON SCREEN, not against rank 1:
  // a filtered board legitimately starts at rank 17, and scaling to an
  // absent leader would draw every visible row as a stub.
  const scaleTo = Math.max(
    0,
    ...careerRows.map((r) => r.value),
    ...matchRows.map((r) => r.value),
    ...seasonRows.map((r) => r.value),
  );
  const barWidth = (value: number) =>
    scaleTo > 0 ? `${Math.max(0, (value / scaleTo) * 100)}%` : '0%';

  /** The figure the board ranks on, with the bar that draws it to scale. */
  const valueCell = (value: number) => (
    <td className="num">
      <strong>{formatNumber(value)}</strong>
      <span className="meter-track meter-inline" aria-hidden="true">
        <span className="meter-fill" style={{ width: barWidth(value) }} />
      </span>
    </td>
  );
  const filters = (
    <TableFilters
      action={`/records/${definition.slug}`}
      anchor="records"
      fields={fields}
      values={values}
      title="Filter this record"
    />
  );
  const hasRows = careerRows.length + matchRows.length + seasonRows.length > 0;

  return (
    <>
      <Breadcrumbs items={[
        { label: 'Records', href: '/records' },
        { label: definition.title },
      ]} />

      {/* The board's ORDER is the fact this page exists to state, so it is
          described as an ItemList — but only when it is the whole board.
          A filtered cut is a different, shorter list under the same URL,
          and marking that up as the record would misstate it. */}
      {described.length === 0 && careerRows.length > 0 && (
        <JsonLd data={itemListSchema({
          name: definition.title,
          path: `/records/${definition.slug}`,
          description: definition.definition,
          items: careerRows.map((row) => ({
            name: row.displayName,
            path: playerPath(row.slug, row.playerId),
          })),
        })} />
      )}

      <div className="page-header">
        <h1>{definition.title}</h1>
        <p className="subtitle">
          {definition.definition}
          {described.length > 0 ? ` · ${described.join(' · ')}` : ''}
        </p>
      </div>

      {definition.coverage && <p className="notice">{definition.coverage}</p>}

      <FilterErrors errors={values.errors} />

      {/* Filtering never renumbers the board: the # column is the position
          in the full record, so a club filter shows its players at 1, 4
          and 17 rather than pretending they are the top three. */}
      {!hasRows && (
        <>
          {filters}
          <div className="empty">
            <h2>No record holders match those filters</h2>
            <p>Try clearing the club or widening a range.</p>
          </div>
        </>
      )}

      {careerRows.length > 0 && (
        <CollapsibleTable
          id="records"
          title="Career leaders"
          note={`${careerRows.length} shown`}
          filters={filters}
        >
        <div className="table-wrap">
          <SortableTable
            defaultSort="rank"
            defaultDir="asc"
            caption={`Top ${careerRows.length} by career total`}
            columns={[
              { key: 'rank', label: '#', sortType: 'number', className: 'num' },
              { key: 'player', label: 'Player', sortType: 'text' },
              { key: 'clubs', label: 'Clubs', sortType: 'text' },
              { key: 'span', label: 'Span', sortType: 'text', className: 'num nowrap' },
              { key: 'value', label: definition.unit, sortType: 'number', className: 'num' },
              { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
            ]}
            items={careerRows.map((row) => ({
              id: String(row.playerId),
              values: {
                rank: row.rank,
                player: row.displayName,
                clubs: row.clubNames ?? '',
                span: row.debutSeason ?? 0,
                value: row.value,
                games: row.games,
              },
              element: (
                <tr key={row.playerId}>
                  <td className="num">{row.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  <td className="wide">{row.clubNames ?? '—'}</td>
                  <td className="num nowrap">
                    {formatSpan(row.debutSeason, row.finalSeason)}
                  </td>
                  {valueCell(row.value)}
                  <td className="num">{formatNumber(row.games)}</td>
                </tr>
              ),
            }))}
          />
        </div>
        </CollapsibleTable>
      )}

      {matchRows.length > 0 && (
        <CollapsibleTable
          id="records"
          title="Match performances"
          note={`${matchRows.length} shown`}
          filters={filters}
        >
        <div className="table-wrap">
          <SortableTable
            defaultSort="rank"
            defaultDir="asc"
            caption={`Top ${matchRows.length} single-match performances`}
            columns={[
              { key: 'rank', label: '#', sortType: 'number', className: 'num' },
              { key: 'player', label: 'Player', sortType: 'text' },
              { key: 'value', label: definition.unit, sortType: 'number', className: 'num' },
              { key: 'club', label: 'Club', sortType: 'text' },
              { key: 'opponent', label: 'Opponent', sortType: 'text' },
              { key: 'match', label: 'Match', sortType: 'text', className: 'nowrap' },
            ]}
            items={matchRows.map((row) => ({
              id: `${row.playerId}-${row.matchId}`,
              values: {
                rank: row.rank,
                player: row.displayName,
                value: row.value,
                club: row.clubName,
                opponent: row.opponentName,
                match: row.matchDate.getTime(),
              },
              element: (
                <tr key={`${row.playerId}-${row.matchId}`}>
                  <td className="num">{row.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  {valueCell(row.value)}
                  <td>{row.clubName}</td>
                  <td>{row.opponentName}</td>
                  <td className="nowrap">
                    <Link href={matchPath(row.matchId)}>
                      {row.season} {formatRoundShort(row.roundType, row.roundNumber)}
                    </Link>
                    {' '}
                    <span className="muted">{formatDate(row.matchDate)}</span>
                  </td>
                </tr>
              ),
            }))}
          />
        </div>
        </CollapsibleTable>
      )}

      {seasonRows.length > 0 && (
        <CollapsibleTable
          id="records"
          title="Season leaders"
          note={`${seasonRows.length} shown`}
          filters={filters}
        >
        <div className="table-wrap">
          <SortableTable
            defaultSort="rank"
            defaultDir="asc"
            caption={`Top ${seasonRows.length} single seasons`}
            columns={[
              { key: 'rank', label: '#', sortType: 'number', className: 'num' },
              { key: 'player', label: 'Player', sortType: 'text' },
              { key: 'value', label: definition.unit, sortType: 'number', className: 'num' },
              { key: 'club', label: 'Club', sortType: 'text' },
              { key: 'season', label: 'Season', sortType: 'number', className: 'num' },
              { key: 'games', label: 'Games', sortType: 'number', className: 'num' },
            ]}
            items={seasonRows.map((row) => ({
              id: `${row.playerId}-${row.season}-${row.clubSlug}`,
              values: {
                rank: row.rank,
                player: row.displayName,
                value: row.value,
                club: row.clubName ?? '',
                season: row.season,
                games: row.games,
              },
              element: (
                <tr key={`${row.playerId}-${row.season}-${row.clubSlug}`}>
                  <td className="num">{row.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  {valueCell(row.value)}
                  <td>
                    {row.clubSlug ? (
                      <Link href={clubPath(row.clubSlug)}>{row.clubName}</Link>
                    ) : (
                      <span className="not-recorded">—</span>
                    )}
                  </td>
                  <td className="num"><Link href={seasonPath(row.season)}>{row.season}</Link></td>
                  <td className="num">{formatNumber(row.games)}</td>
                </tr>
              ),
            }))}
          />
        </div>
        </CollapsibleTable>
      )}
    </>
  );
}
