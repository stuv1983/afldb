'use client';

import { useState } from 'react';

import {
  correctAppointmentAction,
  endAppointmentAction,
  reinstateAppointmentAction,
  replaceLeaderAction,
  voidAppointmentAction,
} from '@/app/admin/season-lists/leadership-actions';
import { LEADERSHIP_ROLE_LABELS } from '@/app/admin/season-lists/leadership-labels';
import { useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';
import type { LeadershipRole, LeadershipStatus } from '@/db/queries/admin-club-leadership';

type CandidateMember = { playerId: number; displayName: string; activeLeadershipRole: LeadershipRole | null };

/**
 * Per-appointment lifecycle controls (AFLDB-ISSUE-163 §12, §18): Replace,
 * End, Correct dates/note and Void for an active row; Reinstate and Correct
 * for an ended one; nothing for a void row (terminal — the backend refuses
 * every other transition against it, and offering a control that can only
 * ever fail is convenience, not the boundary, so it is not rendered — the
 * ISSUE-162 §39 lesson).
 *
 * Replace is the one clean "leader changes mid-season" workflow: it is never
 * simulated as void-then-appoint or as editing `playerId` on this row (§12).
 * Void and End are never sibling buttons — void lives in its own, more
 * heavily worded destructive block, exactly as the ISSUE-162 fixture
 * lifecycle precedent (`LifecyclePanel.tsx`) established.
 *
 * A `co_captaincy_unconfirmed` refusal from Replace or Reinstate is rendered
 * as a deliberate second step (the message plus an explicit "Confirm
 * co-captaincy" button that resubmits with `confirmCoCaptaincy=1`) rather
 * than auto-retried — L-3 requires a human decision, never a silent retry.
 */
export function LeadershipActions({
  appointmentKey, role, status, expectedUpdatedAt, startedOn, endedOn, note,
  candidates,
}: {
  appointmentKey: string;
  role: LeadershipRole;
  status: LeadershipStatus;
  expectedUpdatedAt: string;
  startedOn: string | null;
  endedOn: string | null;
  note: string | null;
  /** Other club-season list members, for Replace's incoming-player select. */
  candidates: CandidateMember[];
}) {
  const replace = useSeasonListActionSubmit(replaceLeaderAction, {});
  const end = useSeasonListActionSubmit(endAppointmentAction, {});
  const reinstate = useSeasonListActionSubmit(reinstateAppointmentAction, {});
  const correct = useSeasonListActionSubmit(correctAppointmentAction, {});
  const voidAction = useSeasonListActionSubmit(voidAppointmentAction, {});

  const [mode, setMode] = useState<'none' | 'replace' | 'end' | 'correct' | 'void'>('none');
  const [newPlayerId, setNewPlayerId] = useState('');
  const [effectiveOn, setEffectiveOn] = useState('');
  const [replaceNote, setReplaceNote] = useState('');
  const [endDate, setEndDate] = useState('');
  const [endReason, setEndReason] = useState('');
  // Pre-filled from the row's own current values (§7): a correction is
  // usually a small fix to one field, and submitting a blank field must
  // never silently clear a date or note the operator did not mean to touch.
  const [correctStartedOn, setCorrectStartedOn] = useState(startedOn ?? '');
  const [correctEndedOn, setCorrectEndedOn] = useState(endedOn ?? '');
  const [correctNote, setCorrectNote] = useState(note ?? '');
  const [voidReason, setVoidReason] = useState('');

  const anyPending = replace.isPending || end.isPending || reinstate.isPending
    || correct.isPending || voidAction.isPending;

  if (status === 'void') return null;

  if (replace.state.ok) return <p className="notice" role="status">{replace.state.message}</p>;
  if (end.state.ok) return <p className="notice" role="status">{end.state.message}</p>;
  if (reinstate.state.ok) return <p className="notice" role="status">{reinstate.state.message}</p>;
  if (correct.state.ok) return <p className="notice" role="status">{correct.state.message}</p>;
  if (voidAction.state.ok) return <p className="notice" role="status">{voidAction.state.message}</p>;

  const submitReplace = (event: React.MouseEvent<HTMLButtonElement>, confirmCoCaptaincy: boolean) => {
    if (!newPlayerId) return;
    const formData = new FormData();
    formData.set('appointmentKey', appointmentKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('newPlayerId', newPlayerId);
    if (effectiveOn) formData.set('effectiveOn', effectiveOn);
    if (replaceNote) formData.set('note', replaceNote);
    if (confirmCoCaptaincy) formData.set('confirmCoCaptaincy', '1');
    replace.submit(formData, event.currentTarget);
  };

  const submitEnd = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('appointmentKey', appointmentKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    if (endDate) formData.set('endedOn', endDate);
    if (endReason) formData.set('reason', endReason);
    formData.set('confirmEnd', '1');
    end.submit(formData, event.currentTarget);
  };

  const submitReinstate = (event: React.MouseEvent<HTMLButtonElement>, confirmCoCaptaincy: boolean) => {
    const formData = new FormData();
    formData.set('appointmentKey', appointmentKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    if (confirmCoCaptaincy) formData.set('confirmCoCaptaincy', '1');
    reinstate.submit(formData, event.currentTarget);
  };

  const submitCorrect = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('appointmentKey', appointmentKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    if (correctStartedOn) formData.set('startedOn', correctStartedOn);
    if (status !== 'active' && correctEndedOn) formData.set('endedOn', correctEndedOn);
    if (correctNote) formData.set('appointmentNote', correctNote);
    correct.submit(formData, event.currentTarget);
  };

  const submitVoid = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('appointmentKey', appointmentKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('reason', voidReason);
    formData.set('confirmVoid', '1');
    voidAction.submit(formData, event.currentTarget);
  };

  const roleLabel = LEADERSHIP_ROLE_LABELS[role];

  if (mode === 'replace') {
    // The caller already excludes this row's own player (§18); every other
    // list member is a candidate incoming leader, current role annotated so
    // an operator sees a co-captaincy or vice-captaincy collision coming.
    const destinations = candidates;
    return (
      <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', maxWidth: '24rem' }}>
        <p role="alert">
          Replacing ends this appointment and starts a new {roleLabel.toLowerCase()} appointment for
          the player chosen below — both rows are kept.
        </p>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Incoming {roleLabel.toLowerCase()}
          <select
            value={newPlayerId}
            onChange={(event) => setNewPlayerId(event.target.value)}
            disabled={anyPending}
            aria-label={`Incoming ${roleLabel.toLowerCase()}`}
          >
            <option value="">— select a listed player —</option>
            {destinations.map((c) => (
              <option key={c.playerId} value={c.playerId}>
                {c.displayName}
                {c.activeLeadershipRole ? ` (current ${LEADERSHIP_ROLE_LABELS[c.activeLeadershipRole].toLowerCase()})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Changeover date (optional)
          <input
            type="date"
            value={effectiveOn}
            onChange={(event) => setEffectiveOn(event.target.value)}
            disabled={anyPending}
            aria-label="Changeover date"
          />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Note (optional)
          <input
            type="text"
            value={replaceNote}
            onChange={(event) => setReplaceNote(event.target.value)}
            disabled={anyPending}
            maxLength={2000}
            aria-label="Replacement note"
          />
        </label>
        {replace.state.error && <p className="notice" role="alert">{replace.state.error}</p>}
        {replace.state.reason === 'co_captaincy_unconfirmed' ? (
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button" className="btn btn-primary"
              onClick={(event) => submitReplace(event, true)} disabled={anyPending || !newPlayerId}
            >
              Confirm co-captaincy and replace anyway
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={anyPending}>
              Back
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '0.6rem' }}>
            <button
              type="button" className="btn btn-primary"
              onClick={(event) => submitReplace(event, false)} disabled={anyPending || !newPlayerId}
            >
              {replace.isPending ? 'Replacing…' : 'Confirm replacement'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={anyPending}>
              Cancel
            </button>
          </div>
        )}
      </div>
    );
  }

  if (mode === 'end') {
    return (
      <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', maxWidth: '22rem' }}>
        <p role="alert">This appointment was valid but ceased. The row is kept as history.</p>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          End date (optional, leave blank if unknown)
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} disabled={anyPending} aria-label="End date" />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Reason (optional)
          <input type="text" value={endReason} onChange={(event) => setEndReason(event.target.value)} disabled={anyPending} maxLength={500} aria-label="Reason the appointment ended" />
        </label>
        {end.state.error && <p className="notice" role="alert">{end.state.error}</p>}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button type="button" className="btn btn-primary" onClick={submitEnd} disabled={anyPending}>
            {end.isPending ? 'Ending…' : 'Confirm end'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={anyPending}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'correct') {
    return (
      <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', maxWidth: '22rem' }}>
        <p className="muted">
          A data-entry correction to dates and note only. Role, player, club and season cannot be
          changed here — end this appointment and record a new one instead.
        </p>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Start date
          <input type="date" value={correctStartedOn} onChange={(event) => setCorrectStartedOn(event.target.value)} disabled={anyPending} aria-label="Correct start date" />
        </label>
        {status !== 'active' && (
          <label style={{ display: 'grid', gap: '0.2rem' }}>
            End date
            <input type="date" value={correctEndedOn} onChange={(event) => setCorrectEndedOn(event.target.value)} disabled={anyPending} aria-label="Correct end date" />
          </label>
        )}
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Note
          <input type="text" value={correctNote} onChange={(event) => setCorrectNote(event.target.value)} disabled={anyPending} maxLength={2000} aria-label="Correct note" />
        </label>
        {correct.state.error && <p className="notice" role="alert">{correct.state.error}</p>}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button type="button" className="btn btn-primary" onClick={submitCorrect} disabled={anyPending}>
            {correct.isPending ? 'Saving…' : 'Save correction'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={anyPending}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'void') {
    return (
      <div style={{ display: 'grid', gap: '0.4rem', fontSize: '0.85rem', maxWidth: '24rem' }}>
        <p role="alert">
          This record was entered in error and should never have counted as valid history. Voiding
          is terminal — it cannot be undone from this page. To correct a genuine appointment, end it
          instead.
        </p>
        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Reason
          <input type="text" value={voidReason} onChange={(event) => setVoidReason(event.target.value)} required minLength={1} maxLength={500} disabled={anyPending} aria-label="Reason for voiding" />
        </label>
        {voidAction.state.error && <p className="notice" role="alert">{voidAction.state.error}</p>}
        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <button type="button" className="btn btn-danger" onClick={submitVoid} disabled={anyPending || !voidReason.trim()}>
            {voidAction.isPending ? 'Voiding…' : 'Confirm void'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('none')} disabled={anyPending}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  // status === 'ended': Reinstate offered directly (a plain action, matching
  // the fixture Reinstate precedent), with the same co-captaincy confirm
  // step as appoint/replace when re-activating collides with a sitting
  // captain (L-3 applies again -- reinstating is a new "holds it now" claim).
  return (
    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
      {status === 'active' && (
        <>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('replace')}>Replace…</button>
          <button type="button" className="btn btn-secondary" onClick={() => setMode('end')}>End…</button>
        </>
      )}
      {status === 'ended' && (
        reinstate.state.reason === 'co_captaincy_unconfirmed' ? (
          <span style={{ display: 'grid', gap: '0.3rem' }}>
            <span role="alert" style={{ fontSize: '0.8rem' }}>{reinstate.state.error}</span>
            <button
              type="button" className="btn btn-primary"
              onClick={(event) => submitReinstate(event, true)} disabled={anyPending}
            >
              Confirm co-captaincy and reinstate anyway
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn-secondary" onClick={(event) => submitReinstate(event, false)} disabled={anyPending}>
            {reinstate.isPending ? 'Reinstating…' : 'Reinstate'}
          </button>
        )
      )}
      <button type="button" className="btn btn-secondary" onClick={() => setMode('correct')}>Correct dates/note…</button>
      <button type="button" className="btn btn-secondary btn-danger" onClick={() => setMode('void')}>Void…</button>
      {/* Reinstate is a direct one-click action with no confirm modal of its
          own, so any refusal other than the co-captaincy step above (which
          renders its own message) has to surface right here. Replace/End/
          Correct/Void each show their own refusal inside their own block. */}
      {reinstate.state.error && reinstate.state.reason !== 'co_captaincy_unconfirmed' && (
        <p className="notice" role="alert">{reinstate.state.error}</p>
      )}
    </div>
  );
}
