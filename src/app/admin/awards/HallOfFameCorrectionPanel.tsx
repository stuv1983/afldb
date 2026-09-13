'use client';

import { useRef, useState } from 'react';

import { correctHallOfFameAction } from '@/app/admin/awards/actions';
import { asText, correctionFormData, useCorrectionDraft } from '@/app/admin/awards/correction-state';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';
import type { HallOfFameRow } from '@/db/queries/admin-awards';

const CATEGORIES = ['Player', 'Coach', 'Umpire', 'Media', 'Administrator', 'Pioneer'];

/**
 * Correct the safe metadata of one Hall of Fame entry (AFLDB-ISSUE-165 §6.5,
 * §6.6).
 *
 * The name and the induction year are absent, because together they ARE the
 * entry's identity (migration 042 keys the table on them, and the durable
 * record is named by them). A wrong one is a void plus a replacement.
 *
 * REMOVAL YEAR IS HERE, AND VOIDING IS NOT. They are different statements and
 * the page keeps them apart on purpose:
 *
 *   - a removal year says a genuine inductee was later formally removed from
 *     the Hall of Fame. It happened; the entry stays on the public site and
 *     shows it;
 *   - voiding says this administrative record should never have existed at
 *     all. That control is in "Lifecycle", not here.
 */
export function HallOfFameCorrectionPanel({ row }: { row: HallOfFameRow }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const [adminNote, setAdminNote] = useState('');
  const correct = useAwardsActionSubmit(correctHallOfFameAction);
  const draft = useCorrectionDraft({
    category: asText(row.category),
    isLegend: row.isLegend,
    legendYear: asText(row.legendYear),
    clubNameRaw: asText(row.clubNameRaw),
    state: asText(row.state),
    playingCareer: asText(row.playingCareer),
    removedYear: asText(row.removedYear),
    notes: asText(row.notes),
  });

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    correct.submit(
      correctionFormData({
        rowId: row.id, expectedUpdatedAt: row.updatedAt,
        values: draft.values, changed: draft.changed, adminNote,
      }),
      submitRef.current,
    );
  };

  return (
    <section className="section">
      <h2>Correct this entry</h2>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
        {correct.state.error && <p className="notice" role="alert">{correct.state.error}</p>}
        {correct.state.ok && <p className="notice" role="status">{correct.state.message}</p>}
        {correct.state.warning && <p className="notice" role="alert">{correct.state.warning}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Category
            <select value={draft.values.category} onChange={(e) => draft.set('category', e.target.value)}>
              <option value="">— None recorded —</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Home state
            <input
              type="text" maxLength={60} value={draft.values.state}
              onChange={(e) => draft.set('state', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Club(s) / association
            <input
              type="text" maxLength={200} value={draft.values.clubNameRaw}
              onChange={(e) => draft.set('clubNameRaw', e.target.value)}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', minHeight: '44px' }}>
            <input
              type="checkbox" checked={draft.values.isLegend}
              onChange={(e) => draft.set('isLegend', e.target.checked)}
            />
            <strong>Legend</strong>
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            Legend year
            <input
              type="number" min={1996} max={2100} style={{ width: '7rem' }}
              value={draft.values.legendYear}
              onChange={(e) => draft.set('legendYear', e.target.value)}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem', maxWidth: '22rem' }}>
          Removed from the Hall in (year)
          <input
            type="number" min={1996} max={2100} value={draft.values.removedYear}
            onChange={(e) => draft.set('removedYear', e.target.value)}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            A historical fact about the Hall of Fame, not a lifecycle state. The entry stays public
            and shows the removal. To say the record itself should never have existed, void it.
          </span>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Career summary / achievements
          <input
            type="text" maxLength={200} value={draft.values.playingCareer}
            onChange={(e) => draft.set('playingCareer', e.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Biographical notes
          <textarea
            rows={2} maxLength={2000} style={{ resize: 'vertical' }}
            value={draft.values.notes}
            onChange={(e) => draft.set('notes', e.target.value)}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Administrative note (kept with the audit entry)
          <input
            type="text" maxLength={2000} value={adminNote}
            onChange={(e) => setAdminNote(e.target.value)}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            ref={submitRef} type="submit" className="btn btn-primary"
            disabled={correct.isPending || draft.changed.length === 0}
          >
            {correct.isPending ? 'Saving…' : 'Save correction'}
          </button>
          <button
            type="button" className="btn btn-secondary"
            onClick={draft.reset} disabled={correct.isPending || draft.changed.length === 0}
          >
            Discard changes
          </button>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {draft.changed.length === 0
              ? 'No changes yet.'
              : `${draft.changed.length} field${draft.changed.length === 1 ? '' : 's'} changed.`}
          </span>
        </div>
      </form>
    </section>
  );
}
