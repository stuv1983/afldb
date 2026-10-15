import { NextResponse } from 'next/server';

import { revalidatePublicLinkPages } from '@/app/admin/player-links/public-link-pages';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place a suggestion approval revalidates the public pages
 * (AFLDB-ISSUE-308). Same shape as the coach, draft and records routes: the
 * browser posts here as a follow-up request once `approveSuggestion` or
 * `bulkApproveSuggestions` has already returned, so the revalidation never
 * runs inside the Server Action (S-6, the Next 15.5 hang).
 *
 * The body is ignored: the path set is fixed in `public-link-pages.ts`, so
 * nothing from the browser reaches `revalidatePath`. The capability guard is
 * the actions' own, so only a viewer who could have approved can reach it.
 */
export async function POST(): Promise<Response> {
  await requireCapability('data.playerLinks');
  revalidatePublicLinkPages();
  return NextResponse.json({ ok: true });
}
