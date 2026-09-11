import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { roundHeading, FIXTURE_STATUS_LABELS, PLAYED_STATE_LABELS } from '@/app/admin/fixtures/labels';
import {
  administrableFixtureSeasons,
  classifyFixtureDiagnostics,
  eligibleFixtureClubs,
  isAdministrableFixtureSeason,
  isPlayedState,
  readFixtureSeasonSummary,
  readPlayedMatchesWithoutFixture,
  readSeasonFixtures,
  type SeasonFixtureRow,
} from '@/db/queries/admin-fixtures';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { firstValue } from '@/lib/params';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ season: string }> },
): Promise<Metadata> {
  await requireCapability('data.fixtures.read');
  const { season } = await params;
  return { title: `${season} fixtures`, robots: { index: false, follow: false } };
}

const PLAYED_FILTERS = ['all', 'played', 'unplayed'] as const;
type PlayedFilter = (typeof PLAYED_FILTERS)[number];

function scheduleText(row: SeasonFixtureRow): string {
  if (row.matchDate === null) return 'Date: TBC';
  const parts = [row.matchDate];
  parts.push(row.matchTime === null ? 'Time: TBC' : row.matchTime);
  return parts.join(' · ');
}

function venueText(row: SeasonFixtureRow): { text: string; unmapped: boolean } {
  if (row.venueId !== null) return { text: row.venueRaw ?? '—', unmapped: false };
  if (row.venueRaw !== null) return { text: `${row.venueRaw} (unmapped)`, unmapped: true };
  return { text: 'Venue: TBC', unmapped: false };
}

/**
 * `/admin/fixtures/[season]` — the main fixture-management surface
 * (AFLDB-ISSUE-162 §28). Rounds render as stacked sections, never one wide
 * grid (§28 UX choice). Void fixtures are excluded by default and shown only
 * behind the explicit "Show voided" filter (§16); TBC and unmapped venues are
 * shown with their exact wording, never conflated (§10, §11).
 */
export default async function FixtureSeasonPage(
  { params, searchParams }: {
    params: Promise<{ season: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  },
) {
  const admin = await requireCapability('data.fixtures.read');
  const { season: seasonParam } = await params;
  const search = await searchParams;
  const season = Number(seasonParam);
  if (!Number.isInteger(season)) notFound();

  const bounds = await administrableFixtureSeasons();
  if (!isAdministrableFixtureSeason(season, bounds)) notFound();

  const canEdit = hasCapability(admin, 'data.fixtures.edit');

  const [allFixtures, summary, playedWithoutFixture, eligibleClubs] = await Promise.all([
    readSeasonFixtures(season, { includeVoid: true }),
    readFixtureSeasonSummary(season),
    readPlayedMatchesWithoutFixture(season),
    eligibleFixtureClubs(season),
  ]);
  const diagnostics = classifyFixtureDiagnostics({ fixtures: allFixtures, playedWithoutFixture, eligibleClubs });

  const showVoided = firstValue(search.voided) === '1';
  const roundFilter = firstValue(search.round) ?? '';
  const clubFilter = firstValue(search.club) ?? '';
  const statusFilter = firstValue(search.status) ?? '';
  const tbcOnly = firstValue(search.tbc) === '1';
  const rawPlayed = firstValue(search.played) ?? 'all';
  const playedFilter: PlayedFilter = (PLAYED_FILTERS as readonly string[]).includes(rawPlayed) ? (rawPlayed as PlayedFilter) : 'all';

  const roundOptions = [...new Map(allFixtures.map((f) => [f.roundCode, { code: f.roundCode, heading: roundHeading(f) }])).values()];

  const visible = allFixtures.filter((f) => showVoided || f.status !== 'void');
  const filtered = visible.filter((f) => {
    if (roundFilter && f.roundCode !== roundFilter) return false;
    if (clubFilter && f.homeClubSlug !== clubFilter && f.awayClubSlug !== clubFilter) return false;
    if (statusFilter && f.status !== statusFilter) return false;
    if (tbcOnly && f.matchDate !== null && f.matchTime !== null && (f.venueId !== null || f.venueRaw !== null)) return false;
    if (playedFilter === 'played' && !isPlayedState(f.playedState)) return false;
    if (playedFilter === 'unplayed' && isPlayedState(f.playedState)) return false;
    return true;
  });

  const rounds = new Map<string, SeasonFixtureRow[]>();
  for (const fixture of filtered) {
    rounds.set(fixture.roundCode, [...(rounds.get(fixture.roundCode) ?? []), fixture]);
  }

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href="/admin/fixtures">← Fixtures</Link></p>
        <h1>{season} fixtures</h1>
        <p className="subtitle">
          {summary.fixtures} fixture{summary.fixtures === 1 ? '' : 's'} across {summary.rounds} round{summary.rounds === 1 ? '' : 's'}
          {summary.voided > 0 && ` (${summary.voided} voided, hidden by default)`}. Played state is
          derived from the match record and never stored on the fixture.
        </p>
      </div>

      {canEdit && (
        <section className="section" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <Link href={`/admin/fixtures/${season}/new`} className="btn btn-primary">Add a fixture</Link>
          <Link href={`/admin/fixtures/${season}/new?tab=batch`} className="btn btn-secondary">Enter a round</Link>
        </section>
      )}

      {diagnostics.length > 0 && (
        <section className="section">
          <h2>Diagnostics</h2>
          <ul style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.3rem' }}>
            {/* `round_byes` is emitted once per round (§27), so the code alone
                is not unique across the list -- key on the position too. */}
            {diagnostics.map((d, index) => (
              <li key={`${d.code}-${index}`} style={{ fontSize: '0.85rem' }}>
                <span className={`badge${d.severity === 'invalid' ? ' badge-danger' : d.severity === 'warning' ? ' badge-warn' : ''}`}>
                  {d.severity}
                </span>{' '}
                {d.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <form method="get" style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
            Round
            <select name="round" defaultValue={roundFilter}>
              <option value="">All rounds</option>
              {roundOptions.map((r) => <option key={r.code} value={r.code}>{r.heading}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
            Club
            <select name="club" defaultValue={clubFilter}>
              <option value="">All clubs</option>
              {eligibleClubs.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
            Status
            <select name="status" defaultValue={statusFilter}>
              <option value="">Any status</option>
              <option value="scheduled">Scheduled</option>
              <option value="cancelled">Cancelled</option>
              <option value="void">Void</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
            Played
            <select name="played" defaultValue={playedFilter}>
              <option value="all">All</option>
              <option value="played">Played only</option>
              <option value="unplayed">Unplayed only</option>
            </select>
          </label>
          <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.8rem' }}>
            <input type="checkbox" name="tbc" value="1" defaultChecked={tbcOnly} />
            TBC only
          </label>
          <label style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.8rem' }}>
            <input type="checkbox" name="voided" value="1" defaultChecked={showVoided} />
            Show voided
          </label>
          <button type="submit" className="btn btn-secondary">Filter</button>
          {(roundFilter || clubFilter || statusFilter || tbcOnly || showVoided || playedFilter !== 'all') && (
            <Link href={`/admin/fixtures/${season}`} className="btn btn-secondary">Clear</Link>
          )}
        </form>
      </section>

      {[...rounds.entries()].map(([roundCode, rows]) => (
        <section key={roundCode} className="section">
          <h2>{roundHeading(rows[0])}</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Date · time</th>
                  <th scope="col">Home</th>
                  <th scope="col">Away</th>
                  <th scope="col">Venue</th>
                  <th scope="col">Status</th>
                  <th scope="col">Played</th>
                  <th scope="col"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const venue = venueText(row);
                  return (
                    <tr key={row.fixtureKey}>
                      <td>{scheduleText(row)}</td>
                      <td>{row.homeClubName}</td>
                      <td>{row.awayClubName}</td>
                      <td>{venue.text}</td>
                      <td>
                        {FIXTURE_STATUS_LABELS[row.status]}
                        {row.status === 'void' && row.statusReason && (
                          <span className="muted"> — {row.statusReason}</span>
                        )}
                      </td>
                      <td>
                        <span className={
                          row.playedState === 'ambiguous' ? 'badge badge-danger'
                            : row.playedState === 'played_home_away_differs' || row.scheduleDiffersFromResult ? 'badge badge-warn'
                              : undefined
                        }>
                          {PLAYED_STATE_LABELS[row.playedState]}
                        </span>
                        {row.scheduleDiffersFromResult && <span className="muted"> — schedule differs from result</span>}
                      </td>
                      <td>
                        <Link href={`/admin/fixtures/${season}/${row.fixtureKey}`} className="btn btn-secondary">
                          {canEdit ? 'Manage' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      {filtered.length === 0 && (
        <section className="section">
          <div className="empty">
            <h3>No fixtures match this filter</h3>
            <p>Clear a filter above, or add the first fixture for {season}.</p>
          </div>
        </section>
      )}
    </>
  );
}
