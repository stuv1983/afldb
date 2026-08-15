import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { FilterErrors } from '@/components/FilterErrors';
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
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const { category } = await params;
  const definition = getRecordCategory(category);
  if (!definition) return { title: 'Record not found' };

  return {
    title: `${definition.title} — AFLDB Records`,
    description: definition.definition,
    alternates: { canonical: `/records/${definition.slug}` },
  };
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
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/records">Records</Link>
        <span aria-hidden="true">/</span>
        <span>{definition.title}</span>
      </nav>

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
          <table>
            <caption>Top {careerRows.length} by career total</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col">Clubs</th>
                <th scope="col" className="num">Span</th>
                <th scope="col" className="num">{definition.unit}</th>
                <th scope="col" className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {careerRows.map((row) => (
                <tr key={row.playerId}>
                  <td className="num">{row.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  <td className="wide">{row.clubNames ?? '—'}</td>
                  <td className="num nowrap">
                    {formatSpan(row.debutSeason, row.finalSeason)}
                  </td>
                  <td className="num"><strong>{formatNumber(row.value)}</strong></td>
                  <td className="num">{formatNumber(row.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
          <table>
            <caption>Top {matchRows.length} single-match performances</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">{definition.unit}</th>
                <th scope="col">Club</th>
                <th scope="col">Opponent</th>
                <th scope="col">Match</th>
              </tr>
            </thead>
            <tbody>
              {matchRows.map((row) => (
                <tr key={`${row.playerId}-${row.matchId}`}>
                  <td className="num">{row.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  <td className="num"><strong>{formatNumber(row.value)}</strong></td>
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
              ))}
            </tbody>
          </table>
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
          <table>
            <caption>Top {seasonRows.length} single seasons</caption>
            <thead>
              <tr>
                <th scope="col" className="num">#</th>
                <th scope="col">Player</th>
                <th scope="col" className="num">{definition.unit}</th>
                <th scope="col">Club</th>
                <th scope="col" className="num">Season</th>
                <th scope="col" className="num">Games</th>
              </tr>
            </thead>
            <tbody>
              {seasonRows.map((row) => (
                <tr key={`${row.playerId}-${row.season}-${row.clubSlug}`}>
                  <td className="num">{row.rank}</td>
                  <td className="wide">
                    <Link href={playerPath(row.slug, row.playerId)}>{row.displayName}</Link>
                  </td>
                  <td className="num"><strong>{formatNumber(row.value)}</strong></td>
                  <td><Link href={clubPath(row.clubSlug)}>{row.clubName}</Link></td>
                  <td className="num"><Link href={seasonPath(row.season)}>{row.season}</Link></td>
                  <td className="num">{formatNumber(row.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      )}
    </>
  );
}
