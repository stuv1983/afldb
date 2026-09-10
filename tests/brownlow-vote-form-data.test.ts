/**
 * AFLDB-ISSUE-155 §27.27 regression — the Brownlow vote editor's client-side
 * state contracts, both of which exist because of real browser-acceptance
 * defects found on the disposable 2089 fixture.
 *
 * Two Playwright tabs open the same match. Tab A commits a correction, which
 * bumps the revision. Tab B, still stale, changes its vote selections, types a
 * reason and submits; the server correctly refuses on the expectedRevision
 * compare-and-set. Everything the operator had just chosen must survive that
 * refusal, because the required recovery is to reload — or to resubmit — with
 * the same intent, without retyping it.
 *
 * Two independent bugs broke that, in sequence:
 *
 * 1. THE SUBMITTED VALUES. The editor submitted via `type="submit"` buttons
 *    with `formAction` — a native `<form>` submission, which React 19 resets
 *    once the Form Action settles, including these controlled `<select>`s. A
 *    second submit then silently sent the reverted values. Fixed by
 *    `buildBrownlowVoteFormData`: never read submission data back off the DOM,
 *    build it from live state and hand it straight to the dispatcher.
 *
 * 2. THE DISPLAYED VALUES. With (1) fixed the payload was correct, but the
 *    display still snapped back on a refusal. The reset was a `useEffect`
 *    keyed on `[model.revision, model.canonicalFingerprint]`. Measured in the
 *    browser with mount/unmount/render instrumentation: after EVERY Server
 *    Action round-trip the App Router destroys and re-creates this subtree's
 *    effects — `useState` initialisers do NOT re-run (state and refs survive),
 *    but every effect cleanup fires and every effect body runs again. A
 *    dependency array only suppresses re-runs within one continuous mount, so
 *    the reset fired on refusals too and wiped the selection and the reason,
 *    disabling the very button needed to retry. Fixed by
 *    `reconcileVoteEditorState`: the local state records which server truth it
 *    was last reconciled to, and reconciling against that same truth returns
 *    the identical object — a decision no lifecycle event can disturb.
 *
 * The source-contract block at the bottom pins the two shapes in
 * MatchVoteEditor.tsx that neither pure function can guard on its own.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildBrownlowVoteFormData,
  initialVoteEditorState,
  reconcileVoteEditorState,
  type BrownlowServerTruth,
  type VoteEditorLocalState,
} from '@/app/admin/brownlow/[season]/[round]/vote-form-data';

function fields(fd: FormData): Record<string, string> {
  return Object.fromEntries([...fd.entries()].map(([key, value]) => [key, String(value)]));
}

describe('buildBrownlowVoteFormData', () => {
  it('reflects every changed vote slot exactly, not a prior/default selection', () => {
    // The stale-tab scenario: the operator changed all three slots away
    // from whatever the match's original model.selection held.
    const fd = buildBrownlowVoteFormData({
      matchId: 18296,
      season: 2089,
      round: 1,
      expectedRevision: 2,
      expectedCanonicalFingerprint: 'stale-fingerprint',
      selection: { three: 501, two: 502, one: 503 },
      reason: 'stale tab attempt',
    });
    expect(fields(fd)).toMatchObject({ three: '501', two: '502', one: '503' });
  });

  it('reflects the reason exactly as typed', () => {
    const fd = buildBrownlowVoteFormData({
      matchId: 18296,
      season: 2089,
      round: 1,
      expectedRevision: 2,
      expectedCanonicalFingerprint: 'fp',
      selection: { three: null, two: null, one: null },
      reason: 'ISSUE-155 acceptance: stale tab attempt (should be refused)',
    });
    expect(fields(fd).reason).toBe('ISSUE-155 acceptance: stale tab attempt (should be refused)');
  });

  it('maps a null slot to an empty string, matching parseSlot on the server', () => {
    const fd = buildBrownlowVoteFormData({
      matchId: 1,
      season: 2089,
      round: 1,
      expectedRevision: 0,
      expectedCanonicalFingerprint: '',
      selection: { three: 10, two: null, one: null },
      reason: '',
    });
    expect(fields(fd)).toMatchObject({ three: '10', two: '', one: '' });
  });

  it('a second call with different state produces its own faithful FormData, never the first call\'s values', () => {
    // Models the exact repro: first attempt (matching the stale model),
    // then the operator changes a slot and resubmits. Nothing here may
    // carry over between calls -- there is no module-level or closed-over
    // mutable state for it to leak through.
    const first = buildBrownlowVoteFormData({
      matchId: 18296,
      season: 2089,
      round: 1,
      expectedRevision: 2,
      expectedCanonicalFingerprint: 'fp-2',
      selection: { three: 100, two: 101, one: 102 },
      reason: 'first attempt',
    });
    const second = buildBrownlowVoteFormData({
      matchId: 18296,
      season: 2089,
      round: 1,
      expectedRevision: 2,
      expectedCanonicalFingerprint: 'fp-2',
      selection: { three: 999, two: 101, one: 102 },
      reason: 'second attempt after refusal',
    });
    expect(fields(first).three).toBe('100');
    expect(fields(second).three).toBe('999');
    expect(fields(second).reason).toBe('second attempt after refusal');
  });

  it('stringifies the numeric/identity fields and passes the fingerprint through unchanged', () => {
    const fd = buildBrownlowVoteFormData({
      matchId: 18296,
      season: 2089,
      round: 1,
      expectedRevision: 3,
      expectedCanonicalFingerprint: 'abc123',
      selection: { three: 1, two: 2, one: 3 },
      reason: 'reason text',
    });
    expect(fields(fd)).toMatchObject({
      matchId: '18296',
      season: '2089',
      round: '1',
      expectedRevision: '3',
      expectedCanonicalFingerprint: 'abc123',
    });
  });
});

/** Tab B's view of match 18296 at the moment it went stale. */
const STALE_TRUTH: BrownlowServerTruth = {
  revision: 5,
  canonicalFingerprint: '290f3e7bb1ab0015',
  selection: { three: 16947, two: 16948, one: 16949 },
};

/** What tab A committed, which tab B has not seen. */
const MOVED_TRUTH: BrownlowServerTruth = {
  revision: 6,
  canonicalFingerprint: 'aa1afff0b59d56ab',
  selection: { three: 16950, two: 16951, one: 16952 },
};

describe('reconcileVoteEditorState', () => {
  it('starts already reconciled to the model it was rendered from', () => {
    const start = initialVoteEditorState(STALE_TRUTH);
    expect(start.selection).toEqual(STALE_TRUTH.selection);
    expect(start.reason).toBe('');
    // The very first reconciliation against the same model must be a no-op:
    // otherwise a mount-time reset would compete with the operator's typing.
    expect(reconcileVoteEditorState(start, STALE_TRUTH)).toBe(start);
  });

  it('a refusal preserves every vote slot exactly as chosen', () => {
    const edited = {
      ...initialVoteEditorState(STALE_TRUTH),
      selection: { three: 16936, two: 16937, one: 16946 },
    };
    // The server refused: nothing moved, so the model handed back is the
    // same stale truth the editor already holds.
    const after = reconcileVoteEditorState(edited, STALE_TRUTH);
    expect(after.selection).toEqual({ three: 16936, two: 16937, one: 16946 });
  });

  it('a refusal preserves the reason exactly as typed', () => {
    const edited = { ...initialVoteEditorState(STALE_TRUTH), reason: 'TAB B intended correction' };
    expect(reconcileVoteEditorState(edited, STALE_TRUTH).reason).toBe('TAB B intended correction');
  });

  it('is idempotent, so a re-created effect or an extra render changes nothing', () => {
    // This is the measured failure: the App Router re-creates this subtree's
    // effects after every Server Action round-trip, so the reconciliation runs
    // again with no change in server truth. It must return the SAME object,
    // both so the operator's work survives and so React bails out of the
    // update instead of cascading renders.
    const edited = {
      ...initialVoteEditorState(STALE_TRUTH),
      selection: { three: 16936, two: 16937, one: 16946 },
      reason: 'TAB B intended correction',
    };
    let carried: VoteEditorLocalState = edited;
    for (let i = 0; i < 5; i += 1) {
      const next = reconcileVoteEditorState(carried, STALE_TRUTH);
      expect(next).toBe(carried);
      carried = next;
    }
    expect(carried.selection).toEqual({ three: 16936, two: 16937, one: 16946 });
    expect(carried.reason).toBe('TAB B intended correction');
  });

  it('a second submit after a refusal carries the preserved intent, not the stale canonical', () => {
    const edited = {
      ...initialVoteEditorState(STALE_TRUTH),
      selection: { three: 16936, two: 16937, one: 16946 },
      reason: 'TAB B intended correction',
    };
    const afterRefusal = reconcileVoteEditorState(edited, STALE_TRUTH);
    const resubmit = buildBrownlowVoteFormData({
      matchId: 18296,
      season: 2089,
      round: 1,
      expectedRevision: STALE_TRUTH.revision,
      expectedCanonicalFingerprint: STALE_TRUTH.canonicalFingerprint,
      selection: afterRefusal.selection,
      reason: afterRefusal.reason,
    });
    expect(fields(resubmit)).toMatchObject({
      three: '16936',
      two: '16937',
      one: '16946',
      reason: 'TAB B intended correction',
      // Still stale, so the server refuses again rather than overwriting
      // tab A's commit. Staleness is the server's decision, not the UI's.
      expectedRevision: '5',
      expectedCanonicalFingerprint: '290f3e7bb1ab0015',
    });
  });

  it('a successful commit reconciles to the new canonical truth and drops the reason', () => {
    const edited = {
      ...initialVoteEditorState(STALE_TRUTH),
      selection: { three: 16936, two: 16937, one: 16946 },
      reason: 'this correction has now been committed',
    };
    const after = reconcileVoteEditorState(edited, MOVED_TRUTH);
    expect(after).not.toBe(edited);
    expect(after.selection).toEqual(MOVED_TRUTH.selection);
    expect(after.reason).toBe('');
    // And having adopted it, it stays adopted: no second reset on the next
    // render, so the operator can immediately start the next correction.
    expect(reconcileVoteEditorState(after, MOVED_TRUTH)).toBe(after);
  });

  it('adopts a same-revision change of the canonical rows', () => {
    // The revision alone is not the identity: C1 compare-and-sets on the
    // fingerprint too (§27.14), and a rebuilt fixture can reissue a revision
    // number against different rows.
    const start = initialVoteEditorState(STALE_TRUTH);
    const sameRevisionDifferentRows: BrownlowServerTruth = {
      revision: STALE_TRUTH.revision,
      canonicalFingerprint: 'a-different-fingerprint',
      selection: { three: 1, two: 2, one: 3 },
    };
    const after = reconcileVoteEditorState(start, sameRevisionDifferentRows);
    expect(after.selection).toEqual({ three: 1, two: 2, one: 3 });
  });
});

/**
 * Two shapes in MatchVoteEditor.tsx that no pure function can guard, and that
 * regressed once each during §27.27 acceptance. Both are cheap to assert on
 * the source and expensive to rediscover in a browser.
 */
describe('MatchVoteEditor submission contract', () => {
  const source = readFileSync(
    join(process.cwd(), 'src', 'app', 'admin', 'brownlow', '[season]', '[round]', 'MatchVoteEditor.tsx'),
    'utf8',
  );
  // The file's own doc comments name every banned construct, on purpose, to
  // explain why it is banned. Assert against code only.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('never submits through a native form action', () => {
    // Reintroducing formAction/type="submit" brings back defect (1): React 19
    // resets the form's controlled fields once the Form Action settles.
    expect(code).not.toMatch(/formAction/);
    expect(code).not.toMatch(/type="submit"/);
  });

  it('dispatches every action inside a transition', () => {
    // Defect (3) in the §27.27 notes: an async useActionState action invoked
    // straight from an onClick logs a React error on every submit and leaves
    // isPending unreliable.
    expect(code).toMatch(/import \{[^}]*\bstartTransition\b[^}]*\} from 'react'/);
    expect(code).toMatch(/startTransition\(\(\) => runner\.submit\(formData\)\)/);
    // The dispatchers are reached only through that one helper.
    expect(code).not.toMatch(/runners\.\w+\.submit\(/);
  });

  it('does not reconcile to server truth from an effect', () => {
    // Defect (2): effects here are destroyed and re-created after every
    // Server Action round-trip, so a dependency array is not a guard.
    expect(code).not.toMatch(/\buseEffect\b/);
    expect(code).toMatch(/reconcileVoteEditorState\(stored, model\)/);
  });
});
