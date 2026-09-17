import type { Metadata } from 'next';
import Link from 'next/link';

import {
  AWARDS_ROOT, DOMAIN_BLURBS, PROVENANCE_LABELS, STATUS_FILTER_LABELS,
  domainDetailPath, domainNewPath, listHref,
} from '@/app/admin/awards/labels';
import { AwardsCrumb } from '@/app/admin/awards/RecordFacts';
import { AdminPager } from '@/components/admin/AdminPager';
import {
  isHonourProvenance, isHonourStatusFilter, listAwardWinners, provenanceOf,
} from '@/db/queries/admin-awards';
import { listAwards } from '@/db/queries/awards';
import { listClubs } from '@/db/queries/clubs';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = { title: 'Award winners', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * `/admin/awards/winners` — every recorded award winner, with the filters an
 * administrator actually needs before deciding anything (AFLDB-ISSUE-165
 * §6.2, §6.3).
 *
 * ACTIVE BY DEFAULT, ALWAYS. The list opens showing what the public site
 * shows. Voided records are one deliberate choice away and are never mixed in
 * silently — "Voided only" is a separate answer from "Active and voided",
 * because "what did we void, and why" is its own question.
 *
 * PROVENANCE IS A COLUMN, not a detail-page footnote: whether a row is
 * source-owned decides whether correcting it needs a durable override to
 * survive the next reload, so an administrator must be able to see it before
 * opening anything.
 */
export default async function AwardWinnersAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.awards.read');
  const params = await searchParams;

  const q = (firstValue(params.q) ?? '').trim();
  const awardSlug = firstValue(params.award) || undefined;
  const clubSlug = firstValue(params.club) || undefined;
  const rawSeason = Number(firstValue(params.season) ?? '');
  const season = Number.isInteger(rawSeason) && rawSeason > 0 ? rawSeason : undefined;
  const rawStatus = firstValue(params.status) ?? '';
  const status = isHonourStatusFilter(rawStatus) ? rawStatus : 'active';
  const rawProvenance = firstValue(params.provenance) ?? '';
  const provenance = isHonourProvenance(rawProvenance) ? rawProvenance : undefined;
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const [awards, clubs, result] = await Promise.all([
    listAwards(),
    listClubs(),
    listAwardWinners({
      status, provenance, awardSlug, clubSlug, season,
      search: q || null, page, pageSize: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const canEdit = hasCapability(admin, 'data.awards.edit');

  const filters = { q: q || undefined, award: awardSlug, club: clubSlug, season, status, provenance };
  const pageHref = (p: number) => listHref('winners', { ...filters, page: p });

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={AWARDS_ROOT} label="Awards &amp; honours" />
        <h1>Award winners</h1>
        <p className="subtitle">{DOMAIN_BLURBS.winners}</p>
        {canEdit && (
          <p><Link href={domainNewPath('winners')} className="btn btn-primary">Record a winner…</Link></p>
        )}
      </div>

      <form
        method="GET"
        action={`${AWARDS_ROOT}/winners`}
        className="section"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Search by name
          <input type="search" name="q" defaultValue={q} placeholder="Recipient name…" style={{ minWidth: '14rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Award
          <select name="award" defaultValue={awardSlug ?? ''}>
            <option value="">Any</option>
            {awards.map((a) => <option key={a.id} value={a.slug}>{a.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Season
          <input type="number" name="season" min={1897} max={2100} defaultValue={season ?? ''} style={{ width: '7rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Club
          <select name="club" defaultValue={clubSlug ?? ''}>
            <option value="">Any</option>
            {clubs.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
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
        <Link href={`${AWARDS_ROOT}/winners`}>Clear</Link>
      </form>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="Award winner pages"
        summary={(
          <>
            {' · '}{formatNumber(result.total)} record{result.total === 1 ? '' : 's'}
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
                  <th scope="col">Award</th>
                  <th scope="col" className="num">Season</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Club</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.awardName}</td>
                    <td className="num">{row.season ?? '—'}</td>
                    <td>
                      <Link href={domainDetailPath('winners', row.id)}>{row.playerNameRaw}</Link>
                      {row.playerId !== null && row.playerSlug && (
                        <>
                          {' '}
                          <a href={playerPath(row.playerSlug, row.playerId)} className="muted" style={{ fontSize: '0.8rem' }}>
                            view public page
                          </a>
                        </>
                      )}
                    </td>
                    <td>{row.clubNameRaw ?? '—'}</td>
                    <td>
                      <span className="badge">{PROVENANCE_LABELS[provenanceOf(row.sourceKey)]}</span>
                    </td>
                    <td>{row.status === 'void' ? <span className="badge">Void</span> : 'Active'}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={6} className="muted">No award winners match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {result.rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={domainDetailPath('winners', row.id)}>{row.playerNameRaw}</Link>
                </div>
                <dl className="admin-card-fields">
                  <div><dt>Award</dt><dd>{row.awardName}</dd></div>
                  <div><dt>Season</dt><dd>{row.season ?? '—'}</dd></div>
                  <div><dt>Club</dt><dd>{row.clubNameRaw ?? '—'}</dd></div>
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
                  <Link href={domainDetailPath('winners', row.id)} className="btn btn-secondary">View record</Link>
                </div>
              </li>
            ))}
            {result.rows.length === 0 && <li className="muted">No award winners match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="Award winner pages" />
    </>
  );
}
