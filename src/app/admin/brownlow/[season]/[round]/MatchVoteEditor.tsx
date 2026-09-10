'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';

import {
  correctAction,
  finaliseAction,
  saveDraftAction,
  voidAction,
  type BrownlowActionState,
} from '@/app/admin/brownlow/actions';
import {
  MATCH_STATE_LABEL,
  MATCH_STATE_TONE,
  badgeClass,
  matchDisplayState,
} from '@/app/admin/brownlow/labels';
import type { BrownlowMatchEditorModel } from '@/db/queries/admin-brownlow';
import { REASON_MIN_LENGTH } from '@/lib/brownlow/entry';
import { formatDate } from '@/lib/format';

/**
 * AFLDB-ISSUE-155 Phase C2 — the vote editor for one home-and-away match.
 *
 * A thin surface over C1's read model and its four transactions. Everything
 * decided here — which players are selectable, whether the 3/2/1 is
 * complete, whether a reason has been typed — is decided again on the server
 * against rows read under the match lock (§27.6, §27.14). A disabled button
 * is an explanation, not a boundary.
 *
 * The result of a submit is reported UPWARDS (`onResult`) and rendered from
 * a prop, never held here: a successful write revalidates the round page,
 * which re-renders this component with a fresh model, and a result kept in
 * local state would be discarded by the same commit that produced it — the
 * Phase B lesson (§26.20 deviation 2). On a refusal the revision is
 * unchanged, so the local selection and reason are kept and the operator
 * does not retype them (§26.20 deviation 4).
 */

type VoteSlot = 'three' | 'two' | 'one';
const SLOTS: ReadonlyArray<{ slot: VoteSlot; votes: 3 | 2 | 1; label: string }> = [
  { slot: 'three', votes: 3, label: '3 votes' },
  { slot: 'two', votes: 2, label: '2 votes' },
  { slot: 'one', votes: 1, label: '1 vote' },
];

type Selection = { three: number | null; two: number | null; one: number | null };

type Runner = { submit: (formData: FormData) => void; pending: boolean };

export function MatchVoteEditor({
  model,
  season,
  round,
  canFinalise,
  result,
  onResult,
  onAdvance,
}: {
  model: BrownlowMatchEditorModel;
  season: number;
  round: number;
  /** The viewer holds `data.brownlow.finalise` (Super Admin). */
  canFinalise: boolean;
  result: BrownlowActionState | null;
  onResult: (state: BrownlowActionState) => void;
  onAdvance: () => void;
}) {
  const [selection, setSelection] = useState<Selection>(model.selection);
  const [reason, setReason] = useState('');

  // Reset to server truth whenever the match actually moved (a successful
  // write bumps the revision). A refusal leaves the revision alone, so the
  // operator's in-progress selection survives it.
  useEffect(() => {
    setSelection(model.selection);
    setReason('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.revision, model.canonicalFingerprint]);

  const report = (
    action: (previous: BrownlowActionState, formData: FormData) => Promise<BrownlowActionState>,
  ) => async (previous: BrownlowActionState, formData: FormData): Promise<BrownlowActionState> => {
    const next = await action(previous, formData);
    onResult(next);
    if (next.ok) onAdvance();
    return next;
  };

  const draft = useActionState<BrownlowActionState, FormData>(report(saveDraftAction), {});
  const finalise = useActionState<BrownlowActionState, FormData>(report(finaliseAction), {});
  const correct = useActionState<BrownlowActionState, FormData>(report(correctAction), {});
  const voidMatch = useActionState<BrownlowActionState, FormData>(report(voidAction), {});
  const runners: Record<'draft' | 'finalise' | 'correct' | 'void', Runner> = {
    draft: { submit: draft[1], pending: draft[2] },
    finalise: { submit: finalise[1], pending: finalise[2] },
    correct: { submit: correct[1], pending: correct[2] },
    void: { submit: voidMatch[1], pending: voidMatch[2] },
  };
  const anyPending = Object.values(runners).some((r) => r.pending);

  const displayState = matchDisplayState(model.status, model.assignment);
  const participants = model.participants;
  const clubGroups = useMemo(() => {
    const groups: Array<{ clubId: number; clubName: string; rows: typeof participants }> = [
      { clubId: model.homeClubId, clubName: model.homeClubName, rows: [] },
      { clubId: model.awayClubId, clubName: model.awayClubName, rows: [] },
    ];
    const other: typeof participants = [];
    for (const p of participants) {
      const g = groups.find((group) => group.clubId === p.clubId);
      if (g) g.rows.push(p);
      else other.push(p);
    }
    if (other.length > 0) groups.push({ clubId: -1, clubName: 'Neither club', rows: other });
    return groups.filter((g) => g.rows.length > 0);
  }, [participants, model.homeClubId, model.homeClubName, model.awayClubId, model.awayClubName]);

  const nameById = useMemo(
    () => new Map(participants.map((p) => [p.playerId, p])),
    [participants],
  );

  const chosen = [selection.three, selection.two, selection.one];
  const selectionComplete = chosen.every((id) => id !== null)
    && new Set(chosen).size === 3;
  const participantsComplete = model.participantAssessment.complete;
  const reasonOk = reason.trim().length >= REASON_MIN_LENGTH;

  function setSlot(slot: VoteSlot, value: string) {
    const id = value === '' ? null : Number(value);
    setSelection((prev) => ({ ...prev, [slot]: id }));
  }

  function adoptImported() {
    const next: Selection = { three: null, two: null, one: null };
    for (const row of model.canonicalRows) {
      if (row.unresolved || row.votes === null || row.votes <= 0) continue;
      if (row.votes === 3) next.three = row.playerId;
      else if (row.votes === 2) next.two = row.playerId;
      else if (row.votes === 1) next.one = row.playerId;
    }
    setSelection(next);
  }

  const holders = model.canonicalRows
    .filter((row) => !row.unresolved && row.votes !== null && row.votes > 0)
    .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0));
  const importedResolvable = model.status === null && model.assignment !== 'none';

  const matchSheetHref = `/admin/data-editor?mode=match-sheet&id=${model.matchId}`;

  return (
    <section
      id={`match-${model.matchId}`}
      className="section"
      style={{ scrollMarginTop: '1rem' }}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          {model.homeClubName} v {model.awayClubName}
        </h3>
        <span className={badgeClass(MATCH_STATE_TONE[displayState])}>
          {MATCH_STATE_LABEL[displayState]}
        </span>
      </div>
      <p className="muted" style={{ margin: '0.25rem 0 0', fontSize: '0.85rem' }}>
        {formatDate(model.matchDate)} · {model.venue} · Match #{model.matchId} · revision {model.revision}
      </p>

      {/* Current canonical facts */}
      <div style={{ margin: '0.75rem 0' }}>
        {model.status === 'void' ? (
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
            Voided: the participation record is kept, the vote values are withdrawn.
          </p>
        ) : holders.length > 0 ? (
          <p style={{ margin: 0, fontSize: '0.9rem' }}>
            Recorded now:{' '}
            {holders.map((row, i) => (
              <span key={row.playerId}>
                {i > 0 ? ', ' : ''}
                <strong>{row.votes}</strong>{' '}
                {nameById.get(row.playerId)?.playerName ?? `player ${row.playerId}`}
              </span>
            ))}
          </p>
        ) : (
          <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>No votes recorded for this match yet.</p>
        )}
      </div>

      {!participantsComplete && (
        <p className="notice" role="status" style={{ margin: '0 0 0.75rem' }}>
          This match cannot be finalised or voided: {model.participantAssessment.shortfall
            ?? 'the line-up is incomplete.'}{' '}
          {canFinalise && (
            <a href={matchSheetHref}>Repair the line-up on the match sheet →</a>
          )}
        </p>
      )}

      {importedResolvable && (
        <p style={{ margin: '0 0 0.75rem', fontSize: '0.85rem' }}>
          The source published these votes.{' '}
          <button type="button" className="btn btn-secondary" onClick={adoptImported} disabled={anyPending}>
            Adopt into the selection
          </button>
        </p>
      )}

      <form style={{ display: 'grid', gap: '0.75rem' }}>
        <input type="hidden" name="matchId" value={model.matchId} />
        <input type="hidden" name="season" value={season} />
        <input type="hidden" name="round" value={round} />
        <input type="hidden" name="expectedRevision" value={model.revision} />
        <input type="hidden" name="expectedCanonicalFingerprint" value={model.canonicalFingerprint} />

        <div style={{ display: 'grid', gap: '0.6rem', maxWidth: '30rem' }}>
          {SLOTS.map(({ slot, label }) => {
            const takenElsewhere = new Set(
              SLOTS.filter((s) => s.slot !== slot)
                .map((s) => selection[s.slot])
                .filter((id): id is number => id !== null),
            );
            return (
              <label key={slot} style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
                {label}
                <select
                  name={slot}
                  value={selection[slot] ?? ''}
                  onChange={(event) => setSlot(slot, event.target.value)}
                  disabled={anyPending}
                >
                  <option value="">— not selected —</option>
                  {clubGroups.map((group) => (
                    <optgroup key={group.clubId} label={group.clubName}>
                      {group.rows.map((p) => (
                        <option
                          key={p.playerId}
                          value={p.playerId}
                          disabled={takenElsewhere.has(p.playerId)}
                        >
                          {p.jumperNumber ? `#${p.jumperNumber} ` : ''}{p.playerName}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            );
          })}
        </div>

        {canFinalise && (
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', maxWidth: '30rem' }}>
            Reason <span className="muted">(required to correct, void, or finalise a voided match)</span>
            <input
              type="text"
              name="reason"
              value={reason}
              minLength={REASON_MIN_LENGTH}
              maxLength={500}
              placeholder="e.g. AFL post-count correction, round 12"
              onChange={(event) => setReason(event.target.value)}
              disabled={anyPending}
            />
          </label>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.6rem', alignItems: 'center' }}>
          {model.status !== 'final' && model.status !== 'void' && (
            <button
              type="submit"
              className="btn btn-secondary"
              formAction={runners.draft.submit}
              disabled={anyPending}
            >
              {runners.draft.pending ? 'Saving…' : 'Save draft'}
            </button>
          )}

          {model.status !== 'final' && (
            <button
              type="submit"
              className="btn btn-primary"
              formAction={runners.finalise.submit}
              disabled={
                anyPending
                || !canFinalise
                || !selectionComplete
                || !participantsComplete
                || (model.status === 'void' && !reasonOk)
              }
              title={canFinalise ? undefined : 'Super Admin only'}
            >
              {runners.finalise.pending ? 'Finalising…' : 'Finalise'}
            </button>
          )}

          {model.status === 'final' && (
            <button
              type="submit"
              className="btn btn-primary"
              formAction={runners.correct.submit}
              disabled={anyPending || !canFinalise || !selectionComplete || !participantsComplete || !reasonOk}
              title={canFinalise ? undefined : 'Super Admin only'}
            >
              {runners.correct.pending ? 'Saving correction…' : 'Correct finalised votes'}
            </button>
          )}

          {model.status !== 'void' && (
            <button
              type="submit"
              className="btn btn-secondary btn-danger"
              formAction={runners.void.submit}
              disabled={anyPending || !canFinalise || !participantsComplete || !reasonOk}
              title={canFinalise ? undefined : 'Super Admin only'}
            >
              {runners.void.pending ? 'Voiding…' : 'Void (no votes awarded)'}
            </button>
          )}
        </div>

        {!canFinalise && (
          <p className="muted" style={{ fontSize: '0.8125rem', margin: 0 }}>
            Finalise, correct and void are Super Admin only. An Admin may save a draft.
          </p>
        )}
        {canFinalise && model.status === 'final' && (
          <p className="muted" style={{ fontSize: '0.8125rem', margin: 0 }}>
            Correcting a finalised match changes canonical Brownlow facts, and re-derives the
            season total in the same change if it is already published.
          </p>
        )}
      </form>

      {result && (result.error || result.message) && (
        <p
          className="notice"
          role={result.error ? 'alert' : 'status'}
          style={{ margin: '0.75rem 0 0' }}
        >
          {result.error ?? result.message}
          {result.code === 'stale' && (
            <>
              {' '}
              <a href={`/admin/brownlow/${season}/${round}`}>Reload this round →</a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
