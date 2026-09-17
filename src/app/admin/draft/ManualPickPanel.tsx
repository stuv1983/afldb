'use client';

import { useRef, useState, useTransition } from 'react';

import { searchPlayersForDraftAction, saveManualPickAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

type EventPair = { draftType: string; draftKind: string };
type SearchResult = { id: number; slug: string; title: string; subtitle: string | null; dob: string | null };

type Values = {
  draftYear: number;
  draftType: string;
  draftKind: string;
  pickNumber: number | null;
  clubSlug: string | null;
  playerNameRaw: string;
  originalClubRaw: string | null;
  draftAge: number | null;
  heightCm: number | null;
  weightKg: number | null;
  pickNote: string | null;
  detail: string | null;
};

/**
 * Edit a manual selection, whole row (AFLDB-ISSUE-160 §6.4). Unlike a
 * source-owned correction this rewrites the single durable `selection`
 * override rather than accumulating a delta -- the override IS the row for a
 * manual selection.
 *
 * Relinking to a different player is allowed here (the search box below):
 * `saveManualPickAction` writes TWO audit rows when the player id actually
 * changes, one against the player who loses the selection and one against
 * the player who gains it, so neither person's history is erased.
 */
export function ManualPickPanel({
  pickId,
  playerId,
  clubs,
  eventPairs,
  values,
  expectedRevision,
}: {
  pickId: number;
  playerId: number | null;
  clubs: { slug: string; name: string }[];
  eventPairs: readonly EventPair[];
  values: Values;
  expectedRevision: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const save = useDraftActionSubmit(saveManualPickAction);
  const [confirmed, setConfirmed] = useState(false);
  const [selectedPlayerId, setSelectedPlayerId] = useState<number | null>(playerId);
  const [relinkQuery, setRelinkQuery] = useState('');
  const [relinkResults, setRelinkResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();

  const runSearch = (value: string) => {
    setRelinkQuery(value);
    if (value.trim().length < 2) {
      setRelinkResults([]);
      return;
    }
    startSearch(async () => {
      setRelinkResults(await searchPlayersForDraftAction(value));
    });
  };

  const handleSave = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (!formRef.current || selectedPlayerId === null) return;
    const formData = new FormData(formRef.current);
    formData.set('pickId', String(pickId));
    formData.set('playerId', String(selectedPlayerId));
    formData.set('expectedRevision', expectedRevision);
    if (confirmed) formData.set('confirmed', '1');
    save.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Selection details (manual)</h2>
      <form
        ref={formRef}
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'grid', gap: '0.6rem', maxWidth: '30rem' }}
      >
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Draft year
          <input type="number" name="draftYear" defaultValue={values.draftYear} min={1981} max={2100} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Draft event
          <select name="eventPair" defaultValue={`${values.draftType}|${values.draftKind}`} disabled={save.isPending}>
            {eventPairs.map((p) => (
              <option key={`${p.draftType}|${p.draftKind}`} value={`${p.draftType}|${p.draftKind}`}>
                {p.draftType} ({p.draftKind})
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Pick number (leave blank if this kind carries none)
          <input type="number" name="pickNumber" defaultValue={values.pickNumber ?? ''} min={1} max={200} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Club
          <select name="clubSlug" defaultValue={values.clubSlug ?? ''} disabled={save.isPending}>
            <option value="">— select —</option>
            {clubs.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Player name (as recorded for this selection)
          <input type="text" name="playerNameRaw" defaultValue={values.playerNameRaw} maxLength={120} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Recruited from (original club)
          <input type="text" name="originalClubRaw" defaultValue={values.originalClubRaw ?? ''} maxLength={160} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Draft age
          <input type="number" name="draftAge" defaultValue={values.draftAge ?? ''} min={14} max={50} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Height (cm)
          <input type="number" name="heightCm" defaultValue={values.heightCm ?? ''} min={120} max={230} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Weight (kg)
          <input type="number" name="weightKg" defaultValue={values.weightKg ?? ''} min={40} max={160} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Pick note
          <textarea name="pickNote" defaultValue={values.pickNote ?? ''} maxLength={500} rows={2} disabled={save.isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Detail / biography
          <textarea name="detail" defaultValue={values.detail ?? ''} maxLength={2000} rows={3} disabled={save.isPending} />
        </label>

        <div>
          <p className="muted" style={{ fontSize: '0.85rem', margin: '0 0 0.3rem' }}>
            Linked player: <strong>{relinkQuery ? `#${selectedPlayerId}` : `#${selectedPlayerId} (current)`}</strong>.
            Search to relink this selection to a different player.
          </p>
          <input
            type="search"
            value={relinkQuery}
            onChange={(event) => runSearch(event.target.value)}
            placeholder="Search for a different player…"
            disabled={save.isPending}
            style={{ maxWidth: '24rem' }}
          />
          {searching && <p className="muted">Searching…</p>}
          {relinkResults.length > 0 && (
            <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.2rem' }}>
              {relinkResults.map((r) => (
                <li key={r.id} style={{ margin: '0.2rem 0' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={save.isPending}
                    onClick={() => { setSelectedPlayerId(r.id); setRelinkResults([]); setRelinkQuery(r.title); }}
                  >
                    Use {r.title}{r.dob ? ` (born ${r.dob})` : ''}{r.subtitle ? ` — ${r.subtitle}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {save.state.needsConfirmation && (
          <div className="notice" role="alert">
            <p style={{ margin: '0 0 0.4rem' }}>{save.state.error}</p>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
              Confirm and save anyway.
            </label>
          </div>
        )}
        {!save.state.needsConfirmation && save.state.error && <p className="notice" role="alert">{save.state.error}</p>}
        {save.state.ok && save.state.message && <p className="notice" role="status">{save.state.message}</p>}

        <div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSave}
            disabled={save.isPending || selectedPlayerId === null || (save.state.needsConfirmation === true && !confirmed)}
          >
            {save.isPending ? 'Saving…' : 'Save selection'}
          </button>
        </div>
      </form>
    </section>
  );
}
