import { NextResponse } from 'next/server';

import { refuseRetiredAdminRoute } from '@/lib/admin/retired-admin';
import { requireCapability } from '@/lib/auth/session';
import { sameOriginRefusal } from '@/lib/ingest/upload-request';

export const dynamic = 'force-dynamic';

/**
 * RETIRED (AFLDB V2 Stage 5, V2-GAP-013, docs/v2/legacy-disposition.md L1): the CSV upload
 * route of /admin/upload (AFLDB-ISSUE-303, D-303-1).
 *
 * It used to stage an uploaded CSV as a data submission, the first half of a path whose second
 * half promoted that file straight into the final statistical tables. AFLDB V2 removed that path
 * (plan D9/D10): curated award proposals (/admin/operations/awards) and the audited data editor
 * replace it. The route stays, deliberately, so a stale form or a direct POST gets a typed
 * refusal instead of a 404.
 *
 * What is kept is exactly what was in front of the old behaviour, in the old order:
 *
 *   1. CSRF: a Route Handler gets no Server Action origin check, so the request must still be
 *      same-origin (`sameOriginRefusal`, 403). The session cookie is also SameSite=Lax.
 *   2. Authentication and authorisation: `requireCapability('acquisition.legacyIntake')`
 *      re-checks the session against the database, so an anonymous or under-privileged caller is
 *      refused exactly as before.
 *
 * Then HTTP 410 with the typed refusal and one audit row. The request body is NEVER read, so
 * nothing an uploader sends is buffered, parsed or staged, and the staging library
 * (`stageSubmission`) is not imported here.
 */
export async function POST(request: Request) {
  const crossSite = sameOriginRefusal(request.headers);
  if (crossSite) return NextResponse.json({ error: crossSite }, { status: 403 });

  const admin = await requireCapability('acquisition.legacyIntake');
  return refuseRetiredAdminRoute('admin.csv_upload', admin, 'POST');
}
