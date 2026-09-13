'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import {
  replaceAwardWinnerAction, replaceHallOfFameAction, replaceHonourTeamAction,
} from '@/app/admin/awards/actions';
import { AwardWinnerFields } from '@/app/admin/awards/AwardWinnerFields';
import { HallOfFameFields } from '@/app/admin/awards/HallOfFameFields';
import { HonourTeamFields } from '@/app/admin/awards/HonourTeamFields';
import { DOMAIN_NOUNS, domainDetailPath, type HonourDomain } from '@/app/admin/awards/labels';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';
import type { AwardSummary } from '@/db/queries/awards';
import type { ClubSummary } from '@/db/queries/clubs';

const REPLACE_ACTIONS = {
  winners: replaceAwardWinnerAction,
  'hall-of-fame': replaceHallOfFameAction,
  'honour-teams': replaceHonourTeamAction,
} as const;

/**
 * Replace one record with the right one, as a single atomic change
 * (AFLDB-ISSUE-165 §6.5).
 *
 * This is the ONLY way to correct an identity-bearing fact — who won, which
 * award, which season, which team, which induction year. It is not an UPDATE
 * of the identity on one row: that would erase the fact that the wrong
 * assertion was ever made and leave the audit trail describing something the
 * database no longer says. The mutation voids the old record and records the
 * new one inside one transaction, cross-referenced by NATURAL key, so the
 * season is never momentarily left with nothing recorded at all.
 *
 * TWO STEPS, ALWAYS. Step one collects the replacement and the reason; step
 * two shows what will happen in plain words — this record is voided, that
 * record is created — and only then does a submission carry the confirmation
 * flag the action requires. A one-click replace would put the most
 * consequential mutation in this surface behind the least friction.
 */
export function ReplacePanel({
  domain, rowId, expectedUpdatedAt, currentSummary, awards, clubs, existingTeams,
}: {
  domain: HonourDomain;
  rowId: number;
  expectedUpdatedAt: string;
  /** How the record being voided reads, so the preview names both halves. */
  currentSummary: string;
  awards?: AwardSummary[];
  clubs?: ClubSummary[];
  existingTeams?: string[];
}) {
  const router = useRouter();
  const noun = DOMAIN_NOUNS[domain];
  const formRef = useRef<HTMLFormElement>(null);
  const previewRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ data: FormData; summary: string[] } | null>(null);
  const replace = useAwardsActionSubmit(REPLACE_ACTIONS[domain]);

  useEffect(() => {
    if (replace.state.ok && replace.state.createdId && !replace.state.warning) {
      router.push(domainDetailPath(domain, replace.state.createdId));
    }
  }, [replace.state.ok, replace.state.createdId, replace.state.warning, domain, router]);

  /** The replacement in the administrator's own words, read back from the form. */
  const describe = (data: FormData): string[] => {
    const text = (key: string) => (data.get(`new:${key}`) ?? '').toString().trim();
    const lines: string[] = [];
    if (domain === 'winners') {
      const award = awards?.find((a) => String(a.id) === text('awardId'));
      const club = clubs?.find((c) => String(c.id) === text('clubId'));
      lines.push(`Award: ${award?.name ?? '(not selected)'}`);
      lines.push(`Season: ${text('season') || '(none)'}`);
      lines.push(`Recipient: ${text('playerId') ? `player #${text('playerId')}` : text('playerNameRaw') || '(none)'}`);
      if (club) lines.push(`Club: ${club.name}`);
      if (text('position')) lines.push(`Position: ${text('position')}`);
      if (text('votes')) lines.push(`Votes / statistic: ${text('votes')}`);
    } else if (domain === 'hall-of-fame') {
      lines.push(`Name: ${text('name') || '(none)'}`);
      lines.push(`Inducted: ${text('inductedYear') || '(none)'}`);
      lines.push(`Category: ${text('category') || 'Player'}`);
      if (text('playerId')) lines.push(`Linked player: #${text('playerId')}`);
    } else {
      lines.push(`Team: ${text('teamName') || '(none)'}`);
      lines.push(`Selection: ${text('playerId') ? `player #${text('playerId')}` : text('playerNameRaw') || '(none)'}`);
      if (text('position')) lines.push(`Position: ${text('position')}`);
      if (text('role')) lines.push(`Role: ${text('role')}`);
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

  const onConfirm = () => {
    if (!pending) return;
    pending.data.set('confirmReplace', '1');
    replace.submit(pending.data, confirmRef.current);
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
          Use this when the wrong fact was recorded — the wrong person, the wrong award, the wrong
          team. The current {noun} is voided and the correct one recorded in one change, so the
          mistake and the correction both survive as history.
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
            <h3 style={{ fontSize: '1rem', margin: '0 0 0.3rem' }}>Void</h3>
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
              disabled={replace.isPending} onClick={onConfirm}
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
        <form ref={formRef} onSubmit={onPreview} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Why is the current record wrong? *
            <input
              type="text" name="reason" required maxLength={500}
              placeholder="e.g. the source named the wrong player; corrected against the official announcement"
            />
          </label>

          <h3 style={{ fontSize: '1rem', margin: '0.5rem 0 0' }}>The correct record</h3>

          {domain === 'winners' && awards && clubs && (
            <AwardWinnerFields prefix="new:" awards={awards} clubs={clubs} />
          )}
          {domain === 'hall-of-fame' && <HallOfFameFields prefix="new:" />}
          {domain === 'honour-teams' && (
            <HonourTeamFields prefix="new:" existingTeams={existingTeams ?? []} />
          )}

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Administrative note (kept with both audit entries)
            <input type="text" name="adminNote" maxLength={2000} />
          </label>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <button ref={previewRef} type="submit" className="btn btn-primary">
              Preview the replacement…
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
