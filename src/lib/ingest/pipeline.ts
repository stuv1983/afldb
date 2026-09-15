import 'server-only';

import { createHash } from 'node:crypto';

import postgres from 'postgres';

import { authSql } from '@/db/authClient';
import { getDataset } from '@/lib/ingest/datasets';
import { CsvError, parseCsv, toObjects } from '@/lib/ingest/csv';
import { asImportBatchId, type ImportBatchId } from '@/lib/import-batch-id';

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
  | { ok: true; applied: number; batchId: ImportBatchId }
  | { ok: false; error: string };

type PromotionOutcome =
  // Nothing was attempted: the row was not in a promotable state when
  // locked, or a pre-condition failed before any statistical write. The
  // submission's status/error are left exactly as they were.
  | { kind: 'refused'; error: string }
  // The promotion work ran and raised; rolled back to the savepoint and
  // recorded as 'failed' in the same transaction that holds the lock.
  | { kind: 'failed'; error: string }
  | { kind: 'promoted'; applied: number; batchId: ImportBatchId };

/**
 * Promote an eligible (approved, or a previously failed) submission under
 * the import role.
 *
 * AFLDB-ISSUE-175: the row is locked with `SELECT ... FOR UPDATE` and the
 * final status transition is written in the SAME transaction as the
 * promoted data, using afldb_import's existing column grant (migration
 * 023) on data_submissions(status, promoted_at, import_batch_id, error).
 * That closes the window where two concurrent promotions could both
 * observe an eligible submission, or where the data commit could succeed
 * while a separate status write silently failed. A second, concurrent
 * caller blocks on the lock and then re-reads the now-committed status,
 * which no longer matches 'approved'/'failed' — it is refused and writes
 * nothing.
 *
 * The status actually locked (`lockedStatus`, 'approved' or 'failed') is
 * reused as the CAS predicate on every write below, so a retry that starts
 * from 'failed' and fails again lands back on 'failed' with a fresh error,
 * and a run that starts from 'approved' only ever fails to 'failed' —
 * never the reverse.
 *
 * Genuine promotion failures roll back to a savepoint (the established
 * pattern in src/lib/acquisition/canonical-apply.ts) rather than the whole
 * transaction, so the lock, the row read, and the eventual 'failed' write
 * survive in the same outer transaction. A 'refused' outcome performs no
 * write at all — the point is that nothing was attempted, so there is
 * nothing to record.
 */
export async function promoteSubmission(submissionId: number): Promise<PromoteResult> {
  const importUrl = process.env.AFLDB_IMPORT_DATABASE_URL;
  if (!importUrl) return { ok: false, error: 'AFLDB_IMPORT_DATABASE_URL is not configured.' };

  // A short-lived import-role connection, closed in finally. Promotion
  // is rare; holding a standing pool for it would be pure liability.
  const importSql = postgres(importUrl, { max: 1, onnotice: () => {} });
  try {
    let outcome: PromotionOutcome;
    try {
      outcome = await importSql.begin(async (tx): Promise<PromotionOutcome> => {
        const [submission] = await tx<{ dataset: string; status: string }[]>`
          SELECT dataset, status::text AS status
            FROM data_submissions
           WHERE id = ${submissionId}
           FOR UPDATE
        `;
        if (!submission) return { kind: 'refused', error: 'Submission not found.' };
        if (!['approved', 'failed'].includes(submission.status)) {
          return {
            kind: 'refused',
            error: `Submission is ${submission.status}; only approved or previously-failed files promote.`,
          };
        }
        const lockedStatus = submission.status;

        const spec = getDataset(submission.dataset);
        if (!spec) return { kind: 'refused', error: 'Dataset is no longer registered.' };

        const rows = await tx<{
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
          return {
            kind: 'refused',
            error: 'Submission contains error rows; re-validate and fix the file.',
          };
        }

        try {
          const runBatchId = await tx.savepoint(async (sp): Promise<ImportBatchId> => {
            // Award-shaped datasets (rising_star, all_australian) feed one
            // row in `awards`; match/player-stat datasets feed the fact
            // tables directly and have no award to resolve. awardId is
            // null for those.
            let awardId: number | null = null;
            if (spec.awardSlug) {
              const [award] = await sp<{ id: number }[]>`
                SELECT id FROM awards WHERE slug = ${spec.awardSlug}
              `;
              if (!award) {
                throw new Error(`award "${spec.awardSlug}" is missing; run the awards import`);
              }
              awardId = award.id;
            }

            const [source] = await sp<{ id: number }[]>`
              SELECT id FROM sources WHERE key = 'sports_data_lab'
            `;
            const [batch] = await sp<{ id: string }[]>`
              INSERT INTO import_batches (source_id, tool, target_table, notes)
              VALUES (${source?.id ?? null}, 'admin-upload', ${spec.key},
                      ${'submission ' + submissionId})
              RETURNING id
            `;
            // AFLDB-ISSUE-105: `import_batches.id` is bigint, which
            // postgres.js delivers as decimal text. Decoded once, here,
            // and opaque from this point on — it is bound back into SQL
            // and reported, never counted.
            const batchId = asImportBatchId(batch.id);

            for (const row of rows) {
              await spec.promoteRow(row.payload, row.reasons?.resolved ?? {}, {
                sql: sp as unknown as typeof importSql,
                awardId,
                sourceId: source?.id ?? 0,
                batchId,
              });
            }

            await sp`
              UPDATE import_batches
                 SET completed_at = now(), status = 'completed',
                     records_read = ${rows.length}, records_inserted = ${rows.length}
               WHERE id = ${batchId}
            `;
            return batchId;
          });

          const [updated] = await tx<{ id: number }[]>`
            UPDATE data_submissions
               SET status = 'promoted', promoted_at = now(),
                   import_batch_id = ${runBatchId}, error = NULL
             WHERE id = ${submissionId} AND status = ${lockedStatus}
            RETURNING id
          `;
          // The row has been locked since the read above, so this should
          // always match; treated as a promotion failure (not a silent
          // refusal) if it somehow does not, since work was already
          // applied.
          if (!updated) throw new Error('submission status changed unexpectedly during promotion');

          return { kind: 'promoted', applied: rows.length, batchId: runBatchId };
        } catch (workError) {
          const message = workError instanceof Error ? workError.message : String(workError);
          await tx`
            UPDATE data_submissions
               SET status = 'failed', error = ${message.slice(0, 2000)}
             WHERE id = ${submissionId} AND status = ${lockedStatus}
          `;
          return { kind: 'failed', error: message };
        }
      });
    } catch (error) {
      // Something failed before or outside the row lock/savepoint
      // machinery above (a dropped connection, a bug) rather than as a
      // handled 'refused'/'failed' outcome. Whether the row was ever
      // locked, and at what status, is unknown here, so — matching the
      // "a concurrency loser performs no status write" rule — nothing is
      // written; the caller sees a failure and may retry.
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: `Promotion failed before completing: ${message}` };
    }

    if (outcome.kind === 'promoted') {
      return { ok: true, applied: outcome.applied, batchId: outcome.batchId };
    }
    if (outcome.kind === 'failed') {
      return { ok: false, error: `Promotion failed and was rolled back: ${outcome.error}` };
    }
    return { ok: false, error: outcome.error };
  } finally {
    await importSql.end({ timeout: 5 });
  }
}
