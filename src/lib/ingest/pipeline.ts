import 'server-only';

import { createHash } from 'node:crypto';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { getDataset } from '@/lib/ingest/datasets';
import { CsvError, parseCsv, toObjects } from '@/lib/ingest/csv';

/**
 * The submission pipeline: staged -> validated -> approved -> promoted.
 *
 * Staging and validation run as afldb_auth, which cannot write a single
 * statistical table — a hostile CSV can do nothing but fill its own
 * staging rows. Promotion alone runs as afldb_import, in one
 * transaction, recorded as an import batch exactly like the bulk
 * migration. There is one way into the statistical tables, not two.
 */

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export type StageResult =
  | { ok: true; submissionId: number; rowCount: number; duplicate: boolean }
  | { ok: false; error: string };

export async function stageSubmission(
  dataset: string,
  filename: string,
  content: Buffer,
  uploadedBy: number,
): Promise<StageResult> {
  const spec = getDataset(dataset);
  if (!spec) return { ok: false, error: `Unknown dataset "${dataset}".` };
  if (content.length === 0) return { ok: false, error: 'The file is empty.' };
  if (content.length > MAX_UPLOAD_BYTES) {
    return { ok: false, error: 'The file exceeds the 5 MB limit.' };
  }

  let objects: Record<string, string | null>[];
  try {
    const table = parseCsv(content.toString('utf8'));
    const missing = spec.requiredColumns.filter((c) => !table.header.includes(c));
    if (missing.length > 0) {
      return {
        ok: false,
        error: `Missing required column(s): ${missing.join(', ')}. `
          + `Expected at least: ${spec.requiredColumns.join(', ')}.`,
      };
    }
    objects = toObjects(table);
  } catch (error) {
    if (error instanceof CsvError) return { ok: false, error: `CSV error at ${error.message}` };
    throw error;
  }
  if (objects.length === 0) return { ok: false, error: 'The file has a header but no rows.' };

  const sha = createHash('sha256').update(content).digest('hex');

  // Idempotency, keyed on the bytes themselves.
  //
  // The email poller re-sends any message whose POST it could not
  // confirm -- a connection dropped after staging, a client timeout
  // while validation was still running -- so the same file arrives
  // twice on a path where nobody chose to send it twice. Resolving it
  // back to the submission it already made keeps the retry harmless
  // and leaves the reviewer one submission to read instead of two
  // identical ones to reconcile.
  //
  // Scoped to the states a retry can actually be racing: 'staged' and
  // 'validated' are "nobody has ruled on this yet". Once a human has
  // approved or rejected it -- or it has been promoted or failed --
  // they have acted on that file, and sending it again is a deliberate
  // act that deserves its own submission and its own fresh verdicts
  // rather than quietly reopening a decision already made.
  const [existing] = await authSql<{ id: number; rowCount: number | null }[]>`
    SELECT id, row_count AS "rowCount"
      FROM data_submissions
     WHERE dataset = ${dataset}
       AND content_sha256 = ${sha}
       AND status IN ('staged', 'validated')
     ORDER BY id DESC
     LIMIT 1
  `;
  if (existing) {
    return {
      ok: true,
      submissionId: existing.id,
      rowCount: existing.rowCount ?? objects.length,
      duplicate: true,
    };
  }

  // One transaction for the header row and every chunk of rows. A
  // failure part-way through would otherwise leave a 'staged'
  // submission whose row_count promises more rows than
  // data_submission_rows actually holds -- and both validation and
  // promotion read those rows, so they would silently work on the
  // partial file as though it were the whole thing.
  const submissionId = await authSql.begin(async (tx) => {
    const [submission] = await tx<{ id: number }[]>`
      INSERT INTO data_submissions (dataset, filename, content, content_sha256, uploaded_by, row_count)
      VALUES (${dataset}, ${filename.slice(0, 200)}, ${content}, ${sha}, ${uploadedBy}, ${objects.length})
      RETURNING id
    `;

    // Bulk insert rows in chunks; jsonb payload per row. `sql(array)`
    // negotiates each column's real type from the table (including
    // `payload`'s jsonb) and serialises accordingly -- pre-stringifying
    // here double-encodes it: the column ends up holding a JSON STRING
    // containing the row's JSON text, not the row object itself, so
    // every `row.payload.<field>` downstream reads back as undefined.
    const chunkSize = 500;
    for (let start = 0; start < objects.length; start += chunkSize) {
      const chunk = objects.slice(start, start + chunkSize).map((payload, offset) => ({
        submission_id: submission.id,
        row_no: start + offset + 1,
        payload,
      }));
      await tx`INSERT INTO data_submission_rows ${tx(chunk)}`;
    }

    return submission.id;
  });

  return { ok: true, submissionId: Number(submissionId), rowCount: objects.length, duplicate: false };
}

export type ValidationSummary = {
  ok: number;
  warnings: number;
  errors: number;
  duplicates: number;
};

/**
 * Validate a staged submission and attach per-row verdicts.
 *
 * Row errors do not throw: the point of the report is to show every
 * problem at once, not the first.
 */
export async function validateSubmission(submissionId: number): Promise<ValidationSummary> {
  const [submission] = await authSql<{ dataset: string; status: string }[]>`
    SELECT dataset, status::text FROM data_submissions WHERE id = ${submissionId}
  `;
  if (!submission) throw new Error(`submission ${submissionId} not found`);
  if (!['staged', 'validated', 'rejected'].includes(submission.status)) {
    throw new Error(`submission is ${submission.status}; only staged files can be validated`);
  }
  const spec = getDataset(submission.dataset);
  if (!spec) throw new Error(`dataset ${submission.dataset} is no longer registered`);

  const rows = await authSql<{ rowNo: number; payload: Record<string, string | null> }[]>`
    SELECT row_no AS "rowNo", payload
      FROM data_submission_rows
     WHERE submission_id = ${submissionId}
     ORDER BY row_no
  `;

  const summary: ValidationSummary = { ok: 0, warnings: 0, errors: 0, duplicates: 0 };
  const seenKeys = new Map<string, number>();

  for (const row of rows) {
    let verdict;
    try {
      verdict = await spec.validateRow(row.payload, { sql: authSql });
    } catch (error) {
      verdict = {
        verdict: 'error' as const,
        reasons: [`validator failed: ${error instanceof Error ? error.message : String(error)}`],
      };
    }

    // Duplicate keys are a file-level defect caught row-by-row so the
    // report can point at both offending lines.
    const key = spec.fileKey(row.payload);
    const firstAt = seenKeys.get(key);
    if (key && firstAt !== undefined) {
      verdict = {
        ...verdict,
        verdict: 'error' as const,
        reasons: [...verdict.reasons, `duplicate of row ${firstAt} (key "${key}")`],
      };
      summary.duplicates += 1;
    } else if (key) {
      seenKeys.set(key, row.rowNo);
    }

    if (verdict.verdict === 'error') summary.errors += 1;
    else if (verdict.verdict === 'warning') summary.warnings += 1;
    else summary.ok += 1;

    await authSql`
      UPDATE data_submission_rows
         SET verdict = ${verdict.verdict},
             reasons = ${authSql.json({
               reasons: verdict.reasons,
               resolved: verdict.resolved ?? null,
             })}
       WHERE submission_id = ${submissionId} AND row_no = ${row.rowNo}
    `;
  }

  await authSql`
    UPDATE data_submissions
       SET status = 'validated',
           validation_report = ${authSql.json(summary as unknown as Record<string, number>)}
     WHERE id = ${submissionId}
  `;
  return summary;
}

export type PromoteResult =
  | { ok: true; applied: number; batchId: number }
  | { ok: false; error: string };

/**
 * Promote an approved submission under the import role.
 *
 * All or nothing: one transaction, one import batch. A failure marks the
 * submission 'failed' with the error and leaves the statistical tables
 * untouched.
 */
export async function promoteSubmission(submissionId: number): Promise<PromoteResult> {
  const [submission] = await authSql<{ dataset: string; status: string }[]>`
    SELECT dataset, status::text FROM data_submissions WHERE id = ${submissionId}
  `;
  if (!submission) return { ok: false, error: 'Submission not found.' };
  if (submission.status !== 'approved') {
    return { ok: false, error: `Submission is ${submission.status}; only approved files promote.` };
  }
  const spec = getDataset(submission.dataset);
  if (!spec) return { ok: false, error: 'Dataset is no longer registered.' };

  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  const rows = await authSql<{
    rowNo: number;
    payload: Record<string, string | null>;
    verdict: string;
    reasons: { resolved: Record<string, number | string | null> | null };
  }[]>`
    SELECT row_no AS "rowNo", payload, verdict, reasons
      FROM data_submission_rows
     WHERE submission_id = ${submissionId}
     ORDER BY row_no
  `;
  if (rows.some((r) => r.verdict === 'error' || !r.verdict)) {
    return { ok: false, error: 'Submission contains error rows; re-validate and fix the file.' };
  }

  // A short-lived import-role connection, closed in finally. Promotion
  // is rare; holding a standing pool for it would be pure liability.
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    const batchId = await importSql.begin(async (tx) => {
      // Award-shaped datasets (rising_star, all_australian) feed one row
      // in `awards`; match/player-stat datasets feed the fact tables
      // directly and have no award to resolve. awardId is null for those.
      let awardId: number | null = null;
      if (spec.awardSlug) {
        const [award] = await tx<{ id: number }[]>`
          SELECT id FROM awards WHERE slug = ${spec.awardSlug}
        `;
        if (!award) throw new Error(`award "${spec.awardSlug}" is missing; run the awards import`);
        awardId = award.id;
      }

      const [source] = await tx<{ id: number }[]>`
        SELECT id FROM sources WHERE key = 'sports_data_lab'
      `;
      const [batch] = await tx<{ id: number }[]>`
        INSERT INTO import_batches (source_id, tool, target_table, notes)
        VALUES (${source?.id ?? null}, 'admin-upload', ${spec.key},
                ${'submission ' + submissionId})
        RETURNING id
      `;

      for (const row of rows) {
        await spec.promoteRow(row.payload, row.reasons?.resolved ?? {}, {
          sql: tx as unknown as typeof importSql,
          awardId,
          sourceId: source?.id ?? 0,
          batchId: batch.id,
        });
      }

      await tx`
        UPDATE import_batches
           SET completed_at = now(), status = 'completed',
               records_read = ${rows.length}, records_inserted = ${rows.length}
         WHERE id = ${batch.id}
      `;
      return batch.id;
    });

    await authSql`
      UPDATE data_submissions
         SET status = 'promoted', promoted_at = now(),
             import_batch_id = ${batchId}, error = NULL
       WHERE id = ${submissionId}
    `;
    return { ok: true, applied: rows.length, batchId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await authSql`
      UPDATE data_submissions SET status = 'failed', error = ${message.slice(0, 2000)}
       WHERE id = ${submissionId}
    `;
    return { ok: false, error: `Promotion failed and was rolled back: ${message}` };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
