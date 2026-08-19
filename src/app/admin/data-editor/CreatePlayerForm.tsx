'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import { createPlayerAction, type CreatePlayerActionState } from '@/app/admin/data-editor/actions';

const INITIAL: CreatePlayerActionState = {};

/**
 * Super Admin form to create a new player record (see changeLog.md).
 * Enables creating bio profiles for drafted players who have yet to play,
 * or historical players.
 */
export function CreatePlayerForm() {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [state, formAction, isPending] = useActionState(createPlayerAction, INITIAL);

  useEffect(() => {
    if (state.createdId) {
      router.push(`/admin/data-editor?entity=players&id=${state.createdId}`);
    }
  }, [state.createdId, router]);

  if (!isOpen && !state.createdId) {
    return (
      <div style={{ margin: '0.5rem 0' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setIsOpen(true)}
          style={{ fontSize: '0.9rem' }}
        >
          + Add new player
        </button>
      </div>
    );
  }

  return (
    <div style={{
      border: '1px solid var(--border-subtle)',
      background: 'var(--bg-subtle)',
      borderRadius: '8px',
      padding: '1rem 1.25rem',
      margin: '0.75rem 0 1.25rem',
      maxWidth: '48rem',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Add new player</h3>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setIsOpen(false)}
          style={{ fontSize: '0.8rem', padding: '0.2rem 0.5rem' }}
        >
          Cancel
        </button>
      </div>

      <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 1rem' }}>
        Creates a new player identity and biography. Ideal for newly drafted players (e.g. rookie/national draftees) who have yet to play a senior match.
      </p>

      {state.message && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-raised)', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
            ✓ {state.message}{' '}
            {state.createdId && (
              <Link href={`/admin/data-editor?entity=players&id=${state.createdId}`}>
                Edit player details →
              </Link>
            )}
          </p>
        </div>
      )}

      {state.error && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-raised)', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--color-warn)', fontSize: '0.9rem' }}>
            ⚠ {state.error}
          </p>
        </div>
      )}

      <form action={formAction} style={{ display: 'grid', gap: '0.75rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Display name *
            <input
              type="text"
              name="displayName"
              required
              maxLength={100}
              placeholder="e.g. Riley Onley"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Given name (optional)
            <input
              type="text"
              name="givenName"
              maxLength={60}
              placeholder="e.g. Riley"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Surname (optional)
            <input
              type="text"
              name="surname"
              maxLength={60}
              placeholder="e.g. Onley"
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Date of birth (YYYY-MM-DD)
            <input
              type="date"
              name="dob"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            DOB confidence
            <select name="dobConfidence" defaultValue="sourced" style={{ fontSize: '0.9rem' }}>
              <option value="sourced">sourced (verified)</option>
              <option value="estimated">estimated</option>
              <option value="derived">derived</option>
              <option value="unknown">unknown</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Height (cm)
            <input
              type="number"
              name="heightCm"
              min={120}
              max={230}
              placeholder="e.g. 195"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Weight (kg)
            <input
              type="number"
              name="weightKg"
              min={40}
              max={160}
              placeholder="e.g. 88"
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Bio details / notes (optional)
          <textarea
            name="notes"
            maxLength={2000}
            rows={2}
            placeholder="e.g. Drafted pick 3 in 2025 Rookie Draft by Melbourne. Junior club Shepparton United / Murray U18."
            style={{ fontSize: '0.9rem', resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
          <button type="submit" disabled={isPending}>
            {isPending ? 'Creating player…' : 'Create player profile'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setIsOpen(false)}
          >
            Close
          </button>
        </div>
      </form>
    </div>
  );
}
