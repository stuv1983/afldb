'use server';

import type { RetiredAdminRefusal } from '@afldb/domain';

import { refuseRetiredAdminAction } from '@/lib/admin/retired-admin';
import { requireAdmin, requireSuperAdmin } from '@/lib/auth/session';

/**
 * RETIRED (AFLDB V2 Stage 5, V2-GAP-013, docs/v2/legacy-disposition.md L2): CSV submission
 * review and promotion.
 *
 * These three actions used to validate a staged CSV, record the human verdict, and promote an
 * approved file straight into the final statistical tables (`matches`, `player_match_stats`,
 * `players`, `award_winners`, `award_nominations`), bypassing curated review and the
 * sealed-season rules. AFLDB V2 removed that path (plan D9/D10): curated award proposals and the
 * audited data editor replace it, and submissions stay readable as history on the review page.
 *
 * The exported names and each action's EXISTING role guard stay, as the first awaited statement,
 * so who is redirected away is unchanged (tests/auth.test.ts holds the guard contract). An
 * authorised caller gets the typed refusal and one audit row. Neither the ingest pipeline nor
 * any SQL is reachable from this module: it imports neither, and the actions declare no parameters,
 * so no ID, decision or form field a stale `useActionState` client still posts is read and a
 * crafted request carries nothing the refusal could act on.
 */
export type ReviewState = { error?: string; message?: string };

export async function runValidation(): Promise<ReviewState | RetiredAdminRefusal> {
  const admin = await requireAdmin();
  return refuseRetiredAdminAction('admin.submission_review', admin, 'runValidation');
}

export async function decideSubmission(): Promise<ReviewState | RetiredAdminRefusal> {
  const admin = await requireSuperAdmin();
  return refuseRetiredAdminAction('admin.submission_review', admin, 'decideSubmission');
}

export async function runPromotion(): Promise<ReviewState | RetiredAdminRefusal> {
  const admin = await requireSuperAdmin();
  return refuseRetiredAdminAction('admin.submission_review', admin, 'runPromotion');
}
