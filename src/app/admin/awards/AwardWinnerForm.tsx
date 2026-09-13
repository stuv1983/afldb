'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { createAwardWinnerAction } from '@/app/admin/awards/actions';
import { AwardWinnerFields } from '@/app/admin/awards/AwardWinnerFields';
import { domainDetailPath } from '@/app/admin/awards/labels';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';
import type { AwardSummary } from '@/db/queries/awards';
import type { ClubSummary } from '@/db/queries/clubs';

/**
 * Record an award winner (AFLDB-ISSUE-165 §6.5 / §6.7).
 *
 * Moved from `/admin/data-editor`, where it was the only way to create one
 * and where its rows carried no durable record at all — a row created there
 * did not survive a rebuild. It now dispatches to the awards domain's own
 * Server Action, which writes the canonical row, its `data_overrides` record
 * and its `data_edits` row in ONE transaction, and is gated by
 * `data.awards.edit` rather than `data.dataEditor`.
 *
 * THE ONE CONFIRMATION. Two rows for the same player in the same award season
 * are legitimate — the 1984 All-Australian lists every player under both a
 * club and a state selection — so a same-player row is surfaced to be
 * confirmed rather than refused. Confirming is a second, explicit submission;
 * the flag is never set by default (R-5).
 */
export function AwardWinnerForm({ awards, clubs }: { awards: AwardSummary[]; clubs: ClubSummary[] }) {
  const router = useRouter();
  const submitRef = useRef<HTMLButtonElement>(null);
  const [confirmed, setConfirmed] = useState(false);
  const create = useAwardsActionSubmit(createAwardWinnerAction);

  useEffect(() => {
    if (create.state.ok && create.state.createdId && !create.state.warning) {
      router.push(domainDetailPath('winners', create.state.createdId));
    }
  }, [create.state.ok, create.state.createdId, create.state.warning, router]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    if (confirmed) data.set('confirmDuplicate', '1');
    create.submit(data, submitRef.current);
  };

  if (create.state.ok) {
    return (
      <section className="section">
        <p className="notice" role="status">
          {create.state.message}
          {create.state.warning ? '' : ' Opening the new record…'}
        </p>
        {create.state.warning && <p className="notice" role="alert">{create.state.warning}</p>}
      </section>
    );
  }

  return (
    <section className="section">
      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
        {create.state.error && (
          <p className="notice" role="alert">{create.state.error}</p>
        )}

        <AwardWinnerFields awards={awards} clubs={clubs} />

        {create.state.needsConfirmation && (
          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'start', fontSize: '0.85rem', minHeight: '44px' }}>
            <input
              type="checkbox" checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              Yes — this really is a second, separate selection for the same player in the same
              season. Record it.
            </span>
          </label>
        )}

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Administrative note (kept with the audit entry)
          <input type="text" name="adminNote" maxLength={2000} />
        </label>

        <div>
          <button ref={submitRef} type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Recording…' : 'Record award winner'}
          </button>
        </div>
      </form>
    </section>
  );
}
