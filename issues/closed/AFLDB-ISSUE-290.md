# AFLDB-ISSUE-290 — Manual draft selections accept out-of-range age, height, weight and pick number

## 0. Status

- **Status:** **Resolved (2026-10-14, merge-scoped)**, on the push of the documentation-only closure commit (§18). Implemented as `a48646d8`, merged and pushed with its records as `19969669`; DB-free validated (§17.1). **Not deployed.**
- **Severity:** Low. **Area:** admin draft / validation.
- **Key files:** `src/app/admin/draft/actions.ts`, `src/db/queries/admin-draft.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-025; partition note R2c-F06).
- **Classification:** code-proven.

## 1. Summary

The three manual-pick actions parse `draftAge`, `heightCm`, `weightKg` and `pickNumber` as positive integers only. The values are written verbatim and copied into the durable `selection` payload that replay re-creates. The source-owned path validates the same fields with the `EDITABLE_ENTITIES.draft_picks` ranges (height 120-230, weight 40-160, age 14-50, pick 1-200).

## 2. Evidence

- `src/app/admin/draft/actions.ts:185, :198-200, :241, :246-247, :314, :330-332`.
- `src/db/queries/admin-draft.ts:889-907` (durable payload), `:916-935` (`insertManualPick`), `:1181-1193` (`saveManualPick`) and `:685-690` (the source-owned path validates).
- `src/lib/edit/spec.ts:159-161, :169` (ranges).
- `src/db/migrations/006_draft_relationships.sql:30-32` (`smallint`, no CHECK).

## 3. Trigger

Create or save a manual pick with `heightCm=999`, `draftAge=99` or `pickNumber=9999`.

## 4. Expected invariant

One validation rule for both provenances.

## 5. Actual behaviour

Implausible figures are stored, made durable, and shown on public player and draft pages.

## 6. First wrong layer

`src/app/admin/draft/actions.ts` (the numeric parsers in the three manual actions).

## 7. Impact

Implausible public data that survives rebuilds.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no CHECK in migrations 006/069, and `checkSelectionConflicts` checks only collisions.

## 10. Existing-issue search

None found. Related: AFLDB-ISSUE-291 (player creation; a different primitive). Classification: **new**.

## 11. Scope

The manual draft actions' numeric validation.

## 12. Out of scope

Player biographical fields (AFLDB-ISSUE-291).

## 13. Proposed fix boundary

Apply `validateFieldValue(EDITABLE_ENTITIES.draft_picks.fields[...])` in the three actions, or in `createManualPick` / `saveManualPick`.

## 14. Proposed validation

DB-free unit tests in `tests/admin-draft-actions.test.ts`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.

## 17. Implementation record (2026-10-14)

- **Commit:** `a48646d8` on `sonnet/issue-290`, base `99fcc4f0`. Files: `src/db/queries/admin-draft.ts`, `tests/admin-draft-actions.test.ts`.
- **Fix.** New exported `validateManualPickMeasures` in `src/db/queries/admin-draft.ts` runs `validateFieldValue` over `EDITABLE_ENTITIES.draft_picks.fields` for `pick_number` (1-200), `draft_age` (14-50), `height_cm` (120-230) and `weight_kg` (40-160), so the manual and source-owned paths share one rule and one set of messages. `createManualPick`, `createPlayerAndDraftPick` and `saveManualPick` call it first and return `refuse('validation', ...)` **before `withImportConnection` opens a connection**, so nothing is written, no override is created and no durable `selection` payload carries the figure. The runbook's second placement option (the query functions rather than the three actions) was chosen so that every caller of the mutation contract is covered, and so the check is unit-testable without a session. `src/app/admin/draft/actions.ts` is unchanged: it already returns the refusal's `error` text and does not audit a `validation` refusal.
- **Behaviour note.** An existing manual selection that already holds an out-of-range figure now has to be corrected (or the figure cleared) before the form will save it. No existing data is read or rewritten; no historical assessment was made.
- **Tests (DB-free, `tests/admin-draft-actions.test.ts`).** Boundary acceptance (14/50, 120/230, 40/160, 1/200 and blanks); seven refusals asserting the exact source-owned messages; the three mutations plus the pick-number case refuse a bad figure with reason `validation` and neither `postgres` nor `sql` is touched.

## 17.1 Validation (2026-10-14, assistant-run on the operator's explicit authorisation; Windows, DB-free)

- `npx vitest run tests/admin-draft-actions.test.ts`: **56/56 passed** (12 new cases).
- **Negative control:** with the three call sites disabled, the four action-level cases fail (4 failed | 52 passed); the file was restored byte-for-byte afterwards.
- `npx tsc --noEmit`: exit 0. `npx eslint src/db/queries/admin-draft.ts tests/admin-draft-actions.test.ts`: exit 0. `git diff --check`: exit 0.
- Related DB-free files: `data-overrides-source-contract` 69/69 and `afl-api-match` 213/213 passed. `player-link-mutations` has **one pre-existing failure** (`AFLDB-ISSUE-235 S6 ... I14 owns its actor`, a CRLF source-text assertion on Windows); it fails identically in the unchanged ISSUE-297 worktree at `99fcc4f0`, so it is not caused by this change.
- **Not run:** `tests/integration/admin-draft.test.ts` (needs `afldb_test`; its fixtures use pick numbers 50-78 and in-range figures, so no case is expected to change, but this is read from the source, not executed); any DEV/PROD action; any browser check. The runbook's section 14 asks only for DB-free unit tests.

## 18. Readiness, merge and closure (2026-10-14)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 290`: READY (0 blockers, 3 warnings; `D:\tmp\issue290\preflight-impl.txt`). `npm run merge:ready -- --issue 290` (raw output, unchanged: `D:\tmp\issue290\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's 16 untracked paths (nine `.agents/skills` files and six stray-named files, the 15 previously recorded, plus the zero-byte `void`). Existing warnings: no `afldb-merge-readiness` block in this runbook; no unexpected-file classification; database parity not checked.
- **Exception.** The owner authorised a fresh exception for this issue only, valid for the set of exactly those 16 paths with no tracked changes, unchanged ISSUE-274/ISSUE-276 blobs, and `void` a regular, zero-byte, untracked, unstaged file. All four were verified before the merge (`D:\tmp\issue290\exception-precheck.txt`, 19:08 AEDT): exact 16-path set; no tracked primary change, nothing staged; `void` regular, length 0, SHA-256 `e3b0c442…b855`, untracked; all 15 listed blobs equal at `839e084c` (ISSUE-297's exception base), at `99fcc4f0` (this base) and on the branch. ISSUE-297's exception was not reused. All 16 paths were left in place; no deletion was attempted.
- **Merge.** `a48646d8` (fix) and `19969669` (records) fast-forwarded onto local `main` (`99fcc4f0..19969669`) and pushed; `git ls-remote origin refs/heads/main` equalled the local tip.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under the satisfied §14 criterion (DB-free unit tests in `tests/admin-draft-actions.test.ts`, §17.1).
- **Preserved limits.** Not deployed. `tests/integration/admin-draft.test.ts`, any browser check and any DEV/PROD action were not run. An existing manual selection holding an out-of-range figure must be corrected before it can be saved again. No historical data was assessed or repaired.
