'use client';

import { useState } from 'react';

import { appointLeaderAction } from '@/app/admin/season-lists/leadership-actions';
import { LEADERSHIP_ROLE_LABELS } from '@/app/admin/season-lists/leadership-labels';
import { useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';
import type { LeadershipRole } from '@/db/queries/admin-club-leadership';

type Candidate = { playerId: number; displayName: string; activeLeadershipRole: LeadershipRole | null };

/**
 * Appoint a new leader (AFLDB-ISSUE-163 §12, §18, D-11). Super Admin only.
 *
 * The player selector is the club's OWN season-list membership, never the
 * global player picker and never free text (§9, L-8, L-11) — `candidates`
 * is exactly the rows the page already loaded for this club-season.
 *
 * A second active captain is never submitted silently: the first submit
 * carries no `confirmCoCaptaincy`, and only a `co_captaincy_unconfirmed`
 * refusal — naming the sitting captain(s) — unlocks an explicit "Appoint as
 * co-captain" confirmation. That confirmation belongs to the EXACT submission
 * it refused: changing the role or the player withdraws it, so a confirmation
 * given about one appointment can never be carried over to a different one the
 * operator has not been warned about. Vice-captains need no confirmation at
 * all (L-4).
 *
 * A recorded appointment leaves the form standing (the `AddPlayerPanel`
 * precedent) rather than replacing it with a receipt: a club-season normally
 * needs a captain AND one or more vice-captains, and making the second
 * appointment cost a page reload would be the panel working against its own
 * task.
 */
export function AppointLeaderPanel({
  season, clubSlug, candidates,
}: {
  season: number;
  clubSlug: string;
  candidates: Candidate[];
}) {
  const appoint = useSeasonListActionSubmit(appointLeaderAction, {});
  const [role, setRole] = useState<LeadershipRole>('captain');
  const [playerId, setPlayerId] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [note, setNote] = useState('');
  /** What the last submit actually asked for, so a refusal cannot outlive it. */
  const [submitted, setSubmitted] = useState<{ role: LeadershipRole; playerId: string } | null>(null);

  const submit = (event: React.MouseEvent<HTMLButtonElement>, confirmCoCaptaincy: boolean) => {
    if (!playerId) return;
    setSubmitted({ role, playerId });
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('clubSlug', clubSlug);
    formData.set('playerId', playerId);
    formData.set('role', role);
    if (startedOn) formData.set('startedOn', startedOn);
    if (note) formData.set('note', note);
    if (confirmCoCaptaincy) formData.set('confirmCoCaptaincy', '1');
    appoint.submit(formData, event.currentTarget);
  };

  // L-3. The confirm step is offered only while the current selection is still
  // the one the backend refused — change the role or the player and it is gone,
  // because the refusal named sitting captains in relation to THAT appointment.
  const isCoCaptaincyRefusal = appoint.state.reason === 'co_captaincy_unconfirmed'
    && submitted !== null && submitted.role === role && submitted.playerId === playerId;

  return (
    <section className="section">
      <h2>Appoint</h2>
      <div style={{ display: 'grid', gap: '0.5rem', maxWidth: '26rem' }}>
        <fieldset style={{ border: 0, padding: 0, display: 'flex', gap: '1rem' }}>
          <legend style={{ padding: 0, fontSize: '0.85rem', marginBottom: '0.2rem' }}>Role</legend>
          {(['captain', 'vice_captain'] as const).map((value) => (
            <label key={value} style={{ display: 'flex', gap: '0.3rem', alignItems: 'center', fontSize: '0.85rem' }}>
              <input
                type="radio" name="leadership-role" value={value}
                checked={role === value}
                onChange={() => setRole(value)}
                disabled={appoint.isPending}
              />
              {LEADERSHIP_ROLE_LABELS[value]}
            </label>
          ))}
        </fieldset>

        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Player
          <select
            value={playerId}
            onChange={(event) => setPlayerId(event.target.value)}
            disabled={appoint.isPending}
            aria-label="Player to appoint"
          >
            <option value="">— select a listed player —</option>
            {candidates.map((c) => (
              <option key={c.playerId} value={c.playerId}>
                {c.displayName}
                {c.activeLeadershipRole ? ` (current ${LEADERSHIP_ROLE_LABELS[c.activeLeadershipRole].toLowerCase()})` : ''}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Start date (optional, leave blank if not announced)
          <input
            type="date" value={startedOn} onChange={(event) => setStartedOn(event.target.value)}
            disabled={appoint.isPending} aria-label="Appointment start date"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.2rem' }}>
          Note (optional)
          <input
            type="text" value={note} onChange={(event) => setNote(event.target.value)}
            disabled={appoint.isPending} maxLength={2000} aria-label="Appointment note"
          />
        </label>

        {appoint.state.error && <p className="notice" role="alert">{appoint.state.error}</p>}
        {appoint.state.ok && appoint.state.message && (
          <p className="notice" role="status">{appoint.state.message}</p>
        )}

        {isCoCaptaincyRefusal ? (
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              type="button" className="btn btn-primary"
              onClick={(event) => submit(event, true)} disabled={appoint.isPending || !playerId}
            >
              Appoint as co-captain alongside them
            </button>
          </div>
        ) : (
          <div>
            <button
              type="button" className="btn btn-primary"
              onClick={(event) => submit(event, false)} disabled={appoint.isPending || !playerId}
            >
              {appoint.isPending ? 'Appointing…' : 'Appoint'}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
