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
  listAfterSirenKicks, listAfterSirenSeasonsForAdmin, provenanceOf,
} from '@/db/queries/admin-special-records';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = {
  title: 'After-the-siren administration',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const EFFECT_LABELS: Record<string, string> = {
  won: 'Won the match',
  drew: 'Drew the match',
  none: 'Changed nothing',
};

/**
 * `/admin/records/after-the-siren` — every recorded kick after the siren
 * (AFLDB-ISSUE-167 §10.2).
 *
 * `cited` is a COLUMN here and never a filter or a lifecycle control. Migration
 * 089 defines it as "false when the source row carried no reference" — an
 * evidence gap about a kick that really happened — and gate G-3 exists because
 * conflating it with `void` would suppress every uncited kick from the public
 * record, the opposite of what 089 decided when it kept them.
 *
 * A pre-season or night-series row resolves to no `matches` row by design
 * (`after_siren_kicks_match_ck`), so "no match" is ordinary here rather than a
 * defect, and the competition column is what tells the two apart.
 */
export default async function AfterTheSirenAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  await requireCapability('data.specialRecords.read');
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
  const rawEffect = firstValue(params.effect) ?? '';
  const effect = rawEffect === 'won' || rawEffect === 'drew' || rawEffect === 'none' ? rawEffect : undefined;
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const [seasons, result] = await Promise.all([
    listAfterSirenSeasonsForAdmin(),
    listAfterSirenKicks({
      status, provenance, link, season, effect, search: q || null, page, pageSize: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const filters = { q: q || undefined, season, status, provenance, link, effect };
  const pageHref = (p: number) => listHref('after-the-siren', { ...filters, page: p });

  return (
    <>
      <div className="page-header">
        <RecordsCrumb href={RECORDS_ROOT} label="Special records" />
        <h1>After the siren</h1>
        <p className="subtitle">{FAMILY_BLURBS['after-the-siren']}</p>
        <p className="muted">
          <Link href={FAMILY_PUBLIC_PATHS['after-the-siren']}>See the public page</Link>
        </p>
      </div>

      <form
        method="GET"
        action={familyListPath('after-the-siren')}
        className="section"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Search
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Player name or source record…"
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
          Effect
          <select name="effect" defaultValue={effect ?? ''}>
            <option value="">Any</option>
            {Object.entries(EFFECT_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
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
        <Link href={familyListPath('after-the-siren')}>Clear</Link>
      </form>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="After-the-siren pages"
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
                  <th scope="col">Kicker</th>
                  <th scope="col" className="num">Season</th>
                  <th scope="col">Round</th>
                  <th scope="col">Match-up</th>
                  <th scope="col">Kick</th>
                  <th scope="col">Cited</th>
                  <th scope="col">Link</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={familyDetailPath('after-the-siren', row.id)}>
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
                    <td>
                      {row.clubName ?? row.clubNameRaw} v {row.opponentName ?? row.opponentNameRaw}
                      {!row.premiershipSeason && (
                        <> <span className="muted" style={{ fontSize: '0.8rem' }}>{row.competition}</span></>
                      )}
                    </td>
                    <td>
                      {row.kickScored} · {EFFECT_LABELS[row.kickEffect] ?? row.kickEffect}
                    </td>
                    <td>{row.cited ? 'Yes' : <span className="muted">No reference</span>}</td>
                    <td>
                      <span className="badge">{row.linkStatus}</span>
                      {row.playerId === null && row.candidateCount > 0 && (
                        <> <span className="muted" style={{ fontSize: '0.8rem' }}>
                          {row.candidateCount} candidate{row.candidateCount === 1 ? '' : 's'}
                        </span></>
                      )}
                    </td>
                    <td>
                      <span className="badge">{PROVENANCE_LABELS[provenanceOf(row.sourceKey)]}</span>
                    </td>
                    <td>{row.status === 'void' ? <span className="badge">Void</span> : 'Active'}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={9} className="muted">No after-the-siren records match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {result.rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={familyDetailPath('after-the-siren', row.id)}>
                    {row.playerDisplayName ?? row.playerNameRaw}
                  </Link>
                </div>
                <dl className="admin-card-fields">
                  <div><dt>Season</dt><dd>{row.season}</dd></div>
                  <div><dt>Round</dt><dd>{row.roundRaw}</dd></div>
                  <div>
                    <dt>Match-up</dt>
                    <dd>{row.clubName ?? row.clubNameRaw} v {row.opponentName ?? row.opponentNameRaw}</dd>
                  </div>
                  <div><dt>Kick</dt><dd>{row.kickScored} · {EFFECT_LABELS[row.kickEffect] ?? row.kickEffect}</dd></div>
                  <div><dt>Cited</dt><dd>{row.cited ? 'Yes' : 'No reference'}</dd></div>
                  <div><dt>Link</dt><dd>{row.linkStatus}</dd></div>
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
                  <Link href={familyDetailPath('after-the-siren', row.id)} className="btn btn-secondary">
                    View record
                  </Link>
                </div>
              </li>
            ))}
            {result.rows.length === 0 && <li className="muted">No after-the-siren records match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="After-the-siren pages" />
    </>
  );
}
