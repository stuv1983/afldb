import { isAllowedRevalidatePath } from '@/app/admin/awards/revalidate-paths';
import { fanOutAwardSeasons, revalidatedPathsOf } from '@/lib/admin/award-season-fanout';
import { applyRevalidateRequest } from '@/lib/admin/revalidate-route';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place any awards-admin `revalidatePath` call actually happens
 * (AFLDB-ISSUE-165 §5.6). See `src/app/admin/coaches/revalidate/route.ts`
 * for the full rationale this mirrors: never called from inside an awards
 * Server Action (the Next 15.5 client hang, ISSUE-156 §7 R-7); the browser
 * posts here only as a follow-up once a mutation has already committed;
 * paths are allowlisted by shape, never taken as arbitrary strings.
 *
 * AFLDB-ISSUE-372 option B: for each season an admitted path names
 * (`/seasons/<yyyy>`, `/awards/<slug>/<yyyy>`), the season fan-out then
 * refreshes that season's page on EVERY worker
 * (`src/lib/admin/award-season-fanout.ts`), not only the one that answered
 * this request. Best-effort and bounded; inert where `AFLDB_REVALIDATE_*` is
 * unset.
 *
 * Guarded by `data.awards.edit`, not `.read`: this endpoint exists only to
 * finish a mutation, and only a Super Admin can have made one.
 */
export async function POST(request: Request): Promise<Response> {
  await requireCapability('data.awards.edit');
  const response = await applyRevalidateRequest(request, isAllowedRevalidatePath);
  await fanOutAwardSeasons(await revalidatedPathsOf(response));
  return response;
}
