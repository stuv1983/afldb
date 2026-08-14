import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ReviewControls } from '@/app/admin/submissions/[id]/ReviewControls';
import { authSql } from '@/db/authClient';
import { requireAdmin } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Review submission',
  robots: { index: false, follow: false },
};

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();

  const { id: idText } = await params;
  const id = Number(idText);
  if (!Number.isInteger(id)) notFound();

  const [submission] = await authSql<{
    id: number; dataset: string; filename: string; status: string;
    rowCount: number | null; uploadedAt: Date; uploaderEmail: string;
    reviewerEmail: string | null; promotedAt: Date | null;
    importBatchId: number | null; error: string | null;
    report: { ok: number; warnings: number; errors: number; duplicates: number } | null;
  }[]>`
    SELECT s.id, s.dataset, s.filename, s.status::text,
           s.row_count AS "rowCount", s.uploaded_at AS "uploadedAt",
           up.email AS "uploaderEmail", rev.email AS "reviewerEmail",
           s.promoted_at AS "promotedAt", s.import_batch_id AS "importBatchId",
           s.error, s.validation_report AS report
      FROM data_submissions s
      JOIN auth_users up ON up.id = s.uploaded_by
      LEFT JOIN auth_users rev ON rev.id = s.reviewed_by
     WHERE s.id = ${id}
  `;
  if (!submission) notFound();

  // Problem rows first, then a sample of clean ones: the reviewer's job
  // is to look at what is wrong, not to scroll past what is right.
  const problemRows = await authSql<{
    rowNo: number; verdict: string | null;
    payload: Record<string, string | null>;
    reasons: { reasons: string[] } | null;
  }[]>`
    SELECT row_no AS "rowNo", verdict, payload, reasons
      FROM data_submission_rows
     WHERE submission_id = ${id} AND (verdict IS DISTINCT FROM 'ok')
     ORDER BY CASE verdict WHEN 'error' THEN 0 ELSE 1 END, row_no
     LIMIT 200
  `;
  const sampleRows = await authSql<{
    rowNo: number; payload: Record<string, string | null>;
  }[]>`
    SELECT row_no AS "rowNo", payload
      FROM data_submission_rows
     WHERE submission_id = ${id}
     ORDER BY row_no
     LIMIT 5
  `;

  const summaryText = (payload: Record<string, string | null>) =>
    Object.entries(payload)
      .filter(([, value]) => value !== null)
      .slice(0, 6)
      .map(([key, value]) => `${key}=${value}`)
      .join(' · ');

  return (
    <>
      <div className="page-header">
        <h1>{submission.filename}</h1>
        <p className="subtitle">
          {submission.dataset} · {formatNumber(submission.rowCount)} rows · uploaded by{' '}
          {submission.uploaderEmail} · status <strong>{submission.status}</strong>
          {submission.reviewerEmail && <> · reviewed by {submission.reviewerEmail}</>}
        </p>
      </div>

      {submission.error && (
        <p className="notice" role="alert"><strong>Error:</strong> {submission.error}</p>
      )}

      {submission.report && (
        <div className="stat-strip">
          <div className="stat">
            <div className="value">{formatNumber(submission.report.ok)}</div>
            <div className="label">Clean rows</div>
          </div>
          <div className="stat">
            <div className="value">{formatNumber(submission.report.warnings)}</div>
            <div className="label">Warnings</div>
          </div>
          <div className="stat">
            <div className="value">{formatNumber(submission.report.errors)}</div>
            <div className="label">Errors</div>
          </div>
          <div className="stat">
            <div className="value">{formatNumber(submission.report.duplicates)}</div>
            <div className="label">Duplicates</div>
          </div>
        </div>
      )}

      <ReviewControls id={submission.id} status={submission.status} />

      {submission.status === 'promoted' && (
        <p className="notice">
          Applied as import batch {submission.importBatchId} on{' '}
          {submission.promotedAt?.toISOString().slice(0, 16).replace('T', ' ')}.
          Re-promoting a corrected file updates the same source records.
        </p>
      )}

      {problemRows.length > 0 && (
        <section className="section">
          <h2>Rows needing attention</h2>
          <p className="section-note">
            Errors block approval. Warnings do not: an unmatched player imports with the
            source spelling and no link, which is AFLDB’s standard treatment.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th scope="col" className="num">Row</th>
                  <th scope="col">Verdict</th>
                  <th scope="col">Reasons</th>
                  <th scope="col">Data</th>
                </tr>
              </thead>
              <tbody>
                {problemRows.map((row) => (
                  <tr key={row.rowNo}>
                    <td className="num">{row.rowNo}</td>
                    <td>
                      <span className={row.verdict === 'error' ? 'badge badge-warn' : 'badge'}>
                        {row.verdict ?? 'unchecked'}
                      </span>
                    </td>
                    <td className="wide">{row.reasons?.reasons?.join('; ') ?? '—'}</td>
                    <td className="wide muted mono" style={{ fontSize: '0.72rem' }}>
                      {summaryText(row.payload)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="section">
        <h2>File sample</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {sampleRows.map((row) => (
                <tr key={row.rowNo}>
                  <td className="num">{row.rowNo}</td>
                  <td className="wide muted mono" style={{ fontSize: '0.72rem' }}>
                    {summaryText(row.payload)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
