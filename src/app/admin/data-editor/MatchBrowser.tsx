import Link from 'next/link';

import type { AdminMatchSummary } from '@/db/queries/match-admin';
import type { ClubSummary } from '@/db/queries/clubs';
import type { SeasonSummary } from '@/db/queries/seasons';
import { formatDate, formatNumber, formatRoundShort } from '@/lib/format';

type MatchBrowserProps = {
  matches: AdminMatchSummary[];
  total: number;
  clubs: ClubSummary[];
  seasons: SeasonSummary[];
  currentSeason?: number | null;
  currentClubId?: number | null;
  currentRound?: number | null;
  currentQuery?: string | null;
};

export function MatchBrowser({
  matches,
  total,
  clubs,
  seasons,
  currentSeason,
  currentClubId,
  currentRound,
  currentQuery,
}: MatchBrowserProps) {
  const isFiltered = Boolean(currentSeason || currentClubId || currentRound || currentQuery);

  return (
    <section className="section" style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>
            {isFiltered ? `Matching games (${total})` : `Recent matches (${matches.length})`}
          </h2>
          <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
            {isFiltered
              ? 'Filter matches by season, club, round, or search query. Click Match sheet to edit lineups & stats.'
              : 'Showing the latest matches in the database. Filter or search to browse past rounds and seasons.'}
          </p>
        </div>

        {/* Quick Season Jump Chips */}
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          {[2026, 2025, 2024, 2023].map((yr) => (
            <Link
              key={yr}
              href={`/admin/data-editor?season=${yr}`}
              className={`btn ${currentSeason === yr ? 'btn-primary' : 'btn-secondary'}`}
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
            >
              {yr}
            </Link>
          ))}
          {isFiltered && (
            <Link
              href="/admin/data-editor"
              className="btn btn-secondary"
              style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
            >
              Reset filters
            </Link>
          )}
        </div>
      </div>

      {/* Filter Form Bar */}
      <form
        method="get"
        style={{
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          padding: '0.85rem 1rem',
          background: 'var(--bg-subtle)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '1rem',
          alignItems: 'end',
        }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Season
          <select
            name="season"
            defaultValue={currentSeason ?? ''}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.5rem', minWidth: '7rem' }}
          >
            <option value="">All seasons</option>
            {seasons.map((s) => (
              <option key={s.year} value={s.year}>
                {s.year} ({s.league})
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Club
          <select
            name="club_id"
            defaultValue={currentClubId ?? ''}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.5rem', minWidth: '10rem' }}
          >
            <option value="">All clubs</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Round #
          <input
            type="number"
            name="round"
            min={1}
            max={30}
            placeholder="e.g. 24"
            defaultValue={currentRound ?? undefined}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.5rem', width: '5.5rem' }}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', flexGrow: 1, minWidth: '12rem' }}>
          Search match / venue
          <input
            type="text"
            name="match_q"
            placeholder="e.g. Carlton, MCG, Grand Final..."
            defaultValue={currentQuery ?? ''}
            style={{ fontSize: '0.85rem', padding: '0.35rem 0.5rem' }}
          />
        </label>

        <button type="submit" className="btn btn-primary" style={{ padding: '0.4rem 0.9rem' }}>
          Filter games
        </button>
      </form>

      {/* Results Table */}
      {matches.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Round</th>
                <th scope="col">Date</th>
                <th scope="col">Match & Scores</th>
                <th scope="col">Venue</th>
                <th scope="col">Lineup</th>
                <th scope="col" style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m) => {
                const homeWon = m.result === 'home_win';
                const awayWon = m.result === 'away_win';
                return (
                  <tr key={m.id}>
                    <td className="nowrap">
                      <span className="badge" style={{ fontSize: '0.78rem' }}>
                        {m.season} {formatRoundShort(m.roundType, m.roundNumber)}
                      </span>
                    </td>
                    <td className="nowrap muted" style={{ fontSize: '0.85rem' }}>
                      {formatDate(m.matchDate)}
                    </td>
                    <td className="wide">
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: homeWon ? 700 : 400 }}>
                          {m.homeName} {m.homeScore}
                        </span>
                        <span className="muted">v</span>
                        <span style={{ fontWeight: awayWon ? 700 : 400 }}>
                          {m.awayName} {m.awayScore}
                        </span>
                        {m.margin > 0 && (
                          <span className="muted" style={{ fontSize: '0.8rem' }}>
                            ({m.margin} pts)
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="nowrap muted" style={{ fontSize: '0.85rem' }}>
                      {m.venueName}
                      {m.attendance !== null && (
                        <span style={{ fontSize: '0.78rem', display: 'block' }}>
                          Crowd: {formatNumber(m.attendance)}
                        </span>
                      )}
                    </td>
                    <td className="nowrap">
                      {m.playerCount > 0 ? (
                        <span className="badge" style={{ background: 'var(--bg-subtle)' }}>
                          ✓ {m.playerCount} players
                        </span>
                      ) : (
                        <span className="badge badge-warn" style={{ fontSize: '0.78rem' }}>
                          No lineup
                        </span>
                      )}
                    </td>
                    <td className="nowrap" style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                        <Link
                          href={`/admin/data-editor?mode=match-sheet&id=${m.id}`}
                          className="btn btn-primary"
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                        >
                          📋 Match sheet
                        </Link>
                        <Link
                          href={`/admin/data-editor?entity=matches&id=${m.id}`}
                          className="btn btn-secondary"
                          style={{ fontSize: '0.8rem', padding: '0.25rem 0.6rem' }}
                        >
                          Edit details
                        </Link>
                        <Link
                          href={`/matches/${m.id}`}
                          target="_blank"
                          className="muted"
                          style={{ fontSize: '0.8rem' }}
                          title="View public match page"
                        >
                          ↗
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">
          <h3>No matches found matching criteria</h3>
          <p className="muted">Try adjusting the season, club, or search filters above.</p>
        </div>
      )}
    </section>
  );
}
