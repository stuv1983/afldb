# AFLDB-ISSUE-290 — Manual draft selections accept out-of-range age, height, weight and pick number

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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
