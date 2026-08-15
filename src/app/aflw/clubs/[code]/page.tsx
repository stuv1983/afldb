import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { TableFilters } from '@/components/TableFilters';
import {
  getAflwClub,
  getAflwClubSeasons,
  getAflwSeasonOptions,
  listAflwPlayers,
} from '@/db/queries/aflw';
import {
  aflwClubPath,
  aflwPlayerPath,
  aflwSeasonPath,
  formatNumber,
  formatPercentage,
} from '@/lib/format';
import { type FilterField, parseFilterValues } from '@/search/table-filters';

export const dynamic = 'force-dynamic';

const PLAYER_LIMIT = 50;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ code: string }>;
}): Promise<Metadata> {
  const { code } = await params;
  const club = await getAflwClub(decodeURIComponent(code));
  if (!club) return { title: 'Club not found' };
  return {
    title: `${club.name} — AFLW`,
    description:
      `${club.name} in the AFLW: ${club.matches} matches, ${club.wins} wins and `
      + `${club.premierships} premierships since 2017.`,
    alternates: { canonical: aflwClubPath(club.code) },
  };
}

export default async function AflwClubPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ code: rawCode }, query] = await Promise.all([params, searchParams]);
  const code = decodeURIComponent(rawCode);

  const club = await getAflwClub(code);
  if (!club) notFound();

  const seasonOptions = await getAflwSeasonOptions();
  const playerFields: FilterField[] = [
    { kind: 'text', key: 'q', label: 'Name', placeholder: 'Search by name' },
    {
      kind: 'select',
      key: 'season',
      label: 'Season',
      anyLabel: 'Every season',
      options: seasonOptions.map((season) => ({ value: season.key, label: season.label })),
    },
    { kind: 'range', key: 'games', label: 'Games (career)', min: 0, max: 300 },
    { kind: 'range', key: 'goals', label: 'Goals (career)', min: 0, max: 500 },
  ];
  const values = parseFilterValues(playerFields, query);

  const [seasons, players] = await Promise.all([
    getAflwClubSeasons(code),
    listAflwPlayers({
      sort: 'games',
      limit: PLAYER_LIMIT,
      offset: 0,
      club: code,
      name: values.text.q,
      seasonKey: values.select.season,
      ranges: values,
    }),
  ]);

  return (
    <>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href="/aflw">AFLW</Link>
        <span aria-hidden="true">/</span>
        <Link href="/aflw/clubs">Clubs</Link>
        <span aria-hidden="true">/</span>
        <span>{club.name}</span>
      </nav>

      <div className="page-header">
        <h1>{club.name}</h1>
        <p className="subtitle">
          AFLW · {club.seasonsContested} seasons · {formatNumber(club.matches)} matches
        </p>
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="value">{formatNumber(club.matches)}</div>
          <div className="label">Matches</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(club.wins)}</div>
          <div className="label">Wins</div>
        </div>
        <div className="stat">
          <div className="value">
            {club.matches > 0 ? formatPercentage((club.wins / club.matches) * 100) : '—'}
          </div>
          <div className="label">Win %</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(club.finals)}</div>
          <div className="label">Finals</div>
        </div>
        <div className="stat">
          <div className="value">{formatNumber(club.premierships)}</div>
          <div className="label">Premierships</div>
        </div>
      </div>

      <section className="section">
        <CollapsibleTable title="Season by season" note={`${seasons.length} seasons`}>
          <div className="table-wrap">
            <table>
              <caption>
                Ladder positions are the home-and-away finish. 2020 was played as two
                conferences, so a rank that season is a rank within its conference.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Season</th>
                  <th scope="col">Conference</th>
                  <th scope="col" className="num">Ladder</th>
                  <th scope="col" className="num">Played</th>
                  <th scope="col" className="num">W–D–L</th>
                  <th scope="col" className="num">%</th>
                  <th scope="col">Premier</th>
                </tr>
              </thead>
              <tbody>
                {seasons.map((season) => (
                  <tr key={`${season.seasonKey}-${season.conference}`}>
                    <td>
                      <Link href={aflwSeasonPath(season.seasonKey)}>{season.seasonLabel}</Link>
                    </td>
                    <td>{season.conference || <span className="muted">—</span>}</td>
                    <td className="num">{season.ladderRank ?? '—'}</td>
                    <td className="num">{season.played ?? '—'}</td>
                    <td className="num nowrap">
                      {season.wins}–{season.draws}–{season.losses}
                    </td>
                    <td className="num">{formatPercentage(season.percentage)}</td>
                    <td>{season.isPremier ? <strong>Premier</strong> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleTable>
      </section>

      <section className="section">
        <CollapsibleTable
          title="Players"
          note={
            players.total > PLAYER_LIMIT
              ? `Top ${PLAYER_LIMIT} by games of ${formatNumber(players.total)}`
              : `${formatNumber(players.total)} players`
          }
          filters={
            <TableFilters
              action={aflwClubPath(code)}
              fields={playerFields}
              values={values}
              title="Filter players"
              submitLabel="Apply"
            />
          }
        >
          {players.rows.length === 0 ? (
            <div className="empty">
              <h2>No players match those filters</h2>
              <p>Try clearing the season or widening a range.</p>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <caption>
                  Career totals span the player’s whole AFLW career, including any
                  games for another club.
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Player</th>
                    <th scope="col">Clubs</th>
                    <th scope="col" className="num">Games</th>
                    <th scope="col" className="num">Goals</th>
                    <th scope="col" className="num">Disposals</th>
                    <th scope="col" className="num">Marks</th>
                    <th scope="col" className="num">Tackles</th>
                  </tr>
                </thead>
                <tbody>
                  {players.rows.map((player) => (
                    <tr key={player.slug}>
                      <td className="wide">
                        <Link href={aflwPlayerPath(player.slug)}>{player.displayName}</Link>
                      </td>
                      <td className="wide">{player.clubNames ?? '—'}</td>
                      <td className="num">{formatNumber(player.games)}</td>
                      <td className="num">{formatNumber(player.goals)}</td>
                      <td className="num">{formatNumber(player.disposals)}</td>
                      <td className="num">{formatNumber(player.marks)}</td>
                      <td className="num">{formatNumber(player.tackles)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CollapsibleTable>
      </section>
    </>
  );
}
