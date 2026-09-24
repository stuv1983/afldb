'use client';

import { useActionState, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { PlayerPicker } from '@/components/PlayerPicker';

import {
  AFL_API_ADJUDICATION_INITIAL_STATE,
  linkAflApiPlayer,
  revokeAflApiPlayerLink,
  type AflApiAdjudicationActionState,
} from './actions';

/**
 * AFLDB-ISSUE-235 (R7, D12). A DEDICATED component — it does NOT import or
 * reuse `ResolveControls`, which seeds name fields for create-and-link
 * (`ResolveControls.tsx:166-167`, `:443-466`). There is no
 * create-and-link, no confirmed-unlinked, no bulk and no suggestion path
 * here (D9, D12).
 *
 * The `PlayerPicker` below is rendered with NO `initialSelected` and its
 * own internal query state starts at `''` — never pre-filled, ranked or
 * filtered from `observedGivenName`/`observedSurname`, even though this
 * component receives them (for read-only display in the evidence blocks
 * above, not for this form). A chosen player is "admin-chosen"; only the
 * provider id, the chosen player id, the note, the acknowledgement flag
 * and the fingerprint are ever sent to the server action — never a name,
 * a score or a status.
 */
export function AflApiAdjudicationForm({
  providerId,
  linkFingerprint,
  revokeFingerprint,
  canLink,
  canRevoke,
  observedSurnameForDisplay,
}: {
  providerId: string;
  /**
   * Two DIFFERENT fingerprints (page.tsx computes each to match what
   * `linkAflApiProvider()`/`revokeAflApiLink()` recompute under lock): link's is
   * provider-side only (no player is chosen at render time); revoke's includes the
   * already-linked player's own facts.
   */
  linkFingerprint: string;
  revokeFingerprint: string | null;
  /** U1 with pending evidence, i.e. link is a meaningful action here. */
  canLink: boolean;
  /** L-H, unconsumed — revoke is offered. */
  canRevoke: boolean;
  /** Display-only (§6): never read by this component's own logic. */
  observedSurnameForDisplay: string | null;
}) {
  const router = useRouter();
  const [picked, setPicked] = useState<{ id: number; label: string } | null>(null);
  const [note, setNote] = useState('');
  const [surnameAcknowledged, setSurnameAcknowledged] = useState(false);
  const [linkState, linkAction, linkPending] = useActionState<AflApiAdjudicationActionState, FormData>(
    linkAflApiPlayer, AFL_API_ADJUDICATION_INITIAL_STATE,
  );
  const [revokeState, revokeAction, revokePending] = useActionState<AflApiAdjudicationActionState, FormData>(
    revokeAflApiPlayerLink, AFL_API_ADJUDICATION_INITIAL_STATE,
  );

  const done = linkState.message ?? revokeState.message;
  useEffect(() => {
    if (done) router.refresh(); // E32: no revalidatePath from the actions themselves.
  }, [done, router]);

  const noteTooShort = note.length > 0 && note.length < 20;
  const noteTooLong = note.length > 2000;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      {done && (
        <p style={{ margin: 0, fontWeight: 600, color: 'var(--accent)' }}>✓ {done}</p>
      )}

      {canLink && (
        <form action={linkAction} style={{ display: 'grid', gap: '0.6rem' }}>
          <input type="hidden" name="providerId" value={providerId} />
          <input type="hidden" name="playerId" value={picked?.id ?? ''} />
          <input type="hidden" name="fingerprint" value={linkFingerprint} />

          <div>
            <PlayerPicker label="Choose the AFLDB player" onSelect={setPicked} />
            {picked && (
              <p className="muted" style={{ fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
                Admin-chosen: {picked.label} — not derived from the provider&rsquo;s observed name.
              </p>
            )}
          </div>

          {observedSurnameForDisplay && (
            <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'start', fontSize: '0.9rem' }}>
              <input type="checkbox" name="surnameAcknowledged" checked={surnameAcknowledged}
                onChange={(e) => setSurnameAcknowledged(e.target.checked)} />
              <span>
                I have checked that this player is the same person as the provider&rsquo;s observed
                surname (&ldquo;{observedSurnameForDisplay}&rdquo;), even though it may not match exactly.
              </span>
            </label>
          )}

          <div>
            <label htmlFor="afl-api-link-note" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
              Note (20–2000 characters) — state the non-name evidence relied on
            </label>
            <textarea
              id="afl-api-link-note" name="note" value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4} maxLength={2000}
              style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border, #ccc)' }}
              required
            />
            {noteTooShort && (
              <p className="badge badge-warn" style={{ display: 'inline-block', marginTop: '0.25rem' }}>
                {20 - note.length} more character(s) needed.
              </p>
            )}
            {noteTooLong && (
              <p className="badge badge-warn" style={{ display: 'inline-block', marginTop: '0.25rem' }}>
                Over the 2000-character limit.
              </p>
            )}
          </div>

          {linkState.error && <p className="badge badge-warn">{linkState.error}</p>}

          <button
            type="submit" className="button"
            disabled={linkPending || !picked || note.length < 20 || note.length > 2000}
          >
            Link this provider
          </button>
        </form>
      )}

      {canRevoke && (
        <form action={revokeAction} style={{ display: 'grid', gap: '0.6rem', borderTop: '1px solid var(--border-subtle)', paddingTop: '0.75rem' }}>
          <input type="hidden" name="providerId" value={providerId} />
          <input type="hidden" name="fingerprint" value={revokeFingerprint ?? ''} />
          <RevokeNote />
          {revokeState.error && <p className="badge badge-warn">{revokeState.error}</p>}
          <button type="submit" className="btn btn-secondary" disabled={revokePending}>
            Revoke this link
          </button>
          <p className="section-note">
            Revoke succeeds only when database and code evidence proves this link has never
            been used to attach canonical or source-derived facts. It refuses on use, and
            also when non-use cannot be proven — there is no override.
          </p>
        </form>
      )}
    </div>
  );
}

function RevokeNote() {
  const [note, setNote] = useState('');
  return (
    <div>
      <label htmlFor="afl-api-revoke-note" style={{ display: 'block', fontSize: '0.85rem', marginBottom: '0.2rem' }}>
        Revoke note (20–2000 characters)
      </label>
      <textarea
        id="afl-api-revoke-note" name="note" value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={3} maxLength={2000} required
        style={{ width: '100%', padding: '0.5rem', borderRadius: '4px', border: '1px solid var(--border, #ccc)' }}
      />
    </div>
  );
}
