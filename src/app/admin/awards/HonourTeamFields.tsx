'use client';

import { useState } from 'react';

import { PlayerPicker } from '@/components/PlayerPicker';

const COMMON_POSITIONS = [
  'Back Pocket', 'Full Back', 'Half Back Flank', 'Centre Half Back', 'Wing', 'Centre',
  'Half Forward Flank', 'Centre Half Forward', 'Forward Pocket', 'Full Forward',
  'Ruck', 'Ruck Rover', 'Rover', 'Interchange', 'Emergency', 'Coach',
];

/**
 * The facts that make up one honour/representative-team selection, as form
 * fields (AFLDB-ISSUE-165 §6.7), lifted from the old
 * `/admin/data-editor/HonourTeamForm.tsx`.
 *
 * The team list comes from the ADMIN reader, which includes teams whose every
 * row is currently void — otherwise the one filter that could find those rows
 * again would be the one that had dropped them.
 *
 * A selection's identity is `(team_name, player)`, so both are declared here
 * and both are refused by the correction contract afterwards: a wrong one is
 * a void plus a replacement.
 */
export function HonourTeamFields({
  prefix = '',
  existingTeams,
  defaults,
}: {
  prefix?: string;
  existingTeams: string[];
  defaults?: {
    teamName?: string; position?: string | null; role?: string | null;
    clubNameRaw?: string | null; sortOrder?: number | null; note?: string | null;
  };
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; label: string } | null>(null);
  const [teamSelection, setTeamSelection] = useState<string>(
    defaults?.teamName ?? existingTeams[0] ?? '__custom__',
  );
  const [customTeamName, setCustomTeamName] = useState<string>('');
  const field = (name: string) => `${prefix}${name}`;
  const teamName = teamSelection === '__custom__' ? customTeamName : teamSelection;
  const positionsListId = `${prefix || 'new'}-honour-positions`;

  return (
    <>
      <input type="hidden" name={field('playerId')} value={selectedPlayer ? String(selectedPlayer.id) : ''} />
      <input type="hidden" name={field('teamName')} value={teamName} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Team *
          <select value={teamSelection} onChange={(e) => setTeamSelection(e.target.value)}>
            {existingTeams.map((t) => <option key={t} value={t}>{t}</option>)}
            <option value="__custom__">+ Record a new honour team…</option>
          </select>
        </label>

        {teamSelection === '__custom__' && (
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            New team name *
            <input
              type="text" required value={customTeamName} maxLength={200}
              onChange={(e) => setCustomTeamName(e.target.value)}
              placeholder="e.g. West Australian Team of the Century"
            />
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Selected player (search the database)
          <PlayerPicker label="Select player profile" onSelect={(p) => setSelectedPlayer(p)} />
        </label>
        {selectedPlayer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
            <span>Selected: <strong>{selectedPlayer.label}</strong> (player #{selectedPlayer.id})</span>
            <button type="button" className="btn btn-secondary" onClick={() => setSelectedPlayer(null)}>
              Clear
            </button>
          </div>
        )}
        {!selectedPlayer && (
          <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
            Or record the name as the source spells it
            <input
              type="text" name={field('playerNameRaw')} maxLength={200}
              placeholder="e.g. a historical representative player with no AFLDB player"
            />
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Position
          <input
            type="text" name={field('position')} list={positionsListId} maxLength={100}
            defaultValue={defaults?.position ?? ''} placeholder="e.g. Full Back or Centre"
          />
          <datalist id={positionsListId}>
            {COMMON_POSITIONS.map((pos) => <option key={pos} value={pos} />)}
          </datalist>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Role
          <input
            type="text" name={field('role')} maxLength={100}
            defaultValue={defaults?.role ?? ''} placeholder="e.g. Captain, Vice Captain, Coach"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Club(s)
          <input
            type="text" name={field('clubNameRaw')} maxLength={200}
            defaultValue={defaults?.clubNameRaw ?? ''} placeholder="e.g. Hawthorn"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Lineup order *
          <input
            type="number" name={field('sortOrder')} min={0} max={50} required
            defaultValue={defaults?.sortOrder ?? 1}
          />
        </label>
      </div>

      <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
        Note / citation
        <input
          type="text" name={field('note')} maxLength={1000}
          defaultValue={defaults?.note ?? ''}
          placeholder="e.g. Selected at Full Forward; announced 1996"
        />
      </label>
    </>
  );
}
