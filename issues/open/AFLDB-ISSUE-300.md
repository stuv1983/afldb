# AFLDB-ISSUE-300 — AFL API control-database read failure is reported as "disabled by a super admin"

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
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

Implementation.
