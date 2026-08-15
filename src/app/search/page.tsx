import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SearchBox } from '@/components/SearchBox';
import { globalSearch } from '@/db/queries/search';
import { clubPath, playerPath, seasonPath, venuePath } from '@/lib/format';
import { firstValue } from '@/lib/params';
import { MIN_QUERY_LENGTH, searchResultHref } from '@/search/constants';

// Results depend entirely on the query string.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Search',
  description: 'Search AFL players, clubs, venues and seasons.',
  alternates: { canonical: '/search' },
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = (firstValue(params.q) ?? '').slice(0, 100);
  const results = query.trim().length >= MIN_QUERY_LENGTH
    ? await globalSearch(query)
    : null;

  return (
    <>
      <div className="page-header">
        <h1>Search</h1>
      </div>

      <div style={{ maxWidth: '640px', marginBottom: '1.5rem' }}>
        <SearchBox initialQuery={query} autoFocus={!query} />
      </div>

      {results === null ? (
        <p className="muted">
          Enter at least {MIN_QUERY_LENGTH} characters to search.
        </p>
      ) : results.total === 0 ? (
        <div className="empty">
          <h2>No results for “{query}”</h2>
          <p>Check the spelling, or try a surname on its own.</p>
        </div>
      ) : (
        <>
          {/* Direct hits first: a round, season, award or record match is
              close to exact when it fires, and burying it below 25 fuzzy
              player rows would hide the thing the reader typed. */}
          {(results.rounds.length > 0
            || results.awards.length > 0
            || results.records.length > 0) && (
            <section className="section">
              <h2>Go to</h2>
              <ul>
                {[...results.rounds, ...results.awards, ...results.records].map((r) => (
                  <li key={`${r.type}-${r.slug}-${r.id}`}>
                    <Link href={searchResultHref(r)}>{r.title}</Link>{' '}
                    {r.subtitle && <span className="muted">— {r.subtitle}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.players.length > 0 && (
            <section className="section">
              <CollapsibleTable title="Players">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">Career</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.players.map((r) => (
                      <tr key={r.id}>
                        <td className="wide">
                          <Link href={playerPath(r.slug, r.id)}>{r.title}</Link>
                        </td>
                        <td className="wide muted">{r.subtitle}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </CollapsibleTable>
            </section>
          )}

          {results.clubs.length > 0 && (
            <section className="section">
              <h2>Clubs</h2>
              <ul>
                {results.clubs.map((r) => (
                  <li key={r.id}>
                    <Link href={clubPath(r.slug)}>{r.title}</Link>{' '}
                    <span className="muted">— {r.subtitle}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.venues.length > 0 && (
            <section className="section">
              <h2>Venues</h2>
              <ul>
                {results.venues.map((r) => (
                  <li key={r.id}>
                    <Link href={venuePath(r.slug)}>{r.title}</Link>{' '}
                    <span className="muted">— {r.subtitle}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {results.seasons.length > 0 && (
            <section className="section">
              <h2>Seasons</h2>
              <ul>
                {results.seasons.map((r) => (
                  <li key={r.id}>
                    <Link href={seasonPath(r.id)}>{r.title}</Link>{' '}
                    <span className="muted">— {r.subtitle}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </>
  );
}
