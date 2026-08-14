import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  RECORD_CATEGORIES,
  getCareerRecord,
  getMatchRecord,
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
  const definition = RECORD_CATEGORIES[category];
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
}: {
  params: Promise<{ category: string }>;
}) {
  const { category } = await params;
  const definition = RECORD_CATEGORIES[category];
  if (!definition) notFound();

  const careerRows = CAREER.has(category) ? await getCareerRecord(category) : [];
  const matchRows = MATCH.has(category) ? await getMatchRecord(category) : [];
  const seasonRows = category === 'most-goals-in-a-season' ? await getSeasonRecord() : [];

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/records">Records</Link>
        <span aria-hidden="true">/</span>
        <span>{definition.title}</span>
      </nav>

      <div className="page-header">
        <h1>{definition.title}</h1>
        <p className="subtitle">{definition.definition}</p>
      </div>

      {definition.coverage && <p className="notice">{definition.coverage}</p>}

      {careerRows.length > 0 && (
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
      )}

      {matchRows.length > 0 && (
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
      )}

      {seasonRows.length > 0 && (
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
      )}
    </>
  );
}
