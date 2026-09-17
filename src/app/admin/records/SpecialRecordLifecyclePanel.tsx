'use client';

import { useRef, useState } from 'react';

import {
  reinstateAfterSirenKickAction, reinstateFirstKickGoalAction,
  suppressAfterSirenKickAction, suppressFirstKickGoalAction,
} from '@/app/admin/records/actions';
import { FAMILY_NOUNS, type RecordFamilySlug } from '@/app/admin/records/labels';
import { useSpecialRecordsActionSubmit } from '@/app/admin/records/submit-helper';

const SUPPRESS_ACTIONS = {
  'first-kick-goal': suppressFirstKickGoalAction,
  'after-the-siren': suppressAfterSirenKickAction,
} as const;

const REINSTATE_ACTIONS = {
  'first-kick-goal': reinstateFirstKickGoalAction,
  'after-the-siren': reinstateAfterSirenKickAction,
} as const;

/**
 * Suppress or reinstate one special record (AFLDB-ISSUE-167 §10.2, §4).
 *
 * THE BUTTON READS "SUPPRESS RECORD", not "delete", and the difference is the
 * whole design. The row stays: its `data_edits` history stays resolvable
 * through the next promotion's lineage remap, and its durable `data_overrides`
 * decision is what re-asserts the suppression after a destructive rebuild.
 * What changes is that every public surface — the family page, the player page,
 * NL answers and the Grid Solver — stops repeating the assertion (Stage 5).
 *
 * The reason is MANDATORY in one direction only. Suppressing needs one because
 * migration 102's CHECK refuses a void row without it, and because "why is this
 * not on the site" is the question the next administrator will ask.
 * Reinstating restores the row to exactly what it said before, so there is
 * nothing new to explain — and the earlier suppression's audit entry and its
 * reason are never erased.
 *
 * `expectedUpdatedAt` is the value this page rendered. If the record changed
 * while the page was open — an importer reload that genuinely moved the row,
 * another administrator — the mutation refuses and writes nothing at all.
 */
export function SpecialRecordLifecyclePanel({
  family, rowId, expectedUpdatedAt, status, statusReason,
}: {
  family: RecordFamilySlug;
  rowId: number;
  expectedUpdatedAt: string;
  status: 'active' | 'void';
  statusReason: string | null;
}) {
  const noun = FAMILY_NOUNS[family];
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const suppressButtonRef = useRef<HTMLButtonElement>(null);
  const reinstateButtonRef = useRef<HTMLButtonElement>(null);
  const suppressIt = useSpecialRecordsActionSubmit(SUPPRESS_ACTIONS[family]);
  const reinstate = useSpecialRecordsActionSubmit(REINSTATE_ACTIONS[family]);

  const base = () => {
    const data = new FormData();
    data.set('rowId', String(rowId));
    data.set('expectedUpdatedAt', expectedUpdatedAt);
    return data;
  };

  if (status === 'void') {
    return (
      <section className="section">
        <h2>Lifecycle</h2>
        <p>
          This {noun} is <strong>suppressed</strong> and appears nowhere on the public site, in
          natural-language answers or in the Grid Solver. It is kept so the decision, its reason
          and its audit trail survive, and so a rebuild can re-assert it.
        </p>
        {statusReason && <p className="muted">Reason given: {statusReason}</p>}
        {reinstate.state.error && <p className="notice" role="alert">{reinstate.state.error}</p>}
        {reinstate.state.ok && <p className="notice" role="status">{reinstate.state.message}</p>}
        {reinstate.state.warning && <p className="notice" role="alert">{reinstate.state.warning}</p>}
        <button
          ref={reinstateButtonRef}
          type="button"
          className="btn btn-secondary"
          disabled={reinstate.isPending}
          onClick={() => reinstate.submit(base(), reinstateButtonRef.current)}
        >
          {reinstate.isPending ? 'Reinstating…' : 'Reinstate this record'}
        </button>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Lifecycle</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Suppress this {noun} when the record should never have existed — a duplicate, a fact the
        source got wrong outright. It is removed from every public surface but never deleted. If
        the fact is right and only a detail is wrong, correct it above instead; if the wrong
        <em> person</em> or the wrong <em>match</em> was recorded, use Replace, which does both
        halves as one change.
      </p>

      {suppressIt.state.error && <p className="notice" role="alert">{suppressIt.state.error}</p>}
      {suppressIt.state.ok && <p className="notice" role="status">{suppressIt.state.message}</p>}
      {suppressIt.state.warning && <p className="notice" role="alert">{suppressIt.state.warning}</p>}

      {!confirming ? (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Suppress record…
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem', maxWidth: '34rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Why is this record wrong? *
            <input
              type="text" maxLength={500} value={reason} required
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate of fkg-042; the source misread the round"
            />
          </label>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              ref={suppressButtonRef}
              type="button"
              className="btn btn-primary"
              disabled={suppressIt.isPending || reason.trim() === ''}
              onClick={() => {
                const data = base();
                data.set('reason', reason);
                suppressIt.submit(data, suppressButtonRef.current);
              }}
            >
              {suppressIt.isPending ? 'Suppressing…' : 'Suppress record'}
            </button>
            <button
              type="button" className="btn btn-secondary"
              onClick={() => setConfirming(false)} disabled={suppressIt.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
