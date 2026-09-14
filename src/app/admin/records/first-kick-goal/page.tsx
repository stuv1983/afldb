import type { Metadata } from 'next';
import Link from 'next/link';

import {
  FAMILY_BLURBS, FAMILY_PUBLIC_PATHS, LINK_FILTER_LABELS, PROVENANCE_LABELS, RECORDS_ROOT,
  STATUS_FILTER_LABELS, familyDetailPath, familyListPath, listHref,
} from '@/app/admin/records/labels';
import { RecordsCrumb } from '@/app/admin/records/SpecialRecordFacts';
import { AdminPager } from '@/components/admin/AdminPager';
import {
  isSpecialRecordLinkFilter, isSpecialRecordProvenance, isSpecialRecordStatusFilter,
  listFirstKickGoalSeasonsForAdmin, listFirstKickGoals, provenanceOf,
} from '@/db/queries/admin-special-records';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = {
  title: 'First-kick-goal administration',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * `/admin/records/first-kick-goal` — every recorded first-kick goal
 * (AFLDB-ISSUE-167 §10.2).
 *
 * The list opens on EVERY status, which is this surface's one deliberate
 * departure from the awards lists. A voided record is the thing an
 * administrator comes here to find, and the manifest holds 334 rows in total,
 * so nothing is gained by hiding them behind a filter first.
 *
 * "Not linked" is a first-class filter because an unlinked row is the one that
 * most often needs looking at, and because the join that resolves the player
 * is a LEFT JOIN precisely so such a row still appears. Linking itself happens
 * in Player links, not here.
 */
export default async function FirstKickGoalAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.specialRecords.read');
  // Furniture only: the creator page and every action behind it assert
  // `data.specialRecords.edit` server-side for themselves.
  const canEdit = hasCapability(admin, 'data.specialRecords.edit');
  const params = await searchParams;

  const q = (firstValue(params.q) ?? '').trim();
  const rawSeason = Number(firstValue(params.season) ?? '');
  const season = Number.isInteger(rawSeason) && rawSeason > 0 ? rawSeason : undefined;
  const rawStatus = firstValue(params.status) ?? '';
  const status = isSpecialRecordStatusFilter(rawStatus) ? rawStatus : 'all';
  const rawProvenance = firstValue(params.provenance) ?? '';
  const provenance = isSpecialRecordProvenance(rawProvenance) ? rawProvenance : undefined;
  const rawLink = firstValue(params.link) ?? '';
  const link = isSpecialRecordLinkFilter(rawLink) ? rawLink : undefined;
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const [seasons, result] = await Promise.all([
    listFirstKickGoalSeasonsForAdmin(),
    listFirstKickGoals({ status, provenance, link, season, search: q || null, page, pageSize: PAGE_SIZE }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const filters = { q: q || undefined, season, status, provenance, link };
  const pageHref = (p: number) => listHref('first-kick-goal', { ...filters, page: p });

  return (
    <>
      <div className="page-header">
        <RecordsCrumb href={RECORDS_ROOT} label="Special records" />
        <h1>First-kick goal</h1>
        <p className="subtitle">{FAMILY_BLURBS['first-kick-goal']}</p>
        <p className="muted">
          <Link href={FAMILY_PUBLIC_PATHS['first-kick-goal']}>See the public page</Link>
          {canEdit && (
            <>
              {' · '}
              <Link href={`${familyListPath('first-kick-goal')}/new`}>Record a manual entry</Link>
            </>
          )}
        </p>
      </div>

      <form
        method="GET"
        action={familyListPath('first-kick-goal')}
        className="section"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Player name or fkg-042…"
            style={{ minWidth: '14rem' }}
          />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Season
          <select name="season" defaultValue={season ?? ''}>
            <option value="">Any</option>
            {seasons.map((year) => <option key={year} value={year}>{year}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Status
          <select name="status" defaultValue={status}>
            {Object.entries(STATUS_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Provenance
          <select name="provenance" defaultValue={provenance ?? ''}>
            <option value="">Any</option>
            {Object.entries(PROVENANCE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Player link
          <select name="link" defaultValue={link ?? ''}>
            <option value="">Any</option>
            {Object.entries(LINK_FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn">Filter</button>
        <Link href={familyListPath('first-kick-goal')}>Clear</Link>
      </form>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="First-kick-goal pages"
        summary={(
          <>
            {' · '}{formatNumber(result.total)} record{result.total === 1 ? '' : 's'}
            {status !== 'all' ? ` · ${STATUS_FILTER_LABELS[status].toLowerCase()}` : ''}
          </>
        )}
      />

      <section className="section">
        <div className="responsive-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Player</th>
                  <th scope="col" className="num">Season</th>
                  <th scope="col">Round</th>
                  <th scope="col">Club</th>
                  <th scope="col">Link</th>
                  <th scope="col">Source record</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={familyDetailPath('first-kick-goal', row.id)}>
                        {row.playerDisplayName ?? row.playerNameRaw}
                      </Link>
                      {row.playerId !== null && row.playerSlug && (
                        <>
                          {' '}
                          <a
                            href={playerPath(row.playerSlug, row.playerId)}
                            className="muted"
                            style={{ fontSize: '0.8rem' }}
                          >
                            view public page
                          </a>
                        </>
                      )}
                    </td>
                    <td className="num">{row.season}</td>
                    <td>{row.roundRaw}</td>
                    <td>{row.clubName ?? row.clubNameRaw}</td>
                    <td>
                      {row.playerId !== null
                        ? <span className="badge">{row.linkStatus}</span>
                        : (
                          <>
                            <span className="badge">{row.linkStatus}</span>
                            {row.candidateCount > 0 && (
                              <> <span className="muted" style={{ fontSize: '0.8rem' }}>
                                {row.candidateCount} candidate{row.candidateCount === 1 ? '' : 's'}
                              </span></>
                            )}
                          </>
                        )}
                    </td>
                    <td style={{ wordBreak: 'break-all' }}>{row.sourceRecordId ?? '—'}</td>
                    <td>
                      <span className="badge">{PROVENANCE_LABELS[provenanceOf(row.sourceKey)]}</span>
                    </td>
                    <td>{row.status === 'void' ? <span className="badge">Void</span> : 'Active'}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={8} className="muted">No first-kick-goal records match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {result.rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={familyDetailPath('first-kick-goal', row.id)}>
                    {row.playerDisplayName ?? row.playerNameRaw}
                  </Link>
                </div>
                <dl className="admin-card-fields">
                  <div><dt>Season</dt><dd>{row.season}</dd></div>
                  <div><dt>Round</dt><dd>{row.roundRaw}</dd></div>
                  <div><dt>Club</dt><dd>{row.clubName ?? row.clubNameRaw}</dd></div>
                  <div><dt>Link</dt><dd>{row.linkStatus}</dd></div>
                  <div><dt>Source record</dt><dd style={{ wordBreak: 'break-all' }}>{row.sourceRecordId ?? '—'}</dd></div>
                  <div>
                    <dt>Provenance</dt>
                    <dd><span className="badge">{PROVENANCE_LABELS[provenanceOf(row.sourceKey)]}</span></dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>{row.status === 'void' ? <span className="badge">Void</span> : 'Active'}</dd>
                  </div>
                </dl>
                <div className="admin-card-action">
                  <Link href={familyDetailPath('first-kick-goal', row.id)} className="btn btn-secondary">
                    View record
                  </Link>
                </div>
              </li>
            ))}
            {result.rows.length === 0 && <li className="muted">No first-kick-goal records match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="First-kick-goal pages" />
    </>
  );
}
