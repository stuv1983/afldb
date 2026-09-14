'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createAfterSirenKickAction, createFirstKickGoalAction } from '@/app/admin/records/actions';
import { AfterSirenFields } from '@/app/admin/records/AfterSirenFields';
import { FirstKickFields } from '@/app/admin/records/FirstKickFields';
import { FAMILY_NOUNS, familyDetailPath, type RecordFamilySlug } from '@/app/admin/records/labels';
import { useSpecialRecordsActionSubmit } from '@/app/admin/records/submit-helper';

const CREATE_ACTIONS = {
  'first-kick-goal': createFirstKickGoalAction,
  'after-the-siren': createAfterSirenKickAction,
} as const;

/**
 * Record a genuinely manual special record (AFLDB-ISSUE-167 §10.2).
 *
 * WHAT A MANUAL RECORD IS. Its source is `manual_admin_edit` and its
 * `source_record_id` is a freshly minted `<family>:<uuid>` — never a
 * source-owned key. Two consequences follow, and both are the point: no
 * importer retirement scope can reach it, so a curated reload cannot delete it;
 * and its whole content is written to a durable `data_overrides` `record`
 * payload, which the Stage 4 replay re-creates the row from after a destructive
 * rebuild.
 *
 * THE PLAYER AND THE MATCH ARE CHOSEN BY DATABASE ID, never by name (Phase E
 * §12). They travel durably as natural identities — the player's AFL Tables
 * identity or manual token, and the match's `match_key` — because a rebuild
 * renumbers every id and neither of those.
 */
export function SpecialRecordCreatePanel({ family }: { family: RecordFamilySlug }) {
  const router = useRouter();
  const noun = FAMILY_NOUNS[family];
  const submitRef = useRef<HTMLButtonElement>(null);
  const create = useSpecialRecordsActionSubmit(CREATE_ACTIONS[family]);

  useEffect(() => {
    if (create.state.ok && create.state.createdId && !create.state.warning) {
      router.push(familyDetailPath(family, create.state.createdId));
    }
  }, [create.state.ok, create.state.createdId, create.state.warning, family, router]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.submit(new FormData(event.currentTarget), submitRef.current);
  };

  return (
    <section className="section">
      {create.state.error && <p className="notice" role="alert">{create.state.error}</p>}
      {create.state.ok && (
        <p className="notice" role="status">
          {create.state.message}
          {create.state.warning ? '' : ' Opening the new record…'}
        </p>
      )}
      {create.state.warning && <p className="notice" role="alert">{create.state.warning}</p>}

      <form onSubmit={onSubmit} style={{ display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
        {family === 'first-kick-goal' ? <FirstKickFields /> : <AfterSirenFields />}

        <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
          The club is recorded as you write it here, not linked to a club record: a manual{' '}
          {noun} must be exactly the row a rebuild can reconstruct, and the durable payload the
          replay rebuilds it from carries the source spelling rather than a club id. Every public
          page already falls back to that spelling.
        </p>

        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
          <button
            ref={submitRef} type="submit" className="btn btn-primary" disabled={create.isPending}
          >
            {create.isPending ? 'Recording…' : `Record this ${noun}`}
          </button>
        </div>
      </form>
    </section>
  );
}
