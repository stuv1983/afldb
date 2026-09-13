'use client';

import { useRef, useState } from 'react';

import { correctAwardWinnerAction } from '@/app/admin/awards/actions';
import { asText, correctionFormData, useCorrectionDraft } from '@/app/admin/awards/correction-state';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';
import type { AwardWinnerRow } from '@/db/queries/admin-awards';
import type { ClubSummary } from '@/db/queries/clubs';

/**
 * Correct the safe metadata of one award-winner record (AFLDB-ISSUE-165
 * §6.5).
 *
 * Every field here is one the record's identity does not depend on. The award,
 * the season, the recipient and the provenance are NOT here and are not
 * editable anywhere: changing one would turn this record into a different
 * record while leaving the audit trail describing the first. The detail page
 * shows them as read-only with that reason, and the mutation contract refuses
 * them a second time regardless of what is posted.
 *
 * The club IS correctable, because it does not decide which row this is — but
 * it moves as one fact: the mutation resolves the club identity that was
 * actually trading in the winner's own season (Footscray, not Western
 * Bulldogs, in 1980) and refuses a club that was not.
 */
export function WinnerCorrectionPanel({
  row, clubs,
}: {
  row: AwardWinnerRow;
  clubs: ClubSummary[];
}) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const [adminNote, setAdminNote] = useState('');
  const correct = useAwardsActionSubmit(correctAwardWinnerAction);
  const draft = useCorrectionDraft({
    votes: asText(row.votes),
    position: asText(row.position),
    isCaptain: row.isCaptain,
    isViceCaptain: row.isViceCaptain,
    note: asText(row.note),
    sortOrder: asText(row.sortOrder),
    clubId: asText(row.clubId),
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
      <h2>Correct this record</h2>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
        {correct.state.error && <p className="notice" role="alert">{correct.state.error}</p>}
        {correct.state.ok && <p className="notice" role="status">{correct.state.message}</p>}
        {correct.state.warning && <p className="notice" role="alert">{correct.state.warning}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Votes / statistic
            <input
              type="text" inputMode="decimal" value={draft.values.votes}
              onChange={(e) => draft.set('votes', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Position
            <input
              type="text" maxLength={100} value={draft.values.position}
              onChange={(e) => draft.set('position', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Display order
            <input
              type="number" min={1} max={100} value={draft.values.sortOrder}
              onChange={(e) => draft.set('sortOrder', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Club (as it traded in {row.season ?? 'that season'})
            <select value={draft.values.clubId} onChange={(e) => draft.set('clubId', e.target.value)}>
              <option value="">— No club recorded —</option>
              {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', minHeight: '44px' }}>
            <input
              type="checkbox" checked={draft.values.isCaptain}
              onChange={(e) => draft.set('isCaptain', e.target.checked)}
            />
            Team captain
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', minHeight: '44px' }}>
            <input
              type="checkbox" checked={draft.values.isViceCaptain}
              onChange={(e) => draft.set('isViceCaptain', e.target.checked)}
            />
            Vice-captain
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Note / citation
          <input
            type="text" maxLength={1000} value={draft.values.note}
            onChange={(e) => draft.set('note', e.target.value)}
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
