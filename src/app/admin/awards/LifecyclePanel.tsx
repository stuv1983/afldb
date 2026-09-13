'use client';

import { useRef, useState } from 'react';

import {
  reinstateAwardWinnerAction, reinstateHallOfFameAction, reinstateHonourTeamAction,
  voidAwardWinnerAction, voidHallOfFameAction, voidHonourTeamAction,
} from '@/app/admin/awards/actions';
import { DOMAIN_NOUNS, type HonourDomain } from '@/app/admin/awards/labels';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';

const VOID_ACTIONS = {
  winners: voidAwardWinnerAction,
  'hall-of-fame': voidHallOfFameAction,
  'honour-teams': voidHonourTeamAction,
} as const;

const REINSTATE_ACTIONS = {
  winners: reinstateAwardWinnerAction,
  'hall-of-fame': reinstateHallOfFameAction,
  'honour-teams': reinstateHonourTeamAction,
} as const;

/**
 * Void or reinstate one record (AFLDB-ISSUE-165 §6.5).
 *
 * Voiding is not deletion and never becomes one: the row stays, its audit
 * trail stays resolvable through the next promotion's lineage remap, and its
 * durable `data_overrides` record is what re-asserts the decision after a
 * rebuild. What changes is that every public and search surface stops
 * repeating the assertion (§4).
 *
 * Both directions ask before acting, and the reason is required in one
 * direction only: voiding needs a reason because the database refuses a void
 * without one, and because "why is this not on the site" is the question the
 * next administrator will ask. Reinstating restores the row to exactly what it
 * said before, so there is nothing new to explain — the audit entry records
 * who and when.
 *
 * `expectedUpdatedAt` is the value this page rendered. If the record changed
 * while the page was open — an importer reload, another administrator — the
 * mutation refuses rather than acting on a stale reading.
 */
export function LifecyclePanel({
  domain, rowId, expectedUpdatedAt, status, statusReason,
}: {
  domain: HonourDomain;
  rowId: number;
  expectedUpdatedAt: string;
  status: 'active' | 'void';
  statusReason: string | null;
}) {
  const noun = DOMAIN_NOUNS[domain];
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const voidButtonRef = useRef<HTMLButtonElement>(null);
  const reinstateButtonRef = useRef<HTMLButtonElement>(null);
  const voidIt = useAwardsActionSubmit(VOID_ACTIONS[domain]);
  const reinstate = useAwardsActionSubmit(REINSTATE_ACTIONS[domain]);

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
          This {noun} is <strong>void</strong> and appears nowhere on the public site, in the Grid
          Solver, in search or in the sitemap. It is kept so the decision, its reason and its audit
          trail survive.
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
        Void this {noun} when the record should never have existed — a duplicate, the wrong season,
        the wrong award. It is removed from every public surface but never deleted. If the fact is
        right and only a detail is wrong, correct it above instead; if the wrong <em>person</em> or
        the wrong <em>award</em> was recorded, use Replace, which does both halves as one change.
      </p>

      {voidIt.state.error && <p className="notice" role="alert">{voidIt.state.error}</p>}
      {voidIt.state.ok && <p className="notice" role="status">{voidIt.state.message}</p>}
      {voidIt.state.warning && <p className="notice" role="alert">{voidIt.state.warning}</p>}

      {!confirming ? (
        <button type="button" className="btn btn-secondary" onClick={() => setConfirming(true)}>
          Void this record…
        </button>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem', maxWidth: '34rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Why is this record wrong? *
            <input
              type="text" maxLength={500} value={reason} required
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate of entry #1234; recorded against the wrong season"
            />
          </label>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              ref={voidButtonRef}
              type="button"
              className="btn btn-primary"
              disabled={voidIt.isPending || reason.trim() === ''}
              onClick={() => {
                const data = base();
                data.set('reason', reason);
                voidIt.submit(data, voidButtonRef.current);
              }}
            >
              {voidIt.isPending ? 'Voiding…' : 'Void this record'}
            </button>
            <button
              type="button" className="btn btn-secondary"
              onClick={() => setConfirming(false)} disabled={voidIt.isPending}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
