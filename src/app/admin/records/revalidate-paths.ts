/**
 * The `/admin/records/revalidate` route's path allowlist (AFLDB-ISSUE-167
 * Stage 6), extracted for direct unit testing and following the ISSUE-159
 * coach / ISSUE-160 draft / ISSUE-165 awards precedent exactly.
 *
 * Kept out of `route.ts` on purpose: a Route Handler module may only export the
 * HTTP-verb functions, so a plain named helper cannot live there and still be
 * imported by a test.
 *
 * The shapes here are exactly the ones `src/db/queries/admin-special-records.ts`
 * computes server-side (`specialRecordPaths`) and no others. Anchored
 * (`^...$`) and restricted to lowercase alphanumerics, hyphens and digits: no
 * path traversal, no scheme, no host, no query string. Nothing from the browser
 * reaches `revalidatePath` unvalidated, regardless of what the client claims
 * changed.
 *
 * The two `/admin/records/...` shapes are `force-dynamic` pages and need no
 * invalidation, but a mutation names them, so the route admits them rather than
 * silently discarding a path the server itself computed.
 */

const FIXED_PATHS = new Set([
  '/records/first-kick-goal',
  '/records/after-the-siren',
]);
const ADMIN_FAMILY_PATH = /^\/admin\/records\/(first-kick-goal|after-the-siren)$/;
const ADMIN_RECORD_PATH = /^\/admin\/records\/(first-kick-goal|after-the-siren)\/\d+$/;
const PLAYER_PATH = /^\/players\/[a-z0-9-]+-\d+$/;
const CLUB_PATH = /^\/clubs\/[a-z0-9-]+$/;
const MATCH_PATH = /^\/matches\/\d+$/;

export function isAllowedRevalidatePath(path: string): boolean {
  return FIXED_PATHS.has(path)
    || ADMIN_FAMILY_PATH.test(path)
    || ADMIN_RECORD_PATH.test(path)
    || PLAYER_PATH.test(path)
    || CLUB_PATH.test(path)
    || MATCH_PATH.test(path);
}
