import { NextResponse } from 'next/server';

import { countMedia, insertMedia, listMedia } from '@/db/queries/site-content';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import { mediaFileName, probeImage } from '@/lib/image-probe';
import { CONTENT_LIMITS } from '@/lib/site-content';

export const dynamic = 'force-dynamic';

/**
 * Image upload for /admin/content.
 *
 * A Route Handler rather than a Server Action, for one specific reason:
 * Server Actions cap their request body at 1 MB and raising that cap is a
 * project-wide `serverActions.bodySizeLimit` that would apply to every action
 * in the application. A route handler takes a 2 MB screenshot without
 * loosening anything else.
 *
 * Under /admin, so middleware demands an admin cookie at the door before this
 * code runs at all; `requireSuperAdmin` then re-checks the session against the
 * database, which is where it can be revoked. Both, because the cookie only
 * gets a request through the door.
 *
 * NOTHING about the upload is trusted. The declared Content-Type and the file
 * name are client-supplied and are used for neither the stored MIME type nor
 * the stored name: src/lib/image-probe.ts reads the leading bytes, and a file
 * whose bytes are not PNG, JPEG or WebP is refused. That is what stops a
 * script being written into a directory a web server publishes.
 */
export async function POST(request: Request) {
  const admin = await requireSuperAdmin();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'Malformed upload.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'Choose an image file.' }, { status: 400 });
  }

  // Refused before the bytes are copied out of the parsed form and before
  // anything is stored. It does NOT save the buffering — request.formData()
  // above has already read the body — so this bounds what reaches the
  // database, not what reaches memory. The route is super-admin-only and
  // behind middleware, which is what makes that acceptable here; the public
  // endpoint in src/app/api/early-access/route.ts bounds the read itself.
  if (file.size > CONTENT_LIMITS.mediaBytes) {
    const limit = Math.round(CONTENT_LIMITS.mediaBytes / 1024 / 1024);
    return NextResponse.json(
      { error: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${limit} MB.` },
      { status: 413 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const format = probeImage(bytes);
  if (!format) {
    return NextResponse.json(
      { error: 'That is not a PNG, JPEG or WebP image. The file is identified by its '
        + 'contents, not its name, so renaming it will not help.' },
      { status: 415 },
    );
  }

  const requested = String(form.get('name') ?? '').trim() || file.name;
  const name = mediaFileName(requested, format);
  const alt = String(form.get('alt') ?? '').trim().slice(0, CONTENT_LIMITS.altChars);

  // The cap counts rows, and an upload that replaces an existing name does not
  // add one — so re-uploading a screenshot still works at the limit, which is
  // exactly when someone is most likely to be doing it.
  const existing = await listMedia();
  const replacing = existing.some((media) => media.name === name);
  if (!replacing && await countMedia() >= CONTENT_LIMITS.maxMedia) {
    return NextResponse.json(
      { error: `${CONTENT_LIMITS.maxMedia} images is the limit. Delete one first.` },
      { status: 409 },
    );
  }

  await insertMedia({
    name,
    mime: format.mime,
    bytes,
    width: format.width,
    height: format.height,
    alt,
    uploadedBy: admin.id,
  });

  await audit('content.media_uploaded', {
    name,
    mime: format.mime,
    bytes: bytes.length,
    width: format.width,
    height: format.height,
    replaced: replacing,
  }, { userId: admin.id, label: admin.email });

  return NextResponse.json({
    name,
    mime: format.mime,
    width: format.width,
    height: format.height,
    byteSize: bytes.length,
    alt,
    replaced: replacing,
  });
}
