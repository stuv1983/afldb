'use client';

import { useRef } from 'react';

import {
  asText, correctionFormData, useCorrectionDraft,
} from '@/app/admin/awards/correction-state';
import { correctFirstKickGoalAction } from '@/app/admin/records/actions';
import { useSpecialRecordsActionSubmit } from '@/app/admin/records/submit-helper';
import type { FirstKickGoalAdminRow } from '@/db/queries/admin-special-records';

/**
 * Correct the amendable metadata of one first-kick-goal record
 * (AFLDB-ISSUE-167 §3.4).
 *
 * ONLY THE FIELDS THE ADMINISTRATOR ACTUALLY EDITED ARE POSTED, because a
 * correction to a source-owned row is stored as a `data_overrides` DELTA and
 * key presence is its semantics: an absent key leaves the source value, an
 * explicit null clears it. Sending every field every time would freeze the
 * whole row against every future source improvement after one typo fix. The
 * dirty-field tracking is `useCorrectionDraft`, shared with the awards panels
 * for the same reason this surface already shares their `RecordHistory`.
 *
 * WHAT IS DELIBERATELY ABSENT. The player, club and match links, the link
 * status and the candidate count are not fields here and are refused by the
 * server if a crafted payload names them: they are derived by the import and
 * by /admin/player-links (§3.4.1, D-2). Identity and provenance —
 * `source_record_id` above all — are not correctable either; a wrong identity
 * is a suppression plus a manual replacement, never a rekey.
 *
 * THE MATCH LINK DOES NOT FOLLOW A SEASON OR ROUND CORRECTION, and the note
 * below says so. The importer resolves the match from the SOURCE's season and
 * round (`import-first-kick-goal.ts:797-808`), and the Stage 4 replay carries a
 * correction as a delta over the amendable columns alone — so re-deriving the
 * link here would produce a row a rebuild could not reproduce.
 */
export function FirstKickCorrectionPanel({ row }: { row: FirstKickGoalAdminRow }) {
  const submitRef = useRef<HTMLButtonElement>(null);
  const correct = useSpecialRecordsActionSubmit(correctFirstKickGoalAction);
  const draft = useCorrectionDraft({
    playerNameRaw: asText(row.playerNameRaw),
    playerNameClean: asText(row.playerNameClean),
    clubNameRaw: asText(row.clubNameRaw),
    season: asText(row.season),
    roundRaw: asText(row.roundRaw),
    seasonFootnoteRaw: asText(row.seasonFootnoteRaw),
    consecutiveGoalKicks: asText(row.consecutiveGoalKicks),
    kicklessMatchesBeforeFirstKick: asText(row.kicklessMatchesBeforeFirstKick),
    noFurtherCareerGoals: row.noFurtherCareerGoals,
    noFurtherCareerKicks: row.noFurtherCareerKicks,
    sourceAnnotation: asText(row.sourceAnnotation),
    notes: asText(row.notes),
  });

  const label = { display: 'grid', gap: '0.25rem', fontSize: '0.85rem' } as const;
  const grid = {
    display: 'grid', gap: '0.75rem',
    gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))',
  } as const;

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
            Club as the source records it
            <input
              type="text" maxLength={200} value={draft.values.clubNameRaw}
              onChange={(e) => draft.set('clubNameRaw', e.target.value)}
            />
          </label>
        </div>

        <div style={grid}>
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
          <label style={label}>
            Season footnote as the source records it
            <input
              type="text" maxLength={200} value={draft.values.seasonFootnoteRaw}
              onChange={(e) => draft.set('seasonFootnoteRaw', e.target.value)}
            />
          </label>
        </div>

        <div style={grid}>
          <label style={label}>
            Consecutive goal kicks
            <input
              type="number" min={1} step={1} value={draft.values.consecutiveGoalKicks}
              onChange={(e) => draft.set('consecutiveGoalKicks', e.target.value)}
            />
          </label>
          <label style={label}>
            Kickless matches before the first kick
            <input
              type="number" min={0} step={1} value={draft.values.kicklessMatchesBeforeFirstKick}
              onChange={(e) => draft.set('kicklessMatchesBeforeFirstKick', e.target.value)}
            />
          </label>
          <label style={{ ...label, alignContent: 'end' }}>
            <span>
              <input
                type="checkbox" checked={draft.values.noFurtherCareerGoals}
                onChange={(e) => draft.set('noFurtherCareerGoals', e.target.checked)}
              />{' '}
              No further career goals
            </span>
          </label>
          <label style={{ ...label, alignContent: 'end' }}>
            <span>
              <input
                type="checkbox" checked={draft.values.noFurtherCareerKicks}
                onChange={(e) => draft.set('noFurtherCareerKicks', e.target.checked)}
              />{' '}
              No further career kicks
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
          The player, club and match links are not corrected here: they are resolved by the import
          and by the player-link queue. Changing the season or the round does <strong>not</strong>{' '}
          move the match link — the import resolves the match from the source&apos;s own season and
          round, and a link changed here would not survive a rebuild.
        </p>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            ref={submitRef} type="button" className="btn btn-primary"
            disabled={correct.isPending || draft.changed.length === 0}
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
