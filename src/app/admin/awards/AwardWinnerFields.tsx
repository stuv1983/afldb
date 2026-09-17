'use client';

import { useState } from 'react';

import { PlayerPicker } from '@/components/PlayerPicker';
import type { AwardSummary } from '@/db/queries/awards';
import type { ClubSummary } from '@/db/queries/clubs';

/**
 * The facts that make up one award-winner record, as form fields
 * (AFLDB-ISSUE-165 §6.7).
 *
 * Lifted out of the old `/admin/data-editor/AwardWinnerForm.tsx` unchanged in
 * substance so the create form and the REPLACEMENT half of a replacement are
 * the same fields, asked in the same order, with the same wording. A
 * replacement that offered a different form from a creation would be a second
 * place for the same facts to be entered differently.
 *
 * `prefix` is what keeps the two apart in one FormData: the create form posts
 * `awardId`, the replace panel posts `new:awardId`, and `actions.ts` reads
 * either through the same parser.
 *
 * The Brownlow Medal is absent from the award list on purpose: Brownlow
 * results come from the authoritative season-votes dataset, and the mutation
 * contract refuses the slug outright regardless of what this form offers.
 */
export function AwardWinnerFields({
  prefix = '',
  awards,
  clubs,
  defaults,
}: {
  prefix?: string;
  awards: AwardSummary[];
  clubs: ClubSummary[];
  defaults?: {
    awardId?: number; season?: number | null; clubId?: number | null;
    votes?: string | null; position?: string | null;
    isCaptain?: boolean; isViceCaptain?: boolean;
    note?: string | null; sortOrder?: number | null;
  };
}) {
  const [selectedPlayer, setSelectedPlayer] = useState<{ id: number; label: string } | null>(null);
  const field = (name: string) => `${prefix}${name}`;
  const editable = awards.filter((award) => award.slug !== 'brownlow-medal');

  return (
    <>
      <input type="hidden" name={field('playerId')} value={selectedPlayer ? String(selectedPlayer.id) : ''} />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Award *
          <select name={field('awardId')} required defaultValue={defaults?.awardId ?? ''}>
            <option value="">— Select an award —</option>
            {editable.map((a) => (
              <option key={a.id} value={a.id}>{a.name} ({a.category.replace(/_/g, ' ')})</option>
            ))}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Season (year) *
          <input
            type="number" name={field('season')} required min={1897} max={2100}
            defaultValue={defaults?.season ?? new Date().getFullYear()}
          />
        </label>
      </div>

      <div style={{ display: 'grid', gap: '0.5rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Recipient player (search the database)
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
            Or record the recipient name as the source spells it
            <input
              type="text" name={field('playerNameRaw')} maxLength={200}
              placeholder="e.g. a state-league or historical recipient with no AFLDB player"
            />
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.75rem' }}>
        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Club (as it traded that season)
          <select name={field('clubId')} defaultValue={defaults?.clubId ?? ''}>
            <option value="">— No club recorded —</option>
            {clubs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Votes / statistic / score
          <input
            type="text" inputMode="decimal" name={field('votes')}
            defaultValue={defaults?.votes ?? ''}
            placeholder="e.g. 32 (votes) or 68 (goals)"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Position (All-Australian / team)
          <input
            type="text" name={field('position')} maxLength={100}
            defaultValue={defaults?.position ?? ''} placeholder="e.g. Full Forward, Rover"
          />
        </label>

        <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
          Display order
          <input
            type="number" name={field('sortOrder')} min={1} max={100}
            defaultValue={defaults?.sortOrder ?? ''}
          />
        </label>
      </div>

      <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', minHeight: '44px' }}>
          <input type="checkbox" name={field('isCaptain')} defaultChecked={defaults?.isCaptain ?? false} />
          Team captain
        </label>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem', minHeight: '44px' }}>
          <input type="checkbox" name={field('isViceCaptain')} defaultChecked={defaults?.isViceCaptain ?? false} />
          Vice-captain
        </label>
      </div>

      <label style={{ display: 'grid', gap: '0.25rem', fontSize: '0.85rem' }}>
        Note / citation
        <input
          type="text" name={field('note')} maxLength={1000}
          defaultValue={defaults?.note ?? ''}
          placeholder="e.g. Tied with Marcus Bontempelli; official AFL announcement"
        />
      </label>
    </>
  );
}
