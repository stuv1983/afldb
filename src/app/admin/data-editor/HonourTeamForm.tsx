'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';

import { createHonourTeamMemberAction, type SimpleAdminActionState } from '@/app/admin/data-editor/actions';
import { PlayerPicker } from '@/components/PlayerPicker';
import type { ClubSummary } from '@/db/queries/clubs';

const INITIAL: SimpleAdminActionState = {};

const COMMON_POSITIONS = [
  'Back Pocket',
  'Full Back',
  'Half Back Flank',
  'Centre Half Back',
  'Wing',
  'Centre',
  'Half Forward Flank',
  'Centre Half Forward',
  'Forward Pocket',
  'Full Forward',
  'Ruck',
  'Ruck Rover',
  'Rover',
  'Interchange',
  'Emergency',
  'Coach',
];

/**
 * Super Admin Form: Add a member to an Honour / Representative Team (see changeLog.md).
 */
export function HonourTeamForm({
  existingTeams = [],
  clubs = [],
}: {
  existingTeams?: string[];
  clubs?: ClubSummary[];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; label: string } | null>(null);
  const [teamSelection, setTeamSelection] = useState<string>(existingTeams[0] || 'AFL Team of the Century');
  const [customTeamName, setCustomTeamName] = useState<string>('');
  const [state, formAction, isPending] = useActionState(createHonourTeamMemberAction, INITIAL);

  const finalTeamName = teamSelection === '__custom__' ? customTeamName : teamSelection;

  if (!isOpen) {
    return (
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setIsOpen(true)}
        style={{ fontSize: '0.9rem' }}
      >
        + Add honour / rep team member
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
        <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Add Representative / Honour Team Member</h3>
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
        Add a selected player or coach to Teams of the Century, State of Origin, Indigenous / Multicultural honour teams.
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
        <input type="hidden" name="teamName" value={finalTeamName} />

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Team *
            <select
              value={teamSelection}
              onChange={(e) => setTeamSelection(e.target.value)}
              style={{ fontSize: '0.9rem' }}
            >
              {existingTeams.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
              <option value="__custom__">+ Create new honour team…</option>
            </select>
          </label>

          {teamSelection === '__custom__' && (
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
              New team name *
              <input
                type="text"
                required
                value={customTeamName}
                onChange={(e) => setCustomTeamName(e.target.value)}
                placeholder="e.g. West Australian Team of the Century"
                style={{ fontSize: '0.9rem' }}
              />
            </label>
          )}
        </div>

        <div style={{ display: 'grid', gap: '0.5rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Member player (search database)
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

          {!selectedPlayer && (
            <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
              Or enter non-linked member name
              <input
                type="text"
                name="playerNameRaw"
                placeholder="e.g. Historical representative player"
                style={{ fontSize: '0.9rem' }}
              />
            </label>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Position
            <input
              type="text"
              name="position"
              list="positions-list"
              placeholder="e.g. Full Back or Centre"
              style={{ fontSize: '0.9rem' }}
            />
            <datalist id="positions-list">
              {COMMON_POSITIONS.map((pos) => (
                <option key={pos} value={pos} />
              ))}
            </datalist>
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Role (Captain / Coach)
            <input
              type="text"
              name="role"
              placeholder="e.g. Captain, Vice Captain, Coach"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Club name(s)
            <input
              type="text"
              name="clubNameRaw"
              placeholder="e.g. Hawthorn"
              style={{ fontSize: '0.9rem' }}
            />
          </label>

          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Lineup order #
            <input
              type="number"
              name="sortOrder"
              min={0}
              max={50}
              defaultValue={1}
              style={{ fontSize: '0.9rem' }}
            />
          </label>
        </div>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Note / Citation
          <input
            type="text"
            name="note"
            maxLength={1000}
            placeholder="e.g. Selected at Full Forward; announced 1996"
            style={{ fontSize: '0.9rem' }}
          />
        </label>

        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          <button type="submit" disabled={isPending}>
            {isPending ? 'Saving team member…' : 'Add honour team member'}
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
