/**
 * The `/admin/coaches/revalidate` route's path allowlist (AFLDB-ISSUE-159
 * §9, S-6), extracted for direct unit testing -- see
 * `tests/admin-coach-actions.test.ts`.
 *
 * Kept out of `route.ts` on purpose: a Route Handler module may only export
 * the HTTP-verb functions (plus a small fixed set of config exports), so a
 * plain named helper cannot live there and still be imported by a test.
 *
 * Anchored (`^...$`) and restricted to lowercase alphanumerics, hyphens and
 * digits: no path traversal, no scheme, no host, no query string, nothing
 * that could resolve outside the small, fixed shape of a coach/club/player/
 * match public page. `revalidatePath` only ever sees a string that matched
 * one of these, never anything the caller supplied verbatim.
 */

const FIXED_PATHS = new Set(['/coaches', '/records/coaches', '/sitemap.xml']);
const COACH_PATH = /^\/coaches\/[a-z0-9-]+-\d+$/;
const CLUB_PATH = /^\/clubs\/[a-z0-9-]+$/;
const PLAYER_PATH = /^\/players\/[a-z0-9-]+-\d+$/;
const MATCH_PATH = /^\/matches\/\d+$/;

export function isAllowedRevalidatePath(path: string): boolean {
  return FIXED_PATHS.has(path)
    || COACH_PATH.test(path)
    || CLUB_PATH.test(path)
    || PLAYER_PATH.test(path)
    || MATCH_PATH.test(path);
}
