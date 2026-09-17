'use client';

import { useRef, useState } from 'react';

import { createCoachAction } from '@/app/admin/coaches/actions';
import { useCoachActionSubmit } from '@/app/admin/coaches/submit-helper';

/**
 * The bounded create panel on `/admin/coaches` (§9), collapsed by default,
 * Super Admin only. Duplicate candidates from `createCoachAction` are shown
 * rather than silently refused; confirming re-submits with `confirmed=1`
 * rather than bypassing the check client-side (§4.4).
 *
 * `type="button"` + a form ref, never a native submit: the same reason
 * `MatchVoteEditor.tsx` gives -- these are `useActionState` actions
 * dispatched from a click handler, and `submit-helper.ts`'s focus-restore
 * needs the exact element the operator clicked, captured before dispatch.
 */
export function CreatePanel() {
  const [open, setOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const { state, isPending, submit } = useCoachActionSubmit(createCoachAction);

  const handleCreate = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    if (confirmed) formData.set('confirmed', '1');
    submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <button type="button" className="btn btn-secondary" onClick={() => setOpen((v) => !v)}>
        {open ? 'Cancel new coach' : 'Create a coach…'}
      </button>

      {open && (
        <form
          ref={formRef}
          onSubmit={(event) => event.preventDefault()}
          style={{ display: 'grid', gap: '0.6rem', maxWidth: '30rem', marginTop: '0.75rem' }}
        >
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            For a person AFL Tables does not publish a coach page for. This does not create a
            player record and cannot be used to correct an existing coach — edit that coach
            instead.
          </p>

          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Display name
            <input type="text" name="displayName" required maxLength={200} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Given name
            <input type="text" name="givenName" maxLength={60} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Surname
            <input type="text" name="surname" maxLength={60} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Date of birth
            <input type="date" name="dob" disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Notes
            <textarea name="notes" maxLength={2000} rows={3} disabled={isPending} />
          </label>

          {state.needsConfirmation && (
            <div className="notice" role="alert">
              <p style={{ margin: '0 0 0.4rem' }}>{state.error}</p>
              <ul style={{ margin: '0 0 0.4rem' }}>
                {state.candidates?.map((c) => (
                  <li key={c.coachId}>{c.label} — {c.reason}</li>
                ))}
              </ul>
              <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                This is a different person. Create a new, separate coach.
              </label>
            </div>
          )}
          {!state.needsConfirmation && state.error && (
            <p className="notice" role="alert">{state.error}</p>
          )}
          {state.ok && state.message && (
            <p className="notice" role="status">{state.message}</p>
          )}

          <div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCreate}
              disabled={isPending || (state.needsConfirmation === true && !confirmed)}
            >
              {isPending ? 'Creating…' : 'Create coach'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
