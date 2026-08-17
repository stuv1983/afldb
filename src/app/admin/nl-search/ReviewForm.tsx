'use client';

import { useActionState } from 'react';

import { saveReview, type NlReviewState } from './actions';
import {
  NL_REVIEW_CATEGORIES, NL_REVIEW_CATEGORY_LABEL,
  NL_REVIEW_STATUSES, NL_REVIEW_STATUS_LABEL,
  type NlReviewCategory, type NlReviewStatus,
} from '@/search/nl/review-spec';

/**
 * The triage form on a search-detail page. Everything it can submit is a
 * value from review-spec.ts's closed sets or bounded free text, and the
 * server action re-checks both -- the <select> options are a convenience,
 * not the guard.
 */
export function ReviewForm({
  searchLogId,
  status,
  category,
  notes,
  fixedInVersion,
}: {
  searchLogId: number;
  status: NlReviewStatus | null;
  category: NlReviewCategory | null;
  notes: string | null;
  fixedInVersion: string | null;
}) {
  const [state, action, saving] = useActionState<NlReviewState, FormData>(saveReview, {});

  return (
    <>
      <form action={action} style={{ display: 'grid', gap: '0.75rem', maxWidth: '40rem' }}>
        <input type="hidden" name="searchLogId" value={searchLogId} />

        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label>
            Status
            <select name="status" defaultValue={status ?? 'unreviewed'}>
              {NL_REVIEW_STATUSES.map((s) => (
                <option key={s} value={s}>{NL_REVIEW_STATUS_LABEL[s]}</option>
              ))}
            </select>
          </label>

          <label>
            Category
            <select name="category" defaultValue={category ?? ''}>
              <option value="">— not categorised —</option>
              {NL_REVIEW_CATEGORIES.map((c) => (
                <option key={c} value={c}>{NL_REVIEW_CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </label>

          <label>
            Fixed in
            <input
              name="fixedInVersion"
              defaultValue={fixedInVersion ?? ''}
              maxLength={40}
              placeholder="e.g. parser v2"
              style={{ width: '9rem' }}
            />
          </label>
        </div>

        <label>
          Notes
          <textarea
            name="notes"
            defaultValue={notes ?? ''}
            maxLength={2000}
            rows={3}
            placeholder="What did you conclude, and what should change?"
          />
        </label>

        <div>
          <button className="btn" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save review'}
          </button>
        </div>
      </form>

      {state.message && <p className="notice">{state.message}</p>}
      {state.error && <p className="notice" role="alert">{state.error}</p>}
    </>
  );
}
