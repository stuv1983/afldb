'use client';

import { useState } from 'react';

import { removeSeasonListMemberAction, transferSeasonListMemberAction } from '@/app/admin/season-lists/actions';
import { LEADERSHIP_ROLE_LABELS } from '@/app/admin/season-lists/leadership-labels';
import { useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';
import type { LeadershipRole } from '@/db/queries/admin-club-leadership';

/**
 * Remove or transfer ONE membership row (AFLDB-ISSUE-161 §12.2, §13). One
 * instance per member row, unlike the ISSUE-160 `RetirePanel`/`SupersedePanel`
 * precedent (one per whole detail page) — a club list has many members, each
 * independently removable/transferable, so the confirm state is local to the
 * row rather than the page.
 *
 * Wording says what actually happens: "Remove from the {season} list", never
 * "retire" (§12.2, D-4) — no career, draft or global-retirement state is
 * touched. Transfer is the atomic Stage 1 primitive, never client-side
 * remove-then-add (§13).
 */
export function MemberActions({
  season, membershipId, playerName, currentClubSlug, expectedUpdatedAt, eligibleClubs,
  activeLeadershipRole,
}: {
  season: number;
  membershipId: number;
  playerName: string;
  currentClubSlug: string;
  expectedUpdatedAt: string;
  eligibleClubs: { slug: string; name: string }[];
  /** AFLDB-ISSUE-163 §9: warns, never blocks — 161's contract is unchanged. */
  activeLeadershipRole?: LeadershipRole | null;
}) {
  const leadershipWarning = activeLeadershipRole && (
    <> {playerName} is the active {season} {LEADERSHIP_ROLE_LABELS[activeLeadershipRole].toLowerCase()};
    the appointment stays recorded until you end it.</>
  );
  const remove = useSeasonListActionSubmit(removeSeasonListMemberAction, {});
  const transfer = useSeasonListActionSubmit(transferSeasonListMemberAction, {});
  const [mode, setMode] = useState<'none' | 'remove' | 'transfer'>('none');
  const [toClub, setToClub] = useState('');
  const isPending = remove.isPending || transfer.isPending;

  if (remove.state.ok) {
    return <p className="muted" style={{ fontSize: '0.8rem' }} role="status">Removed.</p>;
  }
  if (transfer.state.ok) {
    return <p className="muted" style={{ fontSize: '0.8rem' }} role="status">Transferred.</p>;
  }

  const handleRemove = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('membershipId', String(membershipId));
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('confirmRemove', '1');
    remove.submit(formData, event.currentTarget);
  };

  const handleTransfer = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!toClub) return;
    const formData = new FormData();
    formData.set('membershipId', String(membershipId));
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('toClubSlug', toClub);
    transfer.submit(formData, event.currentTarget);
  };

  if (mode === 'remove') {
    return (
      <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', minWidth: '12rem' }}>
        <p role="alert">
          Remove {playerName} from the {season} list? This cannot be undone from this page.
          {leadershipWarning}
        </p>
        {remove.state.error && <p className="notice" role="alert">{remove.state.error}</p>}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleRemove} disabled={isPending}>
            {remove.isPending ? 'Removing…' : 'Confirm remove'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={isPending}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'transfer') {
    const destinations = eligibleClubs.filter((club) => club.slug !== currentClubSlug);
    return (
      <div style={{ display: 'grid', gap: '0.3rem', fontSize: '0.8rem', minWidth: '12rem' }}>
        {leadershipWarning && <p role="alert">Transferring {playerName}?{leadershipWarning}</p>}
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Transfer to
          <select value={toClub} onChange={(event) => setToClub(event.target.value)} disabled={isPending}>
            <option value="">— select —</option>
            {destinations.map((club) => <option key={club.slug} value={club.slug}>{club.name}</option>)}
          </select>
        </label>
        {transfer.state.error && <p className="notice" role="alert">{transfer.state.error}</p>}
        <div style={{ display: 'flex', gap: '0.4rem' }}>
          <button type="button" className="btn btn-primary" onClick={handleTransfer} disabled={isPending || !toClub}>
            {transfer.isPending ? 'Transferring…' : 'Confirm transfer'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={isPending}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      <button type="button" className="btn btn-secondary" onClick={() => setMode('remove')}>Remove…</button>
      <button type="button" className="btn btn-secondary" onClick={() => setMode('transfer')}>Transfer…</button>
    </div>
  );
}
