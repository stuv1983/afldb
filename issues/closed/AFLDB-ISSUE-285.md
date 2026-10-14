# AFLDB-ISSUE-285 — Award Replace panel cannot give the duplicate confirmation its action requires

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented as `70af9ae3` on `sonnet/issue-285` (base `ea792f43`), merged and pushed with its records as `848f13f1`; DB-free validated (§17.1, §17.2). **Not deployed. Not resolved at 848f13f1:** §14 item 2 (the integration variant) was outstanding and a closure pushed as `5f440acf` was withdrawn (§18). The integration variant was written and passed on `afldb_test` on 2026-10-15 (§19, `39f996c8`).
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
2. An integration variant of the `admin-awards` :670 case. **Met 2026-10-15, §19.**

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Done 2026-10-14 (§17); merged (§18). None. Resolved (§20). Not deployed.

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

## 17.2 Mutation checks of the tests (2026-10-14, assistant-run; Windows, DB-free)

Each mutant changes the real confirmation wiring in `ReplacePanel.tsx`, keeps every export, is applied alone to a clean tree, and is restored from Git afterwards (`D:\tmp\issue285\mutate.py`; outputs `mutation-<name>.txt`). A kill counts only if the failure is an assertion about behaviour, not a missing import.

| Mutant | Against the first 15 cases | Against the 20 cases |
|---|---|---|
| A1 the helper never sends `confirmDuplicate` when ticked | killed by 2 behavioural cases (`expected null to be '1'`) | killed by 3 |
| A2 the component never applies the tick | killed **only by a source-text assertion** | killed by the panel flow (`expected null to be '1'`) |
| B1 the offer is not tied to the refused preview | killed by 1 helper case | killed by 2 (helper and panel flow) |
| B2 the tick survives a new preview and "Back" | killed **only by a source-text assertion** | killed by the panel flow (the control returns pre-ticked for another player) |
| B3 the tick is applied once the control is no longer offered | killed **only by a source-text assertion** | killed by the panel flow (`expected true to be false`) |
| C1 the control is offered for every domain | killed by 2 helper cases | killed by 4 |

The component-level mutants (A2, B2, B3) survived behaviourally in the first 15 cases, so the tests were strengthened: the real `ReplacePanel` function is driven through open, preview, confirm, refusal, tick, resubmit, back and a different player's preview, using a hook harness (slot-based `useState`/`useRef`, inert `useEffect`, a mocked awards submit hook and a `FormData` stand-in). The source-text case was removed. A first attempt at the mutation run was contaminated by an earlier aborted command that had left mutant A in the file; all results above are from clean-tree reruns. The 20 cases pass unmutated; `tsc --noEmit` and ESLint exit 0. Still not exercised: the markup the browser finally paints and real React rendering (no DOM or browser).

## 18. Readiness, merge and the withdrawn closure (2026-10-14)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run merge:ready -- --issue 285` (raw output, unchanged: `D:\tmp\issue285\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths. The exact set and the full content hashes were verified immediately before and after each merge (`D:\tmp\issue285\premerge-1`, `postmerge-1`, `premerge-2`, `postmerge-2`, all RESULT OK).
- **Merge 1.** `70af9ae3` (fix) and `848f13f1` (records) fast-forwarded onto `main` (`ea792f43..848f13f1`) and pushed.
- **Closure withdrawn.** `5f440acf` closed the issue "under §14 item 1" and moved this runbook to `issues/closed/`. That over-read §14: it lists a DB-free render **and** an integration variant of the `admin-awards` :670 case and nowhere says the first suffices (the other closed review findings' §14 sections say so explicitly), and an unchanged query layer is not a reason to drop a listed criterion. The closure was reverted; the runbook is back in `issues/open/` and the issue is **Open**.
- **Remaining.** §14 item 2 on `afldb_test`, run by the operator (it needs the database), then close. Not deployed. The panel's React state transitions are now covered by a DOM-free harness (§17.2); the painted page and a browser are not.

## 19. Integration variant on `afldb_test` (2026-10-15)

- **Test.** `39f996c8` on `sonnet/issue-285-integration` (base `cc38c669`): `tests/integration/admin-awards.test.ts`, one new case after the `replaces the wrong winner…` case, plus an optional `season` on the `seedSourceWinner` helper. The case builds its own fixture award with a wrong-season active row and an existing active row for the same player in the right season, then calls the real `replaceAwardWinner` twice. **Without `confirmDuplicate`:** refused with reason `duplicate` naming the existing entry; the wrong-season row is still active with its original `updated_at`, the existing row is unchanged, no row was inserted, and no `data_overrides` or `data_edits` row exists for the target (the void runs before the duplicate check inside the transaction, so this proves the refusal rolled it back). **With `confirmDuplicate: true`:** succeeds; the wrong-season row is `void` with its reason; the replacement is an active `manual_admin_edit` row in the right season for the same player; the player holds two active rows there; the old key's `lifecycle` override names `replaced_by_key`, the new key's `record` override names `replaces_key`, both by natural key; the audit has one `award_winner_voided` and one `award_winner_created` row sharing `replacement_id`.
- **Authority and guards.** `D:\tmp\issue285\run-int.mjs` derives the owner, importer and auth DSNs in memory, points them at `afldb_test` on the tunnel port and, before vitest starts, proves `current_database() = afldb_test` for each (`afldb_owner`, `afldb_import`, `afldb_auth`); the suite's own `tests/integration/guard.ts` and importer-role parity check then run. Credentials were never printed or written. No `afldb_dev`, PROD, migration, rebuild, restore, truncation or data repair. The only writes were the suite's prefix-keyed fixtures (`AFLDB-ISSUE-165-TEST`, `afldb-issue-165-test-*`) through its own `purgeFixtures()`.
- **Result.** The new case: **1 passed** (`D:\tmp\issue285\int-run-1.txt`, `int-run-final.txt`). The whole `admin-awards.test.ts` file, run once to cover the helper change: **33 of 33 passed** (`int-run-file.txt`). The whole integration suite was not run.
- **Negative controls.** Two mutants of `insertAwardWinner` in `src/db/queries/admin-awards.ts`, each applied alone and restored from a saved copy (sha-256 verified equal; `git status` shows the source file clean). **M1**, the duplicate check ignores `confirmDuplicate` (always runs): killed at the confirmed step (`expected false to be true`, the message being the `duplicate` refusal). **M2**, the duplicate check never runs: killed at the refusal step (`expected true to be false`). Evidence: `int-mutant-M1.txt`, `int-mutant-M2.txt`.
- **Fixture cleanup.** After the runs a read-only count on `afldb_test` found 0 fixture awards, award winners, players, overrides and audit rows (`int-residue.txt`, repeated after the whole-file run).
- **Limits.** Not deployed. No browser, DEV or PROD action. The panel's React wiring is covered by `tests/awards-replace-panel.test.ts` (DB-free, §17) and the query layer by this case; the two are not joined in one end-to-end run.

## 20. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 285`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue285\preflight-impl-int.txt`, run after the test was committed). `npm run merge:ready -- --issue 285` with five `--expected-file` rules (raw output, unchanged: `D:\tmp\issue285\merge-ready-raw-int-1.txt`): every check PASS (branch, clean issue worktree, `main` equals recorded `origin/main`, ahead 2 / behind 0, migration parity, declared scope 5 changed / 0 unexpected) except **one blocker, "main worktree is clean"**; one warning (no runbook readiness block); database parity not checked. The raw output ends `Merge readiness: BLOCKED (1 blocker(s), 1 warning(s))`.
- **Exception (fresh, this issue only).** The owner authorised an exception for the integration-variant work on ISSUE-285, covering only that clean-tree FAIL under the exact **18**-path primary state: the nine `.agents/skills` files, the seven zero-byte stray-named files (`0)`, ``20` ``, ``` `path ```, `i`, `q(sequenceValueSql(qname))))[0]`, `t.kind`, `void`), the literal `$null)` and the zero-byte `2000)`. No earlier ratification was reused. The path set, no tracked or staged change, and full content hashes were verified by `D:\tmp\issue285\exception-check-int.py` (an adaptation of the ISSUE-296 script): `precheck-int-1` and `premerge-int-1` before, and `postmerge-int-1` after, the push, all RESULT OK. The nine skill files equal the 13 Oct manifests; the seven zero-byte files and `2000)` are regular, 0 bytes, sha-256 `e3b0c442...b855`; `$null)` is 143 bytes, mtime 2026-10-14 20:00:49, full sha-256 `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`, captured fresh at `precheck-int-1` and identical at every later check. This is current equality, not continuous preservation. No additional path or changed content appeared.
- **Merge.** A fresh `git fetch` and `git ls-remote` showed `main` at `cc38c669` immediately before the merge. `39f996c8` (the integration case) and `fbe9715c` (its records) fast-forwarded onto `main` and were pushed (`cc38c669..fbe9715c`); local `main` and `git ls-remote origin refs/heads/main` both equalled `fbe9715c` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 lists two items and both are met: item 1, the DB-free render of the control, by §17.1 and §17.2 (20 cases, six mutants killed by behavioural assertions); item 2, the integration variant of the `admin-awards` :670 case, by §19 (run on `afldb_test`, 1 passed, the file 33 of 33, two mutants killed, fixture residue zero). The closure scope is **merge-scoped**: code on `main`, validated DB-free and on `afldb_test`, **not deployed**.
- **Preserved limits.** Not deployed. No browser, DEV or PROD action. The painted page and real React rendering were not exercised; the panel wiring and the query layer are proved by separate suites, not one end-to-end run. The whole integration suite was not run.
