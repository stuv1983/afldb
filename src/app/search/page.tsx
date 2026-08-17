import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { SearchBox } from '@/components/SearchBox';
import { aflwOnlySearch, globalSearch } from '@/db/queries/search';
import { getSiteSettings } from '@/db/queries/site-settings';
import { getAdminUser, ROLE_RANK } from '@/lib/auth/session';
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
  const scope = firstValue(params.scope) === 'aflw' ? 'aflw' as const : undefined;
  const hasQuery = query.trim().length >= MIN_QUERY_LENGTH;

  const aflwResults = scope === 'aflw' && hasQuery ? await aflwOnlySearch(query) : null;

  // The player-question intents ("drawn twice or more in one season") link
  // to /grid-solver, whose audience is a runtime setting — only offer them
  // to a visitor that gate would actually admit (see requireAudience).
  let gridSolverIntents = false;
  let diagUser: string | null = null;
  if (scope !== 'aflw' && hasQuery) {
    const { gridAudience } = await getSiteSettings();
    if (gridAudience === 'public') {
      gridSolverIntents = true;
    } else {
      const user = await getAdminUser();
      diagUser = user ? user.role : 'null';
      gridSolverIntents = user !== null && ROLE_RANK[user.role] >= ROLE_RANK[gridAudience];
    }
    // TEMP DIAGNOSTIC — remove after confirming the natural-language search
    // intent path. Logs nothing sensitive: query text, the audience gate's
    // inputs/output, and the resolved intent (or its absence).
    console.error('[nl-search-diag]', JSON.stringify({ query, gridAudience, diagUser, gridSolverIntents }));
  }

  const results = scope !== 'aflw' && hasQuery
    ? await globalSearch(query, 25, { gridSolverIntents })
    : null;

  if (results) {
    console.error('[nl-search-diag] intent:', JSON.stringify(results.intent));
  }

  const otherScopeHref = scope === 'aflw'
    ? `/search?q=${encodeURIComponent(query)}`
    : `/search?q=${encodeURIComponent(query)}&scope=aflw`;

  return (
    <>
      <div className="page-header">
        <h1>{scope === 'aflw' ? 'Search AFLW' : 'Search'}</h1>
      </div>

      <div style={{ maxWidth: '640px', marginBottom: '1.5rem' }}>
        <SearchBox initialQuery={query} autoFocus={!query} scope={scope} />
      </div>

      {hasQuery && (
        <p className="muted" style={{ marginTop: '-1rem', marginBottom: '1.5rem' }}>
          {scope === 'aflw' ? (
            <Link href={otherScopeHref}>Search all AFL history instead →</Link>
          ) : (
            <Link href={otherScopeHref}>Search AFLW only →</Link>
          )}
        </p>
      )}

      {scope === 'aflw' ? (
        !hasQuery ? (
          <p className="muted">
            Enter at least {MIN_QUERY_LENGTH} characters to search.
          </p>
        ) : aflwResults!.total === 0 ? (
          <div className="empty">
            <h2>No AFLW results for “{query}”</h2>
            <p>Check the spelling, or try a surname on its own.</p>
          </div>
        ) : (
          <>
            {aflwResults!.players.length > 0 && (
              <section className="section">
                <CollapsibleTable
                  title="AFLW players"
                  note={`${aflwResults!.players.length} found`}
                >
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Player</th>
                          <th scope="col">AFLW career</th>
                        </tr>
                      </thead>
                      <tbody>
                        {aflwResults!.players.map((r) => (
                          <tr key={r.slug}>
                            <td className="wide">
                              <Link href={searchResultHref(r)}>{r.title}</Link>
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

            {aflwResults!.clubs.length > 0 && (
              <section className="section">
                <h2>AFLW clubs</h2>
                <ul className="ruled-list">
                  {aflwResults!.clubs.map((r) => (
                    <li key={r.slug}>
                      <Link href={searchResultHref(r)}>{r.title}</Link>{' '}
                      <span className="muted">— {r.subtitle}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )
      ) : results === null ? (
        <p className="muted">
          Enter at least {MIN_QUERY_LENGTH} characters to search.
        </p>
      ) : results.total === 0 && !results.intent ? (
        <div className="empty">
          <h2>No results for “{query}”</h2>
          <p>Check the spelling, or try a surname on its own.</p>
        </div>
      ) : (
        <>
          {results.intent && (
            <section className="section search-intent">
              <Link href={results.intent.href} className="search-intent-link">
                <strong>{results.intent.label}</strong>
                <span className="muted"> — {results.intent.detail}</span>
              </Link>
            </section>
          )}

          {/* Direct hits first: a round, season, award or record match is
              close to exact when it fires, and burying it below 25 fuzzy
              player rows would hide the thing the reader typed. */}
          {(results.rounds.length > 0
            || results.awards.length > 0
            || results.records.length > 0) && (
            <section className="section">
              <h2>Go to</h2>
              <ul className="ruled-list">
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
              <ul className="ruled-list">
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
              <ul className="ruled-list">
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
              <ul className="ruled-list">
                {results.seasons.map((r) => (
                  <li key={r.id}>
                    <Link href={seasonPath(r.id)}>{r.title}</Link>{' '}
                    <span className="muted">— {r.subtitle}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* AFLW results stay in their own section. The competitions
              share no players, clubs or records, so a combined list would
              imply a continuity of record that does not exist. */}
          {results.aflwPlayers.length > 0 && (
            <section className="section">
              <CollapsibleTable
                title="AFLW players"
                note={`${results.aflwPlayers.length} found`}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">AFLW career</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.aflwPlayers.map((r) => (
                        <tr key={r.slug}>
                          <td className="wide">
                            <Link href={searchResultHref(r)}>{r.title}</Link>
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

          {results.aflwClubs.length > 0 && (
            <section className="section">
              <h2>AFLW clubs</h2>
              <ul className="ruled-list">
                {results.aflwClubs.map((r) => (
                  <li key={r.slug}>
                    <Link href={searchResultHref(r)}>{r.title}</Link>{' '}
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
