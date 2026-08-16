'use client';

import { useActionState } from 'react';

import { sendTestEmail, type SettingsState } from '@/app/admin/settings/actions';

/**
 * A one-field form that proves the relay works.
 *
 * Deliberately a sibling of the settings form rather than a button inside it:
 * HTML forbids nesting forms, and more to the point pressing "send a test"
 * must not save a half-edited question list as a side effect.
 */
export function TestEmailForm({ defaultTo }: { defaultTo: string }) {
  const [state, action, sending] = useActionState<SettingsState, FormData>(sendTestEmail, {});

  return (
    <form action={action} className="section">
      <h2>Test email</h2>
      <p className="section-note">
        Sends one message through the configured relay. Nothing is saved.
      </p>

      {state.message && <p className="notice">{state.message}</p>}
      {state.error && <p className="notice" role="alert">{state.error}</p>}

      <div className="search-form" style={{ maxWidth: '30rem' }}>
        <label htmlFor="testTo" className="visually-hidden">Send test to</label>
        <input
          id="testTo"
          name="testTo"
          type="email"
          defaultValue={defaultTo}
          required
        />
        <button className="btn btn-secondary" type="submit" disabled={sending}>
          {sending ? 'Sending…' : 'Send test'}
        </button>
      </div>
    </form>
  );
}
