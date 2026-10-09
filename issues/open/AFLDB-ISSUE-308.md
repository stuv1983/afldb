# AFLDB-ISSUE-308 — Approving a player-link suggestion does not revalidate public pages

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin player links / public cache revalidation.
- **Key file:** `src/app/admin/player-links/actions.ts` (`approveSuggestion`, `bulkApproveSuggestions`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-043; partition note R5b-F01).
- **Classification:** code-proven. The fix choice is framework-dependent (whether `revalidatePath` inside an action is safe on Next 16).

## 1. Summary

A manual link, a confirm-unlinked and a create-and-link each call `revalidatePublicLinkPages()`. Approving a suggestion, single or bulk, does not. The awards, honour-team, club, first-kick and season pages (ISR up to 24 hours) keep showing the unlinked name.

## 2. Evidence

- `src/app/admin/player-links/actions.ts:274-288` and `:335-376` (no call), against `:32-41`, `:94`, `:120` and `:224` (the call).
- `actions.ts:245-246` (the comment addresses the admin page only).
- `SuggestionControls.tsx:19-21` and `ResolveControls.tsx:169-174` (`router.refresh()` refreshes the admin tree only).
- `tests/player-link-mutations.test.ts:1038-1045` pins `not.toContain('revalidatePublicLinkPages')`, with the Next 15.5 client-hang rationale (ISSUE-087 follow-up, `issues.md:6373-6379`).

## 3. Trigger

A Super Admin approves (or bulk-approves) a suggestion for an unresolved `award_winners` row.

## 4. Expected invariant

An approval has the same public-cache effect as a manual link.

## 5. Actual behaviour

Public pages are stale for up to a day.

## 6. First wrong layer

`actions.ts:274-288, :335-376`.

## 7. Impact

Stale public honours pages. No corruption.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

There is no `/admin/player-links/revalidate` route, unlike coaches, draft and records.

## 10. Existing-issue search

ISSUE-164 (bulk contract), ISSUE-075 and the ISSUE-087 follow-up. The public-page consequence was never accepted anywhere. Classification: **new**.

## 11. Scope

Post-approval revalidation.

## 12. Out of scope

Per-worker invalidation (ISSUE-134).

## 13. Proposed fix boundary

A capability-gated post-settle revalidation through `src/lib/admin/revalidate-route.ts` (the existing pattern), or an in-action `revalidatePath` if the Next 15.5 hang no longer applies on Next 16. Update the pinned test.

## 14. Proposed validation

1. A DB-free unit test that the approval path triggers the public path set.
2. On DEV: approve one suggestion and request the award page.

## 15. Decisions / unresolved questions

- Whether the ISSUE-087 hang reproduces on Next 16.3.1. Confirm against `node_modules/next/dist/docs/` and on DEV.

## 16. Next action

Choose the mechanism, then implement it.
