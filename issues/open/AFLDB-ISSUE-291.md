# AFLDB-ISSUE-291 — Admin player creation persists unvalidated biographical fields

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin player creation (Data Editor; player-links create-and-link).
- **Key files:** `src/app/admin/data-editor/actions.ts` (`createPlayerAction`), `src/app/admin/player-links/actions.ts` (`createAndLinkPlayer`), `src/db/queries/players.ts` (`createPlayerInTransaction`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-026; partition notes R3-F05 and R5b-F05, grouped because both reach the one shared primitive).
- **Classification:** code-proven.

## 1. Summary

Both admin player-creation actions forward `dob`, `dobConfidence`, `heightCm` and `weightKg` without server-side validation. `createPlayerInTransaction` validates none of them either. Out-of-range heights and weights (for example `-5` or `999`) are stored in `players` and in the durable `manual_admin_edit` creation record, which is replayed on every rebuild. A bad enum or impossible date surfaces as a raw PostgreSQL error. The Data Editor's edit surface refuses the same values (`spec.ts`: height 120-230, weight 40-160).

## 2. Evidence

- `src/app/admin/data-editor/actions.ts:68-75`.
- `src/app/admin/player-links/actions.ts:162-169` (the `dobConfidence` cast at `:163`).
- `src/db/queries/players.ts:334-338` (no validation) and `:399-416` (durable record).
- `src/lib/edit/spec.ts:86-87` (ranges) and `:209-255` (`validateFieldValue`).
- `src/db/migrations/002_core_entities.sql:139-140` (`smallint`, no CHECK).
- The principle is stated in `src/lib/match-sheet.ts:94-96`.

## 3. Trigger

`/admin/data-editor` "Add new player", or player-links "Create and link", with height 999 or -5, or a hand-edited `dobConfidence`.

## 4. Expected invariant

Server-side validation with the same bounds as the editor, before the import transaction.

## 5. Actual behaviour

Implausible values become durable. Bad enums and dates produce raw errors.

## 6. First wrong layer

`src/db/queries/players.ts:334-338` (the shared primitive), reached from both actions.

## 7. Impact

Implausible public biographical data that survives rebuilds.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`createPlayerInTransaction` has no range checks, and there is no DB CHECK.

## 10. Existing-issue search

`createPlayerAction`, `createAndLinkPlayer` and `dobConfidence` hit only ISSUE-013 (atomicity). Classification: **new**.

## 11. Scope

Validation in the shared creation primitive.

## 12. Out of scope

Manual draft pick fields (AFLDB-ISSUE-290).

## 13. Proposed fix boundary

Validate in `createPlayerInTransaction` with `validateFieldValue` and the enum membership check, and return typed errors to both actions.

## 14. Proposed validation

DB-free: `createPlayerInTransaction(tx, { displayName: 'X', heightCm: -5 }, actor)` throws before any INSERT.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
