'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useEffect, useState } from 'react';

import {
  approveSuggestion,
  confirmUnlinked,
  createAndLinkPlayer,
  linkPlayer,
  type PlayerLinkActionState,
} from '@/app/admin/player-links/actions';
import { PlayerPicker } from '@/components/PlayerPicker';

const INITIAL: PlayerLinkActionState = {};

type EvidenceItem = {
  family: string; signal: string; detail: string; points: number;
  /** Reviewer-facing wording, produced server-side from the same signal. */
  label?: string;
};
type ConflictItem = { reason: string; detail: string; label?: string };

/** What kind of source record this is, and how to identify it. */
export type SourceRecordView = { typeLabel: string; lines: string[] };

export type SuggestedMatch = {
  playerId: number;
  playerName: string;
  playerSlug: string;
  /** "Essendon · 1987-1998 · 243 games · 46 goals" */
  playerSummary: string;
  score: number;
  band: string;
  gap: number | null;
  ambiguous: boolean;
  hardConflict: boolean;
  bulkEligible: boolean;
  /** Why unattended approval is allowed, in four plain statements. */
  bulkCriteria: string[];
  evidence: EvidenceItem[];
  conflicts: ConflictItem[];
  algorithmVersion: string;
  alternatives: {
    playerId: number;
    playerName: string;
    playerSummary: string;
    score: number;
    evidence: EvidenceItem[];
    conflicts: ConflictItem[];
  }[];
};

const BAND_LABELS: Record<string, string> = {
  very_high: 'Very high',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No suggestion',
};

/**
 * The score, itemised.
 *
 * A reviewer approving an identity is entitled to see what the number
 * was made of, so every signal that paid and every contradiction found
 * is listed. A bare percentage would be asking for trust rather than
 * offering evidence.
 */
function EvidenceTable({
  evidence, conflicts, total,
}: {
  evidence: EvidenceItem[];
  conflicts: ConflictItem[];
  total?: number;
}) {
  return (
    <div style={{ fontSize: '0.8rem' }}>
      {evidence.map((item) => (
        <div key={item.signal} style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
          <span>
            {item.label ?? item.detail}
            <span className="muted"> — {item.detail}</span>
          </span>
          <span className="nowrap" style={{ fontVariantNumeric: 'tabular-nums' }}>+{item.points}</span>
        </div>
      ))}
      {evidence.length === 0 && <div className="muted">No evidence scored.</div>}
      {conflicts.map((conflict) => (
        <div key={conflict.reason} className="badge badge-warn" style={{ marginTop: '0.35rem', display: 'block' }}>
          {conflict.label ?? conflict.detail}
          <span className="muted"> — {conflict.detail}</span>
        </div>
      ))}
      {total !== undefined && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', gap: '0.75rem',
          borderTop: '1px solid var(--border-subtle)', marginTop: '0.35rem', paddingTop: '0.25rem',
          fontWeight: 600,
        }}>
          <span>Total</span>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{total}</span>
        </div>
      )}
    </div>
  );
}

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
  targets,
  playerName,
  context,
  linkStatus,
  suggestions,
  match,
  sourceRecord,
}: {
  targets: { table: string; id: number; linkStatus?: string }[];
  playerName?: string;
  context?: string;
  linkStatus: string;
  suggestions: { id: number; suggestedName: string; note: string | null }[];
  match?: SuggestedMatch | null;
  sourceRecord?: SourceRecordView | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<'link' | 'create' | 'unlinked'>('link');

  const [approveState, approveAction, approvePending] = useActionState(approveSuggestion, INITIAL);
  const [linkState, linkAction, linkPending] = useActionState(linkPlayer, INITIAL);
  const [createState, createAction, createPending] = useActionState(createAndLinkPlayer, INITIAL);
  const [confirmState, confirmAction, confirmPending] = useActionState(confirmUnlinked, INITIAL);
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);

  const done = approveState.message ?? linkState.message ?? createState.message ?? confirmState.message;
  const warning = approveState.warning ?? linkState.warning ?? createState.warning ?? confirmState.warning;

  const targetsRaw = targets.map(t => `${t.table}:${t.id}:${t.linkStatus ?? ''}`).join(',');

  // Split name for create pre-fill
  const cleanName = (playerName ?? '').trim();
  const parts = cleanName.split(/\s+/);
  const initialGiven = parts.length > 1 ? parts.slice(0, -1).join(' ') : '';
  const initialSurname = parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';

  useEffect(() => {
    if (done && !warning) {
      document.dispatchEvent(new CustomEvent('player-links-resolved'));
      router.refresh();
    }
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

      {/* What this record actually is, in its own terms. */}
      {sourceRecord && (
        <div>
          <div className="muted" style={{ fontSize: '0.72rem', letterSpacing: '0.06em' }}>
            SOURCE RECORD
          </div>
          <strong>{playerName}</strong>
          <div><span className="badge">{sourceRecord.typeLabel}</span></div>
          {sourceRecord.lines.map((line) => (
            <div key={line} className="muted" style={{ fontSize: '0.85rem' }}>{line}</div>
          ))}
        </div>
      )}

      {/* Suggested match, with the evidence behind its score. */}
      {match && (
        <div style={{
          padding: '0.6rem 0.75rem',
          borderRadius: '6px',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-subtle)',
          display: 'grid',
          gap: '0.6rem',
        }}>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem', letterSpacing: '0.06em' }}>
              SUGGESTED AFLDB PLAYER
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', alignItems: 'baseline' }}>
              <strong>{match.playerName}</strong>
              <span className={match.hardConflict ? 'badge badge-warn' : 'badge'}>
                {BAND_LABELS[match.band] ?? match.band} · {match.score}/100
              </span>
            </div>
            {match.playerSummary && (
              <div className="muted" style={{ fontSize: '0.85rem' }}>{match.playerSummary}</div>
            )}
          </div>

          <div>
            <div className="muted" style={{ fontSize: '0.72rem', letterSpacing: '0.06em' }}>
              MATCH EVIDENCE
            </div>
            <EvidenceTable
              evidence={match.evidence}
              conflicts={match.conflicts}
              total={match.score}
            />
          </div>

          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {match.gap === null
              ? 'No credible alternative candidate.'
              : `Next best candidate is ${match.gap} points behind.`}
            {' · '}algorithm {match.algorithmVersion}
          </div>

          {match.bulkEligible && (
            <div>
              <div className="muted" style={{ fontSize: '0.72rem', letterSpacing: '0.06em' }}>
                BULK-READY
              </div>
              {match.bulkCriteria.map((criterion) => (
                <div key={criterion} style={{ fontSize: '0.8rem' }}>✓ {criterion}</div>
              ))}
            </div>
          )}

          {match.hardConflict ? (
            <p className="badge badge-warn" style={{ margin: 0 }}>
              Not approvable as a suggestion: the source evidence contradicts this candidate.
              Link manually below if you can verify it another way.
            </p>
          ) : match.ambiguous ? (
            <p className="badge badge-warn" style={{ margin: 0 }}>
              Needs review: another candidate scores almost as highly. Compare the
              alternatives before approving.
            </p>
          ) : null}

          {!match.hardConflict && targets.length === 1 && (
            <form action={approveAction} style={{ display: 'grid', gap: '0.4rem' }}>
              <input type="hidden" name="targets" value={targetsRaw} />
              <input type="hidden" name="playerId" value={match.playerId} />
              <input
                type="text"
                name="note"
                maxLength={2000}
                placeholder="Verification note (optional)"
                style={{ fontSize: '0.85rem', width: '100%' }}
              />
              <button type="submit" className="btn btn-primary" disabled={approvePending}>
                {approvePending ? 'Approving…' : `Approve match: ${match.playerName}`}
              </button>
              {approveState.error && (
                <span className="badge badge-warn" style={{ fontSize: '0.8rem' }}>{approveState.error}</span>
              )}
            </form>
          )}

          {match.alternatives.length > 0 && (
            <details>
              <summary style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
                ALTERNATIVES ({match.alternatives.length})
              </summary>
              <div style={{ display: 'grid', gap: '0.5rem', marginTop: '0.4rem' }}>
                {match.alternatives.map((alt, index) => (
                  <div key={alt.playerId} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.4rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <span>{index + 2}. {alt.playerName}</span>
                      <span className="muted" style={{ fontSize: '0.8rem' }}>{alt.score}/100</span>
                    </div>
                    {alt.playerSummary && (
                      <div className="muted" style={{ fontSize: '0.8rem' }}>{alt.playerSummary}</div>
                    )}
                    <EvidenceTable evidence={alt.evidence} conflicts={alt.conflicts} />
                    {/* Choosing an alternative is a manual decision and is
                        recorded as one: it is not the model's suggestion. */}
                    <form action={linkAction} style={{ marginTop: '0.3rem' }}>
                      <input type="hidden" name="targets" value={targetsRaw} />
                      <input type="hidden" name="playerId" value={alt.playerId} />
                      <button type="submit" className="btn btn-secondary" disabled={linkPending}
                        style={{ fontSize: '0.78rem', padding: '0.25rem 0.5rem' }}>
                        Link this player instead
                      </button>
                    </form>
                  </div>
                ))}
              </div>
            </details>
          )}
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
          <input type="hidden" name="targets" value={targetsRaw} />
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
          <input type="hidden" name="targets" value={targetsRaw} />

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
          <input type="hidden" name="targets" value={targetsRaw} />
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
