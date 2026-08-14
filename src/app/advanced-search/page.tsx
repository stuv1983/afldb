import type { Metadata } from 'next';
import Link from 'next/link';

import { Pagination } from '@/components/Pagination';
import { getClubOptions, runAdvancedSearch } from '@/db/queries/advanced-search';
import { formatNumber, playerPath } from '@/lib/format';
import {
  DEFAULT_SORT,
  FIELDS,
  SORTS,
  buildQueryString,
  describeQuery,
  parseAdvancedQuery,
} from '@/search/advanced-spec';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Advanced Player Search',
  description:
    'Find AFL players by career games, goals, finals, premierships, Brownlow votes, '
    + 'clubs and debut season. Every search is a shareable link.',
  alternates: { canonical: '/advanced-search' },
};

const GROUP_LABELS: Record<string, string> = {
  career: 'Career',
  honours: 'Honours',
  span: 'Career span',
};

export default async function AdvancedSearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { query, errors } = parseAdvancedQuery(params);

  const hasCriteria = query.filters.length > 0 || query.clubSlugs.length > 0;
  const [results, clubs] = await Promise.all([
    hasCriteria ? runAdvancedSearch(query) : Promise.resolve({ rows: [], total: 0 }),
    getClubOptions(),
  ]);

  const value = (name: string) => {
    const raw = params[name];
    return (Array.isArray(raw) ? raw[0] : raw) ?? '';
  };

  const groups = ['career', 'honours', 'span'] as const;
  const shareQuery = buildQueryString({ ...query, page: 1 });

  return (
    <>
      <div className="page-header">
        <h1>Advanced Player Search</h1>
        <p className="subtitle">
          Combine career criteria to answer statistical questions. Every search is a
          shareable URL.
        </p>
      </div>

      <form method="get" action="/advanced-search">
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
              {Object.values(FIELDS)
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
                        placeholder="min"
                        min={field.min}
                        max={field.max}
                        defaultValue={value(`${field.key}_min`)}
                        aria-label={`${field.label} minimum`}
                      />
                      <input
                        id={`${field.key}_max`}
                        name={`${field.key}_max`}
                        type="number"
                        inputMode="numeric"
                        placeholder="max"
                        min={field.min}
                        max={field.max}
                        defaultValue={value(`${field.key}_max`)}
                        aria-label={`${field.label} maximum`}
                      />
                    </div>
                    {field.help && (
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-faint)', marginTop: '0.2rem' }}>
                        {field.help}
                      </div>
                    )}
                  </div>
                ))}
            </div>
          </fieldset>
        ))}

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))' }}>
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
            <label htmlFor="sort">Sort by</label>
            <select id="sort" name="sort" defaultValue={query.sort}>
              {Object.entries(SORTS).map(([key, option]) => (
                <option key={key} value={key}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ marginTop: '0.9rem', display: 'flex', gap: '0.5rem' }}>
          <button className="btn" type="submit">Search</button>
          <Link className="btn btn-secondary" href="/advanced-search">Reset</Link>
        </div>
      </form>

      {errors.length > 0 && (
        <div className="notice" role="alert" style={{ borderLeftColor: 'var(--loss)' }}>
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}

      {hasCriteria && (
        <section className="section">
          <h2>Results</h2>
          <p className="section-note">
            {formatNumber(results.total)} players match
            {describeQuery(query).length > 0 && <> · {describeQuery(query).join(' · ')}</>}
            {query.clubSlugs.length > 0 && <> · club: {query.clubSlugs.join(', ')}</>}
          </p>

          {results.total === 0 ? (
            <div className="empty">
              <h2>No players match those criteria</h2>
              <p>Try widening a range or removing a filter.</p>
            </div>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Clubs</th>
                      <th scope="col" className="num">Span</th>
                      <th scope="col" className="num">Games</th>
                      <th scope="col" className="num">Goals</th>
                      <th scope="col" className="num">Finals</th>
                      <th scope="col" className="num">Prem</th>
                      <th scope="col" className="num">Brownlow</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="wide">
                          <Link href={playerPath(row.slug, row.id)}>{row.displayName}</Link>
                        </td>
                        <td className="wide">{row.clubNames ?? '—'}</td>
                        <td className="num nowrap">{row.debutSeason}–{row.finalSeason}</td>
                        <td className="num">{formatNumber(row.games)}</td>
                        <td className="num">{formatNumber(row.goals)}</td>
                        <td className="num">{formatNumber(row.finals)}</td>
                        <td className="num">{formatNumber(row.premierships)}</td>
                        <td className="num">{formatNumber(row.brownlowVotes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                basePath="/advanced-search"
                params={Object.fromEntries(new URLSearchParams(shareQuery))}
                page={query.page}
                pageSize={query.pageSize}
                total={results.total}
              />
            </>
          )}
        </section>
      )}

      {!hasCriteria && (
        <section className="section">
          <h2>Example searches</h2>
          <ul>
            <li>
              <Link href="/advanced-search?games_min=200&goals_min=100&finals_min=15">
                200+ games, 100+ goals and 15+ finals
              </Link>
            </li>
            <li>
              <Link href="/advanced-search?debut_min=1960&debut_max=1969&clubs_min=2&clubs_max=2">
                Debuted in the 1960s and played for exactly two clubs
              </Link>
            </li>
            <li>
              <Link href="/advanced-search?games_min=200&games_max=249&finals_min=16">
                200–249 games with 16 or more finals
              </Link>
            </li>
            <li>
              <Link href="/advanced-search?goals_min=50&goals_max=199&brownlow_votes_max=0">
                50–199 career goals and no Brownlow votes
              </Link>
            </li>
            <li>
              <Link href="/advanced-search?premierships_min=4&sort=premierships">
                Four or more premierships
              </Link>
            </li>
          </ul>
        </section>
      )}
    </>
  );
}
