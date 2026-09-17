'use client';

import Link from 'next/link';
import { useState } from 'react';

import { addSeasonListMemberAction } from '@/app/admin/season-lists/actions';
import { useSeasonListActionSubmit } from '@/app/admin/season-lists/submit-helper';
import { PlayerPicker } from '@/components/PlayerPicker';

/**
 * Add an EXISTING player to a club's list (AFLDB-ISSUE-161 §12.1). Search
 * uses the same `PlayerPicker` (`/api/search/autocomplete?scope=players`)
 * every other admin surface does -- ranking only, never identity; the
 * server re-reads the player and resolves their durable identity inside the
 * mutation transaction (§4 rule 2 of the ISSUE-160 precedent this reuses).
 *
 * No player-creation control exists here (D-5): a player who does not yet
 * exist is created through `/admin/draft/new` or the data editor, then
 * added here like any other existing player. `initialSelected` carries the
 * ISSUE-160 handoff's `?add=<playerId>` pre-fill (§14) -- the add is still
 * this explicit Super Admin confirmation, never automatic.
 */
export function AddPlayerPanel({
  season, clubSlug, initialSelected,
}: {
  season: number;
  clubSlug: string;
  initialSelected: { id: number; label: string } | null;
}) {
  const add = useSeasonListActionSubmit(addSeasonListMemberAction, {});
  const [selected, setSelected] = useState<{ id: number; label: string } | null>(initialSelected);
  const [note, setNote] = useState('');

  const handleAdd = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!selected) return;
    const formData = new FormData();
    formData.set('season', String(season));
    formData.set('clubSlug', clubSlug);
    formData.set('playerId', String(selected.id));
    if (note.trim()) formData.set('note', note.trim());
    add.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Add a player</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Search AFLDB&rsquo;s player records and choose by identity, never by name alone. A player
        already on another club&rsquo;s {season} list is refused here — transfer them instead. A
        person who does not exist in AFLDB yet is created through{' '}
        <Link href="/admin/draft/new">draft administration</Link>, then added here.
      </p>
      <div style={{ display: 'grid', gap: '0.6rem', maxWidth: '26rem' }}>
        <PlayerPicker label="Search players…" onSelect={setSelected} initialSelected={selected} />
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Note (optional, recorded on the audit row)
          <input
            type="text"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            disabled={add.isPending}
          />
        </label>
        {add.state.error && <p className="notice" role="alert">{add.state.error}</p>}
        {add.state.ok && add.state.message && <p className="notice" role="status">{add.state.message}</p>}
        <div>
          <button type="button" className="btn btn-primary" onClick={handleAdd} disabled={add.isPending || !selected}>
            {add.isPending ? 'Adding…' : 'Add to the list'}
          </button>
        </div>
      </div>
    </section>
  );
}
