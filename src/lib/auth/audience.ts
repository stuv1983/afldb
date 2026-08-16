import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { getAdminUser, ROLE_RANK, type AdminUser } from '@/lib/auth/session';
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
 */
export async function requireAudience(audience: GridAudience): Promise<AdminUser | null> {
  if (audience === 'public') return null;

  const user = await getAdminUser();
  if (!user) redirect('/admin/login');
  if (ROLE_RANK[user.role] < ROLE_RANK[audience]) notFound();
  return user;
}
