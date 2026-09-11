'use client';

import { useRef } from 'react';

import { retireSourcePickOverrideAction, saveSourcePickFieldsAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

type Values = {
  playerNameRaw: string;
  originalClubRaw: string | null;
  draftAge: number | null;
  heightCm: number | null;
  weightKg: number | null;
  pickNote: string | null;
  detail: string | null;
  pickNumber: number | null;
  clubSlug: string | null;
};

/**
 * The four correctable field groups of a source-owned (DraftGuru) selection
 * (AFLDB-ISSUE-160 §6.1, D-5). Each group is its own mini-form and its own
 * durable override: the club is carried as a SLUG here, never a club id
 * (§6.1) -- the browser cannot know which era-correct identity is active in
 * the draft year, so `saveSourcePickFieldsAction` resolves it server-side.
 */
export function SourceFieldsPanel({
  pickId,
  clubs,
  values,
  activeGroups,
  expectedRevision,
}: {
  pickId: number;
  clubs: { slug: string; name: string }[];
  values: Values;
  activeGroups: Set<string>;
  expectedRevision: string;
}) {
  const playerInfo = useDraftActionSubmit(saveSourcePickFieldsAction);
  const measurements = useDraftActionSubmit(saveSourcePickFieldsAction);
  const notes = useDraftActionSubmit(saveSourcePickFieldsAction);
  const selectionFacts = useDraftActionSubmit(saveSourcePickFieldsAction);
  const retire = useDraftActionSubmit(retireSourcePickOverrideAction);

  const playerInfoRef = useRef<HTMLFormElement>(null);
  const measurementsRef = useRef<HTMLFormElement>(null);
  const notesRef = useRef<HTMLFormElement>(null);
  const selectionFactsRef = useRef<HTMLFormElement>(null);

  const isPending = playerInfo.isPending || measurements.isPending || notes.isPending
    || selectionFacts.isPending || retire.isPending;

  const submitGroup = (
    group: typeof playerInfo,
    formRef: React.RefObject<HTMLFormElement | null>,
    groupKey: string,
    event: React.MouseEvent<HTMLButtonElement>,
  ) => {
    if (!formRef.current) return;
    const formData = new FormData(formRef.current);
    formData.set('pickId', String(pickId));
    formData.set('groupKey', groupKey);
    formData.set('expectedRevision', expectedRevision);
    group.submit(formData, event.currentTarget);
  };

  const handleRetire = (groupKey: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = new FormData();
    formData.set('pickId', String(pickId));
    formData.set('groupKey', groupKey);
    retire.submit(formData, event.currentTarget);
  };

  return (
    <section className="section">
      <h2>Selection details (source-owned)</h2>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Correcting a field here writes a durable override on top of the DraftGuru row: it applies
        immediately and survives the next reload. A field you leave unchanged keeps tracking the
        source across reloads.
      </p>

      <form
        ref={playerInfoRef}
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'grid', gap: '0.5rem', maxWidth: '30rem', marginBottom: '1rem' }}
      >
        <h3 style={{ margin: 0 }}>Player details</h3>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Player name
          <input type="text" name="field:player_name_raw" defaultValue={values.playerNameRaw} maxLength={120} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Recruited from (original club)
          <input type="text" name="field:original_club_raw" defaultValue={values.originalClubRaw ?? ''} maxLength={160} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Draft age
          <input type="number" name="field:draft_age" defaultValue={values.draftAge ?? ''} min={14} max={50} disabled={isPending} />
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={isPending} onClick={(e) => submitGroup(playerInfo, playerInfoRef, 'player_info', e)}>
            {playerInfo.isPending ? 'Saving…' : 'Save player details'}
          </button>
          {activeGroups.has('player_info') && (
            <button type="button" className="btn btn-secondary" disabled={isPending} onClick={(e) => handleRetire('player_info', e)}>
              {retire.isPending ? 'Retiring…' : 'Retire override'}
            </button>
          )}
        </div>
        {playerInfo.state.error && <p className="notice" role="alert">{playerInfo.state.error}</p>}
        {playerInfo.state.ok && playerInfo.state.message && <p className="notice" role="status">{playerInfo.state.message}</p>}
      </form>

      <form
        ref={measurementsRef}
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'grid', gap: '0.5rem', maxWidth: '30rem', marginBottom: '1rem' }}
      >
        <h3 style={{ margin: 0 }}>Height and weight</h3>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Height (cm)
          <input type="number" name="field:height_cm" defaultValue={values.heightCm ?? ''} min={120} max={230} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Weight (kg)
          <input type="number" name="field:weight_kg" defaultValue={values.weightKg ?? ''} min={40} max={160} disabled={isPending} />
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={isPending} onClick={(e) => submitGroup(measurements, measurementsRef, 'measurements', e)}>
            {measurements.isPending ? 'Saving…' : 'Save measurements'}
          </button>
          {activeGroups.has('measurements') && (
            <button type="button" className="btn btn-secondary" disabled={isPending} onClick={(e) => handleRetire('measurements', e)}>
              {retire.isPending ? 'Retiring…' : 'Retire override'}
            </button>
          )}
        </div>
        {measurements.state.error && <p className="notice" role="alert">{measurements.state.error}</p>}
        {measurements.state.ok && measurements.state.message && <p className="notice" role="status">{measurements.state.message}</p>}
      </form>

      <form
        ref={notesRef}
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'grid', gap: '0.5rem', maxWidth: '30rem', marginBottom: '1rem' }}
      >
        <h3 style={{ margin: 0 }}>Notes and details</h3>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Pick note
          <textarea name="field:pick_note" defaultValue={values.pickNote ?? ''} maxLength={500} rows={2} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Detail / biography
          <textarea name="field:detail" defaultValue={values.detail ?? ''} maxLength={2000} rows={3} disabled={isPending} />
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={isPending} onClick={(e) => submitGroup(notes, notesRef, 'notes', e)}>
            {notes.isPending ? 'Saving…' : 'Save notes'}
          </button>
          {activeGroups.has('notes') && (
            <button type="button" className="btn btn-secondary" disabled={isPending} onClick={(e) => handleRetire('notes', e)}>
              {retire.isPending ? 'Retiring…' : 'Retire override'}
            </button>
          )}
        </div>
        {notes.state.error && <p className="notice" role="alert">{notes.state.error}</p>}
        {notes.state.ok && notes.state.message && <p className="notice" role="status">{notes.state.message}</p>}
      </form>

      <form
        ref={selectionFactsRef}
        onSubmit={(event) => event.preventDefault()}
        style={{ display: 'grid', gap: '0.5rem', maxWidth: '30rem' }}
      >
        <h3 style={{ margin: 0 }}>Pick number and club</h3>
        <p className="muted" style={{ fontSize: '0.8rem', margin: 0 }}>
          The club must be the historical identity active in this draft year, and the pick number
          must not already be held by another selection in the same draft and kind.
        </p>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Pick number (leave blank if this kind carries none)
          <input type="number" name="field:pick_number" defaultValue={values.pickNumber ?? ''} min={1} max={200} disabled={isPending} />
        </label>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
          Club
          <select name="field:club_slug" defaultValue={values.clubSlug ?? ''} disabled={isPending}>
            <option value="">— select —</option>
            {clubs.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button type="button" className="btn btn-primary" disabled={isPending} onClick={(e) => submitGroup(selectionFacts, selectionFactsRef, 'selection_facts', e)}>
            {selectionFacts.isPending ? 'Saving…' : 'Save pick number and club'}
          </button>
          {activeGroups.has('selection_facts') && (
            <button type="button" className="btn btn-secondary" disabled={isPending} onClick={(e) => handleRetire('selection_facts', e)}>
              {retire.isPending ? 'Retiring…' : 'Retire override'}
            </button>
          )}
        </div>
        {selectionFacts.state.needsConfirmation && (
          <div className="notice" role="alert">
            <p style={{ margin: '0 0 0.4rem' }}>{selectionFacts.state.error}</p>
          </div>
        )}
        {!selectionFacts.state.needsConfirmation && selectionFacts.state.error && (
          <p className="notice" role="alert">{selectionFacts.state.error}</p>
        )}
        {selectionFacts.state.ok && selectionFacts.state.message && <p className="notice" role="status">{selectionFacts.state.message}</p>}
      </form>
      {retire.state.error && <p className="notice" role="alert">{retire.state.error}</p>}
      {retire.state.ok && retire.state.message && <p className="notice" role="status">{retire.state.message}</p>}
    </section>
  );
}
