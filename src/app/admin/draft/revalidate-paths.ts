/**
 * The `/admin/draft/revalidate` route's path allowlist (AFLDB-ISSUE-160
 * §18, D-9) -- extracted for direct unit testing, matching the
 * ISSUE-159 coach precedent (`tests/admin-draft-actions.test.ts`).
 *
 * Every draft-facing PUBLIC page is `force-dynamic` (`/draft`,
 * `/draft/[year]`, `/players`) and needs no cache invalidation at all
 * (AFLDB-ISSUE-160 runbook §7 / `AFLDB-ISSUE-156.md` §7 row P3b); club pages
 * do not render draft data (§0.1). Only two surfaces are actually cached:
 * `/players/[slug]` (ISR, one hour) and `/sitemap.xml` (enumerates players,
 * so a newly created player needs it). Those are the only two shapes this
 * allowlist admits.
 *
 * Anchored (`^...$`) and restricted to lowercase alphanumerics, hyphens and
 * digits: no path traversal, no scheme, no host, no query string. Nothing
 * from the browser reaches `revalidatePath` unvalidated, regardless of what
 * the client claims changed.
 */

const FIXED_PATHS = new Set(['/sitemap.xml']);
const PLAYER_PATH = /^\/players\/[a-z0-9-]+-\d+$/;

export function isAllowedRevalidatePath(path: string): boolean {
  return FIXED_PATHS.has(path) || PLAYER_PATH.test(path);
}
