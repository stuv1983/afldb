# AFLDB-ISSUE-301 — AFL API HTTP client has no request timeout and reads the body outside its retry

## 0. Status

- **Status:** **Resolved (2026-10-15, merge-scoped; opened 2026-10-08).** Implemented and merged as `0d3d03b5` (fix, tests and records), validated DB-free (§17), merged and pushed (§18). **Not deployed.**
- **Severity:** Low. **Area:** acquisition / network resilience.
- **Key file:** `src/lib/acquisition/afl-api-client.ts` (`requestAflApi`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-036; partition note R4b-F06).
- **Classification:** code-proven.

## 1. Summary

`fetchImpl(url, { method, headers })` is called with no `AbortSignal`, and `await response.text()` sits outside the retried `try`. An upstream that accepts the connection and never completes the body hangs the run until systemd's `TimeoutStartSec` kills it. A body-stream failure is thrown unretried as a plain `TypeError`, bypassing the backoff and the 401/403 reissue logic.

## 2. Evidence

- `src/lib/acquisition/afl-api-client.ts:240-249` (the retried region), `:241` (no signal) and `:253` (body read outside the retry).
- The CLIs pass the global `fetch` (`acquire-afl-api.ts:403`, `acquire-afl-api-brownlow.ts:248`, `discover-afl-api-seasons.ts:133`).
- `deploy/afldb-settle-afl-api.service:36` (3600 s) and the Brownlow unit's 180 s.

## 3. Trigger

The upstream stalls mid-body (for example on match 150 of 200).

## 4. Expected invariant

Each attempt is bounded by a timeout, and the body read is inside the retried region.

## 5. Actual behaviour

The whole nightly window is lost to one request. On SIGTERM the Node `finally` does not run, so the cleanup at `acquire-afl-api.ts:410-412` is skipped and a manifest-less partial directory remains.

## 6. First wrong layer

`src/lib/acquisition/afl-api-client.ts:241, :253`.

## 7. Impact

Operational resilience. The run still fails visibly.

## 8. Reproduction / witness

Not executed. A DB-free check with a never-resolving stub fetch and fake timers is proposed.

## 9. Disproof attempts

No timeout exists at any layer below systemd.

## 10. Existing-issue search

The "timeout" hits in `issues.md` are database statement timeouts only. Classification: **new**.

## 11. Scope

The client request loop.

## 12. Out of scope

Retry-After handling (bounded; recorded in the review as rejected).

## 13. Proposed fix boundary

Use `AbortSignal.timeout` per attempt and move the body read inside the retry.

## 14. Proposed validation

DB-free: a stub fetch that never resolves makes `requestAflApi` reject within the budget.

## 15. Decisions / unresolved questions

- The timeout value (operator or implementation choice).

## 16. Next action

~~Implementation.~~ Superseded by §17.

## 17. Implementation and validation (2026-10-15)

### 17.1 Change

- `src/lib/acquisition/afl-api-client.ts` (`requestAflApi`): each attempt is now one unit under a deadline. A new private `attemptWithDeadline` creates an `AbortController`, passes its signal to the injected `fetch`, reads the body of a 2xx response inside the same unit, and races the unit against a timer. At the deadline it aborts the signal and rejects with an `AflApiRequestError` (`timed out after N ms`, status `null`), so a transport that ignores the signal cannot hang the run either. A timeout, a failed body read and a network failure all go through the existing retry and backoff; a 401/403 is still thrown immediately for the reissue-once policy.
- `RetryOptions.timeoutMs` (optional) carries the per-attempt budget; a value that is not a positive finite number is refused with a `RangeError` before any request.
- **The budget (§15's open value).** The runbook allows either an operator or an implementation choice. This change takes an **implementation default of 60 000 ms per attempt**, recorded here as such: it is not a measured figure and not an owner decision. The feeds are small JSON documents, so a healthy attempt takes seconds, and three attempts at 60 s plus backoff (about 3 minutes worst case per request) stay far inside the nightly unit's 3 600 s and are the same order as the Brownlow unit's 180 s. Any caller can pass another value; no environment variable was added.
- No change to the callers (the CLIs pass the global `fetch`), the retry count or the backoff.

### 17.2 Tests

`tests/afl-api-match.test.ts` (DB-free; the existing `requestAflApi` block), five cases with fake timers and stub transports, none of which touches a network: a transport that never answers and ignores the signal is abandoned at the budget with its signal aborted and the next attempt given a fresh one, and the call rejects after the last attempt with the timeout error and the attempt count; a 200 whose body never arrives is abandoned and retried and a later attempt can succeed (the body is inside the retry and the deadline); a body read that throws is retried with the normal backoff instead of escaping as a bare `TypeError`; every attempt receives a signal and the default budget is 60 s (59 999 ms is still pending, 60 000 ms rejects); a non-positive or non-finite `timeoutMs` is refused with no request made.

### 17.3 Results

- **Fixed code.** `tests/afl-api-match.test.ts`: **220 passed** (5 new). With `afl-api-ingestion-safety`, `afl-api-brownlow-acquire`, `afl-api-brownlow` and `afl-api-rounds`: **449 passed** in 5 files. No database was used.
- **Unfixed source** (`git checkout HEAD -- src/`, the fixed file copied back and sha-256 verified): all 5 new cases fail (run with a 2 s test timeout, because the unfixed client hangs on the stalled transport, which is the defect).
- **Mutants** (`D:\tmp\issue301\mutate.mjs`, one at a time, original bytes restored and hash-verified after each): no signal passed (W1), the deadline never rejecting (W2), the signal never aborted (W3), the body read outside the deadline (W4), the default budget 30 s (W5), no validation (W6), and a timeout not retried (W7). **All 7 killed.**
- **Static.** `tsc --noEmit` exit 0; `git diff --check` exit 0; ESLint of the two changed files exits 1 on this branch and on unchanged `main` with an identical problem set (compared by rule and message): none introduced.

### 17.4 Limits

- Not deployed; no network, DEV or PROD action. The behaviour against the real upstream is not exercised: the transports are stubs. The §5 observation that a SIGTERM skips the acquire CLI's cleanup is not changed; the point of the timeout is that a stalled request now fails the run visibly, with `finally` running, long before systemd's limit. The 60 s default is an implementation choice that an owner may change.

## 18. Readiness, merge and closure (2026-10-15)

- **Readiness: accepted under a scoped cleanliness exception, not a clean pass.** `npm run preflight -- --mode implementation --issue 301` on the committed worktree: READY (0 blockers, 3 warnings: `.env`, `psql`, `pg_restore`; raw `D:\tmp\issue301\preflight-1.txt`). `npm run merge:ready -- --issue 301` (raw, unchanged: `D:\tmp\issue301\merge-ready-raw-1.txt`): BLOCKED by exactly one blocker, the primary worktree not clean; every other check PASSed, with two metadata warnings (no runbook readiness JSON block; no automated unexpected-file classification). The five committed paths were compared with the declared scope by hand: `afl-api-client.ts`, the AFL API match test, this runbook, `issues.md` and `IssuesIndex.md`.
- **Exception (fresh, this issue only).** The owner authorised an exception covering only that clean-tree FAIL under the exact **18**-path primary state (the nine `.agents/skills` files, the seven zero-byte stray-named files, the literal `$null)` and the zero-byte `2000)`). Immediately before the merge a script verified the 18 paths, their full sha-256 hashes (`$null)` `d9edb146…2500`, unchanged since the session start), no tracked and no staged primary change, and that fresh `main`, `origin/main` and the live remote agreed (`premerge-1.txt`); it read OK again after the push (`postmerge-1.txt`).
- **Merge.** `0d3d03b5` fast-forwarded onto `main` and was pushed (`1d2ec9fb..0d3d03b5`); local `main` and `git ls-remote origin refs/heads/main` both equalled `0d3d03b5` afterwards.
- **Resolution.** Resolved on the push of the documentation-only closure commit. §14 asks for a DB-free check that a stub fetch that never resolves makes `requestAflApi` reject within the budget; it exists and passes, with the body-read cases (§17.2, §17.3). §15's open value was settled as an **implementation default of 60 s per attempt**, which the runbook permitted ("operator or implementation choice"); it is recorded as such and is not an owner decision. The closure scope is **merge-scoped**: code on `main`, validated DB-free, **not deployed**.
- **Preserved limits.** Not deployed. No network, DEV or PROD action; the behaviour against the real upstream is not exercised. The 60 s default may be changed by the owner. The SIGTERM cleanup observation in §5 is not changed in itself.
