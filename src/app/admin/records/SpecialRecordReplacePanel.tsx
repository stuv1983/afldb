'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { replaceAfterSirenKickAction, replaceFirstKickGoalAction } from '@/app/admin/records/actions';
import { AfterSirenFields } from '@/app/admin/records/AfterSirenFields';
import { FirstKickFields } from '@/app/admin/records/FirstKickFields';
import { FAMILY_NOUNS, familyDetailPath, type RecordFamilySlug } from '@/app/admin/records/labels';
import { useSpecialRecordsActionSubmit } from '@/app/admin/records/submit-helper';

const REPLACE_ACTIONS = {
  'first-kick-goal': replaceFirstKickGoalAction,
  'after-the-siren': replaceAfterSirenKickAction,
} as const;

/**
 * Replace one special record with the right one, as a single atomic change
 * (AFLDB-ISSUE-167 §10.2).
 *
 * This is the ONLY way to repair an identity-bearing fact — including a wrong
 * `source_record_id`, which is never rekeyed in place (that is P10's). It is
 * not an UPDATE of the identity on one row: that would erase the fact that the
 * wrong assertion was ever made and leave the audit trail describing something
 * the database no longer says. The mutation suppresses the old record and
 * records the new one inside ONE transaction, cross-referenced by NATURAL key,
 * so the fact is never momentarily recorded nowhere and neither half can
 * survive without the other.
 *
 * THE REPLACEMENT IS ALWAYS A MANUAL RECORD. It carries the
 * `manual_admin_edit` source and a freshly minted `<family>:<uuid>` identity,
 * so it falls outside every source-owned importer retirement scope and the
 * Stage 4 replay re-creates it after a destructive rebuild from its own durable
 * payload.
 *
 * TWO STEPS, ALWAYS. Step one collects the replacement and the reason; step two
 * shows what will happen in plain words before anything is submitted. A
 * one-click replace would put the most consequential mutation on this surface
 * behind the least friction.
 */
export function SpecialRecordReplacePanel({
  family, rowId, expectedUpdatedAt, currentSummary,
}: {
  family: RecordFamilySlug;
  rowId: number;
  expectedUpdatedAt: string;
  /** How the record being suppressed reads, so the preview names both halves. */
  currentSummary: string;
}) {
  const router = useRouter();
  const noun = FAMILY_NOUNS[family];
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ data: FormData; summary: string[] } | null>(null);
  const replace = useSpecialRecordsActionSubmit(REPLACE_ACTIONS[family]);

  useEffect(() => {
    if (replace.state.ok && replace.state.createdId && !replace.state.warning) {
      router.push(familyDetailPath(family, replace.state.createdId));
    }
  }, [replace.state.ok, replace.state.createdId, replace.state.warning, family, router]);

  /** The replacement in the administrator's own words, read back from the form. */
  const describe = (data: FormData): string[] => {
    const text = (key: string) => (data.get(`replacement_${key}`) ?? '').toString().trim();
    const lines = [
      `Player: ${text('playerId') ? `player record #${text('playerId')}` : text('playerNameRaw') || '(none)'}`,
      `Club: ${text('clubNameRaw') || '(none)'}`,
      `Season: ${text('season') || '(none)'}`,
      `Round: ${text('roundRaw') || '(none)'}`,
    ];
    if (text('matchId')) lines.push(`Match: record #${text('matchId')}`);
    if (family === 'after-the-siren') {
      lines.push(`Opponent: ${text('opponentNameRaw') || '(none)'}`);
      lines.push(`Event: ${text('kickScored')} that ${text('kickEffect')}, `
        + `${text('kickerPoints')}-${text('opponentPoints')} after ${text('siren')}`);
    }
    return lines;
  };

  const onPreview = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set('rowId', String(rowId));
    data.set('expectedUpdatedAt', expectedUpdatedAt);
    setPending({ data, summary: describe(data) });
  };

  if (replace.state.ok) {
    return (
      <section className="section">
        <p className="notice" role="status">
          {replace.state.message}
          {replace.state.warning ? '' : ' Opening the new record…'}
        </p>
        {replace.state.warning && <p className="notice" role="alert">{replace.state.warning}</p>}
      </section>
    );
  }

  if (!open) {
    return (
      <section className="section">
        <h2>Replace this record</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Use this when the record identifies the wrong thing — the wrong person, the wrong match,
          or a source record id that belongs to something else. The current {noun} is suppressed
          and the correct one recorded in one change, so the mistake and the correction both
          survive as history.
        </p>
        <button type="button" className="btn btn-secondary" onClick={() => setOpen(true)}>
          Replace this record…
        </button>
      </section>
    );
  }

  return (
    <section className="section">
      <h2>Replace this record</h2>

      {replace.state.error && <p className="notice" role="alert">{replace.state.error}</p>}

      {pending ? (
        <div style={{ display: 'grid', gap: '0.75rem', maxWidth: '40rem' }}>
          <p role="alert" className="notice">
            Confirm this replacement. It is one change and it does both halves.
          </p>
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.3rem' }}>Suppress</h3>
            <p style={{ margin: 0 }}>{currentSummary}</p>
            <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.85rem' }}>
              Reason: {(pending.data.get('reason') ?? '').toString()}
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.3rem' }}>Then record</h3>
            <ul style={{ margin: 0, paddingLeft: '1.1rem' }}>
              {pending.summary.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button
              ref={confirmRef} type="button" className="btn btn-primary"
              disabled={replace.isPending}
              onClick={() => { if (pending) replace.submit(pending.data, confirmRef.current); }}
            >
              {replace.isPending ? 'Replacing…' : 'Confirm replacement'}
            </button>
            <button
              type="button" className="btn btn-secondary"
              disabled={replace.isPending} onClick={() => setPending(null)}
            >
              Back to the details
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={onPreview} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Why is the current record wrong? *
            <input
              type="text" name="reason" required maxLength={500}
              placeholder="e.g. the source record id belongs to a different kick; re-entered correctly"
            />
          </label>

          <h3 style={{ fontSize: '1rem', margin: '0.5rem 0 0' }}>The correct record</h3>

          {family === 'first-kick-goal'
            ? <FirstKickFields prefix="replacement_" />
            : <AfterSirenFields prefix="replacement_" />}

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Administrative note (kept with both audit entries)
            <input type="text" name="adminNote" maxLength={2000} />
          </label>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary">Preview the replacement…</button>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
