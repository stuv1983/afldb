'use client';

import { useActionState } from 'react';

import { redeemAccessCode, requestMagicLink, type BetaFormState } from '@/app/beta/actions';

/**
 * The two admission paths, one form each. Kept as a Client Component for
 * useActionState; all decisions happen in the server actions.
 */
export function BetaGateForm({ from }: { from: string }) {
  const [codeState, codeAction, codePending] = useActionState<BetaFormState, FormData>(
    redeemAccessCode, {},
  );
  const [emailState, emailAction, emailPending] = useActionState<BetaFormState, FormData>(
    requestMagicLink, {},
  );

  return (
    <div style={{ display: 'grid', gap: '2rem', textAlign: 'left' }}>
      <form action={codeAction} className="section">
        <h2 style={{ fontSize: '1rem' }}>I have an access code</h2>
        <div className="search-form" style={{ marginTop: '0.5rem' }}>
          <label htmlFor="beta-code" className="visually-hidden">Access code</label>
          <input
            id="beta-code"
            name="code"
            type="password"
            autoComplete="off"
            placeholder="Access code"
            required
            minLength={8}
          />
          <input type="hidden" name="from" value={from} />
          <button className="btn" type="submit" disabled={codePending}>
            {codePending ? 'Checking…' : 'Enter'}
          </button>
        </div>
        {codeState.error && (
          <p className="notice" role="alert">{codeState.error}</p>
        )}
      </form>

      <form action={emailAction} className="section">
        <h2 style={{ fontSize: '1rem' }}>My email is on the list</h2>
        <div className="search-form" style={{ marginTop: '0.5rem' }}>
          <label htmlFor="beta-email" className="visually-hidden">Email address</label>
          <input
            id="beta-email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <button className="btn btn-secondary" type="submit" disabled={emailPending}>
            {emailPending ? 'Sending…' : 'Send me a link'}
          </button>
        </div>
        {emailState.sent && (
          <p className="notice">
            If that address is on the list, a sign-in link is on its way. It is valid
            for 30 minutes.
          </p>
        )}
        {emailState.error && (
          <p className="notice" role="alert">{emailState.error}</p>
        )}
      </form>
    </div>
  );
}
