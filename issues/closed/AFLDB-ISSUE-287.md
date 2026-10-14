# AFLDB-ISSUE-287 — Source-owned draft pick `null_pick_number` confirmation is unreachable

## 0. Status

- **Status:** **Resolved (2026-10-14, merge-scoped)**, on the push of the documentation-only closure commit (§18). Implemented as `dcc6a61c`, merged and pushed with its records as `8cea1a45`; DB-free validated (§17.1). **Not deployed.**
- **Severity:** Low. **Area:** admin draft UI.
- **Key files:** `src/app/admin/draft/SourceFieldsPanel.tsx`, `src/app/admin/draft/actions.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-022; partition note R2c-F01).
- **Classification:** code-proven.

## 1. Summary

A Super Admin can clear the pick number of a source-owned (DraftGuru) pick whose kind is not a null-pick kind and which has a `pick_note`. The action then returns `needsConfirmation` (J-5 `null_pick_number`). `SourceFieldsPanel` never sends `confirmed` and renders no confirmation control, so every resubmit is identical and the operation can never complete.

## 2. Evidence

- `SourceFieldsPanel.tsx`:
  - `:54-66`: `submitGroup` builds FormData without `confirmed`.
  - `:203-207`: `needsConfirmation` is rendered as a bare notice.
- `actions.ts:110` (`confirmed: formData.get('confirmed') === '1'`) and `:114-116`.
- `src/db/queries/admin-draft.ts:486-497` (J-5) and `:735-743`.
- The other three surfaces implement the step: `AdoptPanel.tsx:62-70, :79`, `ManualPickPanel.tsx:175-183, :192` and `NewPickWizard.tsx:217-234`.

## 3. Trigger

On `/admin/draft/[id]` for a source-owned `national` pick with a saved `pick_note`, clear "Pick number" and Save.

## 4. Expected invariant

The same explicit confirm step as the other draft surfaces.

## 5. Actual behaviour

The contract's own "confirm a genuinely un-numbered selection" path is dead on this surface.

## 6. First wrong layer

`SourceFieldsPanel.tsx:54-66, :203-207`.

## 7. Impact

A legitimate correction is unexpressible. No data effect.

## 8. Reproduction / witness

Not executed. A DB-free render witness is described in the R2c notes (W-R2c-F01).

## 9. Disproof attempts

There is no `confirmed` input in the `selection_facts` form.

## 10. Existing-issue search

ISSUE-160 contains only the surface description (`issues.md:23549`). Classification: **new**.

## 11. Scope

`SourceFieldsPanel`.

## 12. Out of scope

The backend confirm rule, which is correct (`tests/admin-draft-actions.test.ts:259-264`).

## 13. Proposed fix boundary

Add a `confirmed` checkbox, shown when `needsConfirmation` is set, and send `confirmed=1`.

## 14. Proposed validation

DB-free `renderToStaticMarkup` with a mocked submit hook, asserting the control exists.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.

## 17. Implementation record (2026-10-14)

- **Commit:** `dcc6a61c` on `sonnet/issue-287`, base `b3975136`. Files: `src/app/admin/draft/SourceFieldsPanel.tsx`, `src/app/admin/draft/validation.ts`, `tests/admin-draft-actions.test.ts`.
- **Fix.** `SourceFieldsPanel` now renders, inside the existing `needsConfirmation` notice of the "Pick number and club" form, a checkbox "Confirm this selection has no pick number." (the same affordance as `AdoptPanel`), and holds that form's Save button disabled until it is ticked. The submit sets `confirmed=1` only through the new pure helper `sourceFieldsConfirmed` (`validation.ts`): group `selection_facts`, the action's last answer was `needsConfirmation`, and the box is ticked. The tick is cleared after every pick-number save, so it answers one request only and a stale tick can never confirm a later, unasked save. The backend rule (J-5), `actions.ts` and `admin-draft.ts` are unchanged (runbook §12).
- **Not changed.** The other three field groups never ask for confirmation and never send it. `retireSourcePickOverrideAction` ignores `needsConfirmation` as before.
- **Tests (DB-free, `tests/admin-draft-actions.test.ts`, "AFLDB-ISSUE-287").** `renderToStaticMarkup` of `SourceFieldsPanel` with a mocked submit hook: after a `null_pick_number` request the checkbox and its label render and the Save button is `disabled`; with no answer, or an ordinary refusal, no checkbox renders and Save is enabled. `sourceFieldsConfirmed` truth table (only `selection_facts`, only after the request, only when ticked). A source-contract test that the panel calls the helper, sets `confirmed=1` and clears the tick.

## 17.1 Validation (2026-10-14, assistant-run on the operator's explicit authorisation; Windows, DB-free)

- `npx vitest run tests/admin-draft-actions.test.ts tests/draft-linkage-invariants.test.ts`: **68 passed** (the suite alone: 60 passed, 8 new). **Negative control:** with `SourceFieldsPanel.tsx` restored to `HEAD`, 2 of the new cases fail (the render case and the source contract; `D:\tmp\issue287\vitest-old-panel.txt`); the helper truth table passes because the helper is in `validation.ts`. The new panel was restored byte-for-byte afterwards.
- `npx tsc --noEmit` exit 0; ESLint of the three files exit 0; `git diff --check` exit 0. `npm run preflight -- --mode implementation --issue 287` READY on the committed tree (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `D:\tmp\issue287\preflight-impl.txt`; an earlier run on the uncommitted tree was BLOCKED only by the dirty tree, `preflight-impl-dirty.txt`).
- **Not run / limits:** the click path (the `FormData` carrying `confirmed=1`, the reset of the tick) is covered by the helper truth table and a source contract, not by a DOM event, because the repository has no DOM test environment. **No browser check: `VISUAL: UNVERIFIED`** (the page `/admin/draft/[id]` needs a live database and a Super Admin session; a DB-free render shows the markup, not the layout). No integration test, DEV or PROD action.

## 18. Readiness, merge and closure (2026-10-14)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 287`: READY (0 blockers, 3 warnings; `D:\tmp\issue287\preflight-impl.txt`). `npm run merge:ready -- --issue 287` (raw output, unchanged: `D:\tmp\issue287\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths (nine `.agents/skills` files, seven zero-byte stray-named files including `void`, and the literal `$null)`). Existing warnings: no `afldb-merge-readiness` block in this runbook; no unexpected-file classification; database parity not checked. `worktree:bootstrap` was BLOCKED by the same paths (`bootstrap-raw-1.txt`), so the worktree was created with the one `git worktree add -b sonnet/issue-287 <path> b3975136` it would have run, at the verified tip of `main`.
- **Exception.** The owner authorised a fresh exception for this issue, covering only that clean-tree FAIL and the exact recorded 17-path set with full content hashes. Preconditions verified before the merge (`D:\tmp\issue287\exception-precheck.txt`, script alongside; repeated after the push as `exception-postcheck.txt`): primary `HEAD` equals the live remote (`git ls-remote`); no tracked change, nothing staged, none of the 17 tracked; each of the 17 a regular file; the nine non-empty files equal their **full 64-hex SHA-256 and length** to the 13 Oct manifest `D:\tmp\issue313\untracked-blockers-manifest.txt`; the seven zero-byte files are `e3b0c442…b855` by length 0; `$null)` (143 bytes, rewritten by the SessionStart hook each session, see ISSUE-279 §18.1) hashed afresh this session as `D9EDB146…2500` and unchanged across the merge. Earlier exceptions were not reused. All 17 paths were left in place.
- **Merge.** Fix `dcc6a61c` and records `8cea1a45` fast-forwarded onto local `main` (`b3975136..8cea1a45`) and pushed; local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled `8cea1a45` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under the satisfied §14 criterion (DB-free `renderToStaticMarkup` with a mocked submit hook asserting the control exists, §17.1).- **Preserved limits.** Not deployed. `VISUAL: UNVERIFIED`: no browser capture of `/admin/draft/[id]` (needs a live database and a Super Admin session). The click path is covered by a helper truth table and a source contract, not a DOM event. No integration test, DEV/PROD action or existing-data assessment.
