'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { createAwardWinnerAction, type SimpleAdminActionState } from '@/app/admin/data-editor/actions';
import { PlayerPicker } from '@/components/PlayerPicker';
import type { AwardSummary } from '@/db/queries/awards';
import type { ClubSummary } from '@/db/queries/clubs';

const INITIAL: SimpleAdminActionState = {};

/**
 * Super Admin Form: Add an Award Winner / Recipient (see changeLog.md).
 */
export function AwardWinnerForm({
  awards,
  clubs,
}: {
  awards: AwardSummary[];
  clubs: ClubSummary[];
}) {
  const editableAwards = awards.filter((award) => award.slug !== 'brownlow-medal');
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; label: string } | null>(null);
  const [state, formAction, isPending] = useActionState(createAwardWinnerAction, INITIAL);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(true)}
        style={{ fontSize: '0.9rem' }}
      >
        + Add award winner
      </button>
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
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Add award winner / recipient</h3>
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
        Record a Coleman, Rising Star, All-Australian, Club Best & Fairest, or AFLCA/AFLPA recipient.
        Brownlow winners use the authoritative season-votes dataset and cannot be added here.
      </p>

      {state.message && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-raised)', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--accent)', fontWeight: 600, fontSize: '0.9rem' }}>
            ✓ {state.message}
          </p>
        </div>
      )}

      {state.warning && (
        <div style={{ padding: '0.5rem 0.75rem', background: 'var(--bg-raised)', borderRadius: '6px', marginBottom: '1rem' }}>
          <p style={{ margin: 0, color: 'var(--color-warn)', fontSize: '0.9rem' }}>
            âš  {state.warning}
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
        <input type="hidden" name="playerId" value={selectedPlayer ? String(selectedPlayer.id) : ''} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Award *
            <select name="awardId" required style={{ fontSize: '0.9rem' }}>
              <option value="">— Select an award —</option>
              {editableAwards.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.category.replace(/_/g, ' ')})
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Season (Year) *
            <input
              type="number"
              name="season"
              required
              min={1897}
              max={2100}
              defaultValue={new Date().getFullYear()}
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Recipient player (search database)
            <PlayerPicker
              label="Select player profile"
              onSelect={(p) => setSelectedPlayer(p)}
            />
          </label>
          {selectedPlayer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <span>Selected: <strong>{selectedPlayer.label}</strong> (ID #{selectedPlayer.id})</span>
              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                style={{ fontSize: '0.75rem', padding: '0.1rem 0.3rem' }}
              >
                Clear
              </button>
            </div>
          )}

          {!selectedPlayer && (
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
              Or enter non-linked recipient name
              <input
                type="text"
                name="playerNameRaw"
                placeholder="e.g. State league or historical recipient"
                style={{ fontSize: '0.9rem' }}
              />
            </label>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Club
            <select name="clubId" defaultValue="" style={{ fontSize: '0.9rem' }}>
              <option value="">— Select club —</option>
              {clubs.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Votes / Stat / Score
            <input
              type="number"
              step="any"
              name="votes"
              placeholder="e.g. 32 (votes) or 68 (goals)"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Position (All-Australian / Team)
            <input
              type="text"
              name="position"
              placeholder="e.g. Full Forward, Rover"
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" name="isCaptain" />
            Team Captain
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" name="isViceCaptain" />
            Vice Captain
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Note / Citation (optional)
          <input
            type="text"
            name="note"
            maxLength={1000}
            placeholder="e.g. Tied with Marcus Bontempelli; official AFL announcement"
            style={{ fontSize: '0.9rem' }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="submit" disabled={isPending}>
            {isPending ? 'Saving winner…' : 'Add award winner'}
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
