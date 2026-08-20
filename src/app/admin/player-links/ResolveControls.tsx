'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import {
  confirmUnlinked,
  createAndLinkPlayer,
  linkPlayer,
  type PlayerLinkActionState,
} from '@/app/admin/player-links/actions';
import { PlayerPicker } from '@/components/PlayerPicker';

const INITIAL: PlayerLinkActionState = {};

/**
 * The resolve panel for one unresolved honours or draft row (see changeLog.md).
 *
 * Three options:
 * 1. Link to an existing AFLDB player found via autocomplete.
 * 2. Create a new player record (with bio info like DOB, height, weight, notes)
 *    and link immediately (ideal for draftees like Riley Onley & Fred Rodriguez).
 * 3. Confirm the person is genuinely not an AFL/VFL player.
 */
export function ResolveControls({
  targetTable,
  targetId,
  playerName,
  context,
  linkStatus,
  suggestions,
}: {
  targetTable: string;
  targetId: number;
  playerName?: string;
  context?: string;
  linkStatus: string;
  suggestions: { id: number; suggestedName: string; note: string | null }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'link' | 'create' | 'unlinked'>('link');

  const [linkState, linkAction, linkPending] = useActionState(linkPlayer, INITIAL);
  const [createState, createAction, createPending] = useActionState(createAndLinkPlayer, INITIAL);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmUnlinked, INITIAL);
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);

  const done = linkState.message ?? createState.message ?? confirmState.message;
  const warning = linkState.warning ?? createState.warning ?? confirmState.warning;

  // Split name for create pre-fill
  const cleanName = (playerName ?? '').trim();
  const parts = cleanName.split(/\s+/);
  const initialGiven = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const initialSurname = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';

  useEffect(() => {
    if (done && !warning) router.refresh();
  }, [done, warning, router]);

  if (done) {
    return (
      <div style={{ padding: '0.75rem', background: 'var(--bg-subtle)', borderRadius: '6px', marginTop: '0.5rem' }}>
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--accent)' }}>✓ {done}</p>
        {warning && (
          <p className="badge badge-warn" style={{ margin: '0.5rem 0 0' }}>{warning}</p>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: '0.75rem', padding: '0.5rem 0' }}>
      {suggestions.length > 0 && (
        <div className="muted" style={{ fontSize: '0.85rem' }}>
          <strong>Reader suggestions:</strong>
          <ul style={{ margin: '0.25rem 0 0 1.1rem' }}>
            {suggestions.map((s) => (
              <li key={s.id}>
                {s.suggestedName}
                {s.note && <> — {s.note}</>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: '0.35rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.5rem' }}>
        <button
          type="button"
          className={`btn ${tab === 'link' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('link')}
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
        >
          Link existing
        </button>
        <button
          type="button"
          className={`btn ${tab === 'create' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('create')}
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
        >
          Create & link new
        </button>
        <button
          type="button"
          className={`btn ${tab === 'unlinked' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setTab('unlinked')}
          style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
        >
          Not a player
        </button>
      </div>

      {/* Tab 1: Link Existing Player */}
      {tab === 'link' && (
        <form action={linkAction} style={{ display: 'grid', gap: '0.6rem' }}>
          <input type="hidden" name="targetTable" value={targetTable} />
          <input type="hidden" name="targetId" value={targetId} />
          <input type="hidden" name="playerId" value={picked?.id ?? ''} />
          <div>
            <PlayerPicker label="Find AFLDB player" onSelect={setPicked} />
          </div>
          <div>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Verification note (optional)
              <input
                type="text"
                name="note"
                maxLength={2000}
                placeholder="e.g. Sourced from club debut records"
                style={{ fontSize: '0.85rem', width: '100%' }}
              />
            </label>
          </div>
          <button type="submit" disabled={linkPending || !picked}>
            {linkPending ? 'Linking…' : 'Link player'}
          </button>
          {linkState.error && (
            <span className="badge badge-warn" style={{ fontSize: '0.8rem' }}>{linkState.error}</span>
          )}
        </form>
      )}

      {/* Tab 2: Create & Link New Player */}
      {tab === 'create' && (
        <form action={createAction} style={{ display: 'grid', gap: '0.6rem' }}>
          <input type="hidden" name="targetTable" value={targetTable} />
          <input type="hidden" name="targetId" value={targetId} />

          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Display name *
              <input
                type="text"
                name="displayName"
                defaultValue={cleanName}
                required
                maxLength={100}
                style={{ fontSize: '0.85rem' }}
              />
            </label>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
                Given name
                <input
                  type="text"
                  name="givenName"
                  defaultValue={initialGiven}
                  maxLength={60}
                  style={{ fontSize: '0.85rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
                Surname
                <input
                  type="text"
                  name="surname"
                  defaultValue={initialSurname}
                  maxLength={60}
                  style={{ fontSize: '0.85rem' }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
                Date of birth (YYYY-MM-DD)
                <input
                  type="date"
                  name="dob"
                  style={{ fontSize: '0.85rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
                DOB confidence
                <select name="dobConfidence" defaultValue="sourced" style={{ fontSize: '0.85rem' }}>
                  <option value="sourced">sourced (verified)</option>
                  <option value="estimated">estimated</option>
                  <option value="derived">derived</option>
                  <option value="unknown">unknown</option>
                </select>
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
                Height (cm)
                <input
                  type="number"
                  name="heightCm"
                  min={120}
                  max={230}
                  placeholder="e.g. 195"
                  style={{ fontSize: '0.85rem' }}
                />
              </label>
              <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
                Weight (kg)
                <input
                  type="number"
                  name="weightKg"
                  min={40}
                  max={160}
                  placeholder="e.g. 88"
                  style={{ fontSize: '0.85rem' }}
                />
              </label>
            </div>

            <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
              Bio details / notes (optional)
              <textarea
                name="notes"
                maxLength={2000}
                rows={2}
                placeholder={context ? `Context: ${context}` : 'e.g. Drafted 2025 rookie draft, original club Murray Bushrangers'}
                style={{ fontSize: '0.85rem', resize: 'vertical' }}
              />
            </label>
          </div>

          <button type="submit" disabled={createPending}>
            {createPending ? 'Creating & linking…' : 'Create player & link record'}
          </button>
          {createState.error && (
            <span className="badge badge-warn" style={{ fontSize: '0.8rem' }}>{createState.error}</span>
          )}
        </form>
      )}

      {/* Tab 3: Confirm Not an AFL/VFL Player */}
      {tab === 'unlinked' && (
        <form action={confirmAction} style={{ display: 'grid', gap: '0.6rem' }}>
          <input type="hidden" name="targetTable" value={targetTable} />
          <input type="hidden" name="targetId" value={targetId} />
          <input type="hidden" name="previousStatus" value={linkStatus} />
          <p className="muted" style={{ fontSize: '0.85rem', margin: 0 }}>
            Mark this record as vetted non-AFL/VFL player (e.g. state-league or pioneer recipient).
          </p>
          <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.8rem' }}>
            Reason / note (optional)
            <input
              type="text"
              name="note"
              maxLength={2000}
              placeholder="e.g. SANFL/WAFL player only"
              style={{ fontSize: '0.85rem', width: '100%' }}
            />
          </label>
          <button type="submit" disabled={confirmPending} className="btn btn-secondary">
            {confirmPending ? 'Saving…' : 'Confirm not an AFL/VFL player'}
          </button>
          {confirmState.error && (
            <span className="badge badge-warn" style={{ fontSize: '0.8rem' }}>{confirmState.error}</span>
          )}
        </form>
      )}
    </div>
  );
}
