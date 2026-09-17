import type { Metadata } from 'next';
import Link from 'next/link';

import { CreatePanel } from '@/app/admin/coaches/CreatePanel';
import { AdminPager } from '@/components/admin/AdminPager';
import { listCoachesForAdmin } from '@/db/queries/admin-coaches';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { coachPath, formatNumber } from '@/lib/format';
import { firstValue } from '@/lib/params';
import { coachSlug } from '@/lib/slugs';

export const metadata: Metadata = { title: 'Coaches', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const LINK_STATUS_LABELS: Record<string, string> = {
  unique: 'Linked',
  unmatched: 'Unlinked',
  ambiguous: 'Ambiguous',
  implausible: 'Implausible',
};

/**
 * `/admin/coaches` -- search, filters, and the bounded create panel
 * (AFLDB-ISSUE-159 §9, Stage 2). Server Component for the read; the create
 * panel is the one interactive piece, and it is Super Admin only.
 */
export default async function CoachesAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.coaches.read');
  const params = await searchParams;

  const q = (firstValue(params.q) ?? '').trim();
  const rawProvenance = firstValue(params.provenance) ?? '';
  const provenance = rawProvenance === 'afltables' || rawProvenance === 'manual' ? rawProvenance : undefined;
  const linkStatus = firstValue(params.linkStatus) || undefined;
  const rawHasOverride = firstValue(params.hasOverride);
  const hasOverride = rawHasOverride === '1' ? true : rawHasOverride === '0' ? false : undefined;

  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const { rows, total } = await listCoachesForAdmin({
    q: q || undefined, provenance, linkStatus, hasOverride, page, pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      q: q || undefined, provenance, linkStatus,
      hasOverride: hasOverride === undefined ? undefined : hasOverride ? '1' : '0',
      ...overrides,
    };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    const qs = search.toString();
    return qs ? `/admin/coaches?${qs}` : '/admin/coaches';
  };
  const pageHref = (p: number) => hrefWith({ page: String(p) });

  const canEdit = hasCapability(admin, 'data.coaches.edit');

  return (
    <>
      <div className="page-header">
        <h1>Coaches</h1>
        <p className="subtitle">
          Every VFL/AFL coach AFLDB knows of, sourced from AFL Tables or created by hand for a
          person the source does not name. Games, W-D-L, finals and premierships are always
          derived from the per-match assignment, never stored here.
        </p>
      </div>

      {canEdit && <CreatePanel />}

      <form method="GET" action="/admin/coaches" className="section" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="search" name="q" defaultValue={q} placeholder="Search by name…" style={{ minWidth: '240px' }} />
        <button type="submit" className="button">Search</button>
        {q && <Link href={hrefWith({ q: undefined })}>Clear</Link>}
      </form>

      <nav className="section" aria-label="Filter by provenance">
        {provenance === undefined
          ? <strong aria-current="true">All</strong>
          : <Link href={hrefWith({ provenance: undefined, page: undefined })}>All</Link>}
        {' · '}
        {provenance === 'afltables'
          ? <strong aria-current="true">AFL Tables</strong>
          : <Link href={hrefWith({ provenance: 'afltables', page: undefined })}>AFL Tables</Link>}
        {' · '}
        {provenance === 'manual'
          ? <strong aria-current="true">Manual</strong>
          : <Link href={hrefWith({ provenance: 'manual', page: undefined })}>Manual</Link>}
      </nav>

      <nav className="section" aria-label="Filter by override">
        {hasOverride === undefined
          ? <strong aria-current="true">Any override state</strong>
          : <Link href={hrefWith({ hasOverride: undefined, page: undefined })}>Any override state</Link>}
        {' · '}
        {hasOverride === true
          ? <strong aria-current="true">Has an active override</strong>
          : <Link href={hrefWith({ hasOverride: '1', page: undefined })}>Has an active override</Link>}
      </nav>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="Coach pages"
        summary={<>{' · '}{formatNumber(total)} coach{total === 1 ? '' : 'es'}{q ? ` matching "${q}"` : ''}</>}
      />

      <section className="section">
        <div className="responsive-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">Coach</th>
                  <th scope="col">DOB</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Link status</th>
                  <th scope="col">Matches coached</th>
                  <th scope="col">Override</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/admin/coaches/${row.id}`}>{row.displayName}</Link>
                      {' '}
                      <a href={coachPath(coachSlug(row.displayName), row.id)} className="muted" style={{ fontSize: '0.8rem' }}>
                        view public page
                      </a>
                    </td>
                    <td className="nowrap">{row.dob ?? '—'}</td>
                    <td>
                      <span className="badge">{row.provenance === 'manual' ? 'Manual' : 'AFL Tables'}</span>
                    </td>
                    <td>{LINK_STATUS_LABELS[row.linkStatusValue] ?? row.linkStatusValue}</td>
                    <td className="num">{formatNumber(row.matchesCoached)}</td>
                    <td>{row.hasActiveOverride && <span className="badge">Overridden</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={6} className="muted">No coaches match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={`/admin/coaches/${row.id}`}>{row.displayName}</Link>
                </div>
                <dl className="admin-card-fields">
                  <div>
                    <dt>Link status</dt>
                    <dd>{LINK_STATUS_LABELS[row.linkStatusValue] ?? row.linkStatusValue}</dd>
                  </div>
                  <div>
                    <dt>Provenance</dt>
                    <dd><span className="badge">{row.provenance === 'manual' ? 'Manual' : 'AFL Tables'}</span></dd>
                  </div>
                  <div>
                    <dt>DOB</dt>
                    <dd>{row.dob ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Matches coached</dt>
                    <dd>{formatNumber(row.matchesCoached)}</dd>
                  </div>
                  {row.hasActiveOverride && (
                    <div>
                      <dt>Override</dt>
                      <dd><span className="badge">Overridden</span></dd>
                    </div>
                  )}
                </dl>
                <div className="admin-card-action">
                  <Link href={`/admin/coaches/${row.id}`} className="btn btn-secondary">
                    {canEdit ? 'Manage' : 'View'}
                  </Link>
                </div>
              </li>
            ))}
            {rows.length === 0 && <li className="muted">No coaches match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="Coach pages" />
    </>
  );
}
