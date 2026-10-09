# AFLDB-ISSUE-293 — Settle runs under-report `dataIssuesResolved`

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** acquisition / settle run accounting.
- **Key files:** `src/lib/acquisition/settle-afltables.ts`, `src/lib/acquisition/settle-afl-api.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-028; partition note R4a-F03).
- **Classification:** code-proven.

## 1. Summary

- The AFL Tables run sums healed `canonical_apply_failed` findings into `counters.dataIssuesResolved` during the run, then assigns (`=`) the end-of-run `resolveRestoredDisagreements` count, discarding the earlier sum.
- The AFL API run discards the returned counts of two resolve calls.

`import_batches.validation_result.dataIssuesResolved` and the CLI counters therefore under-report.

## 2. Evidence

- `src/lib/acquisition/settle-afltables.ts:1900` (assignment); the increments at `:3445-3455` and `:3497-3502`.
- `src/lib/acquisition/settle-afl-api.ts:1389` and `:1430-1433` (discarded); `:626` counts.
- Stamped at `settle-afltables.ts:1954` and `settle-core.ts:1215`.

## 3. Trigger

An AFL Tables run that heals an apply failure and restores no disagreement, which reports 0.

## 4. Expected invariant

Honest run counters (ISSUE-244 F008: `validation_result` is the durable record).

## 5. Actual behaviour

Healed findings are under-counted.

## 6. First wrong layer

`settle-afltables.ts:1900`; `settle-afl-api.ts:1389, :1430`.

## 7. Impact

Reporting only. The `data_issues` rows themselves are resolved correctly.

## 8. Reproduction / witness

Not executed.

## 9. Disproof attempts

The tests (`settle-afltables.test.ts:1498, :1518`; `settle-afl-api.test.ts:3072, :3197`) do not cover a mixed run.

## 10. Existing-issue search

`dataIssuesResolved` has no entry. Classification: **new**.

## 11. Scope

The three counter sites.

## 12. Out of scope

The other counters (AFLDB-ISSUE-294).

## 13. Proposed fix boundary

`+=` at all three sites.

## 14. Proposed validation

Integration: after an apply-failure heal, assert `dataIssuesResolved === 1`.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation (trivial).
