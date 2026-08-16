'use server';

import { redirect } from 'next/navigation';

import { audit, requireUploader } from '@/lib/auth/session';
import { MAX_UPLOAD_BYTES, stageSubmission } from '@/lib/ingest/pipeline';

export type UploadState = { error?: string };

export async function uploadSubmission(
  _previous: UploadState,
  formData: FormData,
): Promise<UploadState> {
  const admin = await requireUploader();

  const dataset = String(formData.get('dataset') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'Choose a CSV file.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'The file exceeds the 5 MB limit.' };

  const content = Buffer.from(await file.arrayBuffer());
  const result = await stageSubmission(dataset, file.name, content, admin.id);

  if (!result.ok) {
    await audit('upload.rejected', { dataset, filename: file.name, error: result.error },
      { userId: admin.id, label: admin.email });
    return { error: result.error };
  }

  // A duplicate lands on the submission the file already made rather
  // than a second copy of it — double-submitting the same CSV is far
  // more often a double-click or a re-upload after losing the tab than
  // a real intent to stage it twice, and the review page is where the
  // uploader wanted to end up either way.
  await audit(result.duplicate ? 'upload.duplicate' : 'upload.staged',
    { dataset, filename: file.name, submissionId: result.submissionId, rows: result.rowCount },
    { userId: admin.id, label: admin.email });
  redirect(`/admin/submissions/${result.submissionId}`);
}
