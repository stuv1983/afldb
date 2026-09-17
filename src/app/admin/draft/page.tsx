import type { Metadata } from 'next';
import Link from 'next/link';

import { AdminPager } from '@/components/admin/AdminPager';
import { listClubs } from '@/db/queries/clubs';
import {
  DRAFT_KINDS,
  DRAFT_LIST_STATES,
  type DraftProvenance,
  isDraftListState,
  listDraftPicksForAdmin,
  needsPlayerLinkReview,
  playerLinksHref,
  readActiveDraftOverrideKeys,
} from '@/db/queries/admin-draft';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = { title: 'Draft administration', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

const PROVENANCE_LABELS: Record<DraftProvenance, string> = {
  draftguru: 'DraftGuru',
  manual: 'Manual',
  legacy: 'Legacy (unrepaired)',
};

const STATE_LABELS: Record<string, string> = {
  override: 'Has an active override',
  duplicate: 'Duplicate of a source selection',
  'awaiting-identity': 'Awaiting AFL Tables identity',
};

const LINK_STATUS_LABELS: Record<string, string> = {
  resolved: 'Linked',
  unmatched: 'Unlinked',
  ambiguous: 'Ambiguous',
  implausible: 'Implausible',
};

/**
 * `/admin/draft` -- search, filters, and the one list of every draft
 * selection AFLDB knows of, whatever its provenance (AFLDB-ISSUE-160 §18).
 * Server Component for the read; every mutation lives on `/admin/draft/new`
 * or `/admin/draft/[id]` and is Super Admin only.
 */
export default async function DraftAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.draft.read');
  const params = await searchParams;

  const q = (firstValue(params.q) ?? '').trim();
  const rawYear = Number(firstValue(params.year) ?? '');
  const year = Number.isInteger(rawYear) && rawYear > 0 ? rawYear : undefined;
  const kind = firstValue(params.kind) || undefined;
  const clubSlug = firstValue(params.club) || undefined;
  const rawProvenance = firstValue(params.provenance) ?? '';
  const provenance = rawProvenance === 'draftguru' || rawProvenance === 'manual' || rawProvenance === 'legacy'
    ? rawProvenance
    : undefined;
  const rawLinkState = firstValue(params.linkState) ?? '';
  const linkState = rawLinkState === 'linked' || rawLinkState === 'unresolved' ? rawLinkState : undefined;
  const rawState = firstValue(params.state) ?? '';
  const state = isDraftListState(rawState) ? rawState : undefined;

  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  // The active override keys are read first, not alongside: `state=override`
  // filters ON them, and `data_overrides` is import-role-only so the list query
  // cannot join it. They are the same set the Override badge renders from --
  // one read, one source of truth.
  const [clubs, overrideKeys] = await Promise.all([listClubs(), readActiveDraftOverrideKeys()]);
  const { rows, total } = await listDraftPicksForAdmin({
    year, kind, clubSlug, q: q || undefined, provenance, linkState, state,
    overrideKeys: state === 'override' ? [...overrideKeys] : undefined,
    page, pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const canEdit = hasCapability(admin, 'data.draft.edit');
  // Navigation only. /admin/player-links enforces its own capability on arrival
  // and owns every mutation there; this just avoids offering a Super-Admin-only
  // destination to a viewer the existing capability model would turn away.
  const canReviewLinks = hasCapability(admin, 'data.playerLinks');

  const hrefWith = (overrides: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      q: q || undefined, year: year ? String(year) : undefined, kind, club: clubSlug,
      provenance, linkState, state, ...overrides,
    };
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(merged)) if (value) search.set(key, value);
    const qs = search.toString();
    return qs ? `/admin/draft?${qs}` : '/admin/draft';
  };
  const pageHref = (p: number) => hrefWith({ page: String(p) });

  return (
    <>
      <div className="page-header">
        <h1>Draft administration</h1>
        <p className="subtitle">
          Every VFL/AFL draft selection AFLDB knows of, sourced from DraftGuru or created by hand
          for a selection or a person the source does not yet name. Provenance, override state and
          legacy (pre-repair) rows are always shown, never hidden behind a plain list.
        </p>
        {canEdit && <p><Link href="/admin/draft/new" className="btn btn-primary">Add a selection…</Link></p>}
      </div>

      <form method="GET" action="/admin/draft" className="section" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Search by name
          <input type="search" name="q" defaultValue={q} placeholder="Player name…" style={{ minWidth: '220px' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Year
          <input type="number" name="year" min={1981} max={2100} defaultValue={year ?? undefined} style={{ width: '7rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Kind
          <select name="kind" defaultValue={kind ?? ''}>
            <option value="">Any</option>
            {DRAFT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Club
          <select name="club" defaultValue={clubSlug ?? ''}>
            <option value="">Any</option>
            {clubs.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Provenance
          <select name="provenance" defaultValue={provenance ?? ''}>
            <option value="">Any</option>
            <option value="draftguru">DraftGuru</option>
            <option value="manual">Manual</option>
            <option value="legacy">Legacy (unrepaired)</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Link state
          <select name="linkState" defaultValue={linkState ?? ''}>
            <option value="">Any</option>
            <option value="linked">Linked</option>
            <option value="unresolved">Unresolved</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          State
          <select name="state" defaultValue={state ?? ''}>
            <option value="">Any</option>
            {DRAFT_LIST_STATES.map((value) => (
              <option key={value} value={value}>{STATE_LABELS[value]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn">Filter</button>
        <Link href="/admin/draft">Clear</Link>
      </form>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="Draft selection pages"
        summary={(
          <>
            {' · '}{formatNumber(total)} selection{total === 1 ? '' : 's'}
            {q ? ` matching "${q}"` : ''}
            {state ? ` · ${STATE_LABELS[state].toLowerCase()}` : ''}
          </>
        )}
      />

      <section className="section">
        <div className="responsive-table">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="num">Year</th>
                  <th scope="col">Event</th>
                  <th scope="col" className="num">Pick</th>
                  <th scope="col">Player</th>
                  <th scope="col">Club</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Link status</th>
                  <th scope="col">Override</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="num">{row.draftYear}</td>
                    <td>{row.draftType} <span className="muted">({row.draftKind ?? '—'})</span></td>
                    <td className="num">{row.pickNumber ?? '—'}</td>
                    <td>
                      <Link href={`/admin/draft/${row.id}`}>{row.playerNameRaw}</Link>
                      {row.playerId !== null && row.playerSlug && (
                        <>
                          {' '}
                          <a href={playerPath(row.playerSlug, row.playerId)} className="muted" style={{ fontSize: '0.8rem' }}>
                            view public page
                          </a>
                        </>
                      )}
                    </td>
                    <td>{row.clubName ?? '—'}</td>
                    <td><span className="badge">{PROVENANCE_LABELS[row.provenance]}</span></td>
                    <td>
                      {LINK_STATUS_LABELS[row.linkStatusValue] ?? row.linkStatusValue}
                      {needsPlayerLinkReview(row) && canReviewLinks && (
                        <>
                          <br />
                          <Link href={playerLinksHref(row)} style={{ fontSize: '0.8rem' }}>
                            Resolve in Player links
                          </Link>
                        </>
                      )}
                    </td>
                    <td>{row.entityKey && overrideKeys.has(row.entityKey) && <span className="badge">Overridden</span>}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="muted">No draft selections match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={`/admin/draft/${row.id}`}>{row.playerNameRaw}</Link>
                  {row.playerId !== null && row.playerSlug && (
                    <>
                      {' '}
                      <a href={playerPath(row.playerSlug, row.playerId)} className="muted" style={{ fontSize: '0.8rem' }}>
                        view public page
                      </a>
                    </>
                  )}
                </div>
                <dl className="admin-card-fields">
                  <div>
                    <dt>Year</dt>
                    <dd>{row.draftYear}</dd>
                  </div>
                  <div>
                    <dt>Event</dt>
                    <dd>{row.draftType} <span className="muted">({row.draftKind ?? '—'})</span></dd>
                  </div>
                  <div>
                    <dt>Pick</dt>
                    <dd>{row.pickNumber ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Club</dt>
                    <dd>{row.clubName ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Provenance</dt>
                    <dd><span className="badge">{PROVENANCE_LABELS[row.provenance]}</span></dd>
                  </div>
                  <div>
                    <dt>Link status</dt>
                    <dd>
                      {LINK_STATUS_LABELS[row.linkStatusValue] ?? row.linkStatusValue}
                      {needsPlayerLinkReview(row) && canReviewLinks && (
                        <>
                          {' '}
                          <Link href={playerLinksHref(row)} style={{ fontSize: '0.8rem' }}>
                            Resolve in Player links
                          </Link>
                        </>
                      )}
                    </dd>
                  </div>
                  {row.entityKey && overrideKeys.has(row.entityKey) && (
                    <div>
                      <dt>Override</dt>
                      <dd><span className="badge">Overridden</span></dd>
                    </div>
                  )}
                </dl>
                <div className="admin-card-action">
                  <Link href={`/admin/draft/${row.id}`} className="btn btn-secondary">View selection</Link>
                </div>
              </li>
            ))}
            {rows.length === 0 && <li className="muted">No draft selections match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="Draft selection pages" />
    </>
  );
}
