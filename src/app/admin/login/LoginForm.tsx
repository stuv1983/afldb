'use client';

import { useActionState } from 'react';

import { adminLogin, type LoginState } from '@/app/admin/login/actions';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(adminLogin, {});

  return (
    <form action={action} style={{ display: 'grid', gap: '0.75rem' }}>
      <label>
        Email
        <input name="email" type="email" autoComplete="username" required
          style={{ width: '100%' }} />
      </label>
      <label>
        Password
        <input name="password" type="password" autoComplete="current-password" required
          style={{ width: '100%' }} />
      </label>
      <label>
        Authenticator code
        <input name="totp" inputMode="numeric" pattern="[0-9 ]*" maxLength={7}
          autoComplete="one-time-code" placeholder="123456" required
          style={{ width: '100%' }} />
      </label>
      <button className="btn" type="submit" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
      {state.error && <p className="notice" role="alert">{state.error}</p>}
    </form>
  );
}
