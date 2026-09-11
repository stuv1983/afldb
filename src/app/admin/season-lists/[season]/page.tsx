import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CopyForwardPanel } from '@/app/admin/season-lists/CopyForwardPanel';
import { readLeadershipOverview } from '@/db/queries/admin-club-leadership';
import {
  administrableListSeasons,
  FIRST_LIST_SEASON,
  isAdministrableListSeason,
  readSeasonListChanges,
  readSeasonListOverview,
} from '@/db/queries/admin-season-lists';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export async function generateMetadata(
  { params }: { params: Promise<{ season: string }> },
): Promise<Metadata> {
  await requireCapability('data.seasonLists.read');
  const { season } = await params;
  return { title: `${season} season list`, robots: { index: false, follow: false } };
}

/**
 * `/admin/season-lists/[season]` — every eligible club for the season, its
 * member count, and a previous-season comparison (AFLDB-ISSUE-161 §11, §20).
 *
 * For 2027 (`FIRST_LIST_SEASON`, D-2) the comparison is 2026 APPEARANCES,
 * explicitly labelled non-authoritative and never called "the 2026 list" —
 * there is no earlier authoritative list, so copy-forward is not offered;
 * the club page's appearances review panel is where every 2027 add happens.
 * From 2028 the comparison and copy-forward are both list-to-list.
 */
export default async function SeasonListOverviewPage(
  { params }: { params: Promise<{ season: string }> },
) {
  const admin = await requireCapability('data.seasonLists.read');
  const { season: seasonParam } = await params;
  const season = Number(seasonParam);
  if (!Number.isInteger(season)) notFound();

  const bounds = await administrableListSeasons();
  if (!isAdministrableListSeason(season, bounds)) notFound();

  const canEdit = hasCapability(admin, 'data.seasonLists.edit');
  // §9.1: the eligibility rule needs no fixture and no club_seasons row for a
  // future season, so this page renders correctly for a season with zero
  // matches (§9.4).
  const [overview, changes, leadership] = await Promise.all([
    readSeasonListOverview(season),
    readSeasonListChanges(season),
    // AFLDB-ISSUE-163 §18: the Captain column reads the leadership overview
    // query directly -- never re-derived here, so admin and public can never
    // disagree about who is captain.
    readLeadershipOverview(season),
  ]);
  const isFirstSeason = season === FIRST_LIST_SEASON;
  const changesBySlug = new Map(changes.map((entry) => [entry.clubSlug, entry]));
  const leadershipBySlug = new Map(leadership.map((entry) => [entry.clubSlug, entry]));

  const populated = overview.filter((club) => club.members > 0).length;
  const emptyClubs = overview.filter((club) => club.members === 0)
    .map((club) => ({ slug: club.clubSlug, name: club.clubName }));
  const captainsRecorded = leadership.filter((club) => club.captains.length > 0).length;

  return (
    <>
      <div className="page-header">
        <p className="eyebrow"><Link href="/admin/season-lists">← Season lists</Link></p>
        <h1>{season} season list</h1>
        <p className="subtitle">
          {populated} of {overview.length} clubs have a {season} list. Until every eligible club is
          populated, an empty club is UNKNOWN rather than confirmed empty (§8).
          {' '}{captainsRecorded} of {overview.length} clubs have a {season} captain recorded.
        </p>
      </div>

      {isFirstSeason ? (
        <section className="section">
          <p className="notice">
            {FIRST_LIST_SEASON} is the first authoritative season AFLDB holds playing lists for —
            there is no earlier list to copy forward, and {FIRST_LIST_SEASON - 1} match appearances
            are never promoted into membership. Build each club&rsquo;s list from its {FIRST_LIST_SEASON - 1}{' '}
            appearances review panel, where every player is added by an explicit decision.
          </p>
        </section>
      ) : (
        canEdit && <CopyForwardPanel season={season} emptyClubs={emptyClubs} />
      )}

      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Club</th>
                <th scope="col" className="num">Listed</th>
                <th scope="col" className="num">
                  {isFirstSeason ? `Change vs ${season - 1} appearances (non-authoritative)` : `Change vs ${season - 1} list`}
                </th>
                <th scope="col">Captain</th>
                <th scope="col"></th>
              </tr>
            </thead>
            <tbody>
              {overview.map((club) => {
                const change = changesBySlug.get(club.clubSlug);
                const clubLeadership = leadershipBySlug.get(club.clubSlug);
                return (
                  <tr key={club.clubSlug}>
                    <td>{club.clubName}</td>
                    <td className="num">{formatNumber(club.members)}</td>
                    <td className="num">
                      {change ? `+${formatNumber(change.added)} / −${formatNumber(change.departed)}` : '—'}
                    </td>
                    <td>
                      {!clubLeadership || clubLeadership.captains.length === 0
                        ? '—'
                        : clubLeadership.captains.join(' · ')}
                      {clubLeadership && clubLeadership.unlistedActive > 0 && (
                        <>
                          {' '}
                          <span
                            className="badge badge-warn"
                            role="img"
                            aria-label="An active leader is no longer on this club's list"
                            title="An active leader is no longer on this club's list"
                          >
                            !
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <Link href={`/admin/season-lists/${season}/${club.clubSlug}`} className="btn btn-secondary">
                        {club.members === 0 ? 'No list yet' : 'View list'}
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
