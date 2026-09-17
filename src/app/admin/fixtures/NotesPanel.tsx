'use client';

import { useState } from 'react';

import { updateFixtureNotesAction } from '@/app/admin/fixtures/actions';
import { useFixtureActionSubmit } from '@/app/admin/fixtures/submit-helper';

/**
 * Notes (AFLDB-ISSUE-162 §15) — the one edit every lifecycle state accepts,
 * including a played fixture: the durable operator context Stage 1 keeps
 * open no matter what else is locked.
 */
export function NotesPanel({
  fixtureKey, notes, expectedUpdatedAt,
}: {
  fixtureKey: string;
  notes: string | null;
  expectedUpdatedAt: string;
}) {
  const update = useFixtureActionSubmit(updateFixtureNotesAction, {});
  const [value, setValue] = useState(notes ?? '');

  const handleSubmit = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('fixtureKey', fixtureKey);
    formData.set('expectedUpdatedAt', expectedUpdatedAt);
    formData.set('notes', value);
    update.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Notes</h2>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} maxLength={2000} rows={3} disabled={update.isPending} style={{ maxWidth: '32rem', width: '100%' }} />
      {update.state.error && <p className="notice" role="alert">{update.state.error}</p>}
      {update.state.ok && <p className="notice" role="status">{update.state.message}</p>}
      <div style={{ marginTop: '0.5rem' }}>
        <button type="button" className="btn btn-primary" onClick={handleSubmit} disabled={update.isPending}>
          {update.isPending ? 'Saving…' : 'Save notes'}
        </button>
      </div>
    </section>
  );
}
