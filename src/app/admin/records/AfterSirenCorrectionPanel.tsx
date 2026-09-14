'use client';

import { useRef } from 'react';

import {
  asText, correctionFormData, useCorrectionDraft,
} from '@/app/admin/awards/correction-state';
import { correctAfterSirenKickAction } from '@/app/admin/records/actions';
import { useSpecialRecordsActionSubmit } from '@/app/admin/records/submit-helper';
import type { AfterSirenAdminRow } from '@/db/queries/admin-special-records';
import {
  AFTER_SIREN_EFFECTS, AFTER_SIREN_RESULTS, AFTER_SIREN_SCORES, AFTER_SIREN_SIRENS,
  validateAfterSirenEvent,
} from '@/lib/special-records/after-siren-rules';

const SCORE_LABELS: Record<string, string> = {
  goal: 'a goal', behind: 'a behind', none: 'nothing',
};
const EFFECT_LABELS: Record<string, string> = {
  won: 'won the match', drew: 'drew the match', none: 'changed nothing',
};
const RESULT_LABELS: Record<string, string> = {
  win: 'a win', loss: 'a loss', draw: 'a draw',
};
const SIREN_LABELS: Record<string, string> = {
  final: 'the final siren',
  end_of_extra_time: 'the end-of-extra-time siren',
  end_of_regulation: 'the end-of-regulation siren',
};

/**
 * Correct the amendable metadata of one after-the-siren record
 * (AFLDB-ISSUE-167 §3.4, §10.3).
 *
 * THE FIVE COUPLED EVENT FIELDS ARE CHECKED AS A COMBINATION, here as well as
 * in the action: `kick_scored`, `kick_effect`, `kicker_result`, `siren` and the
 * margin between the two point totals are bound together by migration 089's
 * `_effect_ck` and `_regulation_ck`. The panel's preview is a courtesy — the
 * action re-checks the same rules from the same pure module before it issues
 * any SQL, and the CHECK constraints hold inside the same transaction after
 * that. Three layers, one rule set, no reimplementation.
 *
 * `cited` sits with the score, not with the lifecycle, and never shares a
 * control with it (migration 089, gate G-3): `cited = false` is an evidence gap
 * about a kick that really happened, while suppression says the row should
 * never have existed.
 */
export function AfterSirenCorrectionPanel({ row }: { row: AfterSirenAdminRow }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const correct = useSpecialRecordsActionSubmit(correctAfterSirenKickAction);
  const draft = useCorrectionDraft({
    playerNameRaw: asText(row.playerNameRaw),
    playerNameClean: asText(row.playerNameClean),
    clubNameRaw: asText(row.clubNameRaw),
    opponentNameRaw: asText(row.opponentNameRaw),
    competition: asText(row.competition),
    season: asText(row.season),
    roundRaw: asText(row.roundRaw),
    premiershipSeason: row.premiershipSeason,
    kickScored: row.kickScored as string,
    kickEffect: row.kickEffect as string,
    kickerResult: row.kickerResult as string,
    siren: row.siren as string,
    kickerScoreRaw: asText(row.kickerScoreRaw),
    opponentScoreRaw: asText(row.opponentScoreRaw),
    kickerPoints: asText(row.kickerPoints),
    opponentPoints: asText(row.opponentPoints),
    supergoalScoring: row.supergoalScoring,
    cited: row.cited,
    shotDetail: asText(row.shotDetail),
    sourceAnnotation: asText(row.sourceAnnotation),
    notes: asText(row.notes),
  });

  const label = { display: 'grid', gap: '0.25rem', fontSize: '0.85rem' } as const;
  const grid = {
    display: 'grid', gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
  } as const;

  // The row as it WILL stand, checked whole — never field by field.
  const coupledProblem = validateAfterSirenEvent({
    kickScored: draft.values.kickScored as never,
    kickEffect: draft.values.kickEffect as never,
    kickerResult: draft.values.kickerResult as never,
    siren: draft.values.siren as never,
    kickerPoints: Number(draft.values.kickerPoints),
    opponentPoints: Number(draft.values.opponentPoints),
    premiershipSeason: draft.values.premiershipSeason as boolean,
    hasMatch: row.matchId !== null,
  });

  const onSubmit = () => {
    correct.submit(correctionFormData({
      rowId: row.id,
      expectedUpdatedAt: row.updatedAt,
      values: draft.values,
      changed: draft.changed,
    }), submitRef.current);
  };

  if (row.status === 'void') {
    return (
      <section className="section">
        <h2>Correct this record</h2>
        <p className="muted">
          This record is suppressed. Suppressed records are kept for the record and are not
          maintained — reinstate it below first if it should stand.
        </p>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Correct this record</h2>

      {correct.state.error && <p className="notice" role="alert">{correct.state.error}</p>}
      {correct.state.ok && <p className="notice" role="status">{correct.state.message}</p>}
      {correct.state.warning && <p className="notice" role="alert">{correct.state.warning}</p>}

      <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
        <div style={grid}>
          <label style={label}>
            Player as the source records it
            <input
              type="text" maxLength={200} value={draft.values.playerNameRaw}
              onChange={(e) => draft.set('playerNameRaw', e.target.value)}
            />
          </label>
          <label style={label}>
            Cleaned player name
            <input
              type="text" maxLength={200} value={draft.values.playerNameClean}
              onChange={(e) => draft.set('playerNameClean', e.target.value)}
            />
          </label>
          <label style={label}>
            Kicker&apos;s club as the source records it
            <input
              type="text" maxLength={200} value={draft.values.clubNameRaw}
              onChange={(e) => draft.set('clubNameRaw', e.target.value)}
            />
          </label>
          <label style={label}>
            Opponent as the source records it
            <input
              type="text" maxLength={200} value={draft.values.opponentNameRaw}
              onChange={(e) => draft.set('opponentNameRaw', e.target.value)}
            />
          </label>
        </div>

        <div style={grid}>
          <label style={label}>
            Competition
            <input
              type="text" maxLength={200} value={draft.values.competition}
              onChange={(e) => draft.set('competition', e.target.value)}
            />
          </label>
          <label style={label}>
            Season
            <input
              type="number" min={1897} max={2100} step={1} value={draft.values.season}
              onChange={(e) => draft.set('season', e.target.value)}
            />
          </label>
          <label style={label}>
            Round
            <input
              type="text" maxLength={50} value={draft.values.roundRaw}
              onChange={(e) => draft.set('roundRaw', e.target.value)}
            />
          </label>
          <label style={{ ...label, alignContent: 'end' }}>
            <span>
              <input
                type="checkbox" checked={draft.values.premiershipSeason as boolean}
                onChange={(e) => draft.set('premiershipSeason', e.target.checked)}
              />{' '}
              Premiership-season match
            </span>
          </label>
        </div>

        <fieldset style={{ display: 'grid', gap: '0.75rem', border: '1px solid var(--border, #ccc)', padding: '0.75rem' }}>
          <legend style={{ fontSize: '0.85rem' }}>
            The event — these five agree or the correction is refused
          </legend>
          <div style={grid}>
            <label style={label}>
              The kick registered
              <select
                value={draft.values.kickScored as string}
                onChange={(e) => draft.set('kickScored', e.target.value)}
              >
                {AFTER_SIREN_SCORES.map((v) => <option key={v} value={v}>{SCORE_LABELS[v]}</option>)}
              </select>
            </label>
            <label style={label}>
              and it
              <select
                value={draft.values.kickEffect as string}
                onChange={(e) => draft.set('kickEffect', e.target.value)}
              >
                {AFTER_SIREN_EFFECTS.map((v) => <option key={v} value={v}>{EFFECT_LABELS[v]}</option>)}
              </select>
            </label>
            <label style={label}>
              Match result from the kicker&apos;s side
              <select
                value={draft.values.kickerResult as string}
                onChange={(e) => draft.set('kickerResult', e.target.value)}
              >
                {AFTER_SIREN_RESULTS.map((v) => <option key={v} value={v}>{RESULT_LABELS[v]}</option>)}
              </select>
            </label>
            <label style={label}>
              It followed
              <select
                value={draft.values.siren as string}
                onChange={(e) => draft.set('siren', e.target.value)}
              >
                {AFTER_SIREN_SIRENS.map((v) => <option key={v} value={v}>{SIREN_LABELS[v]}</option>)}
              </select>
            </label>
          </div>
          <div style={grid}>
            <label style={label}>
              Kicker&apos;s final score, as written
              <input
                type="text" maxLength={50} value={draft.values.kickerScoreRaw}
                onChange={(e) => draft.set('kickerScoreRaw', e.target.value)}
              />
            </label>
            <label style={label}>
              Kicker&apos;s final points
              <input
                type="number" min={0} max={1000} step={1} value={draft.values.kickerPoints}
                onChange={(e) => draft.set('kickerPoints', e.target.value)}
              />
            </label>
            <label style={label}>
              Opponent&apos;s final score, as written
              <input
                type="text" maxLength={50} value={draft.values.opponentScoreRaw}
                onChange={(e) => draft.set('opponentScoreRaw', e.target.value)}
              />
            </label>
            <label style={label}>
              Opponent&apos;s final points
              <input
                type="number" min={0} max={1000} step={1} value={draft.values.opponentPoints}
                onChange={(e) => draft.set('opponentPoints', e.target.value)}
              />
            </label>
          </div>
          <label style={label}>
            Shot detail, for a miss
            <input
              type="text" maxLength={200} value={draft.values.shotDetail}
              onChange={(e) => draft.set('shotDetail', e.target.value)}
            />
          </label>
          {coupledProblem && (
            <p className="notice" role="alert" style={{ margin: 0 }}>{coupledProblem}</p>
          )}
        </fieldset>

        <div style={grid}>
          <label style={{ ...label, alignContent: 'end' }}>
            <span>
              <input
                type="checkbox" checked={draft.values.supergoalScoring as boolean}
                onChange={(e) => draft.set('supergoalScoring', e.target.checked)}
              />{' '}
              Supergoal scoring applied
            </span>
          </label>
          <label style={{ ...label, alignContent: 'end' }}>
            <span>
              <input
                type="checkbox" checked={draft.values.cited as boolean}
                onChange={(e) => draft.set('cited', e.target.checked)}
              />{' '}
              The source carried a reference
            </span>
          </label>
        </div>

        <label style={label}>
          Source annotation
          <input
            type="text" maxLength={500} value={draft.values.sourceAnnotation}
            onChange={(e) => draft.set('sourceAnnotation', e.target.value)}
          />
        </label>
        <label style={label}>
          Notes
          <input
            type="text" maxLength={2000} value={draft.values.notes}
            onChange={(e) => draft.set('notes', e.target.value)}
          />
        </label>

        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          The player, club, opponent and match links are not corrected here: the import resolves
          them, and after-siren player linkage is deliberately out of scope (D-2). A record with no
          player shows as unlinked rather than being silently guessed at.
        </p>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            ref={submitRef} type="button" className="btn btn-primary"
            disabled={correct.isPending || draft.changed.length === 0 || coupledProblem !== null}
            onClick={onSubmit}
          >
            {correct.isPending ? 'Saving…' : `Save ${draft.changed.length || 'no'} correction${draft.changed.length === 1 ? '' : 's'}`}
          </button>
          <button
            type="button" className="btn btn-secondary"
            disabled={correct.isPending || draft.changed.length === 0} onClick={draft.reset}
          >
            Discard changes
          </button>
        </div>
      </div>
    </section>
  );
}
