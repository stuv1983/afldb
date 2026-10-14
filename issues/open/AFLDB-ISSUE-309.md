# AFLDB-ISSUE-309 — Multi-target player-link actions stop at the first failure after earlier targets committed

## 0. Status

- **Status:** Open (2026-10-08). Implemented 2026-10-15 on `sonnet/issue-309` (shared with ISSUE-311); DB-free validated; not yet merged. See §17.
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

## 17. Implementation record (2026-10-15)

- **Commits:** `adbe6329` (fix) and `c7e583e0` (tests), shared by ISSUE-309 and ISSUE-311, on `sonnet/issue-309`, base `f959e68f`. Source: `src/app/admin/player-links/actions.ts`.
- **Shape (§13).** `linkPlayer`, `confirmUnlinked` and `createAndLinkPlayer` collect each refused target (`{ label, error }`) instead of returning from the loop, and continue. When no target changed the action returns `{ error }` listing every refusal in the single-target wording (`Error on <table>:<id>: <reason>`, first five then an ellipsis) and revalidates nothing. When at least one target changed it revalidates exactly as before and returns `{ message, warning }`: the message reads `N of M record(s)` and the warning lists the targets left unchanged, combined with any activity-audit warning. An all-success batch keeps its original message and has no warning.
- **Create-and-link.** A refusal of the first target still returns its error: no player exists yet, nothing has committed, and there is nothing for later targets to link to. A refusal of a later target, after the player exists, continues.
- **Why continuing per target is complete.** The query functions `resolveLink`, `confirmUnlinked` and `createPlayerAndResolveLink` catch every transaction error and return `{ ok: false }`; the only call in these loops that could still throw was `audit()`, guarded by ISSUE-311.
- **UI.** `ResolveControls.tsx` is unchanged: it already shows `message` with `warning` and, while a warning is present, does not call `router.refresh()` itself; the action's `revalidatePath` calls refresh the lists. The done panel therefore stays until the page is reloaded, exactly as it already did for an activity-audit warning.

## 17.1 Validation (2026-10-15, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- New cases: 17, all in the new `describe('AFLDB-ISSUE-309/311: ...')` of `tests/player-link-mutations.test.ts` (the existing suite that already pins these actions): `linkPlayer` 4 (a later refusal, an earlier refusal, every target refused, an unmixed success), `confirmUnlinked` 3 (partial, every target refused, a rejected activity audit with the loop continuing), `createAndLinkPlayer` 2 (a later refusal after the player exists, a first-target refusal that creates nothing), `reviewSuggestion` 2 (rejected audit, successful audit), the two AFL API actions 3 (link, revoke, and a refused mutation writes no audit) and 3 source contracts (no loop returns an error, every `audit()` after a commit is guarded, the components render the warning). The real query functions run against the fake import transaction; a target is refused by making its lock query return no row ("resolved meanwhile by another admin").
- Result: `tests/player-link-mutations.test.ts` **148 passed, 1 failed (149)**; with `tests/player-links-page.test.ts` and `tests/afl-api-adjudication-actions-contract.test.ts` **160 passed, 1 failed (161)**. `npx tsc --noEmit` exit 0. `npx eslint` of the four changed source files exit 0 (two pre-existing unused-parameter warnings in `refreshSuggestions`); of the test file 20 errors and 2 warnings, the same 20 `no-explicit-any` errors as on unchanged `main`, none in the added lines. `git diff --check origin/main..HEAD` exit 0.
- **The one failure is pre-existing and unrelated:** `AFLDB-ISSUE-235 S6: fixture ownership ... I14 owns its actor and its teardown needs nothing from setup`, a source-text assertion that `tests/integration/settle-afl-api.test.ts` does not contain `FROM auth_users ORDER BY`; line 2881 (the ISSUE-257 describe, commit `92f2bdf6`) does. It fails identically on unchanged `main` `f959e68f`: **131 passed, 1 failed (132)** there, 148 + 1 here, the difference being exactly the 17 new cases. Also recorded at ISSUE-276, ISSUE-290 and ISSUE-291. Not touched here (an integration file this issue does not own).
- **Against the pre-fix source** (the four source files restored to `origin/main`, then back): **13 of the 17 new cases fail**; the four that pass either way are the regression guards (an unmixed success keeps its wording, a first-target refusal creates no player, and the two "successful audit leaves no warning" cases).
- **Not run / limits:** PostgreSQL, the integration files, the full suite, any browser, DEV or PROD action. No render of the two changed components: their added text appears only after a failed activity audit, which cannot be produced in a browser without fault injection, so the change carries **VISUAL: UNVERIFIED** and is pinned by source contracts only.

## 17.2 Mutation checks of the tests (2026-10-15, assistant-run; Windows, DB-free)

Each mutant changes the real fix, is applied alone and restored from a saved copy (byte-identical afterwards, verified); only the new `describe` is run. A kill counts only on an assertion failure. Script and raw output: `D:\tmp\issue309\mutate.py`, `mutation.txt`.

| Mutant | Result |
|---|---|
| M01 `linkPlayer` returns from inside the loop | killed (4) |
| M02 `linkPlayer` revalidates only on a clean batch | killed (2) |
| M03 `linkPlayer` drops the not-changed warning | killed (2) |
| M04 `confirmUnlinked` audit unguarded | killed (2) |
| M05 `reviewSuggestion` audit unguarded | killed (2) |
| M06 `createAndLinkPlayer` later refusal returns | killed (2) |
| M07 `createAndLinkPlayer` drops the not-changed warning | killed (1) |
| M08 AFL link audit failure silent again | killed (2) |
| M09 AFL revoke audit failure silent again | killed (2) |
| M10 AFL link audit failure rethrows | killed (2) |
| M11 `SuggestionControls` does not render the warning | killed (1) |
| M12 `AflApiAdjudicationForm` does not render the warning | killed (1) |
| M13 the not-changed warning is always empty | killed (4) |
| M14 `confirmUnlinked` all-refused is not an error | killed (1) |
| M15 `linkPlayer` partial wording loses the denominator | killed (2) |
| M16 `linkPlayer` all-refused still revalidates | killed (1) |

All 16 killed; none survived. A first run left M12 and M14 alive; the all-refused `confirmUnlinked` case and a render-line contract were added, and the table is the second, final run.
