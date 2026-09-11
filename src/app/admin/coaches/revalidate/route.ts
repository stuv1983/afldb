import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

import { isAllowedRevalidatePath } from '@/app/admin/coaches/revalidate-paths';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place any coach-admin `revalidatePath` call actually happens
 * (AFLDB-ISSUE-159 §9, S-6).
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

  const body = await request.json().catch(() => null) as { paths?: unknown } | null;
  const requested = Array.isArray(body?.paths)
    ? body.paths.filter((p): p is string => typeof p === 'string')
    : [];

  const revalidated: string[] = [];
  for (const path of requested) {
    if (!isAllowedRevalidatePath(path)) continue;
    revalidatePath(path);
    revalidated.push(path);
  }

  return NextResponse.json({ ok: true, revalidated });
}
