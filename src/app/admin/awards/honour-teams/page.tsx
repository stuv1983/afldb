import type { Metadata } from 'next';
import Link from 'next/link';

import {
  AWARDS_ROOT, DOMAIN_BLURBS, PROVENANCE_LABELS, STATUS_FILTER_LABELS,
  domainDetailPath, domainNewPath, listHref,
} from '@/app/admin/awards/labels';
import { AwardsCrumb } from '@/app/admin/awards/RecordFacts';
import { AdminPager } from '@/components/admin/AdminPager';
import {
  isHonourProvenance, isHonourStatusFilter, listHonourTeamMembers,
  listHonourTeamNamesForAdmin, provenanceOf,
} from '@/db/queries/admin-awards';
import { hasCapability } from '@/lib/auth/capabilities';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber, playerPath } from '@/lib/format';
import { firstValue } from '@/lib/params';

export const metadata: Metadata = { title: 'Honour teams administration', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

/**
 * `/admin/awards/honour-teams` — every recorded representative-team selection
 * (AFLDB-ISSUE-165 §6.2).
 *
 * The linked/unlinked filter is here because it is this domain's own identity
 * distinction, not a cosmetic one: migration 059 keys a LINKED selection on
 * `(team_name, player_id)` and an UNLINKED one on `(team_name,
 * player_name_raw)`, which is what stops a same-named different player from
 * overwriting someone else's selection. Which of the two a row is decides what
 * its durable key says, so an administrator can filter on it.
 */
export default async function HonourTeamsAdminPage(
  { searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> },
) {
  const admin = await requireCapability('data.awards.read');
  const params = await searchParams;

  const q = (firstValue(params.q) ?? '').trim();
  const teamName = firstValue(params.team) || undefined;
  const rawLinked = firstValue(params.linked) ?? '';
  const linked = rawLinked === 'yes' ? true : rawLinked === 'no' ? false : undefined;
  const rawStatus = firstValue(params.status) ?? '';
  const status = isHonourStatusFilter(rawStatus) ? rawStatus : 'active';
  const rawProvenance = firstValue(params.provenance) ?? '';
  const provenance = isHonourProvenance(rawProvenance) ? rawProvenance : undefined;
  const rawPage = Number(firstValue(params.page) ?? '1');
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;

  const [teams, result] = await Promise.all([
    listHonourTeamNamesForAdmin(),
    listHonourTeamMembers({
      status, provenance, teamName, linked, search: q || null, page, pageSize: PAGE_SIZE,
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
  const canEdit = hasCapability(admin, 'data.awards.edit');

  const filters = { q: q || undefined, team: teamName, linked: rawLinked || undefined, status, provenance };
  const pageHref = (p: number) => listHref('honour-teams', { ...filters, page: p });

  return (
    <>
      <div className="page-header">
        <AwardsCrumb href={AWARDS_ROOT} label="Awards &amp; honours" />
        <h1>Honour &amp; representative teams</h1>
        <p className="subtitle">{DOMAIN_BLURBS['honour-teams']}</p>
        {canEdit && (
          <p><Link href={domainNewPath('honour-teams')} className="btn btn-primary">Record a selection…</Link></p>
        )}
      </div>

      <form
        method="GET"
        action={`${AWARDS_ROOT}/honour-teams`}
        className="section"
        style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Search by name
          <input type="search" name="q" defaultValue={q} placeholder="Selected person…" style={{ minWidth: '14rem' }} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Team
          <select name="team" defaultValue={teamName ?? ''}>
            <option value="">Any</option>
            {teams.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Player link
          <select name="linked" defaultValue={rawLinked}>
            <option value="">Any</option>
            <option value="yes">Linked to a player</option>
            <option value="no">Not linked</option>
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
        <Link href={`${AWARDS_ROOT}/honour-teams`}>Clear</Link>
      </form>

      <AdminPager
        page={page}
        totalPages={totalPages}
        pageHref={pageHref}
        label="Honour team pages"
        summary={(
          <>
            {' · '}{formatNumber(result.total)} selection{result.total === 1 ? '' : 's'}
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
                  <th scope="col">Team</th>
                  <th scope="col" className="num">Order</th>
                  <th scope="col">Selected</th>
                  <th scope="col">Position</th>
                  <th scope="col">Player link</th>
                  <th scope="col">Provenance</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.teamName}</td>
                    <td className="num">{row.sortOrder}</td>
                    <td>
                      <Link href={domainDetailPath('honour-teams', row.id)}>{row.playerNameRaw}</Link>
                      {row.playerId !== null && row.playerSlug && (
                        <>
                          {' '}
                          <a href={playerPath(row.playerSlug, row.playerId)} className="muted" style={{ fontSize: '0.8rem' }}>
                            view public page
                          </a>
                        </>
                      )}
                    </td>
                    <td>{row.position ?? '—'}{row.role ? ` · ${row.role}` : ''}</td>
                    <td>{row.playerId !== null ? `Player #${row.playerId}` : <span className="muted">Not linked</span>}</td>
                    <td><span className="badge">{PROVENANCE_LABELS[provenanceOf(row.sourceKey)]}</span></td>
                    <td>{row.status === 'void' ? <span className="badge">Void</span> : 'Active'}</td>
                  </tr>
                ))}
                {result.rows.length === 0 && (
                  <tr><td colSpan={7} className="muted">No selections match this search.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          <ul className="admin-cards">
            {result.rows.map((row) => (
              <li className="admin-card" key={row.id}>
                <div className="admin-card-title">
                  <Link href={domainDetailPath('honour-teams', row.id)}>{row.playerNameRaw}</Link>
                </div>
                <dl className="admin-card-fields">
                  <div><dt>Team</dt><dd>{row.teamName}</dd></div>
                  <div><dt>Order</dt><dd>{row.sortOrder}</dd></div>
                  <div><dt>Position</dt><dd>{row.position ?? '—'}{row.role ? ` · ${row.role}` : ''}</dd></div>
                  <div><dt>Player link</dt><dd>{row.playerId !== null ? `Player #${row.playerId}` : 'Not linked'}</dd></div>
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
                  <Link href={domainDetailPath('honour-teams', row.id)} className="btn btn-secondary">View selection</Link>
                </div>
              </li>
            ))}
            {result.rows.length === 0 && <li className="muted">No selections match this search.</li>}
          </ul>
        </div>
      </section>

      <AdminPager page={page} totalPages={totalPages} pageHref={pageHref} label="Honour team pages" />
    </>
  );
}
