import { isAllowedRevalidatePath } from '@/app/admin/draft/revalidate-paths';
import { applyRevalidateRequest } from '@/lib/admin/revalidate-route';
import { requireCapability } from '@/lib/auth/session';

/**
 * The one place any draft-admin `revalidatePath` call actually happens
 * (AFLDB-ISSUE-160 §18, D-9). See `src/app/admin/coaches/revalidate/route.ts`
 * for the full rationale this mirrors: never called from inside a draft
 * Server Action (S-6, the Next 15.5 hang); the browser posts here only as a
 * follow-up once a mutation has already committed; paths are allowlisted by
 * shape, never taken as arbitrary strings.
 */
export async function POST(request: Request): Promise<Response> {
  await requireCapability('data.draft.edit');
  return applyRevalidateRequest(request, isAllowedRevalidatePath);
}
