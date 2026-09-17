'use client';

import { useState } from 'react';

import { PlayerPicker } from '@/components/PlayerPicker';

const CATEGORIES = ['Player', 'Coach', 'Umpire', 'Media', 'Administrator', 'Pioneer'];

/**
 * The facts that make up one Hall of Fame induction, as form fields
 * (AFLDB-ISSUE-165 §6.7), lifted from the old
 * `/admin/data-editor/HallOfFameForm.tsx`.
 *
 * ONE DELIBERATE CHANGE FROM THE OLD FORM, and it is the bug §17.8 found:
 * the name is NOT pre-filled from the linked player and is never derived
 * from one. `hall_of_fame` is keyed on `(name, inducted_year)`, so the name
 * IS the record's identity; deriving it from a linked player would file the
 * induction under a different key from the one the administrator asked for,
 * and would make the required correction — re-entering a voided inductee
 * under the SAME name and year while linking the person it should have been
 * — unexpressible.
 *
 * `removedYear` is here, beside the other plain metadata, because that is
 * what it is: a genuine historical fact that a real inductee was later
 * formally removed from the Hall of Fame. It is NOT the void control, which
 * lives on the detail page and says something entirely different (§6.6).
 */
export function HallOfFameFields({
  prefix = '',
  defaults,
}: {
  prefix?: string;
  defaults?: {
    name?: string; category?: string | null; inductedYear?: number | null;
    isLegend?: boolean; legendYear?: number | null; clubNameRaw?: string | null;
    state?: string | null; playingCareer?: string | null; notes?: string | null;
    removedYear?: number | null;
  };
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; label: string } | null>(null);
  const [isLegend, setIsLegend] = useState(defaults?.isLegend ?? false);
  const field = (name: string) => `${prefix}${name}`;

  return (
    <>
      <input type="hidden" name={field('playerId')} value={selectedPlayer ? String(selectedPlayer.id) : ''} />

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Link to a player profile (optional — many inductees are coaches, umpires or
          state-league figures with no AFLDB player)
          <PlayerPicker label="Select player profile" onSelect={(p) => setSelectedPlayer(p)} />
        </label>
        {selectedPlayer && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', flexWrap: 'wrap' }}>
            <span>Linked: <strong>{selectedPlayer.label}</strong> (player #{selectedPlayer.id})</span>
            <button type="button" className="btn btn-secondary" onClick={() => setSelectedPlayer(null)}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Inductee name *
          <input
            type="text" name={field('name')} required maxLength={200}
            defaultValue={defaults?.name ?? ''}
            placeholder="e.g. Daisy Pearce or Ron Barassi"
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            Recorded exactly as typed. With the induction year, this is what identifies the entry.
          </span>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Category *
          <select name={field('category')} defaultValue={defaults?.category ?? 'Player'}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Inducted year *
          <input
            type="number" name={field('inductedYear')} required min={1996} max={2100}
            defaultValue={defaults?.inductedYear ?? new Date().getFullYear()}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Club(s) / association
          <input
            type="text" name={field('clubNameRaw')} maxLength={200}
            defaultValue={defaults?.clubNameRaw ?? ''}
            placeholder="e.g. Melbourne (AFLW) or West Perth"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Home state
          <input
            type="text" name={field('state')} maxLength={60}
            defaultValue={defaults?.state ?? ''} placeholder="e.g. VIC, WA, SA, TAS"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Removed from the Hall in (year)
          <input
            type="number" name={field('removedYear')} min={1996} max={2100}
            defaultValue={defaults?.removedYear ?? ''}
          />
          <span className="muted" style={{ fontSize: '0.78rem' }}>
            A real, rare historical event. The entry stays public and shows the removal.
          </span>
        </label>
      </div>

      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', minHeight: '44px' }}>
          <input
            type="checkbox" name={field('isLegend')} checked={isLegend}
            onChange={(e) => setIsLegend(e.target.checked)}
          />
          <strong>Elevated to Legend status</strong>
        </label>
        {isLegend && (
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
            Legend year
            <input
              type="number" name={field('legendYear')} min={1996} max={2100}
              defaultValue={defaults?.legendYear ?? new Date().getFullYear()}
              style={{ width: '7rem' }}
            />
          </label>
        )}
      </div>

      <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
        Career summary / achievements
        <input
          type="text" name={field('playingCareer')} maxLength={200}
          defaultValue={defaults?.playingCareer ?? ''}
          placeholder="e.g. Melbourne 2017-2022 (55 games, 25 goals, 2022 Premier)"
        />
      </label>

      <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
        Biographical notes
        <textarea
          name={field('notes')} rows={2} maxLength={2000}
          defaultValue={defaults?.notes ?? ''}
          placeholder="Citation and historical notes"
          style={{ resize: 'vertical' }}
        />
      </label>
    </>
  );
}
