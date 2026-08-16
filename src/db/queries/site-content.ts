import 'server-only';

import { authSql } from '@/db/authClient';
import {
  DEFAULT_APEX_CONTENT,
  parseApexContent,
  type ApexContent,
} from '@/lib/site-content';
import { SETTING_KEYS } from '@/lib/site-settings';

/**
 * The apex page's content document, and the images it points at.
 *
 * Everything here runs on the AUTH pool. Unlike the rest of `site_settings`,
 * which the public role reads to render the home page, this document is only
 * ever read by two callers — the editor at /admin/content and the publisher —
 * and `site_media` is not granted to afldb_app at all (migration 037).
 *
 * That is also why `getSiteSettings()` excludes the `apex.content` row: the
 * public path fetches the settings table on every render, and a marketing
 * page's prose has no business crossing the wire on a player page.
 */

export async function getApexContent(): Promise<ApexContent> {
  const rows = await authSql<{ value: unknown }[]>`
    SELECT value FROM site_settings WHERE key = ${SETTING_KEYS.apexContent}
  `;
  if (rows.length === 0) return DEFAULT_APEX_CONTENT;

  // postgres.js hands jsonb back as raw TEXT on this project's client
  // configuration, so this has to parse before the shape parser sees it. See
  // the note on `fromStore` in src/lib/site-settings.ts for the full story,
  // and migration 035 for the same warning on beta_join_requests.answers.
  const raw = rows[0].value;
  let decoded: unknown = raw;
  if (typeof raw === 'string') {
    try {
      decoded = JSON.parse(raw);
    } catch {
      return DEFAULT_APEX_CONTENT;
    }
  }
  return parseApexContent(decoded);
}

// ---------------------------------------------------------------------------
// Uploaded images
// ---------------------------------------------------------------------------

export type MediaRecord = {
  name: string;
  mime: string;
  byteSize: number;
  width: number;
  height: number;
  alt: string;
  uploadedAt: Date;
};

/** Every uploaded image, without its bytes — for the editor's picker. */
export async function listMedia(): Promise<MediaRecord[]> {
  return authSql<MediaRecord[]>`
    SELECT name,
           mime,
           byte_size   AS "byteSize",
           width,
           height,
           alt,
           uploaded_at AS "uploadedAt"
      FROM site_media
     ORDER BY uploaded_at DESC
  `;
}

export async function countMedia(): Promise<number> {
  const [row] = await authSql<{ total: number }[]>`
    SELECT count(*)::int AS total FROM site_media
  `;
  return row?.total ?? 0;
}

/** One image WITH its bytes — for the publisher and the preview's asset route. */
export async function getMediaBytes(
  name: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const [row] = await authSql<{ mime: string; bytes: Buffer }[]>`
    SELECT mime, bytes FROM site_media WHERE name = ${name}
  `;
  return row ?? null;
}

/** Every image with its bytes, for a publish. */
export async function getAllMediaBytes(): Promise<
  { name: string; bytes: Buffer }[]
> {
  return authSql<{ name: string; bytes: Buffer }[]>`
    SELECT name, bytes FROM site_media ORDER BY name
  `;
}

export async function insertMedia(media: {
  name: string;
  mime: string;
  bytes: Buffer;
  width: number;
  height: number;
  alt: string;
  uploadedBy: number;
}): Promise<void> {
  // Re-uploading the same name REPLACES the image, which is what "upload a
  // replacement" means to the person doing it: every page slot already
  // pointing at that name picks up the new picture without being re-edited.
  await authSql`
    INSERT INTO site_media (name, mime, bytes, byte_size, width, height, alt, uploaded_by)
    VALUES (
      ${media.name}, ${media.mime}, ${media.bytes}, ${media.bytes.length},
      ${media.width}, ${media.height}, ${media.alt}, ${media.uploadedBy}
    )
    ON CONFLICT (name) DO UPDATE
      SET mime        = EXCLUDED.mime,
          bytes       = EXCLUDED.bytes,
          byte_size   = EXCLUDED.byte_size,
          width       = EXCLUDED.width,
          height      = EXCLUDED.height,
          alt         = EXCLUDED.alt,
          uploaded_at = now(),
          uploaded_by = EXCLUDED.uploaded_by
  `;
}

export async function deleteMedia(name: string): Promise<void> {
  await authSql`DELETE FROM site_media WHERE name = ${name}`;
}
