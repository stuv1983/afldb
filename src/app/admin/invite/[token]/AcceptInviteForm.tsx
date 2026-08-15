'use client';

import { useActionState } from 'react';

import {
  beginEnrolment, confirmEnrolment, type InviteAcceptState,
} from '@/app/admin/invite/[token]/actions';

const INITIAL: InviteAcceptState = { step: 'password' };

export function AcceptInviteForm({ token }: { token: string }) {
  const [passwordState, passwordAction, settingPassword] =
    useActionState<InviteAcceptState, FormData>(beginEnrolment, INITIAL);
  const [confirmState, confirmAction, confirming] =
    useActionState<InviteAcceptState, FormData>(confirmEnrolment, INITIAL);

  // The QR/confirm step is reached either by finishing step 1 or by a
  // failed confirm attempt (confirmEnrolment re-renders the same QR
  // rather than sending the invitee back to choose a password again).
  const active = confirmState.qrDataUrl ? confirmState : passwordState;

  if (active.step !== 'confirm' || !active.qrDataUrl) {
    return (
      <form action={passwordAction} style={{ display: 'grid', gap: '0.75rem' }}>
        <input type="hidden" name="token" value={token} />
        <label>
          Choose a password
          <input name="password" type="password" autoComplete="new-password" required
            minLength={12} style={{ width: '100%' }} />
        </label>
        <label>
          Confirm password
          <input name="confirmPassword" type="password" autoComplete="new-password" required
            minLength={12} style={{ width: '100%' }} />
        </label>
        <button className="btn" type="submit" disabled={settingPassword}>
          {settingPassword ? 'Working…' : 'Continue'}
        </button>
        {passwordState.error && <p className="notice" role="alert">{passwordState.error}</p>}
      </form>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem' }}>
      <p>
        Scan this with your authenticator app (Google Authenticator, Authy, 1Password, …):
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element -- a one-time data: URI, not a served asset */}
      <img
        src={active.qrDataUrl}
        alt={`Authenticator QR code for ${active.email ?? 'this account'}`}
        width={220}
        height={220}
        style={{ background: '#fff', padding: '0.5rem', borderRadius: 'var(--radius-lg)' }}
      />
      <details>
        <summary>Can’t scan it? Enter this key manually</summary>
        <p style={{ fontSize: '0.8rem' }}>
          Time-based, SHA-1, 6 digits, 30 seconds.
        </p>
        <code className="mono" style={{ fontSize: '0.9rem', userSelect: 'all', wordBreak: 'break-all' }}>
          {active.secret}
        </code>
      </details>

      <form action={confirmAction} style={{ display: 'grid', gap: '0.75rem' }}>
        <input type="hidden" name="token" value={token} />
        <label>
          Enter the current code to confirm
          <input name="totp" inputMode="numeric" pattern="[0-9 ]*" maxLength={7}
            autoComplete="one-time-code" placeholder="123456" required
            style={{ width: '100%' }} />
        </label>
        <button className="btn" type="submit" disabled={confirming}>
          {confirming ? 'Confirming…' : 'Confirm and finish'}
        </button>
        {confirmState.error && <p className="notice" role="alert">{confirmState.error}</p>}
      </form>
    </div>
  );
}
