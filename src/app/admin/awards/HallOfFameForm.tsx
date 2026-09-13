'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef } from 'react';

import { createHallOfFameAction } from '@/app/admin/awards/actions';
import { HallOfFameFields } from '@/app/admin/awards/HallOfFameFields';
import { domainDetailPath } from '@/app/admin/awards/labels';
import { useAwardsActionSubmit } from '@/app/admin/awards/submit-helper';

/**
 * Record a Hall of Fame induction (AFLDB-ISSUE-165 §6.5 / §6.7).
 *
 * Moved from `/admin/data-editor` and rewired to the awards domain's own
 * Server Action and `data.awards.edit`; the fields themselves are the ones
 * that page asked for, minus the derived-name defect (see
 * `HallOfFameFields.tsx`).
 */
export function HallOfFameForm() {
  const router = useRouter();
  const submitRef = useRef<HTMLButtonElement>(null);
  const create = useAwardsActionSubmit(createHallOfFameAction);

  useEffect(() => {
    if (create.state.ok && create.state.createdId && !create.state.warning) {
      router.push(domainDetailPath('hall-of-fame', create.state.createdId));
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

        <HallOfFameFields />

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Administrative note (kept with the audit entry)
          <input type="text" name="adminNote" maxLength={2000} />
        </label>

        <div>
          <button ref={submitRef} type="submit" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Recording…' : 'Record induction'}
          </button>
        </div>
      </form>
    </section>
  );
}
