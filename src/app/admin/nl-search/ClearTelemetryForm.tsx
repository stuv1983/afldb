'use client';

import { useActionState, useEffect, useState } from 'react';

import { clearTelemetry, NL_TELEMETRY_CLEAR_PHRASE, type NlClearTelemetryState } from './actions';
import { formatNumber } from '@/lib/format';

const INITIAL: NlClearTelemetryState = {};

function plural(n: number, noun: string): string {
  return `${formatNumber(n)} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Super Admin-only destructive control for /admin/nl-search
 * (AFLDB-ISSUE-119 §10). Follows DeleteMatchButton's
 * reveal-warning-confirm-cancel pattern, with an added exact-phrase gate:
 * the submit button stays disabled until the typed text matches
 * NL_TELEMETRY_CLEAR_PHRASE exactly. This is a misclick guard only -- the
 * action re-checks the same phrase server-side (§6), so a forged submit
 * with the field blank or wrong is refused there regardless of what this
 * component allows.
 */
export function ClearTelemetryForm() {
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState('');
  const [state, formAction, isPending] = useActionState<NlClearTelemetryState, FormData>(
    clearTelemetry,
    INITIAL,
  );

  // Collapse back to the initial button once a clear actually commits --
  // state.counts is only ever set on committed success, never on error.
  useEffect(() => {
    if (state.counts) {
      setIsConfirming(false);
      setConfirmation('');
    }
  }, [state.counts]);

  function cancel() {
    setIsConfirming(false);
    setConfirmation('');
  }

  const phraseMatches = confirmation === NL_TELEMETRY_CLEAR_PHRASE;

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      {!isConfirming ? (
        <button
          type="button"
          onClick={() => setIsConfirming(true)}
          className="btn"
          style={{
            background: 'transparent',
            border: '1px solid var(--color-warn)',
            color: 'var(--color-warn)',
            fontSize: '0.85rem',
          }}
        >
          🗑 Clear search telemetry
        </button>
      ) : (
        <div style={{
          border: '1px solid var(--color-warn)',
          borderRadius: '6px',
          padding: '0.75rem 1rem',
          background: 'var(--bg-raised)',
          display: 'grid',
          gap: '0.5rem',
          maxWidth: '34rem',
        }}>
          <p style={{ margin: 0, fontWeight: 600, color: 'var(--color-warn)', fontSize: '0.85rem' }}>
            ⚠ Clear search telemetry
          </p>
          <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
            Permanently deletes disposable <code>nl_search_log</code> rows — ones with no
            admin review and no matching reader feedback, plus any otherwise-unprotected
            ancestor of a row that does. Every review, every piece of reader feedback, and
            the log rows they reference are retained no matter what. This does not pause
            logging: searches after the clear are recorded as usual.
          </p>

          {state.error && (
            <p style={{ margin: 0, color: 'var(--color-warn)', fontSize: '0.8rem' }} role="alert">
              ⚠ {state.error}
            </p>
          )}

          <form action={formAction} style={{ display: 'grid', gap: '0.5rem' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Type <code>{NL_TELEMETRY_CLEAR_PHRASE}</code> to confirm
              <input
                type="text"
                name="confirmation"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                disabled={isPending}
                autoComplete="off"
                spellCheck={false}
                style={{ fontSize: '0.8rem' }}
              />
            </label>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                type="submit"
                disabled={isPending || !phraseMatches}
                style={{
                  background: 'var(--color-warn)',
                  color: '#fff',
                  border: 'none',
                  fontSize: '0.8rem',
                  padding: '0.3rem 0.6rem',
                }}
              >
                {isPending ? 'Clearing…' : 'Yes, clear search telemetry'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={cancel}
                disabled={isPending}
                style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {state.counts && (
        <p className="notice" style={{ display: 'grid', gap: '0.15rem' }}>
          <strong>{state.message}</strong>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Retained: {plural(state.counts.retainedReviewRows, 'review')},{' '}
            {plural(state.counts.retainedFeedbackRows, 'feedback row')}.{' '}
            {plural(state.counts.detachedAppHealthLinks, 'app-health link')} detached from cleared rows.
          </span>
        </p>
      )}
    </div>
  );
}
