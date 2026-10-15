import { NextResponse } from 'next/server';

import { audit, requireCapability } from '@/lib/auth/session';
import { MAX_UPLOAD_BYTES, stageSubmission } from '@/lib/ingest/pipeline';
import {
  declaredLengthCheck,
  maxUploadBodyBytes,
  readBoundedBody,
  sameOriginRefusal,
} from '@/lib/ingest/upload-request';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = maxUploadBodyBytes(MAX_UPLOAD_BYTES);
const TOO_LARGE = 'The file exceeds the 5 MB limit.';

/**
 * CSV upload for /admin/upload (AFLDB-ISSUE-303, D-303-1).
 *
 * A Route Handler rather than a Server Action, for one specific reason: Server
 * Actions cap their request body at 1 MB, multipart included, and raising that cap
 * is a project-wide `serverActions.bodySizeLimit` that would apply to every action
 * in the application. This route takes the documented 5 MB file without loosening
 * anything else (the same reason `src/app/admin/content/media/route.ts` is one).
 *
 * What the framework no longer does for us is done here, in this order:
 *
 *   1. CSRF: a Route Handler gets no Server Action origin check, so the request must
 *      be same-origin (`sameOriginRefusal`). The session cookie is also SameSite=Lax.
 *   2. Authentication and authorisation: `requireCapability('acquisition.legacyIntake')`
 *      re-checks the session against the database, exactly as the page and the old
 *      action did. Under /admin, so middleware demands an admin cookie at the door first.
 *   3. The size bound: a declared `Content-Length` over the file limit plus the multipart
 *      envelope is refused before any of the body is read, and the read itself stops at
 *      that bound whatever the client declared, so no oversized upload is ever buffered.
 *
 * From there it is the same pipeline the form always used: `stageSubmission`, the same
 * audit events, the same 5 MB file check. Nothing is approved or promoted here.
 */
export async function POST(request: Request) {
  const crossSite = sameOriginRefusal(request.headers);
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 });

  const admin = await requireCapability('acquisition.legacyIntake');

  const declared = declaredLengthCheck(request.headers, MAX_BODY_BYTES);
  if (declared.kind === 'invalid') {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }
  if (declared.kind === 'too_large') {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }

  const bytes = await readBoundedBody(request, MAX_BODY_BYTES);
  if (bytes === null) return NextResponse.json({ error: TOO_LARGE }, { status: 413 });

  let form: FormData;
  try {
    form = await new Response(bytes as BodyInit, {
      headers: { 'content-type': request.headers.get('content-type') ?? '' },
    }).formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const dataset = String(form.get('dataset') ?? '');
  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a CSV file.' }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: TOO_LARGE }, { status: 413 });
  }

  const content = Buffer.from(await file.arrayBuffer());
  const result = await stageSubmission(dataset, file.name, content, admin.id);

  if (!result.ok) {
    await audit('upload.rejected', { dataset, filename: file.name, error: result.error },
      { userId: admin.id, label: admin.email });
    return NextResponse.json({ error: result.error }, { status: 422 });
  }

  // A duplicate lands on the submission the file already made rather than a second copy
  // of it: double-submitting the same CSV is far more often a double-click or a re-upload
  // after losing the tab than a real intent to stage it twice, and the review page is
  // where the uploader wanted to end up either way.
  await audit(result.duplicate ? 'upload.duplicate' : 'upload.staged',
    { dataset, filename: file.name, submissionId: result.submissionId, rows: result.rowCount },
    { userId: admin.id, label: admin.email });

  return NextResponse.json({
    ok: true,
    submissionId: result.submissionId,
    duplicate: result.duplicate,
    redirectTo: `/admin/submissions/${result.submissionId}`,
  });
}
