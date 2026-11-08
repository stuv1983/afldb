import 'server-only';

import { notFound } from 'next/navigation';

import { requireUploader, ROLE_RANK, type AdminUser } from '@/lib/auth/session';
import type { GridAudience } from '@/lib/site-settings';

/**
 * Guard a page whose audience is configurable at runtime (migration 034).
 *
 * Such a page must live on a public route — middleware that always demands an
 * admin cookie cannot serve a page that may be published to everyone — so this
 * check plus the stored setting is its only gate.
 *
 * The setting names the LEAST privileged session admitted. Every level below
 * 'public' still re-checks the database session via `getAdminUser()`, so this
 * is `requireAdmin()` with a movable threshold, never something weaker. A
 * signed-out visitor gets the login form; a signed-in account that ranks too
 * low gets a 404, matching the posture middleware takes for /admin.
 *
 * Under 'public' the cookie is not read at all, so a public page does not
 * become uncacheable to answer a question already answered.
 *
 * AFLDB-ISSUE-345: every non-public level goes through `requireUploader()`,
 * the same session guard `requireAdmin()` funnels through, so an account
 * holding an admin-issued temporary password is sent to the change-password
 * page BEFORE its role is compared — exactly as every /admin route treats it.
 * Without this the restricted solver was the one staff surface a temporary
 * password could reach (migration 040, ISSUE-155's forced-change rule).
 */
export async function requireAudience(audience: GridAudience): Promise<AdminUser | null> {
  if (audience === 'public') return null;

  // Signed out -> /admin/login; temporary password -> /admin/password.
  const user = await requireUploader();
  if (ROLE_RANK[user.role] < ROLE_RANK[audience]) notFound();
  return user;
}
