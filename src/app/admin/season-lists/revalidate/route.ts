import { isAllowedLeadershipRevalidatePath } from '@/app/admin/season-lists/revalidate-paths';
import { applyRevalidateRequest } from '@/lib/admin/revalidate-route';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place any season-list-domain `revalidatePath` call actually happens
 * (AFLDB-ISSUE-161 D-9, AFLDB-ISSUE-163 §21/D-13). Reserved by ISSUE-161 as
 * `REVALIDATE_ENDPOINT` and never requested until now: club leadership is the
 * first season-list mutation with a public consumer, so this route exists
 * from Stage 2 and every other season-list action keeps returning
 * `revalidatePaths: []`, which `useAdminActionSubmit`'s `postRevalidate()`
 * never fetches for.
 *
 * See `src/app/admin/coaches/revalidate/route.ts` for the full rationale this
 * mirrors: never called from inside a Server Action (S-6, the Next 15.5
 * hang); the browser posts here only as a follow-up once a mutation has
 * already committed; paths are allowlisted by shape, never taken as
 * arbitrary strings.
 */
export async function POST(request: Request): Promise<Response> {
  await requireCapability('data.seasonLists.edit');
  return applyRevalidateRequest(request, isAllowedLeadershipRevalidatePath);
}
