# AFLDB-ISSUE-285 — Award Replace panel cannot give the duplicate confirmation its action requires

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin awards UI.
- **Key files:** `src/app/admin/awards/ReplacePanel.tsx`, `src/app/admin/awards/actions.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-020; partition note R2a-F04).
- **Classification:** code-proven.

## 1. Summary

A replacement that names a player who already holds an active row for the replacement's award and season is refused as `duplicate` unless `confirmDuplicate` is set. The action returns `needsConfirmation: true`, but `ReplacePanel` has no confirmation control: its `onConfirm` sets only `confirmReplace`. The refusal invites a confirmation the UI cannot give.

## 2. Evidence

- `ReplacePanel.tsx`: there is no `confirmDuplicate` anywhere. `:103-107` (onConfirm) and `:141` (needsConfirmation rendered as an error only).
- `actions.ts:297` (`formData.get('confirmDuplicate')`) and `:63-70` (refusalState).
- `admin-awards.ts:1458-1474` (duplicate refusal) and `:1352-1360` (the legitimate two-selection case R-5).
- `AwardWinnerForm.tsx:69-80` has the checkbox.

## 3. Trigger

Moving a state-selection row to the correct season when the player's club-selection row for that season already exists.

## 4. Expected invariant

The same confirmation affordance as the create form.

## 5. Actual behaviour

The legitimate replacement cannot be expressed in the UI. The workaround is to void and then create, which loses the cross-link.

## 6. First wrong layer

`src/app/admin/awards/ReplacePanel.tsx` (no control).

## 7. Impact

A narrow, legitimate workflow is blocked. No data effect.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

The replace path does check the new row for duplicates (`:1633-1637`).

## 10. Existing-issue search

None found. Classification: **new**.

## 11. Scope

`ReplacePanel`.

## 12. Out of scope

The duplicate rule itself.

## 13. Proposed fix boundary

Render a `confirmDuplicate` checkbox when `state.needsConfirmation` is true, and resubmit with it.

## 14. Proposed validation

1. A DB-free component render asserting the control appears.
2. An integration variant of the `admin-awards` :670 case.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
