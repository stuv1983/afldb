import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { NextResponse } from 'next/server';

import { getMediaBytes } from '@/db/queries/site-content';
import { apexTemplateDir } from '@/lib/apex-publish';
import { requireSuperAdmin } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

/**
 * The apex page's assets, served to the preview at /admin/content/preview.
 *
 * The published page loads `/style.css`, `/app.js` and `/img/…` from the root
 * of its own host. The preview renders the same markup inside this
 * application, where none of those paths exist, so the renderer is given an
 * `assetBase` of `/admin/content/asset` and this route resolves them out of
 * the two places the publisher would have written them from: the template
 * directory in git, and the `site_media` table.
 *
 * That is what makes the preview trustworthy — it is not an approximation of
 * the published page, it is the same HTML over the same bytes.
 *
 * Super admin only, and every path is matched against an allowlist rather
 * than sanitised. A route that reads a file named by the URL is exactly the
 * shape of a directory traversal, so no segment is ever concatenated into a
 * path unless it has first been matched whole.
 */

const ROOT_FILES = new Map([
  ['style.css', 'text/css; charset=utf-8'],
  ['app.js', 'text/javascript; charset=utf-8'],
  ['favicon.svg', 'image/svg+xml'],
  ['robots.txt', 'text/plain; charset=utf-8'],
  ['sitemap.xml', 'application/xml; charset=utf-8'],
]);

/** A bare image file name: no separators, no dot-segments, known extension. */
const IMAGE_NAME = /^[a-z0-9][a-z0-9._-]{0,59}\.(webp|png|jpg|jpeg)$/;

const IMAGE_TYPES: Record<string, string> = {
  webp: 'image/webp',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function notFound() {
  return new NextResponse('Not found', { status: 404 });
}

/** Never cached: a preview showing yesterday's upload is worse than useless. */
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  await requireSuperAdmin();

  const { path } = await params;
  const segments = path ?? [];

  // /admin/content/asset/style.css
  if (segments.length === 1) {
    const type = ROOT_FILES.get(segments[0]);
    if (!type) return notFound();
    try {
      const bytes = await readFile(join(apexTemplateDir(), segments[0]));
      return new NextResponse(bytes, {
        headers: { ...HEADERS, 'Content-Type': type },
      });
    } catch {
      return notFound();
    }
  }

  // /admin/content/asset/img/home-dark.webp — shipped with the repository.
  if (segments.length === 2 && segments[0] === 'img' && IMAGE_NAME.test(segments[1])) {
    const extension = segments[1].split('.').pop() ?? '';
    try {
      const bytes = await readFile(join(apexTemplateDir(), 'img', segments[1]));
      return new NextResponse(bytes, {
        headers: { ...HEADERS, 'Content-Type': IMAGE_TYPES[extension] ?? 'application/octet-stream' },
      });
    } catch {
      return notFound();
    }
  }

  // /admin/content/asset/img/u/my-shot.webp — uploaded, straight from the
  // database rather than from wherever it was last published to.
  if (
    segments.length === 3
    && segments[0] === 'img' && segments[1] === 'u'
    && IMAGE_NAME.test(segments[2])
  ) {
    const media = await getMediaBytes(segments[2]);
    if (!media) return notFound();
    // The driver hands bytea back as a Node Buffer, which is a Uint8Array but
    // not one the Response body type accepts directly.
    return new NextResponse(new Uint8Array(media.bytes), {
      headers: { ...HEADERS, 'Content-Type': media.mime },
    });
  }

  return notFound();
}
