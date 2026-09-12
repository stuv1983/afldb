import type { Metadata } from 'next';
import Link from 'next/link';

import { administrableListSeasons, currentListSeason, readSeasonListOverview } from '@/db/queries/admin-season-lists';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

export const metadata: Metadata = { title: 'Season lists', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/**
 * `/admin/season-lists` — the season selector (AFLDB-ISSUE-161 §20). Every
 * administrable season from `FIRST_LIST_SEASON` (2027) to the register's
 * last season plus one, whether or not it has a list yet: "no list yet" is
 * an expected state (§9.2 — a season is administrable from the moment it is
 * selected, with no separate initialisation step).
 *
 * Fixture-independent (§9.4): every read here goes through
 * `afldb_season_list_clubs()` and `season_list_members`, neither of which
 * needs a `matches` row, a fixture or a `club_seasons` row for a future
 * season.
 */
export default async function SeasonListsIndexPage() {
  const admin = await requireCapability('data.seasonLists.read');
  const canEdit = hasCapability(admin, 'data.seasonLists.edit');

  const [bounds, current] = await Promise.all([administrableListSeasons(), currentListSeason()]);

  if (bounds.first > bounds.last) {
    return (
      <div className="page-header">
        <h1>Season lists</h1>
        <p className="subtitle">No season is administrable yet: the season register is empty.</p>
      </div>
    );
  }

  const seasons: number[] = [];
  for (let season = bounds.last; season >= bounds.first; season -= 1) seasons.push(season);

  const summaries = await Promise.all(seasons.map(async (season) => {
    const overview = await readSeasonListOverview(season);
    const members = overview.reduce((sum, club) => sum + club.members, 0);
    const populated = overview.filter((club) => club.members > 0).length;
    return { season, clubs: overview.length, populated, members };
  }));

  return (
    <>
      <div className="page-header">
        <h1>Season lists</h1>
        <p className="subtitle">
          Authoritative club playing lists, administered per season from {bounds.first} onward. A
          list membership records administrative intent — who is on a club&rsquo;s list — and is a
          separate fact from who has played a match.
        </p>
      </div>

      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col" className="num">Clubs with a list</th>
                <th scope="col" className="num">Total listed</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {summaries.map((summary) => (
                <tr key={summary.season}>
                  <td>
                    {summary.season}
                    {summary.season === current && (
                      <span className="badge season-badge" style={{ marginLeft: '0.4rem' }}>Latest listed season</span>
                    )}
                    {summary.season === bounds.first && (
                      <span className="badge season-badge" style={{ marginLeft: '0.4rem' }}>First authoritative season</span>
                    )}
                  </td>
                  <td className="num">{summary.populated} / {summary.clubs}</td>
                  <td className="num">{formatNumber(summary.members)}</td>
                  <td>
                    <Link href={`/admin/season-lists/${summary.season}`} className="btn btn-secondary">
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
