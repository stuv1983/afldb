import 'server-only';

import { notFound, redirect } from 'next/navigation';

import { getAdminUser, ROLE_RANK, type AdminUser } from '@/lib/auth/session';
import type { GridAudience } from '@/lib/site-settings';

/**
 * Guard a page whose audience is configurable at runtime (migration 034).
 *
 * The grid solver is the first such page: it lives on a public route because
 * a page that can be published to everyone cannot sit behind middleware that
 * always demands an admin cookie, and its actual gate is this check plus the
 * stored setting.
 *
 * Three deliberate choices:
 *
 *  - The setting names the LEAST privileged session admitted, and every level
 *    below 'public' still goes through `getAdminUser()`, which re-checks the
 *    database session rather than trusting the cookie. Nothing here is weaker
 *    than `requireAdmin()`; it is the same check with a movable threshold.
 *  - A signed-out visitor is sent to the login form, because the honest
 *    answer to "you need an account for this" is the account form.
 *  - A signed-in account that ranks too low gets a 404, not a redirect: a
 *    contributor who has been told the page does not exist learns nothing
 *    about it, which is the posture middleware already takes for /admin.
 *
 * Returns the session when there is one, so a caller can vary what it shows.
 * Under 'public' it does not read the cookie at all — a public page should
 * not become uncacheable, or leak a session lookup, to answer a question it
 * has already answered.
 */
export async function requireAudience(audience: GridAudience): Promise<AdminUser | null> {
  if (audience === 'public') return null;

  const user = await getAdminUser();
  if (!user) redirect('/admin/login');
  if (ROLE_RANK[user.role] < ROLE_RANK[audience]) notFound();
  return user;
}
