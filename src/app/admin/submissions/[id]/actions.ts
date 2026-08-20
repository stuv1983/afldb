'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { audit, requireAdmin, requireSuperAdmin } from '@/lib/auth/session';
import { promoteSubmission, validateSubmission } from '@/lib/ingest/pipeline';

export type ReviewState = { error?: string; message?: string };

export async function runValidation(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await requireAdmin();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad submission id.' };

  try {
    const summary = await validateSubmission(id);
    await audit('submission.validated', { submissionId: id, ...summary },
      { userId: admin.id, label: admin.email });
    revalidatePath(`/admin/submissions/${id}`);
    return {
      message: `Validated: ${summary.ok} ok, ${summary.warnings} warnings, `
        + `${summary.errors} errors.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The human verdicts. Approval requires a validated file with no error
 * rows; the pipeline re-checks both, so the button is a convenience and
 * the constraint is real. Restricted strictly to super admins.
 */
export async function decideSubmission(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await requireSuperAdmin();
  const id = Number(formData.get('id'));
  const decision = String(formData.get('decision'));
  if (!Number.isInteger(id)) return { error: 'Bad submission id.' };

  if (decision === 'approve') {
    const [updated] = await authSql<{ id: number }[]>`
      UPDATE data_submissions
         SET status = 'approved', reviewed_by = ${admin.id}, reviewed_at = now()
       WHERE id = ${id}
         AND status = 'validated'
         AND NOT EXISTS (
               SELECT 1 FROM data_submission_rows r
                WHERE r.submission_id = ${id} AND (r.verdict = 'error' OR r.verdict IS NULL)
             )
      RETURNING id
    `;
    if (!updated) {
      return { error: 'Only a validated submission with no error rows can be approved.' };
    }
    await audit('submission.approved', { submissionId: id },
      { userId: admin.id, label: admin.email });
  } else if (decision === 'reject') {
    await authSql`
      UPDATE data_submissions
         SET status = 'rejected', reviewed_by = ${admin.id}, reviewed_at = now()
       WHERE id = ${id}
    `;
    await audit('submission.rejected', { submissionId: id },
      { userId: admin.id, label: admin.email });
  } else {
    return { error: 'Unknown decision.' };
  }

  revalidatePath(`/admin/submissions/${id}`);
  return { message: decision === 'approve' ? 'Approved.' : 'Rejected.' };
}

export async function runPromotion(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const admin = await requireSuperAdmin();
  const id = Number(formData.get('id'));
  if (!Number.isInteger(id)) return { error: 'Bad submission id.' };

  const result = await promoteSubmission(id);
  if (!result.ok) {
    await audit('submission.promote_failed', { submissionId: id, error: result.error },
      { userId: admin.id, label: admin.email });
    revalidatePath(`/admin/submissions/${id}`);
    return { error: result.error };
  }

  await audit('submission.promoted',
    { submissionId: id, applied: result.applied, batchId: result.batchId },
    { userId: admin.id, label: admin.email });
  revalidatePath(`/admin/submissions/${id}`);
  return {
    message: `Promoted: ${result.applied} rows applied as import batch ${result.batchId}. `
      + 'Pages refresh as their caches expire.',
  };
}
