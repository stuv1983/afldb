/**
 * AFLDB-ISSUE-155 §27.27 regression — the Brownlow match-vote editor's two
 * client-side state contracts: what a submission carries, and when the
 * operator's in-progress work may be replaced by server truth.
 *
 * Split out of MatchVoteEditor.tsx so both are unit-testable without dragging
 * in the whole client-component/action/db import chain. Both exist because of
 * a real browser-acceptance defect, and both are load-bearing.
 *
 * ---------------------------------------------------------------------------
 * 1. `buildBrownlowVoteFormData` — never read submission data off the DOM.
 *
 * React 19 resets a `<form>`'s fields after a Form Action submitted via a
 * `type="submit"` button completes, including controlled `<select>`s, whose
 * live DOM value silently reverted to whatever was rendered at mount even
 * though React's own `selection` state was untouched. A second submission
 * would then have sent the reverted values instead of what the operator
 * actually chose. The fix: build the FormData here from the caller's live
 * state and hand it straight to the action dispatcher rather than through a
 * native form submission — there is then no DOM form state for anything to
 * fall out of sync with.
 *
 * ---------------------------------------------------------------------------
 * 2. `reconcileVoteEditorState` — reconcile on OBSERVED server movement, not
 *    on effect lifecycle.
 *
 * The editor must adopt server truth when the match actually moves (a
 * successful write bumps `revision`), and must keep the operator's selection
 * and reason when it does not (a refusal — §26.20 deviation 4). The obvious
 * implementation, a `useEffect` whose dependency array is
 * `[model.revision, model.canonicalFingerprint]`, is WRONG, and measurably so:
 *
 *   Next 16's App Router tears down and re-creates the route subtree's effects
 *   after every Server Action round-trip — React state and refs survive
 *   (`useState` initialisers do not re-run), but every `useEffect` cleanup
 *   fires and every `useEffect` body runs again. A dependency array only
 *   suppresses re-runs WITHIN one continuous mount: after an effect re-mount
 *   there is no previous deps array to compare against, so the effect always
 *   runs. The reset therefore fired on every action completion — including a
 *   stale-revision refusal, where nothing on the server had moved — wiping the
 *   selection and reason the operator had just chosen and disabling the very
 *   button they needed to retry with.
 *
 * So the rule below is expressed as data, not as a dependency array: the local
 * state records WHICH server truth it was last reconciled to, and reconciling
 * against that same truth again returns the identical object, so an effect
 * that re-runs for lifecycle reasons is a no-op React bails out of.
 */

export type BrownlowVoteSelection = {
  three: number | null;
  two: number | null;
  one: number | null;
};

export type BrownlowVoteFormInput = {
  matchId: number;
  season: number;
  round: number;
  expectedRevision: number;
  expectedCanonicalFingerprint: string;
  selection: BrownlowVoteSelection;
  reason: string;
};

/** Matches exactly what a native `<form>` submission would have produced, field for field. */
export function buildBrownlowVoteFormData(input: BrownlowVoteFormInput): FormData {
  const fd = new FormData();
  fd.set('matchId', String(input.matchId));
  fd.set('season', String(input.season));
  fd.set('round', String(input.round));
  fd.set('expectedRevision', String(input.expectedRevision));
  fd.set('expectedCanonicalFingerprint', input.expectedCanonicalFingerprint);
  fd.set('three', input.selection.three === null ? '' : String(input.selection.three));
  fd.set('two', input.selection.two === null ? '' : String(input.selection.two));
  fd.set('one', input.selection.one === null ? '' : String(input.selection.one));
  fd.set('reason', input.reason);
  return fd;
}

/** The canonical facts the editor reconciles against. */
export type BrownlowServerTruth = {
  revision: number;
  canonicalFingerprint: string;
  selection: BrownlowVoteSelection;
};

export type VoteEditorLocalState = {
  /**
   * Which server truth this local state was last reconciled to. The revision
   * alone is not enough: a match can be corrected back to the same revision
   * number in a rebuilt fixture, and the fingerprint is what C1 already
   * compare-and-sets against (§27.14).
   */
  reconciledTo: string;
  selection: BrownlowVoteSelection;
  reason: string;
};

function serverTruthKey(server: BrownlowServerTruth): string {
  return `${server.revision}:${server.canonicalFingerprint}`;
}

/** The editor's state at first render: server truth, already reconciled to. */
export function initialVoteEditorState(server: BrownlowServerTruth): VoteEditorLocalState {
  return { reconciledTo: serverTruthKey(server), selection: server.selection, reason: '' };
}

/**
 * Adopt `server` only if the match has moved since `current` was last
 * reconciled. Returns `current` ITSELF (same reference) when it has not, so
 * the caller — and React's own `setState` bail-out — can treat a repeated
 * reconciliation as the no-op it is.
 */
export function reconcileVoteEditorState(
  current: VoteEditorLocalState,
  server: BrownlowServerTruth,
): VoteEditorLocalState {
  const key = serverTruthKey(server);
  if (current.reconciledTo === key) return current;
  return { reconciledTo: key, selection: server.selection, reason: '' };
}
