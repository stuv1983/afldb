# AFLDB-ISSUE-285 — Award Replace panel cannot give the duplicate confirmation its action requires

## 0. Status

- **Status:** **Resolved (2026-10-14, merge-scoped)**, on the push of the documentation-only closure commit (§18). Implemented as `70af9ae3` on `sonnet/issue-285` (base `ea792f43`), merged and pushed with its records as `848f13f1`; DB-free validated (§17.1). **Not deployed.**
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

~~Implementation.~~ Done 2026-10-14 (§17); merged and closed (§18).

## 17. Implementation record (2026-10-14)

- **Commit:** `70af9ae3` on `sonnet/issue-285`, base `ea792f43`. Source: `src/app/admin/awards/ReplacePanel.tsx`. Test: `tests/awards-replace-panel.test.ts` (new; no existing suite is a semantic home for the awards admin panels, and `tests/awards-admin.test.ts` covers a different module).
- **Shape chosen (§13).** After a `duplicate` refusal the confirmation step renders the create form's checkbox (same wording, `name="confirmDuplicate"`), and the confirm button posts `confirmDuplicate=1` only when it is ticked. The action reads the key **unprefixed** (`actions.ts` `formData.get('confirmDuplicate')`, not `new:`), so the panel sets it directly on the form data, after `confirmReplace`.
- **Offered only where it can work.** `refusalState` answers `needsConfirmation` for a `duplicate` refusal in any domain, but only `award_winners` reads `confirmDuplicate`. `offersDuplicateConfirmation` therefore returns true only for `winners`, so Hall of Fame and honour-team replacements keep showing the refusal as an error with no control that cannot work.
- **Offered only for the refused preview.** The `needsConfirmation` flag in the action state outlives "Back to the details". The panel remembers which preview was submitted (`submitted`), and offers the control only while that same preview is showing; a new preview, and "Back", reset the tick. A confirmation given for one player is never carried onto another.
- **Structure.** Step two is now the exported presentational `ReplaceConfirmation`; `offersDuplicateConfirmation` and `withReplaceConfirmation` are exported pure helpers. Markup, wording and the focus-restore ref of the existing confirmation step are unchanged. The query layer is untouched: `replaceAwardWinner` already passes `replacement.confirmDuplicate` into `insertAwardWinner`.
- **Unchanged.** The duplicate rule, the two-step confirmation (`confirmReplace`), the audit and revalidation paths, and every other domain.

## 17.1 Validation (2026-10-14, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- `npx vitest run tests/awards-replace-panel.test.ts`: **15 passed.** Cases: the rendered control is present when offered, ticked when ticked, and absent (with both halves of the replacement still shown) when not offered; `offersDuplicateConfirmation` for `winners`, never for `hall-of-fame` or `honour-teams`, not without a refusal, not for a different preview than the refused one, not with no preview; `withReplaceConfirmation` always sets `confirmReplace`, posts `confirmDuplicate` (unprefixed) only when ticked and removes a stale one; the **real** `replaceAwardWinnerAction` over a mocked query returns a refusal with `needsConfirmation` for a duplicate and, on the second submission built with the ticked helper, passes `replacement.confirmDuplicate === true` and succeeds; a wiring contract on `ReplacePanel.tsx`.
- **Negative control:** with `ReplacePanel.tsx` restored to the base, **15 of 15 fail**, because the base has none of the exports or wiring (the evidence is that the tests detect the missing control, not that the base mis-renders it). The fix was restored afterwards (hash verified).
- `npx tsc --noEmit` exit 0; `npx eslint` of the two changed files exit 0; `git diff --check` exit 0. `npm run preflight -- --mode implementation --issue 285`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `D:\tmp\issue285\preflight-impl.txt`).
- `tests/awards-admin.test.ts` (the only other suite that names `ReplacePanel.tsx`): 40 of 41 pass; the one failure (`widens data_edits by SELECT alone in 108`, a migration-text regex) fails identically in the primary checkout at the unmodified base, so it is pre-existing and unrelated. The full suite was not run.
- **Not run / limits:** the integration variant named in §14 item 2 (an `admin-awards` case replacing onto an existing same-player row with `confirmDuplicate`) was not written or run: it needs `afldb_test`, and the query layer it exercises is unchanged. The panel's React state transitions (preview, refusal, tick, resubmit) and the rendered page are not exercised: this suite has no DOM, so the tick-then-resubmit sequence is covered as pieces (helpers, rendered control, real action) plus a source-wiring check, not as one interaction. No browser, deployment, DEV or PROD action.

## 18. Readiness, merge and closure (2026-10-14)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 285`: READY (§17.1). `npm run merge:ready -- --issue 285` (raw output, unchanged: `D:\tmp\issue285\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths (nine `.agents/skills` files, seven zero-byte stray-named files including `void`, and the literal `$null)`). Existing warnings: no `afldb-merge-readiness` block in this runbook; no unexpected-file classification (5 committed files); database parity not checked. The worktree was created with `git worktree add -b sonnet/issue-285 <path> ea792f43` (the tip verified equal to the live remote by `git ls-remote`) and a `node_modules` junction, because `worktree:bootstrap` is blocked by the same strays.
- **Exception.** The owner authorised a fresh exception for this issue, covering only that clean-tree FAIL and the exact 17-path set, compared by full content hash, **verified immediately before each merge**. `D:\tmp\issue285\exception-check.py` (a copy of the read-only ISSUE-300 script) was run as `precheck-1`, as `premerge-1` immediately before the implementation merge and `postmerge-1` after its push, and again as `premerge-2` immediately before the closure merge and `postmerge-2` after it; every run RESULT OK. `$null)` (143 bytes, mtime 20:00:49) was hashed in full before each merge as `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500` and the check was run with that fresh value. Current equality with the saved 13 Oct snapshots, not continuous preservation. No stray was modified, moved or deleted.
- **Merge 1.** `70af9ae3` (fix) and `848f13f1` (records) fast-forwarded onto `main` (`ea792f43..848f13f1`) and pushed; local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled `848f13f1` afterwards. Before the merge a fresh `git fetch` and `ls-remote` showed `main` still at `ea792f43`.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under §14 item 1 (a DB-free component render asserting the control appears; met, §17.1). The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. The §14 item 2 integration variant (an `admin-awards` integration case replacing onto an existing same-player row with `confirmDuplicate`) was not written or run: it needs `afldb_test`, and the query layer it would exercise is unchanged by this issue. The panel's React state transitions and the rendered page were not exercised in a browser; the tick-then-resubmit sequence is covered as pieces (helpers, rendered control, the real action over a mocked query) plus a source-wiring check. The one failure in `tests/awards-admin.test.ts` is pre-existing at the base and unrelated (§17.1).
