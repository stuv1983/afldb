# AFLDB-ISSUE-283 — The administrative note is not recorded on creation audit rows

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin awards and special records / audit trail.
- **Key files:** `src/app/admin/awards/actions.ts`, `src/db/queries/admin-awards.ts`, `src/db/queries/admin-special-records.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-018; partition notes R2a-F02 and R2c-F03, grouped: the same field is dropped on the creation half of each write).
- **Classification:** code-proven.

## 1. Summary

The awards create forms offer an "Administrative note (kept with the audit entry)", and the replace panels promise the note is "kept with both audit entries". In practice:

- the three award create actions never read `adminNote`, and the creation `data_edits.note` is written from the row's public citation or biography field;
- in every replace (three award families and two special-record families) the admin note reaches only the voided or suppressed row's audit entry; the created row's entry carries the row's own notes.

## 2. Evidence

- Award create actions ignore `adminNote`: `src/app/admin/awards/actions.ts:302-319`, `:496-513`, `:668-685`.
- Creation audit writes the row note: `admin-awards.ts:1538` (`note: input.note`), `:2092` (`note: input.notes`, the inductee biography) and `:2627`.
- Replace inserts spread `...input.replacement` without the admin note: `admin-awards.ts:1639-1644`, `:2171-2176`, `:2696-2701`; `admin-special-records.ts:1633-1638`, `:2192-2197`. The creation audit uses `input.notes` (`admin-special-records.ts:1546`, `:2125`).
- Promises in the UI: `AwardWinnerForm.tsx:82-85`, `HallOfFameForm.tsx:54-57`, `HonourTeamForm.tsx:56-59`, `ReplacePanel.tsx:196-199`, `SpecialRecordReplacePanel.tsx:174-177`.

## 3. Trigger

Create an award, Hall of Fame or honour-team record with an administrative note. Or replace any of the five record families with one.

## 4. Expected invariant

The admin note is recorded on the creation audit entry, and on both halves of a replacement, as correct/void/reinstate already do (`awards/actions.ts:202, :225, :246`).

## 5. Actual behaviour

The note is dropped, or recorded on one half only. `data_edits.note` holds public record text instead.

## 6. First wrong layer

`awards/actions.ts:302-319, :496-513, :668-685` (create), and the replace call sites listed above.

## 7. Impact

The audit trail is incomplete or wrong for every manual creation and for half of every replacement. The mutations themselves are correct.

## 8. Reproduction / witness

Not executed (DB-backed).

## 9. Disproof attempts

- No other reader of `adminNote` exists.
- `recordDataEdit` has a single `note` channel.

## 10. Existing-issue search

The ISSUE-165 and ISSUE-167 runbooks and `issues.md` were searched for `adminNote`. The only hit is club leadership, which is unrelated. Classification: **new**.

## 11. Scope

The note plumbing in the create and replace paths.

## 12. Out of scope

Special-record create, which deliberately has no admin-note field.

## 13. Proposed fix boundary

Carry a distinct `adminNote` into the insert functions and use it for `recordDataEdit.note`, keeping the row note in `newValues`.

## 14. Proposed validation

Integration: create and replace with a note, then assert `data_edits.note` for the new row.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation, grouped with AFLDB-ISSUE-282.
