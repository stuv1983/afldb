# AFLDB-ISSUE-311 — Activity audit after a committed player-link mutation is unwrapped or silent

## 0. Status

- **Status:** Open (2026-10-08). Implemented 2026-10-15 on `sonnet/issue-309` (shared with ISSUE-309); DB-free validated; not yet merged. See §17.
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

## 17. Implementation record (2026-10-15)

- **Commits:** `adbe6329` (fix) and `c7e583e0` (tests), shared by ISSUE-309 and ISSUE-311, on `sonnet/issue-309`, base `f959e68f`. Source: `src/app/admin/player-links/actions.ts`, `src/app/admin/player-links/afl-api/actions.ts`, and the two components that render the new state, `SuggestionControls.tsx` and `afl-api/AflApiAdjudicationForm.tsx`.
- **Shape (§13).** `confirmUnlinked` and `reviewSuggestion` wrap `audit()` as `linkPlayer` does and return the committed success with `ACTIVITY_AUDIT_WARNING` (for `confirmUnlinked` once per batch, merged with any other warning). `linkAflApiPlayer` and `revokeAflApiPlayerLink` keep their `console.error` but now also return that warning; `AflApiAdjudicationActionState` gains `warning`. The AFL API module repeats the 2-line wording locally because a `'use server'` module may export only async functions.
- **Components.** A returned warning would be invisible without these two additions: `SuggestionControls` appends the warning to its success text and `AflApiAdjudicationForm` shows it under the success line. `ResolveControls` and `BulkApproveControls` already rendered `warning`.
- **Scope kept.** `auditInTransaction` (deliberately throwing, §12) and the `refreshSuggestions` audit are untouched.

See ISSUE-309 §17.1 and §17.2 for the shared validation (one new `describe`, 17 cases covering both issues), the pre-existing unrelated failure and the 16-mutant check; for this issue the relevant cases are the `confirmUnlinked` rejected-audit case, both `reviewSuggestion` cases, the three AFL API cases and the guard and render contracts (mutants M04, M05, M08–M12).

