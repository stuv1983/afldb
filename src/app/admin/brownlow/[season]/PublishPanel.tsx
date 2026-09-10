'use client';

import { useActionState, useMemo, useState, type ChangeEvent } from 'react';

import { publishSeasonAction, type BrownlowActionState } from '@/app/admin/brownlow/actions';
import { useActionFocusRestore, useRevealFocus } from '@/app/admin/brownlow/focus-restore';
import type { SeasonPolledPlayer } from '@/db/queries/admin-brownlow-ui';
import type { BrownlowSeasonAuthority } from '@/lib/brownlow/entry';

/**
 * AFLDB-ISSUE-155 Phase C2 — the season publication panel (§27.9, §27.26).
 *
 * Publication is the moment a set of finalised matches becomes the season's
 * public Brownlow total. It is Super Admin only, and only when the backend
 * would accept it: every home-and-away match finalised or voided, and no
 * vote row left unattached to a match. This panel shows that readiness and
 * the blockers behind it; the transaction re-checks all of it under the
 * advisory lock and refuses `season_incomplete` with the same counts if the
 * page was stale.
 *
 * An Admin sees the panel rendered inert with the reason, exactly as Phase
 * B renders a disabled lifecycle control (§26.9).
 */
export function PublishPanel({
  season,
  expectedRevision,
  polledPlayers,
  prefilledIneligibleIds,
  canPublish,
  complete,
  unresolved,
  accounted,
  expected,
  authority,
  stale,
}: {
  season: number;
  expectedRevision: number;
  polledPlayers: SeasonPolledPlayer[];
  prefilledIneligibleIds: number[];
  /** The viewer holds `data.brownlow.finalise`. */
  canPublish: boolean;
  complete: boolean;
  unresolved: number;
  accounted: number;
  expected: number;
  authority: BrownlowSeasonAuthority;
  stale: boolean;
}) {
  const [state, submit, pending] = useActionState<BrownlowActionState, FormData>(
    publishSeasonAction,
    {},
  );
  // Confirm publish disables itself while the publish runs, so it shares the
  // §27.27 H-1 focus loss exactly: a `season_incomplete` or `stale` refusal
  // re-enables the button with focus stranded on <body>. Same mechanism, same
  // rule — see `focus-restore.ts`.
  const captureFocusOrigin = useActionFocusRestore(pending);
  // Confirming is a swap, not a disable: the button the operator pressed is
  // unmounted by its own click, so focus has to move forward into the block it
  // revealed rather than back (§27.27 H-2, `focus-restore.ts`).
  const { armReveal, captureRevealed } = useRevealFocus();
  const [confirming, setConfirming] = useState(false);
  const [ineligible, setIneligible] = useState<Set<number>>(new Set(prefilledIneligibleIds));

  const blockers = useMemo(() => {
    const list: string[] = [];
    if (expected === 0) list.push('This season has no home-and-away matches.');
    else if (!complete) {
      list.push(`${accounted} of ${expected} home-and-away matches are finalised or voided.`);
    }
    if (unresolved > 0) {
      list.push(`${unresolved} vote row(s) are not attached to a match.`);
    }
    return list;
  }, [expected, complete, accounted, unresolved]);
  const ready = blockers.length === 0;

  const toggle = (playerId: number) => (event: ChangeEvent<HTMLInputElement>) => {
    setIneligible((previous) => {
      const next = new Set(previous);
      if (event.target.checked) next.add(playerId);
      else next.delete(playerId);
      return next;
    });
  };

  return (
    <section className="section" style={{ borderTop: '2px solid var(--border-strong)', paddingTop: '1rem' }}>
      <h2 style={{ marginTop: 0 }}>Publish the season total</h2>

      <p className="muted" style={{ fontSize: '0.9rem' }}>
        {authority === 'manual' && !stale && 'This season is manually published. '}
        {authority === 'manual' && stale && 'This season is manually published but the match set has changed since — re-publish to reconcile it. '}
        {authority === 'source' && 'The public total is currently source-authoritative. Publishing replaces it with the total derived from the finalised matches. '}
        {authority === 'none' && 'No public total has been published for this season yet. '}
        Publishing derives every polling player&rsquo;s votes, ranks and medal from the finalised
        match set, and nothing else.
      </p>

      {!ready && (
        <div className="notice" role="status" style={{ marginBottom: '0.75rem' }}>
          <strong>Not ready to publish:</strong>
          <ul style={{ margin: '0.35rem 0 0' }}>
            {blockers.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      {polledPlayers.length > 0 && (
        <details style={{ margin: '0.5rem 0 0.75rem' }}>
          <summary style={{ cursor: 'pointer', fontSize: '0.9rem' }}>
            Ineligible players ({ineligible.size} marked)
          </summary>
          <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.4rem 0' }}>
            An ineligible player keeps his place in the overall ranking and his votes, but has no
            rank among the eligible and wins no medal. Prefilled from the current season rows.
          </p>
          <div style={{ display: 'grid', gap: '0.25rem', maxHeight: '16rem', overflowY: 'auto' }}>
            {polledPlayers.map((player) => (
              <label key={player.playerId} style={{ display: 'flex', gap: '0.5rem', fontSize: '0.85rem', alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={ineligible.has(player.playerId)}
                  onChange={toggle(player.playerId)}
                  disabled={!canPublish || pending}
                />
                <span>{player.playerName}</span>
                <span className="muted">{player.votes} vote{player.votes === 1 ? '' : 's'}</span>
              </label>
            ))}
          </div>
        </details>
      )}

      <form action={submit}>
        <input type="hidden" name="season" value={season} />
        <input type="hidden" name="expectedRevision" value={expectedRevision} />
        {[...ineligible].map((id) => (
          <input key={id} type="hidden" name="ineligible" value={id} />
        ))}
        <label style={{ display: 'grid', gap: '0.2rem', fontSize: '0.85rem', maxWidth: '30rem', marginBottom: '0.6rem' }}>
          Note (optional)
          <input type="text" name="note" maxLength={500} placeholder="e.g. Published after the official count" />
        </label>

        {!canPublish ? (
          <>
            <button type="button" className="btn btn-primary" disabled>
              Publish season
            </button>
            <p className="muted" style={{ fontSize: '0.8125rem', margin: '0.35rem 0 0' }}>
              Publishing a season is Super Admin only.
            </p>
          </>
        ) : !confirming ? (
          <button
            ref={captureRevealed}
            type="button"
            className="btn btn-primary"
            disabled={!ready || pending}
            onClick={() => {
              armReveal();
              setConfirming(true);
            }}
          >
            Publish season…
          </button>
        ) : (
          <div
            ref={captureRevealed}
            tabIndex={-1}
            role="group"
            aria-labelledby={`publish-confirm-${season}`}
            style={{ display: 'grid', gap: '0.4rem' }}
          >
            <p id={`publish-confirm-${season}`} className="muted" style={{ fontSize: '0.8125rem', margin: 0 }}>
              This writes {season}&rsquo;s public Brownlow total from {accounted} accounted match
              {accounted === 1 ? '' : 'es'}
              {authority === 'source' && ', replacing the source-published total'}. It can be
              re-published or corrected afterwards; there is no unpublish.
            </p>
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending}
                onClick={(event) => captureFocusOrigin(event.currentTarget)}
              >
                {pending ? 'Publishing…' : 'Confirm publish'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  armReveal();
                  setConfirming(false);
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </form>

      {(state.error || state.message) && (
        <p
          className="notice"
          role={state.error ? 'alert' : 'status'}
          style={{ marginTop: '0.75rem' }}
        >
          {state.error ?? state.message}
          {state.code === 'stale' && (
            <>
              {' '}
              <a href={`/admin/brownlow/${season}`}>Reload this season →</a>
            </>
          )}
        </p>
      )}
    </section>
  );
}
