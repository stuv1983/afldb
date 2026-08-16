'use client';

import { useActionState } from 'react';

import { changeOwnPassword, type ChangePasswordState } from '@/app/admin/password/actions';

/**
 * `minLength` arrives as a prop rather than being imported.
 *
 * `MIN_PASSWORD_LENGTH` lives in `@/lib/auth/crypto`, which imports
 * `node:crypto`; importing it here would pull that into the client bundle and
 * fail the build outright — see the header of that module. The server page
 * reads the constant and hands the number down, so there is still one
 * definition of the rule and the action re-checks it regardless.
 */
export function ChangePasswordForm({ minLength }: { minLength: number }) {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(
    changeOwnPassword, {},
  );

  return (
    <form action={action} style={{ display: 'grid', gap: '0.75rem', maxWidth: '24rem' }}>
      <label>
        Current password
        <input
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          style={{ width: '100%' }}
        />
      </label>
      <label>
        New password
        <input
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          style={{ width: '100%' }}
        />
        <span className="muted" style={{ fontSize: '0.78rem' }}>
          At least {minLength} characters. Length is the only rule: a
          passphrase you can remember beats a short one you cannot.
        </span>
      </label>
      <label>
        New password again
        <input
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          minLength={minLength}
          required
          style={{ width: '100%' }}
        />
      </label>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Changing…' : 'Change password'}
      </button>
      {state.error && <p className="notice" role="alert">{state.error}</p>}
    </form>
  );
}
