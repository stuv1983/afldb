# AFLDB-ISSUE-300 — AFL API control-database read failure is reported as "disabled by a super admin"

## 0. Status

- **Status:** **Resolved (2026-10-14, merge-scoped)**, on the push of the documentation-only closure commit (§18). Implemented as `47541503` on `sonnet/issue-300` (base `5dff6ea6`), merged and pushed with its records as `597242cd`; DB-free validated (§17.1). **Not deployed.**
- **Severity:** Low. **Area:** acquisition / operational diagnostics.
- **Key files:** `src/lib/acquisition/afl-api-ingestion-control.ts`, `tools/current-season/acquire-afl-api.ts`, `discover-afl-api-seasons.ts`, `acquire-afl-api-brownlow.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-035; partition note R4b-F05).
- **Classification:** code-proven.

## 1. Summary

The ingestion-control reader deliberately fails closed: an unset DSN, a refused connection, a timeout and a missing table all read as disabled. The CLIs then throw a message naming only the admin switch ("A super admin must enable it"). The sibling `afl-api-ingestion-safety.ts` distinguishes "unable to read the control database".

## 2. Evidence

- `src/lib/acquisition/afl-api-ingestion-control.ts:54-82` and `:17-25` (by design).
- The CLI messages: `acquire-afl-api.ts:216-222`, `discover-afl-api-seasons.ts:123-129`, `acquire-afl-api-brownlow.ts:146-155`.
- Contrast: `afl-api-ingestion-safety.ts:90-93`.

## 3. Trigger

The nightly timer fires while PostgreSQL is restarting, or the unit's environment lacks `DATABASE_URL`.

## 4. Expected invariant

Fail-closed behaviour, with a message that names the read failure.

## 5. Actual behaviour

The journal says the switch is off; the operator may toggle a switch that is already on. Fail-closed behaviour and the `AFLDB_SETTLE_FAILURE` marker are intact.

## 6. First wrong layer

`afl-api-ingestion-control.ts:54-82` (the value carries no reason).

## 7. Impact

Operator misdiagnosis.

## 8. Reproduction / witness

Not executed. `tests/afl-api-ingestion-control.test.ts:25` pins "unreachable reads as disabled" (by design), not the message.

## 9. Disproof attempts

The sibling module shows the distinction is feasible.

## 10. Existing-issue search

None. Classification: **new**.

## 11. Scope

The reader's return shape and the three CLI messages.

## 12. Out of scope

Fail-closed semantics, which are unchanged.

## 13. Proposed fix boundary

A tri-state return (`disabled | unreadable`), or a secret-free read error surfaced by the CLIs.

## 14. Proposed validation

DB-free unit tests with an unreachable stub.

## 15. Decisions / unresolved questions

None.

## 16. Next action

~~Implementation.~~ Done 2026-10-14 (§17); merged and closed (§18).

## 17. Implementation record (2026-10-14)

- **Commit:** `47541503` on `sonnet/issue-300`, base `5dff6ea6`. Source: `src/lib/acquisition/afl-api-ingestion-control.ts` and four CLIs (`acquire-afl-api.ts`, `discover-afl-api-seasons.ts`, `acquire-afl-api-brownlow.ts`, `settle-afl-api-fixtures.ts`). Tests: `tests/afl-api-ingestion-control.test.ts`, `tests/afl-api-match.test.ts`, `tests/afl-api-brownlow-acquire.test.ts`, `tests/afl-api-settle-cli-gate.test.ts`.
- **Shape chosen (§13, first option, kept backward compatible).** `AflApiIngestionControls` gains an optional `readFailure?: string`, set only when the switches could not be read (unset `DATABASE_URL`, or any failure of the connection or query). Both flags stay `false`, so fail-closed behaviour is identical and every existing `ingestionControls` override (which has no `readFailure`) behaves as before. The reason is a fixed phrase: `DATABASE_URL is not set`, or `the control database could not be read` plus, only when the error carries a short alphanumeric code (`ECONNREFUSED`, `CONNECT_TIMEOUT`, SQLSTATE `42P01`), that code. The driver's message is never copied, because it can embed connection details. `describeAflApiIngestionReadFailure(controls)` renders the one operator sentence (`...could not be read: <reason>. This is a read failure, not a super-admin "disabled" setting; the tool is failing closed. Check that PostgreSQL is reachable and that DATABASE_URL is set for this process.`) or `null` for a genuine stored value.
- **CLIs.** `acquire-afl-api`, `discover-afl-api-seasons --fetch` and `settle-afl-api-fixtures` throw `AFL API current-season ingestion refused: <sentence>` instead of the admin-switch message when `readFailure` is present; the stored-`false` message is unchanged. `acquire-afl-api-brownlow` reports the deployment gate state and says the super-admin setting is *unknown because* the switches could not be read. **Scope note:** §11 names three CLIs; `settle-afl-api-fixtures.ts` is a fourth caller of the same reader with the identical message, so it was brought into line rather than left misleading. `settle-afl-api.ts` and `settle-afl-api-brownlow.ts` already distinguish the case through `proveAflApiIngestionPreflight` (`afl-api-ingestion-safety.ts:90-93`) and were not touched.
- **Unchanged.** Fail-closed semantics, the `AFLDB_SETTLE_FAILURE` marker, the reader's never-throws contract, the two-key Brownlow composition.

## 17.1 Validation (2026-10-14, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- `npx vitest run` of `tests/afl-api-ingestion-control.test.ts`, `afl-api-brownlow-acquire`, `afl-api-settle-cli-gate`, `afl-api-ingestion-safety`, `afl-api-match`: **5 files, 435 passed.** New cases drive the **real** reader output (`readAflApiIngestionControls({})`, an unreachable `127.0.0.1:1` stub and a malformed DSN) into the real CLI entry points with a fetch stub that fails if called: the message names the read failure, does not say "A super admin must enable it", and no request, file or database write follows; the reason and sentence contain none of the password, role, host or database name from the DSN; a stored-disabled value carries no `readFailure`. Three existing assertions that pinned exact `toEqual(DISABLED_AFL_API_INGESTION_CONTROLS)` for an unreadable result (two in `afl-api-ingestion-control.test.ts`, one in `afl-api-settle-cli-gate.test.ts`) were relaxed to `toMatchObject` because the result now legitimately carries the extra `readFailure` field; the two flags are asserted `false` explicitly and the settle-gate case also asserts the `readFailure` text. No test was deleted, skipped or disabled.
- **Negative control:** with `src/` and `tools/` restored to the base, **9 tests fail** (4 control, 2 match, 2 settle-gate, 1 Brownlow); the fix was restored afterwards.
- `npx tsc --noEmit` exit 0; `npx eslint` of the six changed source/test files exit 0; `git diff --check` exit 0. `npm run preflight -- --mode implementation --issue 300`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `D:\tmp\issue300\preflight-impl.txt`).
- Full `npx vitest run` in the worktree (`D:\tmp\issue300\full-vitest.txt`): the integration files cannot run without a database, and 11 non-integration tests fail. The same 11 files were re-run in the primary checkout at the unmodified base: 10 of the 11 fail identically there (`awards-admin`, `behind-holder`, `correct-afl-api-identity-cli`, `current-season-import`, `draftguru-acquisition` (review tool), `finals-semantics-contract`, `honours-lifecycle-public-contract`, `player-link-mutations`, `register-issue224-s9-dev-write-gate`, `site-settings`), so they are pre-existing. The remaining one (`admin-coach-actions`) failed only because the worktree has no `.env` (`DATABASE_URL is not set`) and passes with a dummy in-process `DATABASE_URL`; one further `draftguru-acquisition` case (bridge import gate) fails only in the worktree because the gitignored `data/sources/draftguru/annual-html-20260826` is absent there. None touches this change.
- **Not run / limits:** no live PostgreSQL case, no systemd/nightly-timer run, no real refused/timeout/missing-table observation: the unreachable case is a local refused-port stub, and the missing-table and timeout branches share the one `catch` and are not exercised separately. Live CLI behaviour is not claimed from these mocks. No deployment, DEV or PROD action.

## 18. Readiness, merge and closure (2026-10-14)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 300`: READY (§17.1). `npm run merge:ready -- --issue 300` (raw output, unchanged: `D:\tmp\issue300\merge-ready-raw-1.txt`): every check PASS except **one blocker, "main worktree is clean"**, the primary checkout's **17** untracked paths (nine `.agents/skills` files, seven zero-byte stray-named files including `void`, and the literal `$null)`). Existing warnings: no `afldb-merge-readiness` block in this runbook; no unexpected-file classification (12 committed files); database parity not checked. The worktree was created with `git worktree add -b sonnet/issue-300 <path> 5dff6ea6` (the tip verified equal to the live remote by `git ls-remote`) and a `node_modules` junction, as for the previous issues, because `worktree:bootstrap` is blocked by the same strays.
- **Exception.** The owner authorised a fresh exception for this issue, covering only that clean-tree FAIL and the exact 17-path set, compared by full content hash, **verified immediately before each merge**. `D:\tmp\issue300\exception-check.py` (a copy of the read-only ISSUE-286 script) was run as `precheck-1`, as `premerge-1` immediately before the implementation merge and `postmerge-1` after its push, and again as `premerge-2` immediately before the closure merge and `postmerge-2` after it; every run RESULT OK. It checks: `git status --porcelain -z -uall` lists exactly the 17 paths, all `??` (no tracked change, nothing staged); each a regular file; the nine non-empty files equal their **full 64-hex SHA-256 and length** to both saved 13 Oct snapshots (`D:\tmp\issue313\untracked-blockers-manifest.txt`, `D:\tmp\issue314\closeout-20261013T021336Z\untracked-after.json`); the seven zero-byte files are `e3b0c442…b855`. `$null)` (143 bytes, mtime 2026-10-14 20:00:49) was hashed in full in this session as `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500` and was identical at every check; its content names an earlier session's id (`faae9b3b-a5a0-4405-8817-1c8bc76507ba`), not this one's, so this session's hook had not rewritten it. That hash is valid for this session only. Earlier exceptions were not reused. All 17 paths were left in place. This is current equality with the saved snapshots; it is not evidence of continuous preservation since 13 Oct (see the ISSUE-279 correction, `3f657ae2`).
- **Merge 1.** `47541503` (fix) and `597242cd` (records) fast-forwarded onto `main` (`5dff6ea6..597242cd`) and pushed; local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled `597242cd` afterwards. Before the merge a fresh `git fetch` and `ls-remote` showed `main` still at `5dff6ea6`.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under the satisfied §14 criterion (DB-free unit tests with an unreachable stub, §17.1). The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. No live behaviour is claimed: no run against a real refused connection from a systemd unit, no PostgreSQL restart window, no missing-table or timeout observation (those branches share one `catch` and are not exercised separately), no nightly-timer run. The unreachable case is a local refused-port stub; the fake `ingestionControls` overrides elsewhere are unchanged. The two settle CLIs that go through `proveAflApiIngestionPreflight` were not touched (they already distinguish the case). `reader.readFailure` is a new optional field: a consumer that ignores it behaves exactly as before. The 11 non-integration full-suite failures are pre-existing or worktree-environment effects (§17.1).
