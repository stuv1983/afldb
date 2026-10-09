# AFLDB-ISSUE-287 — Source-owned draft pick `null_pick_number` confirmation is unreachable

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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
