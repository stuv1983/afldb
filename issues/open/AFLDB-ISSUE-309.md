# AFLDB-ISSUE-309 — Multi-target player-link actions stop at the first failure after earlier targets committed

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin player links.
- **Key file:** `src/app/admin/player-links/actions.ts` (`linkPlayer`, `confirmUnlinked`, `createAndLinkPlayer`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-044; partition note R5b-F02).
- **Classification:** code-proven.

## 1. Summary

Each target is resolved in its own import-role transaction. On a failing later target the three multi-target actions `return { error }` from inside the loop, after earlier targets have already committed. Nothing is revalidated, the UI does not refresh, and a resubmit re-attempts the committed target and is refused "already linked by another admin".

## 2. Evidence

- `src/app/admin/player-links/actions.ts:83`, `:114` and `:213` (early return), with revalidation at `:94`, `:120` and `:224`.
- `src/db/queries/player-links.ts:484-486, :505-513`.
- `ResolveControls.tsx:169-174, :426-428`.
- The correct pattern: `bulkApproveSuggestions` (`:344-347`, pinned by `tests/player-link-mutations.test.ts:1047-1057`).

## 3. Trigger

Resolve two selected rows when the second was resolved meanwhile by another admin.

## 4. Expected invariant

Continue per target, revalidate if any target succeeded, and report partial success.

## 5. Actual behaviour

Only an error is returned. The pages are stale and the UI is confusing.

## 6. First wrong layer

`actions.ts:83, :114, :213`.

## 7. Impact

Stale caches and UX confusion. The database stays consistent.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

Each `resolveLink` is independently transactional.

## 10. Existing-issue search

ISSUE-013 fixed atomicity for a single target only. Classification: **new**.

## 11. Scope

The three loops.

## 12. Out of scope

Approval revalidation (AFLDB-ISSUE-308).

## 13. Proposed fix boundary

Collect per-target results, continue on failure, revalidate when at least one succeeded, and return a message with a warning.

## 14. Proposed validation

DB-free unit test with `resolveLink` failing on the second of two targets.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation, together with AFLDB-ISSUE-308 and AFLDB-ISSUE-311.
