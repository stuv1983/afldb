'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { deleteMedia as deleteMediaRow } from '@/db/queries/site-content';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import { describePublishResult, publishApex } from '@/lib/apex-publish';
import { parseApexContent, parseSiteFooter } from '@/lib/site-content';
import { SETTING_KEYS } from '@/lib/site-settings';

export type ContentState = { error?: string; message?: string };

/**
 * Save the apex page's content and the shared footer, then publish.
 *
 * The order matters and is not negotiable: the database is written first and
 * the files second. A failed publish therefore costs the publish alone — the
 * edit survives, the admin is told what went wrong, and pressing Publish
 * again is the whole retry. The reverse order would risk a page on disk that
 * nothing in the database describes.
 *
 * Both documents arrive as one JSON field each from the client editor and are
 * re-parsed here through the same functions the read path uses. The editor is
 * a convenience, never the validation: a hand-posted document lands on the
 * normalised, clamped, allowlisted version of itself or on the defaults.
 */
export async function saveSiteContent(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const admin = await requireSuperAdmin();

  const decode = (field: string): unknown => {
    try {
      return JSON.parse(String(formData.get(field) ?? 'null'));
    } catch {
      // Undecodable means "no submission", which the parsers turn into the
      // stored-or-default document rather than an error. One mangled field
      // must not block the other from saving.
      return null;
    }
  };

  const content = parseApexContent(decode('content'));
  const footer = parseSiteFooter(decode('footer'));

  await authSql.begin(async (tx) => {
    for (const [key, value] of [
      [SETTING_KEYS.apexContent, content],
      [SETTING_KEYS.siteFooter, footer],
    ] as const) {
      await tx`
        INSERT INTO site_settings (key, value, updated_by)
        VALUES (${key}, ${JSON.stringify(value)}::jsonb, ${admin.id})
        ON CONFLICT (key) DO UPDATE
          SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
      `;
    }
  });

  const result = await publishApex();

  await audit('content.saved', {
    features: content.features.items.length,
    notes: content.notes.items.length,
    stats: content.hero.stats.length,
    footerLines: footer.lines.length,
    published: result.ok,
    ...(result.ok ? { written: result.written, pruned: result.pruned } : { reason: result.reason }),
  }, { userId: admin.id, label: admin.email });

  // The footer is in the root layout, so every page carries it. 'layout' scope
  // is what reaches them all — revalidating '/' alone would leave the footer
  // stale on every other page until its own ISR window rolled over.
  revalidatePath('/', 'layout');

  return result.ok
    ? { message: `Saved and published. ${describePublishResult(result)}` }
    : { error: describePublishResult(result) };
}

/**
 * Publish without saving.
 *
 * Its own action and its own form, so it cannot carry a half-edited document
 * to disk — the same separation /admin/settings draws around its test-email
 * button. This is the recovery path: it rebuilds the published directory from
 * what is already in the database, which is how a rebuilt server, a deleted
 * /var/www/afldb-soon or a deploy that changed style.css gets back in step.
 */
export async function republishApex(
  _previous: ContentState,
  _formData: FormData,
): Promise<ContentState> {
  const admin = await requireSuperAdmin();

  const result = await publishApex();

  await audit('content.published', {
    ok: result.ok,
    ...(result.ok
      ? { written: result.written, pruned: result.pruned, target: result.target }
      : { reason: result.reason }),
  }, { userId: admin.id, label: admin.email });

  return result.ok
    ? { message: describePublishResult(result) }
    : { error: describePublishResult(result) };
}

/**
 * Remove an uploaded image.
 *
 * Deliberately does NOT rewrite the content document to drop references to
 * it. A slot still pointing at a deleted image keeps its src, which the
 * editor renders as a visible "missing" marker rather than silently reverting
 * to a stock screenshot the admin did not choose. Publishing prunes the file;
 * the page slot is the admin's to repoint.
 */
export async function deleteMedia(
  _previous: ContentState,
  formData: FormData,
): Promise<ContentState> {
  const admin = await requireSuperAdmin();
  const name = String(formData.get('name') ?? '');
  if (!name) return { error: 'No image named.' };

  await deleteMediaRow(name);
  await audit('content.media_deleted', { name }, { userId: admin.id, label: admin.email });

  revalidatePath('/admin/content');
  return { message: `Deleted ${name}. Publish to remove it from the live page.` };
}
