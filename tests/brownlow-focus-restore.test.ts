/**
 * AFLDB-ISSUE-155 §27.27 regression — keyboard focus after a refused Brownlow
 * action (acceptance defect H-1).
 *
 * Measured on the live 2089 fixture with a stale second tab, instrumenting the
 * Correct button through one refused round-trip:
 *
 *   focus            active=CORRECT disabled=false
 *   mutate-disabled  active=CORRECT disabled=true
 *   blur             active=BODY    disabled=true
 *   mutate-disabled  active=BODY    disabled=false
 *
 * The button node stayed connected the whole time — no remount. The browser
 * dropped focus because we disabled the element that had it, and on a refusal
 * nothing put it back: a keyboard-only operator was left on <body>, having to
 * tab in from the top of the document to reach the control they needed to
 * retry with, with the refusal message they were meant to read nowhere near
 * the focus ring. On a SUCCESS the same loss is invisible, because `onAdvance`
 * moves focus to the next match.
 *
 * `shouldRestoreFocus` is the whole policy, so it is tested here directly
 * rather than through a browser. The source-contract blocks pin the two
 * wirings no pure function can guard: the capture at click time, and the
 * `onAdvance` success path it must not fight.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  shouldFocusReveal,
  shouldRestoreFocus,
  type FocusRestoreTarget,
} from '@/app/admin/brownlow/focus-restore';

/** The refused Correct button as the settle render leaves it: back, and usable. */
const RESTORED_BUTTON: FocusRestoreTarget = {
  isConnected: true,
  disabled: false,
  hidden: false,
  clientRectCount: 1,
};

describe('shouldRestoreFocus', () => {
  it('restores focus to the control that was refused', () => {
    // The exact H-1 end state: settled, focus on <body>, button re-enabled.
    expect(shouldRestoreFocus({
      pending: false,
      origin: RESTORED_BUTTON,
      focusHolder: 'body',
    })).toBe(true);
  });

  it('waits while the action is still in flight', () => {
    // Mid-round-trip the control is legitimately disabled and there is
    // nothing to restore to yet. Restoring here would be a no-op that
    // spent the one-shot capture and lost the real repair.
    expect(shouldRestoreFocus({
      pending: true,
      origin: { ...RESTORED_BUTTON, disabled: true },
      focusHolder: 'body',
    })).toBe(false);
  });

  it('does nothing when no control started an action', () => {
    expect(shouldRestoreFocus({ pending: false, origin: null, focusHolder: 'body' })).toBe(false);
  });

  it('leaves a successful advance alone', () => {
    // The success path is untouched: `onAdvance` has already moved focus to
    // the next match's first vote selector, so focus is held by something
    // real and this must not drag it backwards.
    expect(shouldRestoreFocus({
      pending: false,
      origin: RESTORED_BUTTON,
      focusHolder: 'other',
    })).toBe(false);
  });

  it('restores when a success advanced nowhere', () => {
    // The last match in a round: `advanceFrom` finds no next card and moves
    // focus nowhere, so the operator would be stranded on <body> after a
    // perfectly good finalise. "Completed without advancing" is the rule,
    // not "refused".
    expect(shouldRestoreFocus({
      pending: false,
      origin: RESTORED_BUTTON,
      focusHolder: 'body',
    })).toBe(true);
  });

  it('never steals focus the operator moved themselves', () => {
    // Clicking or tabbing elsewhere during the round-trip is a decision.
    expect(shouldRestoreFocus({
      pending: false,
      origin: RESTORED_BUTTON,
      focusHolder: 'other',
    })).toBe(false);
  });

  it('handles a document with no active element at all', () => {
    expect(shouldRestoreFocus({
      pending: false,
      origin: RESTORED_BUTTON,
      focusHolder: 'none',
    })).toBe(true);
  });

  describe('never focuses a control that is no longer valid', () => {
    it('declines a disconnected control', () => {
      // A successful finalise replaces its own button with Correct: the node
      // that started the action is gone, and focusing it would either throw
      // focus away silently or jump the page. Let it go.
      expect(shouldRestoreFocus({
        pending: false,
        origin: { ...RESTORED_BUTTON, isConnected: false },
        focusHolder: 'body',
      })).toBe(false);
    });

    it('declines a control the refusal left disabled', () => {
      // e.g. a refusal that also cleared the reason, so Correct is inert.
      // Focusing a disabled button is a no-op in the browser; deciding it
      // here keeps the reason in the code instead of in the DOM's behaviour.
      expect(shouldRestoreFocus({
        pending: false,
        origin: { ...RESTORED_BUTTON, disabled: true },
        focusHolder: 'body',
      })).toBe(false);
    });

    it('declines a hidden control', () => {
      expect(shouldRestoreFocus({
        pending: false,
        origin: { ...RESTORED_BUTTON, hidden: true },
        focusHolder: 'body',
      })).toBe(false);
    });

    it('declines a control that is out of the layout', () => {
      // Still connected, but `display: none` on it or an ancestor.
      expect(shouldRestoreFocus({
        pending: false,
        origin: { ...RESTORED_BUTTON, clientRectCount: 0 },
        focusHolder: 'body',
      })).toBe(false);
    });
  });
});

/**
 * Acceptance defect H-2 — "Publish season…" unmounts itself to render the
 * confirmation block, so the browser drops focus to <body> for a reason
 * `shouldRestoreFocus` deliberately will not repair: the control focus came
 * from is gone on purpose. Focus has to move forward into the revealed block.
 */
describe('shouldFocusReveal', () => {
  /** The confirmation block's container as the swap render leaves it. */
  const REVEALED_BLOCK: FocusRestoreTarget = {
    isConnected: true,
    disabled: false,
    hidden: false,
    clientRectCount: 1,
  };

  it('moves focus into the block the click revealed', () => {
    // The exact H-2 end state: the toggle is gone, focus fell to <body>, and
    // the confirmation block is on screen with nothing holding focus.
    expect(shouldFocusReveal({
      armed: true,
      target: REVEALED_BLOCK,
      focusHolder: 'body',
    })).toBe(true);
  });

  it('handles a document with no active element at all', () => {
    expect(shouldFocusReveal({
      armed: true,
      target: REVEALED_BLOCK,
      focusHolder: 'none',
    })).toBe(true);
  });

  it('does nothing on a re-render nobody armed', () => {
    // The load-bearing guard. The ref is attached in both halves of the swap
    // and this route re-creates the subtree after every Server Action
    // round-trip, so without arming, an unrelated re-render — or simply
    // opening the season page — would yank focus into the panel.
    expect(shouldFocusReveal({
      armed: false,
      target: REVEALED_BLOCK,
      focusHolder: 'body',
    })).toBe(false);
  });

  it('does nothing when nothing was revealed', () => {
    expect(shouldFocusReveal({ armed: true, target: null, focusHolder: 'body' })).toBe(false);
  });

  it('never steals focus the operator moved themselves', () => {
    // Same rule as `shouldRestoreFocus`: something real holds focus, so this
    // is not ours to take.
    expect(shouldFocusReveal({
      armed: true,
      target: REVEALED_BLOCK,
      focusHolder: 'other',
    })).toBe(false);
  });

  describe('never focuses a target that cannot hold focus', () => {
    it('declines a disconnected target', () => {
      expect(shouldFocusReveal({
        armed: true,
        target: { ...REVEALED_BLOCK, isConnected: false },
        focusHolder: 'body',
      })).toBe(false);
    });

    it('declines a disabled target', () => {
      // Cancel swapping back to a "Publish season…" that readiness has since
      // disabled: focusing it would be a no-op that blurs nothing into
      // nothing.
      expect(shouldFocusReveal({
        armed: true,
        target: { ...REVEALED_BLOCK, disabled: true },
        focusHolder: 'body',
      })).toBe(false);
    });

    it('declines a hidden target', () => {
      expect(shouldFocusReveal({
        armed: true,
        target: { ...REVEALED_BLOCK, hidden: true },
        focusHolder: 'body',
      })).toBe(false);
    });

    it('declines a target that is out of the layout', () => {
      expect(shouldFocusReveal({
        armed: true,
        target: { ...REVEALED_BLOCK, clientRectCount: 0 },
        focusHolder: 'body',
      })).toBe(false);
    });
  });
});

function sourceOf(...segments: string[]): string {
  const source = readFileSync(join(process.cwd(), ...segments), 'utf8');
  // The files explain the banned constructs in their own doc comments, on
  // purpose. Assert against code only.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

describe('MatchVoteEditor focus contract', () => {
  const code = sourceOf('src', 'app', 'admin', 'brownlow', '[season]', '[round]', 'MatchVoteEditor.tsx');

  it('captures the initiating control on every action dispatch', () => {
    // The capture must happen at click time: by the time the action settles
    // the browser has already moved focus off the button, so there is nothing
    // left to look up afterwards.
    expect(code).toMatch(/const captureFocusOrigin = useActionFocusRestore\(anyPending\)/);
    expect(code).toMatch(/captureFocusOrigin\(origin\)/);
    for (const runner of ['draft', 'finalise', 'correct', 'void']) {
      expect(code).toMatch(
        new RegExp(`submit\\(runners\\.${runner}, event\\.currentTarget\\)`),
      );
    }
  });

  it('still reports upwards and advances on success', () => {
    // H-1's fix must not disturb the Phase B result/advance contract.
    expect(code).toMatch(/onResult\(next\)/);
    expect(code).toMatch(/if \(next\.ok\) onAdvance\(\)/);
  });

  it('keeps the pending-disable that caused the focus loss', () => {
    // The disable is correct — it is what stops a second write against a
    // revision the first is about to move. The repair is restoring focus,
    // not removing the guard.
    expect(code).toMatch(/const anyPending = Object\.values\(runners\)\.some/);
    expect(code).toMatch(/disabled=\{\s*anyPending/);
  });

  it('does not grow a useEffect of its own', () => {
    // Effects in this route are re-created after every Server Action
    // round-trip, so they live in `focus-restore.ts` where that is reasoned
    // about — and reconciling server truth from an effect stays banned here.
    expect(code).not.toMatch(/\buseEffect\b/);
  });
});

describe('PublishPanel focus contract', () => {
  const code = sourceOf('src', 'app', 'admin', 'brownlow', '[season]', 'PublishPanel.tsx');

  it('disables Confirm publish while the publish is pending', () => {
    expect(code).toMatch(/type="submit"[\s\S]{0,200}?disabled=\{pending\}/);
  });

  it('captures Confirm publish so a refused publish gets its focus back', () => {
    // Same defect, same mechanism: a `stale` or `season_incomplete` refusal
    // re-enables the button with focus stranded on <body>.
    expect(code).toMatch(/const captureFocusOrigin = useActionFocusRestore\(pending\)/);
    expect(code).toMatch(/onClick=\{\(event\) => captureFocusOrigin\(event\.currentTarget\)\}/);
  });

  it('arms the reveal from both halves of the confirm swap', () => {
    // H-2: each of these clicks unmounts the element that has focus, so each
    // must hand the next block permission to take it.
    expect(code).toMatch(/const \{ armReveal, captureRevealed \} = useRevealFocus\(\)/);
    expect(code).toMatch(/armReveal\(\);\s*setConfirming\(true\)/);
    expect(code).toMatch(/armReveal\(\);\s*setConfirming\(false\)/);
  });

  it('attaches the reveal ref to whichever block the swap shows', () => {
    // Both halves: opening focuses the confirmation block, Cancel focuses
    // "Publish season…" again. Only one is ever mounted, so one ref serves
    // both directions.
    expect(code.match(/ref=\{captureRevealed\}/g)).toHaveLength(2);
  });

  it('makes the confirmation block itself the focus target', () => {
    // Not Confirm publish. A button activates on Enter *keydown* and keydown
    // auto-repeats, so focusing it would let one held Enter open the
    // confirmation and immediately confirm it — publishing a season that
    // cannot be unpublished. The container is not activatable, and the
    // consequence sentence labels it so a screen reader announces it first.
    expect(code).toMatch(
      /ref=\{captureRevealed\}\s*tabIndex=\{-1\}\s*role="group"\s*aria-labelledby=\{`publish-confirm-\$\{season\}`\}/,
    );
    expect(code).toMatch(/<p id=\{`publish-confirm-\$\{season\}`\}/);
  });
});
