# AFLDB-ISSUE-311 — Activity audit after a committed player-link mutation is unwrapped or silent

## 0. Status

- **Status:** Resolved (2026-10-15, merge-scoped; opened 2026-10-08). Implemented on `sonnet/issue-309` (shared with ISSUE-309); DB-free validated; merged and pushed as `7ebe2763`; not deployed. See §17 and §18.
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

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 309`: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`). `npm run merge:ready -- --issue 311` with eight `--expected-file` rules (raw output, unchanged: `D:\tmp\issue309\merge-ready-raw-1.txt` for 309 and `merge-ready-raw-2-issue311.txt` for 311): every check PASS (branch, clean issue worktree, `main` equals recorded `origin/main`, ahead 3 / behind 0, migration parity, declared scope 8 changed / 0 unexpected) except **one blocker, "main worktree is clean"**, the primary checkout's untracked paths; one warning (no runbook readiness JSON block). `worktree:bootstrap` was not run: earlier closures record it blocked by the same paths, so the worktree was created with `git worktree add -b sonnet/issue-309 D:\dev\afldb-issue-309 origin/main` at the live-remote-verified tip `f959e68f`.
- **Exception.** The owner authorised a fresh exception for ISSUE-309 and ISSUE-311, covering only that clean-tree FAIL and the exact 17-path set (nine `.agents/skills` files, seven zero-byte files, the literal `$null)`), compared by full content hash and verified immediately before the merge with `D:\tmp\issue309\exception-check.py` (a copy of the ISSUE-298 script): `precheck-1`, `premerge-1` (with `$null)` pinned to `d9edb1467a9ddecc7ca89424e5b5597f3c6fae7e5e41b49bb279aa1f71f62500`) and `postmerge-1`, all RESULT OK. `$null)` (143 bytes, mtime 2026-10-14 20:00:49) was identical at every check. This is current equality with the saved 13 Oct snapshots, not continuous preservation.
- **Discrepancy, reported not hidden.** An **eighteenth** path appeared in the primary during this session: zero-byte `2000)` (sha-256 `e3b0c442...b855`, mtime 2026-10-15 06:39:27). It was absent from the session-start status and from the first status check, its origin is unknown, it was not created by this work, and it was left untouched. It lies outside the 17 the owner named; the script was adapted only to report it as ADDITIONAL (a regular zero-byte file) and it appears in the raw readiness FAIL. The owner may ratify or remove it.
- **Merge.** Before the merge a fresh `git fetch` and `git ls-remote` showed `main` still at `f959e68f`. `adbe6329`, `c7e583e0` and the records commit `7ebe2763` fast-forwarded onto `main` and were pushed (`f959e68f..7ebe2763`); local `main`, the fetched `origin/main` and `git ls-remote origin refs/heads/main` all equalled `7ebe2763` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit, under §14 ("DB-free unit test with `audit` mocked to reject"): met by the rejected-audit cases for `confirmUnlinked`, `reviewSuggestion` and both AFL API actions (§17.1; ISSUE-309 §17.1); §15 lists no decision. The closure scope is **merge-scoped**: code on `main`, DB-free validated, **not deployed**.
- **Preserved limits.** Not deployed. No PostgreSQL, integration, browser, network-acquisition, DEV or PROD action. The added text in `SuggestionControls.tsx` and `AflApiAdjudicationForm.tsx` appears only after a failed activity audit and was not rendered: **VISUAL: UNVERIFIED**, pinned by source contracts. After a partial result the Resolve panel stays until the page is reloaded (it already did for an audit warning). One pre-existing unrelated failure in `tests/player-link-mutations.test.ts` (I14, `settle-afl-api.test.ts:2881`) is untouched and identical on unchanged `main`. ISSUE-308 (`approveSuggestion`/`bulkApproveSuggestions` revalidation) is untouched and still open; `auditInTransaction` and the `refreshSuggestions` audit are unchanged.
