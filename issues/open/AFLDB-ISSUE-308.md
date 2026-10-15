# AFLDB-ISSUE-308 — Approving a player-link suggestion does not revalidate public pages

## 0. Status

- **Status:** Open (2026-10-08). **Implemented and merge-scoped on 2026-10-15 (§17-§18, merged as `16f31a67` and `dfc5c9f2`, §20); DEV acceptance parked (§19).** Not deployed; the fix is not on DEV or PROD. The issue is **not** resolved: §14 item 2 (approve one suggestion on DEV and request the award page) needs a deployment and a DEV data write, neither authorised in the implementing session.
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
  **2026-10-15: not answered, and not needed.** The mechanism chosen (§17) is the §13 first alternative, the capability-gated
  follow-up route, which never calls `revalidatePath` inside a Server Action, so it holds whether or not the hang reproduces on
  Next 16.3.1. Whether it still reproduces remains unknown; no claim is made either way, and `linkPlayer`, `confirmUnlinked` and
  `createAndLinkPlayer` keep their existing in-action calls unchanged.

## 16. Next action

DEV acceptance (§19): deploy to DEV, approve one suggestion as Super Admin, then request the award page. Close only then.

## 17. Implementation (2026-10-15; branch `sonnet/issue-rec1015`, base `032ca17c`; not deployed)

Mechanism: a post-settle revalidation through a capability-gated route, as the coach, draft and records domains do.

- `src/app/admin/player-links/public-link-pages.ts` (new): the one `revalidatePublicLinkPages()` (the eight paths that `linkPlayer`,
  `confirmUnlinked` and `createAndLinkPlayer` already revalidated), moved out of `actions.ts` so the actions and the route share one list.
- `src/app/admin/player-links/revalidate/route.ts` (new): `POST` awaits `requireCapability('data.playerLinks')` as its first statement, then calls
  `revalidatePublicLinkPages()`. It reads nothing from the request, so nothing the browser sends reaches `revalidatePath`.
- `src/app/admin/player-links/post-public-revalidate.ts` (new): a best-effort `fetch('/admin/player-links/revalidate', { method: 'POST' })`.
- `actions.ts`: `PlayerLinkActionState` gains `revalidatePublic?: true`. `approveSuggestion` sets it on success; `bulkApproveSuggestions` sets it only when at
  least one row was approved. Neither action calls `revalidatePath` or `revalidatePublicLinkPages` (the pinned test still holds).
- `ResolveControls.tsx` (the single approval) and `BulkApproveControls.tsx` post to the route from an effect once the action's result carries the flag, so
  the request is a second request after the action's own response, even when the form unmounts. A refused approval, or a bulk with none approved, posts nothing.

## 18. Validation (DB-free; 2026-10-15)

- `tests/player-link-mutations.test.ts`: 5 new cases (a committed single approval is flagged and calls no `revalidatePath`; a refused one is not flagged; a bulk
  is flagged only when a row committed; a source contract for the route guard, the shared path list and both client posts; the route's behaviour with a mocked
  guard and `revalidatePath`: guard first, the eight fixed paths in order, nothing revalidated when the guard rejects). The pinned "keeps revalidatePath out of the
  new actions" case is kept and now also requires `revalidatePublic: true` in the approval actions. File 160 tests, **1 failure: I14**, the pre-existing unrelated
  case that fails identically on unchanged `main`. With `tests/auth.test.ts` and `tests/player-links-page.test.ts`: 366 passed, 1 failed (I14).
- **9 of 9 mutants killed** (flag dropped; bulk flags with none approved; route without guard; route without revalidation; resolve controls never post; bulk
  controls never post; approval revalidates in-action; path set loses `/hall-of-fame`; wrong capability); evidence `D:\tmp\issue308\mutation.txt`.
- `tsc --noEmit` and `git diff --check` exit 0. ESLint of `src/app/admin/player-links`: 0 errors, 3 warnings that were already there.
- **Not run:** any PostgreSQL or integration test, any browser, DEV or PROD action, any deployment. The two components' added behaviour is **VISUAL: UNVERIFIED**
  (it adds a request, not visible text).

## 19. DEV acceptance, parked (prepared 2026-10-15; nothing executed)

Why parked: it needs (a) a deployment of this change to DEV and (b) a DEV data write (an approval creates a link). The 15 October authority was read-only DEV
diagnostics and browser checks; it excluded data writes and another deployment. §14 item 2 is not weakened.

Read-only facts observed on DEV on 2026-10-15 (as `afldb_app`, in a `READ ONLY` transaction; DEV at `f07c2a74`, BUILD_ID `Xr8x1v5iRTaLiR7h0ScFg`, which does **not**
contain this change): 182 rank-1 candidates for `award_winners`, 40 bulk-eligible; 241 unresolved `award_winners` rows (192 `unmatched`, 45 `implausible`, 4 `ambiguous`).
A suitable single target is `award_winners` id 118 (All-Australian 1987, "Matthew Campbell", `unmatched`), whose rank-1 candidate is player 9257 "Matthew Campbell",
score 97, band `very_high`, bulk-eligible, not ambiguous, no hard conflict. That row is a candidate, not a recommendation: the operator must confirm it is the right
person before approving.

Exact remaining action (operator, daytime, outside the gate's refused windows):
1. Deploy the merged commit to DEV through the gated runner (a separate decision; never inferred from this record).
2. Before: record the public All-Australian 1987 page (`/awards/all-australian/1987`) as served (it shows the unlinked name). DEV sits behind the beta gate, so use a signed-in session.
3. As Super Admin on `/admin/player-links`, approve the suggestion for `award_winners` 118 through the drawer (screenshot: the form unmounts on success and the page does not hang).
4. Capture the browser's `POST /admin/player-links/revalidate` (expect 200, `{"ok":true}`), then request the All-Australian 1987 page again: it must show the linked player.
5. Optionally bulk-approve one other bulk-eligible row to cover `BulkApproveControls`.
6. Record the images, the request, the audit rows (`player_link.suggestion_approved`) and the journal; close DEV-scoped.

## 20. Readiness, merge and exception (2026-10-15)

- **Merged and pushed.** The code is `16f31a67`; its records are `dfc5c9f2`. Both were fast-forwarded to `main` and pushed (`032ca17c..dfc5c9f2`); local `main`, the fetched `origin/main` and the live remote all equalled `dfc5c9f2` afterwards. Worktree `D:\dev\afldb-issue-rec1015`, branch `sonnet/issue-rec1015`.
- **Readiness: accepted under a task-specific cleanliness exception, not a clean pass.** `merge:ready -- --issue 308` is **BLOCKED by exactly one FAIL**, `main worktree is clean: D:/dev/afldb`, which lists the primary checkout's 18 untracked paths; every other check PASSed (current branch, issue worktree clean, local main equals recorded origin/main, base/main relationship, migration collision/checksum parity). Two warnings: no runbook readiness metadata, no unexpected-file classification. The raw output is preserved unchanged: `D:\tmp\issuerec1015\merge-ready-raw-6.txt` (SHA-256 `17b85e1fc478a0d470cbdbcce21275343cceef1a2736f892978cd86f6de44b01`), with `preflight-6.txt` (READY, 0 blockers, 3 warnings), `premerge-6.txt` and `postmerge-6.txt`.
- **The exception.** The owner authorised, for this task only, accepting that one FAIL on the condition that the exact sealed 18 paths and their full hashes stay unchanged: the nine `.agents/skills` files (full SHA-256 and length equal to the 13 Oct manifests), seven zero-byte files (`0)`, `20` followed by a backtick, a backtick followed by `path`, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the 143-byte `$null)` (SHA-256 `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`) and the zero-byte `2000)`. It is not a standing exception. The script `D:\tmp\issuerec1015\exception-check.py` compared them in full at `precheck-1` and `precheck-2` (`D:\tmp\issue308`), immediately before the merge (`premerge-6`) and after it (`postmerge-6`); the last three are RESULT OK, and the primary had no tracked or staged change.
- **A nineteenth path, removed before the first accepted check.** The first check of the task (`D:\tmp\issue308\precheck-1.txt`, RESULT FAILED) found a zero-byte untracked `TARGET` in the primary (created 2026-10-15 19:47:46, during this session; origin unknown; not created by this work; the same stray that earlier reappeared at 15:01:19 and was deleted at 15:05). It is not one of the sealed 18, so the condition failed as stated. It was confirmed zero bytes and deleted; `precheck-2` then passed. Nothing else was deleted.
- **Not deployed.** Neither the DEV nor the PROD revision contains this change.
