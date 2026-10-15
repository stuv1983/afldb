'use client';

import { useActionState } from 'react';

import { confirmMagicLink, type VerifyState } from '@/app/beta/verify/actions';

/**
 * The one-button confirmation (AFLDB-ISSUE-280). The emailed link only opens
 * this form; the token is spent when the reader presses the button.
 */
export function VerifyForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<VerifyState, FormData>(
    confirmMagicLink, {},
  );

  return (
    <form action={action} className="section" style={{ textAlign: 'center' }}>
      <input type="hidden" name="token" value={token} />
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in to the beta'}
      </button>
      {state.error && (
        <p className="notice" role="alert">{state.error}</p>
      )}
    </form>
  );
}
