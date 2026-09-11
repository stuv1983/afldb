import type { Metadata } from 'next';
import Link from 'next/link';

import {
  administrableFixtureSeasons,
  classifyFixtureDiagnostics,
  eligibleFixtureClubs,
  isPlayedState,
  readFixtureSeasonSummary,
  readPlayedMatchesWithoutFixture,
  readSeasonFixtures,
} from '@/db/queries/admin-fixtures';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Fixtures', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/fixtures` — the administrable-season selector and operational
 * overview (AFLDB-ISSUE-162 §28). Every season from
 * `max(seasons.year) <= S <= max + 1` (D-3), whether or not it has a
 * fixture yet: "no fixture yet" is an expected state, exactly as ISSUE-161's
 * season-list index treats "no list yet".
 *
 * "Administrable fixture season" is deliberate wording (§8): the upper
 * season is NOT registered in `seasons` yet, only administrable ahead of it.
 */
export default async function FixturesIndexPage() {
  const admin = await requireCapability('data.fixtures.read');
  const canEdit = hasCapability(admin, 'data.fixtures.edit');

  const bounds = await administrableFixtureSeasons();

  if (bounds.first > bounds.last) {
    return (
      <div className="page-header">
        <h1>Fixtures</h1>
        <p className="subtitle">No season is administrable yet: the season register is empty.</p>
      </div>
    );
  }

  const seasons: number[] = [];
  for (let season = bounds.last; season >= bounds.first; season -= 1) seasons.push(season);

  const summaries = await Promise.all(seasons.map(async (season) => {
    const [summary, fixtures, playedWithoutFixture, eligibleClubs] = await Promise.all([
      readFixtureSeasonSummary(season),
      readSeasonFixtures(season),
      readPlayedMatchesWithoutFixture(season),
      eligibleFixtureClubs(season),
    ]);
    const diagnostics = classifyFixtureDiagnostics({ fixtures, playedWithoutFixture, eligibleClubs });
    const issues = diagnostics.filter((d) => d.severity === 'invalid' || d.severity === 'warning').length;
    const played = fixtures.filter((f) => isPlayedState(f.playedState)).length;
    return { season, summary, played, issues };
  }));

  return (
    <>
      <div className="page-header">
        <h1>Fixtures</h1>
        <p className="subtitle">
          Administrable fixture seasons, {bounds.first}–{bounds.last}. A fixture records that a
          match is scheduled; a played result is a separate fact in match administration, linked
          here read-only once it exists.
        </p>
      </div>

      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col" className="num">Fixtures</th>
                <th scope="col" className="num">Rounds</th>
                <th scope="col" className="num">Played</th>
                <th scope="col" className="num">TBC (date/time/venue)</th>
                <th scope="col" className="num">Cancelled</th>
                <th scope="col">Diagnostics</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(({ season, summary, played, issues }) => (
                <tr key={season}>
                  <td>
                    {season}
                    {season === bounds.first && (
                      <span className="badge" style={{ marginLeft: '0.4rem' }}>In progress / current</span>
                    )}
                    {season === bounds.last && bounds.last !== bounds.first && (
                      <span className="badge" style={{ marginLeft: '0.4rem' }}>Next season</span>
                    )}
                  </td>
                  <td className="num">{formatNumber(summary.fixtures)}</td>
                  <td className="num">{formatNumber(summary.rounds)}</td>
                  <td className="num">{formatNumber(played)}</td>
                  <td className="num">
                    {formatNumber(summary.dateTbc)} / {formatNumber(summary.timeTbc)} / {formatNumber(summary.venueTbc)}
                  </td>
                  <td className="num">{formatNumber(summary.cancelled)}</td>
                  <td>
                    {issues > 0 ? (
                      <span className="badge badge-warn">{issues} to review</span>
                    ) : (
                      <span className="muted">None</span>
                    )}
                  </td>
                  <td>
                    <Link href={`/admin/fixtures/${season}`} className="btn btn-secondary">
                      {canEdit ? 'Manage' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
