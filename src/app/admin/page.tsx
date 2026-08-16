import type { Metadata } from 'next';
import Link from 'next/link';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { authSql } from '@/db/authClient';
import { getSiteSettingsForAdmin } from '@/db/queries/site-settings';
import { requireAdmin } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import { GRID_AUDIENCES } from '@/lib/site-settings';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Administration',
  robots: { index: false, follow: false },
};

export default async function AdminDashboard() {
  const admin = await requireAdmin();

  const [{ gridAudience }, submissions, recentAudit] = await Promise.all([
    getSiteSettingsForAdmin(),
    authSql<{
      id: number; dataset: string; filename: string; status: string;
      rowCount: number | null; uploadedAt: Date; email: string;
    }[]>`
      SELECT s.id, s.dataset, s.filename, s.status::text, s.row_count AS "rowCount",
             s.uploaded_at AS "uploadedAt", u.email
        FROM data_submissions s
        JOIN auth_users u ON u.id = s.uploaded_by
       ORDER BY s.uploaded_at DESC
       LIMIT 25
    `,
    authSql<{ at: Date; action: string; actorLabel: string | null }[]>`
      SELECT at, action, actor_label AS "actorLabel"
        FROM auth_audit_log
       ORDER BY at DESC
       LIMIT 15
    `,
  ]);

  const pending = submissions.filter((s) => ['staged', 'validated'].includes(s.status));

  return (
    <>
      <div className="page-header">
        <h1>Administration</h1>
        <p className="subtitle">
          Signed in as {admin.email}.
        </p>
      </div>

      {pending.length > 0 && (
        <p className="notice">
          {pending.length} submission{pending.length === 1 ? '' : 's'} awaiting review.
        </p>
      )}

      {/* The list of destinations that used to live here is the sidebar's job
          now — repeating it was most of what made this page hard to read.
          What stays is the one line that carries information the nav cannot:
          who the grid solver is currently open to. */}
      <p className="section-note">
        <Link href="/grid-solver">Grid solver →</Link>{' '}
        — a 3×3 board of named questions, for spot-checking data by intersection.
        Currently open to {GRID_AUDIENCES.find((a) => a.value === gridAudience)?.label.toLowerCase()}.
      </p>

      <section className="section">
        <div className="split-head">
          <h2>Data submissions</h2>
          <Link className="more" href="/admin/upload">Upload a file →</Link>
        </div>
        {submissions.length === 0 ? (
          <p className="muted">Nothing uploaded yet.</p>
        ) : (
          <CollapsibleTable title="Submissions log">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Dataset</th>
                  <th scope="col" className="num">Rows</th>
                  <th scope="col">Status</th>
                  <th scope="col">By</th>
                </tr>
              </thead>
              <tbody>
                {submissions.map((s) => (
                  <tr key={s.id}>
                    <td className="wide">
                      <Link href={`/admin/submissions/${s.id}`}>{s.filename}</Link>
                    </td>
                    <td>{s.dataset}</td>
                    <td className="num">{s.rowCount === null ? '—' : formatNumber(s.rowCount)}</td>
                    <td>
                      <span className={s.status === 'failed' || s.status === 'rejected'
                        ? 'badge badge-warn' : 'badge'}>
                        {s.status}
                      </span>
                    </td>
                    <td className="muted">{s.email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </CollapsibleTable>
        )}
      </section>

      <section className="section">
        <CollapsibleTable title="Recent activity">
        <div className="table-wrap">
          <table>
            <tbody>
              {recentAudit.map((entry, i) => (
                <tr key={i}>
                  <td className="nowrap muted">{entry.at.toISOString().slice(0, 16).replace('T', ' ')}</td>
                  <td>{entry.action}</td>
                  <td className="muted">{entry.actorLabel ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </CollapsibleTable>
      </section>
    </>
  );
}
