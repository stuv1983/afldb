import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';

/**
 * The shared body of every domain "revalidate" route (AFLDB-ISSUE-160 D-9,
 * extracted from the ISSUE-159 coach precedent, `src/app/admin/coaches/
 * revalidate/route.ts`).
 *
 * Deliberately NOT the capability guard: `tests/auth.test.ts`'s
 * capability-enforcement contract reads each `route.ts` file's own source
 * and requires its exported `POST` to `await requireCapability(...)` as the
 * very first thing it does, so every domain route keeps that call (and its
 * own capability literal) in its own file. What is shared is the part that
 * carries no domain policy: parse the body, keep only paths the caller's own
 * allowlist admits, and call `revalidatePath` for each survivor.
 *
 * Never called from inside a Server Action — see the coach precedent's
 * `submit-helper.ts` for why (S-6, the Next 15.5 hang). The browser posts
 * here as a follow-up request once a mutation has already committed, so this
 * handler can never observe a state the action itself has not already
 * returned successfully.
 */
export async function applyRevalidateRequest(
  request: Request,
  isAllowedPath: (path: string) => boolean,
): Promise<Response> {
  const body = await request.json().catch(() => null) as { paths?: unknown } | null;
  const requested = Array.isArray(body?.paths)
    ? body.paths.filter((p): p is string => typeof p === 'string')
    : [];

  const revalidated: string[] = [];
  for (const path of requested) {
    if (!isAllowedPath(path)) continue;
    revalidatePath(path);
    revalidated.push(path);
  }

  return NextResponse.json({ ok: true, revalidated });
}
