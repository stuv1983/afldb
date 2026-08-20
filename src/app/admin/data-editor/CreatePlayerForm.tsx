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
export function CreatePlayerForm({
  clubs = [],
}: {
  clubs?: { id: number; name: string }[];
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [showDraftFields, setShowDraftFields] = useState(false);
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
        Creates a new player identity and biography with optional draft selection & recruitment details.
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

      {state.warning && (
        <div className="badge badge-warn" style={{ marginBottom: '1rem' }}>
          {state.warning}
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

        {/* Draft & Recruitment Section */}
        <div style={{
          borderTop: '1px dashed var(--border-subtle)',
          paddingTop: '0.75rem',
          display: 'grid',
          gap: '0.5rem',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: '0.9rem' }}>Draft & recruitment details</strong>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowDraftFields((prev) => !prev)}
              style={{ fontSize: '0.75rem', padding: '0.2rem 0.4rem' }}
            >
              {showDraftFields ? 'Hide draft fields' : '+ Add draft / recruitment record'}
            </button>
          </div>

          {showDraftFields && (
            <div style={{ display: 'grid', gap: '0.75rem', marginTop: '0.25rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(13rem, 1fr))', gap: '0.75rem' }}>
                <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                  Recruited from (junior / origin club)
                  <input
                    type="text"
                    name="recruitedFrom"
                    placeholder="e.g. Shepparton United / Murray U18"
                    style={{ fontSize: '0.9rem' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                  Drafted by club
                  <select name="draftClubId" defaultValue="" style={{ fontSize: '0.9rem' }}>
                    <option value="">— Select club —</option>
                    {clubs.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: '0.75rem' }}>
                <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                  Draft year
                  <input
                    type="number"
                    name="draftYear"
                    min={1981}
                    max={2100}
                    placeholder="e.g. 2025"
                    style={{ fontSize: '0.9rem' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                  Draft type
                  <select name="draftType" defaultValue="National Draft" style={{ fontSize: '0.9rem' }}>
                    <option value="National Draft">National Draft</option>
                    <option value="Rookie Draft">Rookie Draft</option>
                    <option value="Pre-Season Draft">Pre-Season Draft</option>
                    <option value="Mid-Season Draft">Mid-Season Draft</option>
                    <option value="Father-Son Selection">Father-Son Selection</option>
                    <option value="Category B Rookie">Category B Rookie</option>
                    <option value="Zone Selection">Zone Selection</option>
                    <option value="Uncontracted Selection">Uncontracted Selection</option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                  Pick number
                  <input
                    type="number"
                    name="pickNumber"
                    min={1}
                    max={200}
                    placeholder="e.g. 3"
                    style={{ fontSize: '0.9rem' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                  Draft age
                  <input
                    type="number"
                    name="draftAge"
                    min={15}
                    max={40}
                    placeholder="e.g. 18"
                    style={{ fontSize: '0.9rem' }}
                  />
                </label>
              </div>

              <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
                Pick note / details
                <input
                  type="text"
                  name="pickNote"
                  maxLength={500}
                  placeholder="e.g. 2025 Rookie Draft Selection"
                  style={{ fontSize: '0.9rem' }}
                />
              </label>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
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
