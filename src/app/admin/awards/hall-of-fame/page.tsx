import type { Metadata } from 'next';
import Link from 'next/link';

import {
  AWARDS_ROOT, DOMAIN_BLURBS, PROVENANCE_LABELS, STATUS_FILTER_LABELS,
  domainDetailPath, domainNewPath, listHref,
} from '@/app/admin/awards/labels';
import { AwardsCrumb } from '@/app/admin/awards/RecordFacts';
import { AdminPager } from '@/components/admin/AdminPager';
import {
  isHonourProvenance, isHonourStatusFilter, listHallOfFame,
  listHallOfFameCategoriesForAdmin, provenanceOf,
} from '@/db/queries/admin-awards';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = { title: 'Hall of Fame administration', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * `/admin/awards/hall-of-fame` — every recorded induction (AFLDB-ISSUE-165
 * §6.2, §6.6).
 *
 * The Legend filter is a first-class control because "who are the Legends" is
 * a real administrative question with a real answer; the removal year is a
 * COLUMN and never a filter state, because it is an ordinary fact about a
 * perfectly valid entry, not a lifecycle state. Void is the lifecycle state,
 * and it is filtered separately, which is the whole point of §6.6.
 */
export default async function HallOfFameAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.awards.read');
  const params = await searchParams;

  const q = (firstValue(params.q) ?? '').trim();
  const rawYear = Number(firstValue(params.year) ?? '');
  const inductedYear = Number.isInteger(rawYear) && rawYear > 0 ? rawYear : undefined;
  const category = firstValue(params.category) || undefined;
  const rawLegend = firstValue(params.legend) ?? '';
  const isLegend = rawLegend === 'yes' ? true : rawLegend === 'no' ? false : undefined;
  const rawStatus = firstValue(params.status) ?? '';
  const status = isHonourStatusFilter(rawStatus) ? rawStatus : 'active';
  const rawProvenance = firstValue(params.provenance) ?? '';
  const provenance = isHonourProvenance(rawProvenance) ? rawProvenance : undefined;
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const [categories, result] = await Promise.all([
    listHallOfFameCategoriesForAdmin(),
    listHallOfFame({
      status, provenance, inductedYear, category, isLegend,
      search: q || null, page, pageSize: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const canEdit = hasCapability(admin, 'data.awards.edit');

  const filters = { q: q || undefined, year: inductedYear, category, legend: rawLegend || undefined, status, provenance };
  const pageHref = (p: number) => listHref('hall-of-fame', { ...filters, page: p });

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={AWARDS_ROOT} label="Awards &amp; honours" />
        <h1>Hall of Fame</h1>
        <p className="subtitle">{DOMAIN_BLURBS['hall-of-fame']}</p>
        {canEdit && (
          <p><Link href={domainNewPath('hall-of-fame')} className="btn btn-primary">Record an induction…</Link></p>
        )}
      </div>

      <form
        method="GET"
        action={`${AWARDS_ROOT}/hall-of-fame`}
        className="section"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Search by name
          <input type="search" name="q" defaultValue={q} placeholder="Inductee name…" style={{ minWidth: '14rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Inducted year
          <input type="number" name="year" min={1996} max={2100} defaultValue={inductedYear ?? ''} style={{ width: '7rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Category
          <select name="category" defaultValue={category ?? ''}>
            <option value="">Any</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Legend
          <select name="legend" defaultValue={rawLegend}>
            <option value="">Any</option>
            <option value="yes">Legends only</option>
            <option value="no">Not a Legend</option>
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
        <button type="submit" className="btn">Filter</button>
        <Link href={`${AWARDS_ROOT}/hall-of-fame`}>Clear</Link>
      </form>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="Hall of Fame pages"
        summary={(
          <>
            {' · '}{formatNumber(result.total)} entr{result.total === 1 ? 'y' : 'ies'}
            {status !== 'active' ? ` · ${STATUS_FILTER_LABELS[status].toLowerCase()}` : ''}
          </>
        )}
      />

      <section className="section">
        <div className="responsive-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Inductee</th>
                  <th scope="col" className="num">Inducted</th>
                  <th scope="col">Category</th>
                  <th scope="col">Legend</th>
                  <th scope="col">Removed</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={domainDetailPath('hall-of-fame', row.id)}>{row.name}</Link>
                      {row.playerId !== null && row.playerSlug && (
                        <>
                          {' '}
                          <a href={playerPath(row.playerSlug, row.playerId)} className="muted" style={{ fontSize: '0.8rem' }}>
                            view public page
                          </a>
                        </>
                      )}
                    </td>
                    <td className="num">{row.inductedYear ?? '—'}</td>
                    <td>{row.category ?? '—'}</td>
                    <td>{row.isLegend ? `Legend${row.legendYear ? ` (${row.legendYear})` : ''}` : '—'}</td>
                    <td>{row.removedYear ?? '—'}</td>
                    <td><span className="badge">{PROVENANCE_LABELS[provenanceOf(row.sourceKey)]}</span></td>
                    <td>{row.status === 'void' ? <span className="badge">Void</span> : 'Active'}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={7} className="muted">No Hall of Fame entries match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {result.rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={domainDetailPath('hall-of-fame', row.id)}>{row.name}</Link>
                </div>
                <dl className="admin-card-fields">
                  <div><dt>Inducted</dt><dd>{row.inductedYear ?? '—'}</dd></div>
                  <div><dt>Category</dt><dd>{row.category ?? '—'}</dd></div>
                  <div><dt>Legend</dt><dd>{row.isLegend ? `Yes${row.legendYear ? ` (${row.legendYear})` : ''}` : 'No'}</dd></div>
                  {row.removedYear !== null && <div><dt>Removed</dt><dd>{row.removedYear}</dd></div>}
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
                  <Link href={domainDetailPath('hall-of-fame', row.id)} className="btn btn-secondary">View entry</Link>
                </div>
              </li>
            ))}
            {result.rows.length === 0 && <li className="muted">No Hall of Fame entries match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="Hall of Fame pages" />
    </>
  );
}
