# AFLDB-ISSUE-301 — AFL API HTTP client has no request timeout and reads the body outside its retry

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

Implementation.
