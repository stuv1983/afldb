import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { CollapsibleTable } from '@/components/CollapsibleTable';
import { authSql } from '@/db/authClient';
import { requireCapability } from '@/lib/auth/session';
import { formatNumber } from '@/lib/format';
import type { ImportBatchId } from '@/lib/import-batch-id';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Submission history',
  robots: { index: false, follow: false },
};

export default async function SubmissionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // The read-only history of a legacy-intake submission: open to every staff
  // role exactly as requireUploader() was (acquisition.legacyIntake is
  // ALL_STAFF), with the uploader-or-admin ownership check below narrowing
  // it per submission. AFLDB V2 Stage 5 retired validation, approval and
  // promotion: the actions in ./actions.ts keep their role guards
  // (AFLDB-ISSUE-158) and refuse.
  const admin = await requireCapability('acquisition.legacyIntake');

  const { id: idText } = await params;
  const id = Number(idText);
  if (!Number.isInteger(id)) notFound();

  const [submission] = await authSql<{
    id: number; dataset: string; filename: string; status: string;
    rowCount: number | null; uploadedAt: Date; uploadedBy: number; uploaderEmail: string;
    reviewerEmail: string | null; promotedAt: Date | null;
    importBatchId: ImportBatchId | null; error: string | null;
    report: { ok: number; warnings: number; errors: number; duplicates: number } | null;
  }[]>`
    SELECT s.id, s.dataset, s.filename, s.status::text,
           s.row_count AS "rowCount", s.uploaded_at AS "uploadedAt",
           s.uploaded_by AS "uploadedBy", up.email AS "uploaderEmail",
           rev.email AS "reviewerEmail",
           s.promoted_at AS "promotedAt", s.import_batch_id AS "importBatchId",
           s.error, s.validation_report AS report
      FROM data_submissions s
      JOIN auth_users up ON up.id = s.uploaded_by
      LEFT JOIN auth_users rev ON rev.id = s.reviewed_by
     WHERE s.id = ${id}
  `;
  if (!submission) notFound();

  // A contributor may only ever see the status of a submission they made
  // themselves -- everyone else's review queue is out of scope for them,
  // same as the rest of /admin.
  if (admin.role === 'contributor' && submission.uploadedBy !== admin.id) notFound();

  // Problem rows first, then a sample of clean ones: the verdicts recorded at
  // the time are what a reader of this history wants to see.
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

      <p className="notice">
        <strong>This submission is read-only history.</strong> CSV submission review and
        promotion have been retired, so it can no longer be validated, approved, rejected or
        promoted. Curated award proposals (<Link href="/admin/operations/awards">operations
        centre</Link>) and the audited data editors replace this path.
      </p>

      {submission.status === 'promoted' && (
        <p className="notice">
          Applied as import batch {submission.importBatchId} on{' '}
          {submission.promotedAt?.toISOString().slice(0, 16).replace('T', ' ')}.
        </p>
      )}

      {problemRows.length > 0 && (
        <section className="section">
          <p className="section-note">
            Verdicts recorded when the file was validated: an error row blocked approval, a warning
            did not.
          </p>
          <CollapsibleTable title="Rows needing attention">
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
          </CollapsibleTable>
        </section>
      )}

      <section className="section">
        <CollapsibleTable title="File sample">
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
        </CollapsibleTable>
      </section>
    </>
  );
}
