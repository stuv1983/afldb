import 'server-only';

import { cache } from 'react';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';
import { DEFAULT_SITE_FOOTER, type SiteFooter } from '@/lib/site-content';
import {
  DEFAULT_SITE_SETTINGS,
  SETTING_KEYS,
  parseSiteSettings,
  type SiteSettings,
} from '@/lib/site-settings';

/**
 * Read the runtime settings a super admin controls (migration 034).
 *
 * One round trip for the whole table — it holds a handful of rows and every
 * caller wants more than one of them — parsed into typed values by
 * `src/lib/site-settings.ts`, which supplies a default for anything absent.
 *
 * Read on the public pool, because the home page renders these choices and
 * runs as afldb_app. That is why the migration grants SELECT there and why
 * the table must never hold a secret.
 */
export const getSiteSettings = cache(async function getSiteSettings(): Promise<SiteSettings> {
  try {
    // The apex content document is excluded rather than fetched and ignored:
    // it is kilobytes of marketing prose, this query runs on every page
    // render, and nothing on the public site reads it. src/db/queries/
    // site-content.ts fetches that row on its own for the two callers that do.
    const rows = await sql<{ key: string; value: unknown }[]>`
      SELECT key, value FROM site_settings WHERE key <> ${SETTING_KEYS.apexContent}
    `;
    return parseSiteSettings(rows);
  } catch (error) {
    // A database that has not run migration 034 yet should serve the front
    // page from the defaults rather than 500 — this is display configuration,
    // not an invariant. Only that one condition is swallowed: a permission
    // error, a dead pool or a timeout still throws, because those are real
    // and silently rendering defaults would hide them.
    if ((error as { code?: string }).code === '42P01') return DEFAULT_SITE_SETTINGS;
    throw error;
  }
});

/**
 * The same settings, read on the auth pool.
 *
 * /admin runs its own reads through afldb_auth so an admin screen never
 * depends on the public role's grants, and so the form always shows what was
 * just written rather than whatever the request-scoped public read cached.
 */
/**
 * The footer alone, for the root layout.
 *
 * Swallows EVERYTHING, unlike `getSiteSettings` above, which deliberately
 * rethrows anything but a missing table. The difference is what depends on the
 * answer: the home page's content is meaningless without its settings, whereas
 * this is the colophon at the bottom of every page in the site — including the
 * error pages. A dead pool must not be turned into a second, more confusing
 * failure by the chrome around the first one.
 */
export async function getSiteFooter(): Promise<SiteFooter> {
  try {
    return (await getSiteSettings()).footer;
  } catch {
    return DEFAULT_SITE_FOOTER;
  }
}

export async function getSiteSettingsForAdmin(): Promise<SiteSettings> {
  const rows = await authSql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM site_settings WHERE key <> ${SETTING_KEYS.apexContent}
  `;
  return parseSiteSettings(rows);
}
