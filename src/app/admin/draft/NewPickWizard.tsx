'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';

import { createManualPickAction, createPlayerAndDraftPickAction, searchPlayersForDraftAction } from '@/app/admin/draft/actions';
import { useDraftActionSubmit } from '@/app/admin/draft/submit-helper';

type EventPair = { draftType: string; draftKind: string };
type SearchResult = { id: number; slug: string; title: string; subtitle: string | null; dob: string | null };

/**
 * The new-selection wizard (AFLDB-ISSUE-160 §18, the runbook's "NEW DRAFT
 * PAGE" contract). Draft facts are entered once, in the one form ref below;
 * the operator then EXPLICITLY chooses exactly one of two submit paths --
 * "Add selection" against a found player, or "Create new player" against the
 * revealed sub-form -- there is no default fallthrough between them (§4/§5).
 *
 * Both paths run through Stage 1's own duplicate/conflict contract inside
 * the mutation transaction; nothing selected or typed here is trusted as
 * identity (§4 rule 2). A refusal that carries candidates (J-3/J-5 here,
 * plus J-10..J-13 on the new-player path) is rendered inline with an
 * explicit confirmation checkbox, never bypassed silently.
 */
export function NewPickWizard({
  clubs,
  eventPairs,
  nullPickKinds,
  minDraftYear,
}: {
  clubs: { slug: string; name: string }[];
  eventPairs: EventPair[];
  nullPickKinds: string[];
  minDraftYear: number;
}) {
  const factsRef = useRef<HTMLFormElement>(null);
  const newPlayerRef = useRef<HTMLFormElement>(null);

  const existing = useDraftActionSubmit(createManualPickAction);
  const createNew = useDraftActionSubmit(createPlayerAndDraftPickAction);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, startSearch] = useTransition();
  const [existingConfirmed, setExistingConfirmed] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<SearchResult | null>(null);

  const [newPlayerOpen, setNewPlayerOpen] = useState(false);
  const [createConfirmed, setCreateConfirmed] = useState(false);

  const isPending = existing.isPending || createNew.isPending;

  const runSearch = (value: string) => {
    setQuery(value);
    setSelectedCandidate(null);
    if (value.trim().length < 2) {
      setResults([]);
      return;
    }
    startSearch(async () => {
      setResults(await searchPlayersForDraftAction(value));
    });
  };

  const factsFormData = (): FormData | null => {
    if (!factsRef.current) return null;
    return new FormData(factsRef.current);
  };

  const handleAddExisting = (event: React.MouseEvent<HTMLButtonElement>, candidate: SearchResult) => {
    const formData = factsFormData();
    if (!formData) return;
    formData.set('playerId', String(candidate.id));
    if (existingConfirmed) formData.set('confirmed', '1');
    setSelectedCandidate(candidate);
    existing.submit(formData, event.currentTarget);
  };

  const handleCreatePlayer = (event: React.MouseEvent<HTMLButtonElement>) => {
    const formData = factsFormData();
    if (!formData || !newPlayerRef.current) return;
    for (const [key, value] of new FormData(newPlayerRef.current).entries()) formData.set(key, value);
    if (createConfirmed) formData.set('confirmed', '1');
    createNew.submit(formData, event.currentTarget);
  };

  if (existing.state.ok) {
    return (
      <section className="section">
        <p className="notice" role="status">{existing.state.message}</p>
        <p><Link href="/admin/draft">Back to draft administration</Link></p>
      </section>
    );
  }
  if (createNew.state.ok) {
    return (
      <section className="section">
        <p className="notice" role="status">{createNew.state.message}</p>
        <p><Link href="/admin/draft">Back to draft administration</Link></p>
      </section>
    );
  }

  return (
    <>
      <section className="section">
        <h2>1. Draft facts</h2>
        <form ref={factsRef} onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: '0.6rem', maxWidth: '26rem' }}>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Draft year
            <input type="number" name="draftYear" required min={minDraftYear} max={2100} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Draft event
            <select name="eventPair" required disabled={isPending} defaultValue="">
              <option value="" disabled>— select —</option>
              {eventPairs.map((p) => (
                <option key={`${p.draftType}|${p.draftKind}`} value={`${p.draftType}|${p.draftKind}`}>
                  {p.draftType} ({p.draftKind})
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Pick number
            <input type="number" name="pickNumber" min={1} max={200} disabled={isPending} />
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              Leave blank only for a kind whose selections carry none ({nullPickKinds.join(', ')}) — anything
              else requires a pick note explaining the absence.
            </span>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Pick note (required if the pick number above is blank, for any other kind)
            <textarea name="pickNote" maxLength={500} rows={2} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Club
            <select name="clubSlug" required disabled={isPending} defaultValue="">
              <option value="" disabled>— select —</option>
              {clubs.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Recruited from (original club)
            <input type="text" name="originalClubRaw" maxLength={160} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Draft age
            <input type="number" name="draftAge" min={14} max={50} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Height (cm)
            <input type="number" name="heightCm" min={120} max={230} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Weight (kg)
            <input type="number" name="weightKg" min={40} max={160} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Detail / biography
            <textarea name="detail" maxLength={2000} rows={3} disabled={isPending} />
          </label>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
            Admin note (recorded on the audit row)
            <input type="text" name="note" maxLength={2000} disabled={isPending} />
          </label>
        </form>
      </section>

      <section className="section">
        <h2>2. Search for the player</h2>
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', maxWidth: '24rem' }}>
          Search existing players
          <input
            type="search"
            value={query}
            onChange={(event) => runSearch(event.target.value)}
            placeholder="Player name…"
            disabled={isPending}
          />
        </label>
        {searching && <p className="muted">Searching…</p>}
        {results.length > 0 && (
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: 0, listStyle: 'none' }}>
            {results.map((r) => (
              <li key={r.id} style={{ margin: '0.3rem 0', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <span>
                  <strong>{r.title}</strong>
                  {r.dob && <span className="muted"> · born {r.dob}</span>}
                  {r.subtitle && <span className="muted"> · {r.subtitle}</span>}
                </span>
                <button type="button" className="btn btn-secondary" disabled={isPending} onClick={(e) => handleAddExisting(e, r)}>
                  Add selection for {r.title}
                </button>
              </li>
            ))}
          </ul>
        )}
        {query.trim().length >= 2 && !searching && results.length === 0 && (
          <p className="muted">No existing player matches &ldquo;{query}&rdquo;.</p>
        )}

        {existing.state.needsConfirmation && selectedCandidate && (
          <div className="notice" role="alert">
            <p style={{ margin: '0 0 0.4rem' }}>{existing.state.error}</p>
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={existingConfirmed} onChange={(event) => setExistingConfirmed(event.target.checked)} />
              Confirm and add the selection for {selectedCandidate.title} anyway.
            </label>
            <div style={{ marginTop: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={isPending || !existingConfirmed}
                onClick={(e) => handleAddExisting(e, selectedCandidate)}
              >
                {existing.isPending ? 'Recording…' : 'Confirm and add selection'}
              </button>
            </div>
          </div>
        )}
        {!existing.state.needsConfirmation && existing.state.error && <p className="notice" role="alert">{existing.state.error}</p>}
      </section>

      <section className="section">
        <h2>3. Or, create a new player</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Only for a person the search above genuinely does not find. A likely duplicate with no
          distinguishing date of birth is refused, never guessed — enter a date of birth to
          distinguish a genuine namesake.
        </p>
        {!newPlayerOpen ? (
          <button type="button" className="btn btn-secondary" onClick={() => setNewPlayerOpen(true)} disabled={isPending}>
            Create a new player…
          </button>
        ) : (
          <form ref={newPlayerRef} onSubmit={(event) => event.preventDefault()} style={{ display: 'grid', gap: '0.6rem', maxWidth: '26rem' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
              Display name
              <input type="text" name="displayName" required maxLength={100} disabled={createNew.isPending} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
              Given name
              <input type="text" name="givenName" maxLength={60} disabled={createNew.isPending} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
              Surname
              <input type="text" name="surname" maxLength={60} disabled={createNew.isPending} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
              Date of birth
              <input type="date" name="dob" disabled={createNew.isPending} />
            </label>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem' }}>
              Notes
              <textarea name="notes" maxLength={2000} rows={3} disabled={createNew.isPending} />
            </label>

            {createNew.state.needsConfirmation && (
              <div className="notice" role="alert">
                <p style={{ margin: '0 0 0.4rem' }}>{createNew.state.error}</p>
                {createNew.state.candidates && createNew.state.candidates.length > 0 && (
                  <ul style={{ margin: '0 0 0.4rem' }}>
                    {createNew.state.candidates.map((c) => (
                      <li key={`${c.kind}-${c.id}`}>{c.label} — {c.reason}</li>
                    ))}
                  </ul>
                )}
                <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', fontSize: '0.85rem' }}>
                  <input type="checkbox" checked={createConfirmed} onChange={(event) => setCreateConfirmed(event.target.checked)} />
                  Confirm this is a different person, and create a new, separate player anyway.
                </label>
              </div>
            )}
            {!createNew.state.needsConfirmation && createNew.state.error && (
              <p className="notice" role="alert">{createNew.state.error}</p>
            )}

            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleCreatePlayer}
                disabled={isPending || (createNew.state.needsConfirmation === true && !createConfirmed)}
              >
                {createNew.isPending ? 'Creating…' : 'Create player and record selection'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => setNewPlayerOpen(false)} disabled={isPending}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
}
