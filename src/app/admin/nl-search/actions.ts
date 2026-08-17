'use server';

import { revalidatePath } from 'next/cache';

import { saveNlSearchReview } from '@/db/queries/nl-search-log';
import { audit, requireSuperAdmin } from '@/lib/auth/session';
import { isNlReviewCategory, isNlReviewStatus, type NlReviewCategory } from '@/search/nl/review-spec';

export type NlReviewState = { error?: string; message?: string };

/**
 * Record (or update) an admin's judgement about one logged search.
 *
 * Guarded by requireSuperAdmin, the same gate the page itself uses: the
 * search log holds raw reader questions, so both reading and annotating it
 * stay at the narrowest role rather than the wider "admin".
 *
 * Every enum value is checked against the closed set from review-spec.ts
 * before it reaches SQL. The CHECK constraints in migration 047 would
 * reject a bad value anyway -- this exists so the admin gets "unknown
 * status" back instead of a 500 from a constraint violation.
 */
export async function saveReview(
  _previous: NlReviewState,
  formData: FormData,
): Promise<NlReviewState> {
  const admin = await requireSuperAdmin();

  const searchLogId = Number(formData.get('searchLogId'));
  if (!Number.isInteger(searchLogId) || searchLogId <= 0) {
    return { error: 'Bad search id.' };
  }

  const status = String(formData.get('status') ?? '');
  if (!isNlReviewStatus(status)) return { error: 'Unknown review status.' };

  // Empty means "not categorised" and is a legitimate choice, so the
  // closed-set check only applies once something was actually picked.
  const rawCategory = String(formData.get('category') ?? '').trim();
  let category: NlReviewCategory | null = null;
  if (rawCategory) {
    if (!isNlReviewCategory(rawCategory)) return { error: 'Unknown category.' };
    category = rawCategory;
  }

  // Free text, so it is bounded rather than trusted. Both columns are
  // plain `text` in the schema; the caps here are about keeping the admin
  // table readable, not about safety.
  const rawNotes = String(formData.get('notes') ?? '').trim();
  if (rawNotes.length > 2000) return { error: 'Notes are limited to 2000 characters.' };
  const notes = rawNotes ? rawNotes : null;

  const rawVersion = String(formData.get('fixedInVersion') ?? '').trim();
  if (rawVersion.length > 40) return { error: 'Version label is limited to 40 characters.' };
  const fixedInVersion = rawVersion ? rawVersion : null;

  await saveNlSearchReview({
    searchLogId, status, category, notes, fixedInVersion, reviewedBy: admin.id,
  });

  await audit('nl_search.reviewed', { searchLogId, status, category },
    { userId: admin.id, label: admin.email });

  revalidatePath(`/admin/nl-search/${searchLogId}`);
  revalidatePath('/admin/nl-search');

  return { message: 'Review saved.' };
}
