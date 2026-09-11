'use client';

import { useRef } from 'react';

import { retireCoachOverrideAction, saveCoachMetadataAction } from '@/app/admin/coaches/actions';
import { useCoachActionSubmit } from '@/app/admin/coaches/submit-helper';

/**
 * Panel 2 of `/admin/coaches/[id]` (§9): `display_name`, `given_name`,
 * `surname`, `dob`, `notes` -- the only source-owned / admin-owned fields
 * `coaches` exposes for edit (§4.1). `afltables_coach_path` and `name_key`
 * are never rendered as inputs here at all, never mind disabled ones: they
 * are identity, set once at creation, never edited.
 */
export function MetadataPanel({
  coachId,
  displayName,
  givenName,
  surname,
  dob,
  notes,
  hasActiveOverride,
}: {
  coachId: number;
  displayName: string;
  givenName: string | null;
  surname: string | null;
  dob: string | null;
  notes: string | null;
  hasActiveOverride: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const save = useCoachActionSubmit(saveCoachMetadataAction);
  const retire = useCoachActionSubmit(retireCoachOverrideAction);
  const isPending = save.isPending || retire.isPending;

  const handleSave = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set('coachId', String(coachId));
    save.submit(formData, event.currentTarget);
  };

  const handleRetire = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('coachId', String(coachId));
    formData.set('fieldGroup', 'identity');
    retire.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Editable metadata</h2>
      <form ref={formRef} onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: '0.6rem', maxWidth: '30rem' }}>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Display name
          <input type="text" name="displayName" defaultValue={displayName} required maxLength={200} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Given name
          <input type="text" name="givenName" defaultValue={givenName ?? ''} maxLength={60} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Surname
          <input type="text" name="surname" defaultValue={surname ?? ''} maxLength={60} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Date of birth
          <input type="date" name="dob" defaultValue={dob ?? ''} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Notes
          <textarea name="notes" defaultValue={notes ?? ''} maxLength={2000} rows={3} disabled={isPending} />
        </label>

        {save.state.error && <p className="notice" role="alert">{save.state.error}</p>}
        {save.state.ok && save.state.message && <p className="notice" role="status">{save.state.message}</p>}

        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={isPending}>
            {save.isPending ? 'Saving…' : 'Save metadata'}
          </button>
          {hasActiveOverride && (
            <button type="button" className="btn btn-secondary" onClick={handleRetire} disabled={isPending}>
              {retire.isPending ? 'Retiring…' : 'Retire this override'}
            </button>
          )}
        </div>
        {hasActiveOverride && (
          <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
            An identity override is active on this coach. Retiring it stops a future reload or
            promotion from reconstructing these corrections — for a manually created coach, that
            includes the coach row itself.
          </p>
        )}
        {retire.state.error && <p className="notice" role="alert">{retire.state.error}</p>}
        {retire.state.ok && retire.state.message && <p className="notice" role="status">{retire.state.message}</p>}
      </form>
    </section>
  );
}
