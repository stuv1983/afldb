'use server';

import { revalidatePath } from 'next/cache';

import { authSql } from '@/db/authClient';
import { saveNlSearchReview } from '@/db/queries/nl-search-log';
import { clearNlSearchTelemetry, type NlTelemetryClearCounts } from '@/db/queries/nl-search-telemetry-clear';
import { audit, auditInTransaction, requireSuperAdmin } from '@/lib/auth/session';
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

/** Exact phrase an operator must type to enable the clear control (AFLDB-ISSUE-119 §10). */
export const NL_TELEMETRY_CLEAR_PHRASE = 'CLEAR SEARCH TELEMETRY';

export type NlClearTelemetryState = {
  error?: string;
  message?: string;
  counts?: NlTelemetryClearCounts;
};

/**
 * Delete disposable nl_search_log rows and audit the deletion, atomically
 * (AFLDB-ISSUE-119 §6, §8, §9, §11).
 *
 * requireSuperAdmin() runs before anything else, including confirmation
 * parsing, so a forged direct call to this action stops at the guard
 * rather than at the phrase check -- rendering the control conditionally
 * on the page is not itself an authorisation boundary.
 *
 * The confirmation phrase is re-checked here independently of the client:
 * a wrong or missing value returns before any transaction opens, so it
 * deletes nothing and audits nothing.
 *
 * clearNlSearchTelemetry() and auditInTransaction() both ride the one
 * authSql.begin() handle below. That is load-bearing, not stylistic: the
 * clear function's SHARE ROW EXCLUSIVE locks only define the §8
 * concurrency cutoff for as long as they live inside an open transaction,
 * and the audit row must commit with the deletion or not at all. Neither
 * call is wrapped in try/catch, matching auditInTransaction's own
 * contract -- an audit failure must abort and roll back the deletion, and
 * a best-effort warning here would recreate the exact gap that
 * transaction exists to close.
 */
export async function clearTelemetry(
  _previous: NlClearTelemetryState,
  formData: FormData,
): Promise<NlClearTelemetryState> {
  const admin = await requireSuperAdmin();

  const confirmation = String(formData.get('confirmation') ?? '');
  if (confirmation !== NL_TELEMETRY_CLEAR_PHRASE) {
    return { error: `Type ${NL_TELEMETRY_CLEAR_PHRASE} exactly to confirm.` };
  }

  const counts = await authSql.begin(async (tx) => {
    const result = await clearNlSearchTelemetry(tx);
    await auditInTransaction(tx, 'nl_search.telemetry_cleared', result, {
      userId: admin.id, label: admin.email,
    });
    return result;
  });

  revalidatePath('/admin/nl-search', 'layout');
  revalidatePath('/admin/app-health');

  return {
    message: `Cleared ${counts.deletedLogRows} disposable search log row`
      + `${counts.deletedLogRows === 1 ? '' : 's'}. ${counts.retainedLogRows} log row`
      + `${counts.retainedLogRows === 1 ? '' : 's'} retained, alongside every review and `
      + 'feedback row.',
    counts,
  };
}
