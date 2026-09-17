/**
 * The `/admin/season-lists/revalidate` route's path allowlist (AFLDB-ISSUE-163
 * §21, D-13) — the season-list Server Actions' own reserved endpoint
 * (`REVALIDATE_ENDPOINT` in `submit-helper.ts`), requested for the first time:
 * club leadership mutations are the first Admin Centre action set with a
 * PUBLIC consumer. Every other season-list action still returns
 * `revalidatePaths: []`, so this allowlist only ever needs to admit the shape
 * `clubPublicPaths()` produces.
 *
 * Computed SERVER-SIDE in `src/db/queries/admin-club-leadership.ts`'s
 * `clubPublicPaths()` from the affected appointment's own club id, never
 * client-supplied. Anchored (`^...$`) and restricted to lowercase
 * alphanumerics and hyphens: no path traversal, no scheme, no host, no query
 * string, and no other admin domain's public page (`/players/...`, `/`,
 * `/seasons/...`) is ever admitted here.
 */

const CLUB_PATH = /^\/clubs\/[a-z0-9-]+$/;

export function isAllowedLeadershipRevalidatePath(path: string): boolean {
  return CLUB_PATH.test(path);
}
