'use client';

import { useRef, useState } from 'react';

import { correctHonourTeamAction } from '@/app/admin/awards/actions';
import { asText, correctionFormData, useCorrectionDraft } from '@/app/admin/awards/correction-state';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';
import type { HonourTeamMemberRow } from '@/db/queries/admin-awards';

/**
 * Correct the safe metadata of one honour-team selection (AFLDB-ISSUE-165
 * §6.5).
 *
 * The team and the selected person are absent: migration 059 keys this table
 * on `(team_name, player_id)` when linked and `(team_name, player_name_raw)`
 * when not, precisely so a same-named different player could not overwrite
 * someone else's selection (ISSUE-025). Editing either in place would walk
 * straight back into that defect, so a wrong one is a void plus a replacement
 * — and the replacement is put through the same collision check a creation
 * is.
 */
export function HonourTeamCorrectionPanel({ row }: { row: HonourTeamMemberRow }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const [adminNote, setAdminNote] = useState('');
  const correct = useAwardsActionSubmit(correctHonourTeamAction);
  const draft = useCorrectionDraft({
    position: asText(row.position),
    role: asText(row.role),
    clubNameRaw: asText(row.clubNameRaw),
    sortOrder: asText(row.sortOrder),
    note: asText(row.note),
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
      <h2>Correct this selection</h2>
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
        {correct.state.error && <p className="notice" role="alert">{correct.state.error}</p>}
        {correct.state.ok && <p className="notice" role="status">{correct.state.message}</p>}
        {correct.state.warning && <p className="notice" role="alert">{correct.state.warning}</p>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Position
            <input
              type="text" maxLength={100} value={draft.values.position}
              onChange={(e) => draft.set('position', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Role
            <input
              type="text" maxLength={100} value={draft.values.role}
              onChange={(e) => draft.set('role', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Club(s)
            <input
              type="text" maxLength={200} value={draft.values.clubNameRaw}
              onChange={(e) => draft.set('clubNameRaw', e.target.value)}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Lineup order
            <input
              type="number" min={0} max={50} value={draft.values.sortOrder}
              onChange={(e) => draft.set('sortOrder', e.target.value)}
            />
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
