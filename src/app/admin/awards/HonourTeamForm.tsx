'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createHonourTeamMemberAction } from '@/app/admin/awards/actions';
import { HonourTeamFields } from '@/app/admin/awards/HonourTeamFields';
import { domainDetailPath } from '@/app/admin/awards/labels';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';

/**
 * Record an honour / representative-team selection (AFLDB-ISSUE-165 §6.5 /
 * §6.7).
 *
 * Moved from `/admin/data-editor` and rewired to the awards domain's own
 * Server Action and `data.awards.edit`. The duplicate refusal this domain has
 * always had — a linked player already selected for the team, or an ambiguous
 * same-name entry — is unchanged and still runs under the ISSUE-080 §5.3
 * advisory lock, which the importer contends on with the same two literals.
 */
export function HonourTeamForm({ existingTeams }: { existingTeams: string[] }) {
  const router = useRouter();
  const submitRef = useRef<HTMLButtonElement>(null);
  const create = useAwardsActionSubmit(createHonourTeamMemberAction);

  useEffect(() => {
    if (create.state.ok && create.state.createdId && !create.state.warning) {
      router.push(domainDetailPath('honour-teams', create.state.createdId));
    }
  }, [create.state.ok, create.state.createdId, create.state.warning, router]);

  const onSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    create.submit(new FormData(event.currentTarget), submitRef.current);
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
        {create.state.error && <p className="notice" role="alert">{create.state.error}</p>}

        <HonourTeamFields existingTeams={existingTeams} />

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Administrative note (kept with the audit entry)
          <input type="text" name="adminNote" maxLength={2000} />
        </label>

        <div>
          <button ref={submitRef} type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Recording…' : 'Record selection'}
          </button>
        </div>
      </form>
    </section>
  );
}
