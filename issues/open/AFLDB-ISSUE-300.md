# AFLDB-ISSUE-300 — AFL API control-database read failure is reported as "disabled by a super admin"

## 0. Status

- **Status:** Open (2026-10-08). **Implemented and DB-free validated 2026-10-14** (§17, §17.1) as `47541503` on `sonnet/issue-300` (base `5dff6ea6`); not yet merged. Not deployed.
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

~~Implementation.~~ Done 2026-10-14 (§17). Next: merge and push, then close.

## 17. Implementation record (2026-10-14)

- **Commit:** `47541503` on `sonnet/issue-300`, base `5dff6ea6`. Source: `src/lib/acquisition/afl-api-ingestion-control.ts` and four CLIs (`acquire-afl-api.ts`, `discover-afl-api-seasons.ts`, `acquire-afl-api-brownlow.ts`, `settle-afl-api-fixtures.ts`). Tests: `tests/afl-api-ingestion-control.test.ts`, `tests/afl-api-match.test.ts`, `tests/afl-api-brownlow-acquire.test.ts`, `tests/afl-api-settle-cli-gate.test.ts`.
- **Shape chosen (§13, first option, kept backward compatible).** `AflApiIngestionControls` gains an optional `readFailure?: string`, set only when the switches could not be read (unset `DATABASE_URL`, or any failure of the connection or query). Both flags stay `false`, so fail-closed behaviour is identical and every existing `ingestionControls` override (which has no `readFailure`) behaves as before. The reason is a fixed phrase: `DATABASE_URL is not set`, or `the control database could not be read` plus, only when the error carries a short alphanumeric code (`ECONNREFUSED`, `CONNECT_TIMEOUT`, SQLSTATE `42P01`), that code. The driver's message is never copied, because it can embed connection details. `describeAflApiIngestionReadFailure(controls)` renders the one operator sentence (`...could not be read: <reason>. This is a read failure, not a super-admin "disabled" setting; the tool is failing closed. Check that PostgreSQL is reachable and that DATABASE_URL is set for this process.`) or `null` for a genuine stored value.
- **CLIs.** `acquire-afl-api`, `discover-afl-api-seasons --fetch` and `settle-afl-api-fixtures` throw `AFL API current-season ingestion refused: <sentence>` instead of the admin-switch message when `readFailure` is present; the stored-`false` message is unchanged. `acquire-afl-api-brownlow` reports the deployment gate state and says the super-admin setting is *unknown because* the switches could not be read. **Scope note:** §11 names three CLIs; `settle-afl-api-fixtures.ts` is a fourth caller of the same reader with the identical message, so it was brought into line rather than left misleading. `settle-afl-api.ts` and `settle-afl-api-brownlow.ts` already distinguish the case through `proveAflApiIngestionPreflight` (`afl-api-ingestion-safety.ts:90-93`) and were not touched.
- **Unchanged.** Fail-closed semantics, the `AFLDB_SETTLE_FAILURE` marker, the reader's never-throws contract, the two-key Brownlow composition.

## 17.1 Validation (2026-10-14, assistant-run on the owner's explicit authorisation; Windows, DB-free)

- `npx vitest run` of `tests/afl-api-ingestion-control.test.ts`, `afl-api-brownlow-acquire`, `afl-api-settle-cli-gate`, `afl-api-ingestion-safety`, `afl-api-match`: **5 files, 435 passed.** New cases drive the **real** reader output (`readAflApiIngestionControls({})`, an unreachable `127.0.0.1:1` stub and a malformed DSN) into the real CLI entry points with a fetch stub that fails if called: the message names the read failure, does not say "A super admin must enable it", and no request, file or database write follows; the reason and sentence contain none of the password, role, host or database name from the DSN; a stored-disabled value carries no `readFailure`. Two existing assertions that pinned `toEqual(DISABLED...)` for an unreadable result now use `toMatchObject` plus the flag checks (the flags are still asserted `false`); no assertion was removed.
- **Negative control:** with `src/` and `tools/` restored to the base, **9 tests fail** (4 control, 2 match, 2 settle-gate, 1 Brownlow); the fix was restored afterwards.
- `npx tsc --noEmit` exit 0; `npx eslint` of the six changed source/test files exit 0; `git diff --check` exit 0. `npm run preflight -- --mode implementation --issue 300`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; `D:\tmp\issue300\preflight-impl.txt`).
- Full `npx vitest run` in the worktree (`D:\tmp\issue300\full-vitest.txt`): the integration files cannot run without a database, and 11 non-integration tests fail. The same 11 files were re-run in the primary checkout at the unmodified base: 10 of the 11 fail identically there (`awards-admin`, `behind-holder`, `correct-afl-api-identity-cli`, `current-season-import`, `draftguru-acquisition` (review tool), `finals-semantics-contract`, `honours-lifecycle-public-contract`, `player-link-mutations`, `register-issue224-s9-dev-write-gate`, `site-settings`), so they are pre-existing. The remaining one (`admin-coach-actions`) failed only because the worktree has no `.env` (`DATABASE_URL is not set`) and passes with a dummy in-process `DATABASE_URL`; one further `draftguru-acquisition` case (bridge import gate) fails only in the worktree because the gitignored `data/sources/draftguru/annual-html-20260826` is absent there. None touches this change.
- **Not run / limits:** no live PostgreSQL case, no systemd/nightly-timer run, no real refused/timeout/missing-table observation: the unreachable case is a local refused-port stub, and the missing-table and timeout branches share the one `catch` and are not exercised separately. Live CLI behaviour is not claimed from these mocks. No deployment, DEV or PROD action.
