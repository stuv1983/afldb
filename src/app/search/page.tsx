import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { NlAnswerSection } from '@/components/NlAnswerSection';
import { SearchBox } from '@/components/SearchBox';
import { aflwOnlySearch, globalSearch } from '@/db/queries/search';
import { getSiteSettings } from '@/db/queries/site-settings';
import { getAdminUser, ROLE_RANK } from '@/lib/auth/session';
import { clubPath, formatNumber, formatSpan, playerPath, seasonPath, venuePath } from '@/lib/format';
import { NL_RUN_TAG_HEADER, nlRunTagAccepted, parseNlRunTag } from '@/lib/nl-run-tag';
import { NL_SESSION_COOKIE } from '@/lib/nl-session';
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

  const settings = await getSiteSettings();
  const aflwResults = scope === 'aflw' && hasQuery ? await aflwOnlySearch(query) : null;

  // The player-question intents ("drawn twice or more in one season") link
  // to /grid-solver, whose audience is a runtime setting — only offer them
  // to a visitor that gate would actually admit (see requireAudience).
  // A plain-words question ("drawn twice or more") is answered inline
  // below for every reader. This only decides whether the answer also
  // offers "refine in the grid solver", which is a page not everyone may
  // reach (its audience is a runtime setting — see requireAudience).
  let canReachGridSolver = false;
  if (scope !== 'aflw' && hasQuery) {
    if (settings.gridAudience === 'public') {
      canReachGridSolver = true;
    } else {
      const user = await getAdminUser();
      canReachGridSolver = user !== null && ROLE_RANK[user.role] >= ROLE_RANK[settings.gridAudience];
    }
  }

  // Anonymous, unsigned, minted by middleware.ts -- purely a correlation
  // id for nl_search_log's reformulation tracking (docs/search.md's
  // "Search log" section); it never affects the answer itself.
  const nlSessionId = scope !== 'aflw' && hasQuery
    ? (await cookies()).get(NL_SESSION_COOKIE)?.value ?? null
    : null;

  // Provenance for a synthetic qualification run (migration 051). Only
  // read when the deployment has opted in, so a visitor cannot mislabel
  // their own searches as test traffic -- see lib/nl-run-tag.ts.
  const nlRunTag = scope !== 'aflw' && hasQuery && nlRunTagAccepted()
    ? parseNlRunTag((await headers()).get(NL_RUN_TAG_HEADER))
    : null;

  const results = scope !== 'aflw' && hasQuery
    ? await globalSearch(query, 25, { canReachGridSolver, nlSessionId, nlRunTag })
    : null;

  const otherScopeHref = scope === 'aflw'
    ? `/search?q=${encodeURIComponent(query)}`
    : `/search?q=${encodeURIComponent(query)}&scope=aflw`;

  return (
    <>
      <div className="page-header">
        <h1>{scope === 'aflw' ? 'Search AFLW' : 'Search'}</h1>
      </div>

      <div style={{ maxWidth: '640px', marginBottom: '1.5rem' }}>
        <SearchBox
          initialQuery={query}
          autoFocus={!query}
          scope={scope}
          placeholders={scope === 'aflw' ? settings.searchPlaceholdersAflw : settings.searchPlaceholdersAfl}
          intervalSeconds={settings.searchPlaceholderInterval}
          animation={settings.searchPlaceholderAnimation}
        />
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
          {/* The deterministic natural-language engine's answer, when it
              has one -- takes precedence over playerQuestion/clubQuestion
              below (globalSearch nulls those out when this is present),
              so the reader never sees two answer panels for one question. */}
          {results.nlAnswer && <NlAnswerSection answer={results.nlAnswer} />}

          {/* A question asked in plain words, answered here rather than
              linked elsewhere: the reader asked for players, so the
              players are the result. */}
          {results.playerQuestion && (
            <section className="section">
              <CollapsibleTable
                title={`Players with ${results.playerQuestion.label}`}
                note={`${formatNumber(results.playerQuestion.total)} ${
                  results.playerQuestion.total === 1 ? 'player' : 'players'
                }`}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Player</th>
                        <th scope="col">Career</th>
                        <th scope="col" className="num">Games</th>
                        <th scope="col" className="num">Goals</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.playerQuestion.rows.map((p) => (
                        <tr key={p.id}>
                          <td className="wide">
                            <Link href={playerPath(p.slug, p.id)}>{p.displayName}</Link>
                          </td>
                          <td className="muted">{formatSpan(p.debutSeason, p.finalSeason)}</td>
                          <td className="num">{formatNumber(p.games)}</td>
                          <td className="num">{formatNumber(p.goals)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleTable>

              {results.playerQuestion.total > results.playerQuestion.rows.length && (
                <p className="muted" style={{ marginTop: '0.6rem' }}>
                  Showing the {results.playerQuestion.rows.length} with the most games
                  of {formatNumber(results.playerQuestion.total)}.
                  {results.playerQuestion.refineHref && (
                    <>
                      {' '}
                      <Link href={results.playerQuestion.refineHref}>
                        Open in the grid solver to refine →
                      </Link>
                    </>
                  )}
                </p>
              )}
            </section>
          )}

          {/* The club-season sibling of the player answer above:
              "teams to draw twice in one season" is answered by a season,
              not just a club, so each row carries that season's record. */}
          {results.clubQuestion && (
            <section className="section">
              <CollapsibleTable
                title={`Teams with ${results.clubQuestion.label}`}
                note={`${formatNumber(results.clubQuestion.total)} ${
                  results.clubQuestion.total === 1 ? 'season' : 'seasons'
                }`}
              >
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Club</th>
                        <th scope="col">Season</th>
                        <th scope="col" className="num">P</th>
                        <th scope="col" className="num">W</th>
                        <th scope="col" className="num">D</th>
                        <th scope="col" className="num">L</th>
                        <th scope="col" className="num">Ladder</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.clubQuestion.rows.map((r) => (
                        <tr key={`${r.clubId}-${r.season}`}>
                          <td className="wide">
                            <Link href={clubPath(r.clubSlug)}>{r.clubName}</Link>
                          </td>
                          <td><Link href={seasonPath(r.season)}>{r.season}</Link></td>
                          <td className="num">{r.played}</td>
                          <td className="num">{r.wins}</td>
                          <td className="num">{r.draws}</td>
                          <td className="num">{r.losses}</td>
                          <td className="num">{r.ladderRank ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CollapsibleTable>

              {results.clubQuestion.total > results.clubQuestion.rows.length && (
                <p className="muted" style={{ marginTop: '0.6rem' }}>
                  Showing {results.clubQuestion.rows.length} of{' '}
                  {formatNumber(results.clubQuestion.total)} seasons.
                </p>
              )}
            </section>
          )}

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
