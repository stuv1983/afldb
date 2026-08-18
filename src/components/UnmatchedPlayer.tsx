'use client';

import { useActionState, useState } from 'react';

import {
  submitPlayerLinkSuggestion,
  type LinkSuggestionState,
} from '@/app/player-link-suggestion-action';

const INITIAL: LinkSuggestionState = { status: 'idle' };

/**
 * The "Unmatched" badge, plus the way a reader turns it into a tip.
 *
 * One component instead of the eight hand-copied badge spans it
 * replaces, so every page that shows an unlinked name also offers the
 * same "I know who this is" form. The badge itself is unchanged; the
 * form is disclosed on demand and posts to an anonymous, rate-limited
 * server action, from which a super admin reviews every tip by hand.
 *
 * Without JavaScript the badge still renders (this file's static
 * fallback is the badge markup itself); only the disclosure needs JS,
 * so the no-JS path loses the form, not the information.
 */
export function UnmatchedPlayer({
  targetTable,
  targetId,
}: {
  targetTable: string;
  targetId: number;
}) {
  const [state, formAction, pending] = useActionState(submitPlayerLinkSuggestion, INITIAL);
  const [open, setOpen] = useState(false);

  if (state.status === 'thanks') {
    return (
      <span className="badge badge-warn" title="Thanks — a reviewer will check your suggestion.">
        Unmatched — thanks!
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        className="badge badge-warn"
        title="Not matched to an AFLDB player — click if you know who this is"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{ cursor: 'pointer', border: 'none', font: 'inherit' }}
      >
        Unmatched
      </button>
      {open && (
        <form
          action={formAction}
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: '0.4rem',
            marginTop: '0.4rem',
            fontSize: '0.85rem',
          }}
        >
          <input type="hidden" name="targetTable" value={targetTable} />
          <input type="hidden" name="targetId" value={targetId} />
          <label className="muted" style={{ flexBasis: '100%' }}>
            Know who this is? AFLDB couldn’t identify them with confidence.
          </label>
          <input
            type="text"
            name="suggestedName"
            required
            maxLength={120}
            placeholder="Who is this player?"
            style={{ fontSize: '0.85rem' }}
          />
          <input
            type="text"
            name="note"
            maxLength={1000}
            placeholder="Source or note (optional)"
            style={{ fontSize: '0.85rem' }}
          />
          <button type="submit" disabled={pending} style={{ fontSize: '0.85rem' }}>
            Send
          </button>
          {state.status === 'error' && state.message && (
            <span className="muted" style={{ flexBasis: '100%', fontSize: '0.8rem' }}>
              {state.message}
            </span>
          )}
        </form>
      )}
    </>
  );
}
