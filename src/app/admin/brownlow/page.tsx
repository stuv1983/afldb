import type { Metadata } from 'next';
import Link from 'next/link';

import {
  SEASON_AUTHORITY_LABEL,
  SEASON_STATUS_LABEL,
  SEASON_STATUS_TONE,
  badgeClass,
  incompleteMatchCount,
} from '@/app/admin/brownlow/labels';
import { listBrownlowSeasons } from '@/db/queries/admin-brownlow';
import {
  getBrownlowSeasonAdminMeta,
  resolveAdminEmails,
} from '@/db/queries/admin-brownlow-ui';
import { requireCapability } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Brownlow administration',
  robots: { index: false, follow: false },
};

function stamp(value: Date | null): string {
  return value ? value.toISOString().slice(0, 16).replace('T', ' ') : '—';
}

export default async function BrownlowSeasonsPage() {
  const viewer = await requireCapability('data.brownlow.read');

  const seasons = await listBrownlowSeasons();
  const polled = seasons.filter((season) => season.polled);

  const meta = await getBrownlowSeasonAdminMeta(polled.map((season) => season.season));
  const emails = await resolveAdminEmails(
    [...meta.values()].flatMap((row) => [row.publishedBy, row.updatedBy]),
  );

  const editor = (season: number): { label: string; at: Date | null } => {
    const row = meta.get(season);
    if (!row) return { label: '—', at: null };
    if (row.publishedBy !== null) {
      return { label: emails.get(row.publishedBy) ?? `user #${row.publishedBy}`, at: row.publishedAt };
    }
    if (row.updatedBy !== null) {
      return { label: emails.get(row.updatedBy) ?? `user #${row.updatedBy}`, at: row.updatedAt };
    }
    return { label: '—', at: row.updatedAt };
  };

  return (
    <>
      <div className="page-header">
        <h1>Brownlow administration</h1>
        <p className="subtitle">
          Enter, finalise and publish Brownlow votes match by match.
          {viewer.role === 'super_admin'
            ? ' You can finalise, correct, void and publish.'
            : ' You can save drafts; a Super Admin finalises and publishes.'}
        </p>
      </div>

      <section className="section">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Season</th>
                <th scope="col">Status</th>
                <th scope="col" className="num">H&amp;A</th>
                <th scope="col" className="num">Final</th>
                <th scope="col" className="num">Draft</th>
                <th scope="col" className="num">Source</th>
                <th scope="col" className="num">Left</th>
                <th scope="col" className="num">Unattached</th>
                <th scope="col">Authority</th>
                <th scope="col">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {polled.map((season) => {
                const left = incompleteMatchCount(season);
                const who = editor(season.season);
                return (
                  <tr key={season.season}>
                    <td>
                      <Link href={`/admin/brownlow/${season.season}`}>{season.season}</Link>
                    </td>
                    <td>
                      <span className={badgeClass(SEASON_STATUS_TONE[season.status])}>
                        {SEASON_STATUS_LABEL[season.status]}
                      </span>
                    </td>
                    <td className="num">{season.expected}</td>
                    <td className="num">{season.final || '—'}</td>
                    <td className="num">{season.draft || '—'}</td>
                    <td className="num">{season.imported || '—'}</td>
                    <td className="num">
                      {left > 0 ? <span className="badge badge-warn">{left}</span> : '0'}
                    </td>
                    <td className="num">
                      {season.unresolved > 0
                        ? <span className="badge badge-warn">{season.unresolved}</span>
                        : '—'}
                    </td>
                    <td className="muted">{SEASON_AUTHORITY_LABEL[season.authority]}</td>
                    <td className="muted" style={{ fontSize: '0.8rem' }}>
                      {who.label}
                      {who.at && <><br />{stamp(who.at)}</>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {polled.length === 0 && (
          <p className="muted">No polled Brownlow seasons found.</p>
        )}
      </section>
    </>
  );
}
