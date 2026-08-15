import 'server-only';

import { cache } from 'react';

import { authSql } from '@/db/authClient';
import { sql } from '@/db/client';
import {
  DEFAULT_SITE_SETTINGS,
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
    const rows = await sql<{ key: string; value: unknown }[]>`
      SELECT key, value FROM site_settings
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
export async function getSiteSettingsForAdmin(): Promise<SiteSettings> {
  const rows = await authSql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM site_settings
  `;
  return parseSiteSettings(rows);
}
