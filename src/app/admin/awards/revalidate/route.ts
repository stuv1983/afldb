import { isAllowedRevalidatePath } from '@/app/admin/awards/revalidate-paths';
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
 * Guarded by `data.awards.edit`, not `.read`: this endpoint exists only to
 * finish a mutation, and only a Super Admin can have made one.
 */
export async function POST(request: Request): Promise<Response> {
  await requireCapability('data.awards.edit');
  return applyRevalidateRequest(request, isAllowedRevalidatePath);
}
