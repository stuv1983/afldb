import { isAllowedRevalidatePath } from '@/app/admin/records/revalidate-paths';
import { applyRevalidateRequest } from '@/lib/admin/revalidate-route';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place any special-records admin `revalidatePath` call actually
 * happens (AFLDB-ISSUE-167 Stage 6, the AFLDB-ISSUE-165 §5.6 shape).
 *
 * Never called from inside a special-record Server Action: `revalidatePath()`
 * there hangs the Next 15.5 client (AFLDB-ISSUE-156 §7 R-7). The browser posts
 * here only as a follow-up once a mutation has already committed, so this
 * handler can never observe a state the action has not already returned
 * successfully; and paths are allowlisted by shape, never taken as arbitrary
 * strings.
 *
 * Guarded by `data.specialRecords.edit`, not `.read`: this endpoint exists only
 * to finish a mutation, and only a Super Admin can have made one.
 */
export async function POST(request: Request): Promise<Response> {
  await requireCapability('data.specialRecords.edit');
  return applyRevalidateRequest(request, isAllowedRevalidatePath);
}
