'use client';

import { useCallback, useEffect, useRef } from 'react';

/**
 * AFLDB-ISSUE-155 §27.27 regression — put keyboard focus back after an action
 * the server refused.
 *
 * ---------------------------------------------------------------------------
 * The measured defect (acceptance H-1)
 *
 * Every action control in Brownlow administration is disabled while its own
 * action is pending, so the operator cannot fire a second write against a
 * revision the first one is about to move. That is correct, and it has a cost
 * the browser imposes: disabling the element that currently HAS focus makes
 * the browser drop focus to `document.body`. Instrumented on the live 2089
 * fixture, a stale-tab Correct measured:
 *
 *   focus            active=CORRECT disabled=false
 *   mutate-disabled  active=CORRECT disabled=true    <- focus dropped here
 *   blur             active=BODY    disabled=true
 *   mutate-disabled  active=BODY    disabled=false   <- re-enabled, still BODY
 *
 * The same DOM node stays connected throughout: this is not a remount, and
 * nothing puts focus back. On a SUCCESS the loss is invisible because
 * `onAdvance` moves focus to the next match. On a REFUSAL nothing advances, so
 * a keyboard-only operator is left on `<body>` — they must tab in from the top
 * of the document to reach the very control they need to retry with, and the
 * refusal message they are meant to read is nowhere near the focus ring.
 *
 * ---------------------------------------------------------------------------
 * The rule
 *
 * Repair the browser's fallback, and nothing else: when an action settles and
 * focus is sitting on `<body>` because we disabled the control that had it,
 * put focus back on that control.
 *
 * That single rule covers all three outcomes without the caller classifying
 * them, because the guard reads where focus actually IS:
 *
 *   - refused              focus is on <body>, the control is back        -> restore
 *   - success + advance    `onAdvance` already moved focus somewhere real -> decline
 *   - success, no advance  nothing claimed focus (the last match in a
 *                          round), the control is still there             -> restore
 *
 * and it never fights whoever legitimately holds focus, including the
 * operator: if they clicked or tabbed elsewhere during the round-trip, focus
 * is not on `<body>` and this declines.
 *
 * ---------------------------------------------------------------------------
 * Why it lives in its own module
 *
 * It is an effect, and effects in this route are hostile: Next 16's App Router
 * tears down and re-creates the route subtree's effects after every Server
 * Action round-trip, so a dependency array is not a guard here (see
 * `vote-form-data.ts`, which exists for the same reason). This effect is
 * therefore written to be safe under arbitrary re-runs — it is armed only by
 * an explicit `capture` at click time, it is one-shot, and it re-reads the
 * live DOM every time rather than trusting a deps comparison. Keeping it out
 * of `MatchVoteEditor.tsx` also keeps that component's "no `useEffect`"
 * contract (`tests/brownlow-vote-form-data.test.ts`) meaningful: reconciling
 * server truth from an effect stays banned there.
 */

/** The subset of a control the restore decision actually depends on. */
export type FocusRestoreTarget = {
  /** Still in the document: a control the last render removed cannot take focus. */
  isConnected: boolean;
  /** Still refusing focus — the pending disable, or a disable the refusal left in place. */
  disabled?: boolean;
  hidden?: boolean;
  /** `0` once the control is out of the layout (`display: none`, a collapsed parent). */
  clientRectCount: number;
};

/** Who holds focus when the action settles. */
export type FocusHolder =
  /** `document.body` — i.e. the browser dropped it when we disabled the control. */
  | 'body'
  /** Nothing at all (`activeElement === null`). */
  | 'none'
  /** A real control: `onAdvance`, or the operator moving on. Never overrule this. */
  | 'other';

export type FocusRestoreDecision = {
  pending: boolean;
  origin: FocusRestoreTarget | null;
  focusHolder: FocusHolder;
};

/**
 * Whether focus should be put back on the control that started the action.
 *
 * Pure, and the whole of the policy: the hook below only adapts the DOM to it.
 */
export function shouldRestoreFocus(decision: FocusRestoreDecision): boolean {
  // Still in flight: the control is legitimately disabled, and focus has
  // nowhere to go back to yet.
  if (decision.pending) return false;

  // Nothing was captured, so no control started this.
  const origin = decision.origin;
  if (origin === null) return false;

  // Something real holds focus. A successful advance, or the operator moving
  // on mid-round-trip; either way this is not ours to take.
  if (decision.focusHolder === 'other') return false;

  // Never focus a control that is gone, inert, or invisible: the point is to
  // undo a focus loss, not to invent a focus jump. A finalise that succeeds
  // replaces its own button, and that button must simply be let go.
  return canTakeFocus(origin);
}

/**
 * Whether an element can actually hold focus right now.
 *
 * Focusing a disconnected, disabled or unrendered element is a silent no-op in
 * the browser that also blurs whatever held focus before — i.e. it would turn
 * one focus loss into another. Deciding it here keeps the reason in the code.
 */
function canTakeFocus(target: FocusRestoreTarget): boolean {
  if (!target.isConnected) return false;
  if (target.disabled === true) return false;
  if (target.hidden === true) return false;
  return target.clientRectCount > 0;
}

/** Read the live element into the shape `shouldRestoreFocus` decides on. */
function describe(element: HTMLElement): FocusRestoreTarget {
  return {
    isConnected: element.isConnected,
    disabled: 'disabled' in element
      ? Boolean((element as HTMLElement & { disabled?: unknown }).disabled)
      : false,
    hidden: element.hidden,
    clientRectCount: element.getClientRects().length,
  };
}

function focusHolderOf(element: HTMLElement): FocusHolder {
  const doc = element.ownerDocument;
  const active = doc.activeElement;
  if (active === null) return 'none';
  if (active === doc.body || active === doc.documentElement) return 'body';
  return 'other';
}

/**
 * Arm focus restoration for a component whose action controls disable
 * themselves while `pending`.
 *
 * Returns the capture function: call it from the control's own `onClick` with
 * `event.currentTarget`, in the same handler that dispatches the action.
 * Passing `null` disarms.
 */
export function useActionFocusRestore(pending: boolean): (element: HTMLElement | null) => void {
  const originRef = useRef<HTMLElement | null>(null);

  const captureFocusOrigin = (element: HTMLElement | null): void => {
    originRef.current = element;
  };

  // No dependency array, on purpose. The effect must run on the render that
  // clears `pending` and re-enables the control, and in this route a deps
  // array cannot be trusted to make that happen (see the header). It is
  // cheap, it is armed only by `captureFocusOrigin`, and it disarms itself,
  // so running after every render costs one ref read.
  useEffect(() => {
    const origin = originRef.current;
    if (origin === null) return;
    // Stay armed while the action is still in flight -- the settle render is
    // the one that matters.
    if (pending) return;

    // One shot: whatever is decided below, this capture is spent.
    originRef.current = null;

    if (!shouldRestoreFocus({
      pending,
      origin: describe(origin),
      focusHolder: focusHolderOf(origin),
    })) {
      return;
    }
    origin.focus();
  });

  return captureFocusOrigin;
}

/* ===========================================================================
 * Acceptance H-2 — the same focus loss caused by a reveal, not a refusal
 *
 * `PublishPanel` swaps one block for another in place: "Publish season…"
 * unmounts itself and renders the confirmation block (consequence sentence,
 * Confirm publish, Cancel), and Cancel swaps it back. Both directions remove
 * the element that HAS focus, so the browser drops focus to `document.body`
 * exactly as the pending-disable does above — measured on the live 2089
 * fixture, keyboard only:
 *
 *   Enter on "Publish season…"  -> confirmation block rendered, active=BODY
 *
 * `useActionFocusRestore` cannot repair this one: its rule is "put focus back
 * where it was", and here the control focus came from is deliberately gone.
 * The repair is to move focus forward, into the block the click revealed.
 *
 * ---------------------------------------------------------------------------
 * Where focus goes, and why not straight onto Confirm publish
 *
 * The revealed block is focused at its container, which carries `tabIndex={-1}`
 * and is labelled by the consequence sentence. That is deliberate:
 *
 *   - a screen reader announces the "there is no unpublish" sentence, which is
 *     the entire reason the confirmation step exists, before the operator
 *     reaches the control that performs it;
 *   - Tab from there lands on Confirm publish, so it is still one key away;
 *   - a button activates on Enter *keydown*, and keydown auto-repeats. Focusing
 *     Confirm publish would let one held Enter open the confirmation and then
 *     immediately confirm it — a single stuck key publishing a season that
 *     cannot be unpublished. The container is not activatable, so a repeat
 *     lands harmlessly.
 *
 * The reverse swap (Cancel) focuses "Publish season…" itself, which is both the
 * revealed block and an ordinary actionable control.
 * ======================================================================== */

export type RevealFocusDecision = {
  /**
   * The click that performed the swap armed this. A plain re-render — a Server
   * Action settling, the route subtree's effects being re-created — does not,
   * so nothing here can pull focus out of the page on its own.
   */
  armed: boolean;
  /** The revealed block's focus target, or `null` if nothing was revealed. */
  target: FocusRestoreTarget | null;
  focusHolder: FocusHolder;
};

/**
 * Whether focus should be moved into a block a click has just revealed.
 *
 * Pure, and the whole of the policy: the hook below only adapts the DOM to it.
 */
export function shouldFocusReveal(decision: RevealFocusDecision): boolean {
  // Not this render's doing. Arming is the only thing that distinguishes "the
  // operator swapped these blocks" from "React re-attached a ref".
  if (!decision.armed) return false;

  const target = decision.target;
  if (target === null) return false;

  // Someone real already holds focus: the operator moved on during the swap,
  // or something else claimed it. Never overrule that — same rule as
  // `shouldRestoreFocus`, and the reason both refuse to fight the operator.
  if (decision.focusHolder === 'other') return false;

  return canTakeFocus(target);
}

/**
 * Arm focus movement for a component that swaps one block for another in
 * place.
 *
 * `armReveal()` is called from the click that performs the swap;
 * `captureRevealed` is attached as the `ref` of the focus target in *both*
 * blocks — only one is mounted at a time, so the ref fires on whichever the
 * swap just revealed.
 *
 * A ref callback rather than an effect, on purpose: it runs exactly once, when
 * the revealed node is attached, which is precisely the moment focus has to
 * move. It is memoised so React does not detach and re-attach it on unrelated
 * re-renders, and it is one-shot regardless.
 */
export function useRevealFocus(): {
  armReveal: () => void;
  captureRevealed: (element: HTMLElement | null) => void;
} {
  const armedRef = useRef(false);

  const armReveal = (): void => {
    armedRef.current = true;
  };

  const captureRevealed = useCallback((element: HTMLElement | null): void => {
    // The detach half of the swap, or an unmount. Nothing to focus.
    if (element === null) return;
    if (!armedRef.current) return;

    // One shot: whatever is decided below, this arming is spent.
    armedRef.current = false;

    if (!shouldFocusReveal({
      armed: true,
      target: describe(element),
      focusHolder: focusHolderOf(element),
    })) {
      return;
    }
    element.focus();
  }, []);

  return { armReveal, captureRevealed };
}
