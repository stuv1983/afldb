# AFLDB-ISSUE-288 — `createCoach` casts an unvalidated `dob` outside its error handling

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin coaches.
- **Key files:** `src/db/queries/admin-coaches.ts` (`createCoach`, `saveCoachMetadata`), `src/app/admin/coaches/actions.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-023; partition note R2c-F04).
- **Classification:** code-proven. The user-visible rendering of a thrown Server Action is framework-defined.

## 1. Summary

`createCoachAction` only trims and slices `dob`. `createCoach` runs its duplicate checks on the public pool with `${input.dob}::date` before the import transaction's try/catch. A non-date such as `2026-02-30`, `31/12/1980` or `x` therefore throws an uncaught PostgreSQL error out of the Server Action, instead of returning `{ error }`. `saveCoachMetadata` performs the same cast inside its try and surfaces the raw PostgreSQL message.

## 2. Evidence

- `src/db/queries/admin-coaches.ts:362-375`, `:409` (casts before the try at `:427-463`) and `:486-545`.
- `src/app/admin/coaches/actions.ts:75` (`optionalText(dob, 10)`).
- Contrast: real-calendar-date validation in `admin-fixtures.ts:299-307` and `admin-club-leadership.ts:218-226`.

## 3. Trigger

A direct POST, a browser without `type=date` support, or a pasted value.

## 4. Expected invariant

A validation refusal sentence. The date is checked as a real calendar day before any SQL.

## 5. Actual behaviour

An uncaught Server Action error. Lenient forms such as `2027-2-3` are accepted and stored in a different form from what was typed.

## 6. First wrong layer

`src/db/queries/admin-coaches.ts:362-375`.

## 7. Impact

Operational only (Super Admin input). No integrity effect.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no date guard in `coaches/validation.ts`, and the pre-transaction queries are not wrapped.

## 10. Existing-issue search

`issues.md` was searched for `createCoach` and `dob::date`. The only hit is ISSUE-159's family list. Classification: **new**.

## 11. Scope

Coach `dob` validation.

## 12. Out of scope

The duplicate-name TOCTOU (recorded as INFO in the review).

## 13. Proposed fix boundary

A real-date check (`YYYY-MM-DD` plus round-trip) in `createCoach` and `saveCoachMetadata` before any SQL.

## 14. Proposed validation

1. DB-free unit test of the date helper.
2. An integration case posting a bad dob.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
