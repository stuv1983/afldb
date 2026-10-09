# AFLDB-ISSUE-311 — Activity audit after a committed player-link mutation is unwrapped or silent

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin player links / activity audit.
- **Key files:** `src/app/admin/player-links/actions.ts`, `src/app/admin/player-links/afl-api/actions.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-046; partition note R5b-F04).
- **Classification:** code-proven.

## 1. Summary

After a committed mutation, the activity-audit handling is inconsistent across the player-link actions:
- `confirmUnlinked` and `reviewSuggestion` call `audit()` with no try/catch, so an `auth_audit_log` failure after the commit throws a generic Server Action error;
- the AFL API actions catch the failure but only `console.error`, returning plain success;
- the sibling actions wrap it and return `ACTIVITY_AUDIT_WARNING`, as the ISSUE-013 follow-up intended.

## 2. Evidence

- `src/app/admin/player-links/actions.ts:116-117, :140-141` (unwrapped), against `:85-91, :197-207, :280-286, :351-357` (wrapped).
- `src/app/admin/player-links/afl-api/actions.ts:48-53, :75-79` (silent).
- `src/lib/auth/session.ts:404-430` (`audit()` propagates the error).
- `issues.md:820-821` (the ISSUE-013 follow-up).

## 3. Trigger

The auth pool fails right after `confirmLockedUnlinked`, or after `linkAflApiProvider` commits.

## 4. Expected invariant

The committed mutation is reported with the audit warning.

## 5. Actual behaviour

- Unwrapped actions: a thrown error, the loop stops, nothing is revalidated, and a resubmit is refused.
- AFL API actions: no `auth_audit_log` row and no operator signal. The in-transaction ledger row is intact.

## 6. First wrong layer

`actions.ts:116-117, :140-141`; `afl-api/actions.ts:48-53, :75-79`.

## 7. Impact

Operational confusion, and a silent activity-audit gap. No data loss.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

`audit()` does not swallow errors.

## 10. Existing-issue search

The ISSUE-013 follow-up. Classification: **new**, a partial regression of that intent on newer actions.

## 11. Scope

The four call sites.

## 12. Out of scope

`auditInTransaction` (deliberately throwing).

## 13. Proposed fix boundary

Wrap the two `audit()` calls as `linkPlayer` does, and return the warning from the AFL API actions.

## 14. Proposed validation

DB-free unit test with `audit` mocked to reject.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (with AFLDB-ISSUE-309).
