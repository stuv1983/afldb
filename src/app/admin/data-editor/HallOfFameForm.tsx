'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { createHallOfFameAction, type SimpleAdminActionState } from '@/app/admin/data-editor/actions';
import { PlayerPicker } from '@/components/PlayerPicker';
import type { ClubSummary } from '@/db/queries/clubs';

const INITIAL: SimpleAdminActionState = {};

/**
 * Super Admin Form: Add an Australian Football Hall of Fame Inductee (see changeLog.md).
 */
export function HallOfFameForm({
  clubs = [],
}: {
  clubs?: ClubSummary[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; label: string } | null>(null);
  const [isLegend, setIsLegend] = useState(false);
  const [state, formAction, isPending] = useActionState(createHallOfFameAction, INITIAL);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(true)}
        style={{ fontSize: '0.9rem' }}
      >
        + Add Hall of Fame inductee
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
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Add Hall of Fame Inductee</h3>
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
        Add an inductee to the Australian Football Hall of Fame across Player, Legend, Coach, Umpire, Media, Administrator, or Pioneer categories.
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
            Warning: {state.warning}
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

        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Link to player profile (search database)
            <PlayerPicker
              label="Select player profile"
              onSelect={(p) => setSelectedPlayer(p)}
            />
          </label>
          {selectedPlayer && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem' }}>
              <span>Selected player: <strong>{selectedPlayer.label}</strong> (ID #{selectedPlayer.id})</span>
              <button
                type="button"
                onClick={() => setSelectedPlayer(null)}
                style={{ fontSize: '0.75rem', padding: '0.1rem 0.3rem' }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Inductee name *
            <input
              type="text"
              name="name"
              required
              defaultValue={selectedPlayer?.label ?? ''}
              placeholder="e.g. Daisy Pearce or Ron Barassi"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Category *
            <select name="category" defaultValue="Player" style={{ fontSize: '0.9rem' }}>
              <option value="Player">Player</option>
              <option value="Coach">Coach</option>
              <option value="Umpire">Umpire</option>
              <option value="Media">Media</option>
              <option value="Administrator">Administrator</option>
              <option value="Pioneer">Pioneer</option>
            </select>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Inducted year *
            <input
              type="number"
              name="inductedYear"
              required
              min={1996}
              max={2100}
              defaultValue={new Date().getFullYear()}
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Club name(s) / association
            <input
              type="text"
              name="clubNameRaw"
              placeholder="e.g. Melbourne (AFLW) or West Perth"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Home state
            <input
              type="text"
              name="state"
              placeholder="e.g. VIC, WA, SA, TAS"
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              name="isLegend"
              checked={isLegend}
              onChange={(e) => setIsLegend(e.target.checked)}
            />
            <strong>Elevated to Legend status</strong>
          </label>

          {isLegend && (
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
              Legend Year
              <input
                type="number"
                name="legendYear"
                min={1996}
                max={2100}
                defaultValue={new Date().getFullYear()}
                style={{ width: '6rem', fontSize: '0.85rem' }}
              />
            </label>
          )}
        </div>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Career summary / achievements
          <input
            type="text"
            name="playingCareer"
            placeholder="e.g. Melbourne 2017-2022 (55 games, 25 goals, 2022 Premier)"
            style={{ fontSize: '0.9rem' }}
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Biographical notes
          <textarea
            name="notes"
            rows={2}
            maxLength={2000}
            placeholder="Citation and historical notes"
            style={{ fontSize: '0.9rem', resize: 'vertical' }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="submit" disabled={isPending}>
            {isPending ? 'Saving inductee…' : 'Add Hall of Fame inductee'}
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
