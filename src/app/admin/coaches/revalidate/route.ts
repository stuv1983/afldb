import { isAllowedRevalidatePath } from '@/app/admin/coaches/revalidate-paths';
import { applyRevalidateRequest } from '@/lib/admin/revalidate-route';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place any coach-admin `revalidatePath` call actually happens
 * (AFLDB-ISSUE-159 §9, S-6). The parse-and-loop body is shared with every
 * other domain's revalidate route (AFLDB-ISSUE-160 D-9,
 * `src/lib/admin/revalidate-route.ts`); the guard and the allowlist stay
 * here, one per domain.
 *
 * Never called from inside a coach Server Action — see
 * `src/app/admin/coaches/submit-helper.ts` for why. The browser posts here
 * as a follow-up request once a mutation has already committed and its
 * result is back, so this route can never observe a state the action itself
 * has not already returned successfully. `requireCapability` therefore
 * guards against an arbitrary caller invalidating cache pages, not against
 * an unauthorised write -- there is none here, and the admin session cookie
 * is `sameSite: 'lax'` (`src/lib/auth/session.ts`), which a cross-site POST
 * does not carry, so an off-site caller reaches `requireCapability` with no
 * session at all.
 *
 * Paths are allowlisted by shape (`revalidate-paths.ts`), never taken as
 * arbitrary strings: nothing from the browser reaches `revalidatePath`
 * unvalidated, regardless of what the client claims changed.
 */

export async function POST(request: Request): Promise<Response> {
  await requireCapability('data.coaches.edit');
  return applyRevalidateRequest(request, isAllowedRevalidatePath);
}
