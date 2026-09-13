/**
 * The `/admin/awards/revalidate` route's path allowlist (AFLDB-ISSUE-165
 * §5.6), extracted for direct unit testing and following the ISSUE-159 coach
 * / ISSUE-160 draft precedent exactly.
 *
 * Kept out of `route.ts` on purpose: a Route Handler module may only export
 * the HTTP-verb functions, so a plain named helper cannot live there and
 * still be imported by a test.
 *
 * The shapes here are exactly the ones `src/db/queries/admin-awards.ts`
 * computes server-side (`awardWinnerPaths` / `hallOfFamePaths` /
 * `honourTeamPaths`) and no others. Anchored (`^...$`) and restricted to
 * lowercase alphanumerics, hyphens and digits: no path traversal, no scheme,
 * no host, no query string. Nothing from the browser reaches
 * `revalidatePath` unvalidated, regardless of what the client claims changed.
 *
 * `/hall-of-fame` is `force-dynamic` and needs no invalidation, but a
 * mutation names it, so the route admits it rather than silently discarding
 * a path the server itself computed.
 */

const FIXED_PATHS = new Set(['/awards', '/hall-of-fame', '/sitemap.xml']);
const AWARD_PATH = /^\/awards\/[a-z0-9-]+$/;
const AWARD_SEASON_PATH = /^\/awards\/[a-z0-9-]+\/\d{4}$/;
const HONOUR_TEAM_PATH = /^\/honour-teams\/[a-z0-9-]+$/;
const PLAYER_PATH = /^\/players\/[a-z0-9-]+-\d+$/;
const CLUB_PATH = /^\/clubs\/[a-z0-9-]+$/;
const SEASON_PATH = /^\/seasons\/\d{4}$/;

export function isAllowedRevalidatePath(path: string): boolean {
  return FIXED_PATHS.has(path)
    || AWARD_PATH.test(path)
    || AWARD_SEASON_PATH.test(path)
    || HONOUR_TEAM_PATH.test(path)
    || PLAYER_PATH.test(path)
    || CLUB_PATH.test(path)
    || SEASON_PATH.test(path);
}
