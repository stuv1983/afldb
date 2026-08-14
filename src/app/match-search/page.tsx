import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { Pagination } from '@/components/Pagination';
import { getClubOptions } from '@/db/queries/advanced-search';
import { runMatchSearch } from '@/db/queries/match-search';
import {
  clubPath,
  formatDate,
  formatNumber,
  formatRoundShort,
  formatScore,
  matchPath,
  seasonPath,
} from '@/lib/format';
import {
  MATCH_FIELDS,
  MATCH_OUTCOMES,
  MATCH_SORTS,
  MATCH_TYPES,
  buildMatchQueryString,
  describeMatchQuery,
  parseMatchSearchQuery,
} from '@/search/match-spec';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Match Search',
  description:
    'Search every AFL/VFL match by season, margin, both teams’ scores, '
    + 'combined score, result, finals status and club.',
  alternates: { canonical: '/match-search' },
};

const GROUP_LABELS = {
  scoreline: 'Scoreline',
  when: 'Season',
} as const;

export default async function MatchSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { query, errors } = parseMatchSearchQuery(params);
  const first = (name: string) => {
    const raw = params[name];
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };
  const hasSearch = first('search') === '1'
    || query.filters.length > 0
    || query.clubSlugs.length > 0
    || query.outcome !== 'all'
    || query.matchType !== 'all';

  const [results, clubs] = await Promise.all([
    hasSearch && errors.length === 0
      ? runMatchSearch(query)
      : Promise.resolve({ rows: [], total: 0 }),
    getClubOptions(),
  ]);

  if (hasSearch && errors.length === 0 && results.total > 0) {
    const lastPage = Math.ceil(results.total / query.pageSize);
    if (query.page > lastPage) {
      redirect(`/match-search?${buildMatchQueryString({ ...query, page: lastPage })}`);
    }
  }

  const groups = ['scoreline', 'when'] as const;
  const canonicalQuery = buildMatchQueryString({ ...query, page: 1 });
  const selectedClub = clubs.find((club) => club.slug === query.clubSlugs[0]);
  const descriptions = describeMatchQuery(query);

  return (
    <>
      <div className="page-header">
        <h1>Match Search</h1>
        <p className="subtitle">
          Find games by scoreline, season, club and match type. Every result set
          is a shareable URL. Looking for career statistics?{' '}
          <Link href="/advanced-search">Search players</Link>.
        </p>
      </div>

      <form method="get" action="/match-search">
        <input type="hidden" name="search" value="1" />

        {groups.map((group) => (
          <fieldset
            key={group}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: '0.75rem 1rem 1rem',
              marginBottom: '0.85rem',
            }}
          >
            <legend style={{ fontWeight: 650, fontSize: '0.85rem', padding: '0 0.35rem' }}>
              {GROUP_LABELS[group]}
            </legend>
            <div
              className="grid"
              style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}
            >
              {Object.values(MATCH_FIELDS)
                .filter((field) => field.group === group)
                .map((field) => (
                  <div key={field.key}>
                    <label htmlFor={`${field.key}_min`}>{field.label}</label>
                    <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.15rem' }}>
                      <input
                        id={`${field.key}_min`}
                        name={`${field.key}_min`}
                        type="number"
                        inputMode="numeric"
                        step="1"
                        placeholder="min"
                        min={field.min}
                        max={field.max}
                        defaultValue={first(`${field.key}_min`)}
                        aria-label={`${field.label} minimum`}
                      />
                      <input
                        id={`${field.key}_max`}
                        name={`${field.key}_max`}
                        type="number"
                        inputMode="numeric"
                        step="1"
                        placeholder="max"
                        min={field.min}
                        max={field.max}
                        defaultValue={first(`${field.key}_max`)}
                        aria-label={`${field.label} maximum`}
                      />
                    </div>
                    {field.help && (
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--text-faint)',
                          marginTop: '0.2rem',
                        }}
                      >
                        {field.help}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </fieldset>
        ))}

        <fieldset
          style={{
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)',
            padding: '0.75rem 1rem 1rem',
          }}
        >
          <legend style={{ fontWeight: 650, fontSize: '0.85rem', padding: '0 0.35rem' }}>
            Match details
          </legend>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }}>
            <div>
              <label htmlFor="club">Club</label>
              <select id="club" name="club" defaultValue={query.clubSlugs[0] ?? ''}>
                <option value="">Any club</option>
                {clubs.map((club) => (
                  <option key={club.slug} value={club.slug}>
                    {club.name}{club.isCurrent ? '' : ' (historical)'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="outcome">Result</label>
              <select id="outcome" name="outcome" defaultValue={query.outcome}>
                {Object.entries(MATCH_OUTCOMES).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="match_type">Match type</label>
              <select id="match_type" name="match_type" defaultValue={query.matchType}>
                {Object.entries(MATCH_TYPES).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="sort">Sort by</label>
              <select id="sort" name="sort" defaultValue={query.sort}>
                {Object.entries(MATCH_SORTS).map(([key, option]) => (
                  <option key={key} value={key}>{option.label}</option>
                ))}
              </select>
            </div>
          </div>
        </fieldset>

        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="submit">Search matches</button>
          <Link className="btn btn-secondary" href="/match-search">Reset</Link>
        </div>
      </form>

      {errors.length > 0 && (
        <div className="notice" role="alert" style={{ borderLeftColor: 'var(--loss)' }}>
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}

      {hasSearch && errors.length === 0 && (
        <section className="section">
          <h2>Results</h2>
          <p className="section-note">
            {formatNumber(results.total)} matches
            {descriptions.length > 0 && <> · {descriptions.join(' · ')}</>}
            {selectedClub && <> · Club: {selectedClub.name}</>}
          </p>

          {results.total === 0 ? (
            <div className="empty">
              <h2>No matches meet those criteria</h2>
              <p>Try increasing a maximum or removing a filter.</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Season</th>
                      <th scope="col">Round</th>
                      <th scope="col">Home</th>
                      <th scope="col" className="num">Score</th>
                      <th scope="col">Away</th>
                      <th scope="col" className="num">Margin</th>
                      <th scope="col">Venue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((match) => (
                      <tr key={match.id}>
                        <td className="nowrap">
                          <Link href={matchPath(match.id)}>{formatDate(match.matchDate)}</Link>
                        </td>
                        <td>
                          <Link href={seasonPath(match.season)}>{match.season}</Link>
                        </td>
                        <td>{formatRoundShort(match.roundType, match.roundNumber)}</td>
                        <td className="wide">
                          <Link href={clubPath(match.homeSlug)}>{match.homeName}</Link>
                        </td>
                        <td className="num nowrap">
                          {formatScore(match.homeGoals, match.homeBehinds, match.homeScore)}–
                          {formatScore(match.awayGoals, match.awayBehinds, match.awayScore)}
                        </td>
                        <td className="wide">
                          <Link href={clubPath(match.awaySlug)}>{match.awayName}</Link>
                        </td>
                        <td className="num">
                          {match.result === 'draw' ? 'Draw' : `${match.margin} pts`}
                        </td>
                        <td>{match.venueName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                basePath="/match-search"
                params={Object.fromEntries(new URLSearchParams(canonicalQuery))}
                page={query.page}
                pageSize={query.pageSize}
                total={results.total}
              />
            </>
          )}
        </section>
      )}

      {!hasSearch && (
        <section className="section">
          <h2>Example searches</h2>
          <ul>
            <li>
              <Link href="/match-search?search=1&margin_min=1&margin_max=5&low_score_min=100&outcome=decided&sort=margin_asc">
                Decided by under a goal with both teams scoring 100+
              </Link>
            </li>
            <li>
              <Link href="/match-search?search=1&outcome=draw&total_score_min=200&sort=total_desc">
                Draws with 200 or more combined points
              </Link>
            </li>
            <li>
              <Link href="/match-search?search=1&match_type=finals&margin_max=6&sort=margin_asc">
                Finals decided by six points or fewer, including draws
              </Link>
            </li>
            <li>
              <Link href="/match-search?search=1&high_score_min=180&sort=high_score_desc">
                Games where a team scored 180+
              </Link>
            </li>
          </ul>
        </section>
      )}
    </>
  );
}
