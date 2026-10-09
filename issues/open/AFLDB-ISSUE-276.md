# AFLDB-ISSUE-276 — AFL API period scores that contradict the final score are written

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** acquisition / AFL API settle / data integrity.
- **Key files:** `src/lib/acquisition/afl-api-settle-plan.ts` (`planRosterFamily`), `src/lib/acquisition/afl-api-bundle.ts`.
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-011; partition note R4b-F02). The main session grepped the flag's consumers.
- **Classification:** code-proven.

## 1. Summary

The AFL API bundle computes `periodScoresReproduceFinalScore`: do the match-roster widget's cumulative period scores reproduce the fixture's final score? The bundle's own doc calls this check "§9 assertion 4". The flag is never consulted by the settle plan or the writer, so a `false` result still yields a planned roster family, and the contradicting period scores are written to `match_period_scores`.

## 2. Evidence

- `src/lib/acquisition/afl-api-bundle.ts:1154-1158` (flag doc) and `:1209-1215` (flag computed).
- `src/lib/acquisition/afl-api-settle-plan.ts:356-366`: `planRosterFamily` decides on `rosterRecord.deferral` and the match target only.
- Repository grep: the flag is consumed only by `tools/current-season/emit-afl-api-bundle.ts:457-460` (the backtest report).
- `src/lib/acquisition/settle-afl-api.ts:705-722`: `cumulativePeriodsOf` checks only intra-roster consistency. `:1458-1477`: the period proposal. `canonical-apply.ts:844-856`: the upsert.
- Contrast: `local_time_contradiction` refuses (`afl-api-bundle.ts:1109-1116`).

## 3. Trigger

A CONCLUDED fixture (home 100, away 80) whose separately fetched match-roster payload carries a stale or partial `recentMatchScores` entry. For example, its periods sum to 70/55, or it has three periods only.

## 4. Expected invariant

A `false` cross-family check refuses the roster family (for example `period_scores_contradict_final_score`) and records a data issue. A `null` result (no own-match entry) stays skipped.

## 5. Actual behaviour

The roster record is planned, and the contradicting checkpoints are written. The match row and its period rows then disagree.

## 6. First wrong layer

`src/lib/acquisition/afl-api-settle-plan.ts:356-366`.

## 7. Impact

Canonical quarter checkpoints whose final cumulative points differ from the match result. NL quarter/half/three-quarter-time answers compile over `match_period_scores`.

## 8. Reproduction / witness

Not executed. A DB-free witness was proposed in the R4b notes: build a bundle whose roster periods sum to 70/55 against a 100/80 fixture, then call `buildAflApiSettleRecords`. The expectation is a deferral or rejection; today the record carries a projection.

## 9. Disproof attempts

No gate exists in `settle-afl-api.ts`, `canonical-apply.ts` or `afl-api-settle-plan.ts`, and `buildAflApiSettleRecords` creates no deferral from the flag.

## 10. Existing-issue search

- `issues.md` was searched for `cumulative`, `assertion 4` and `periodScoresReproduceFinalScore`. The hits are ISSUE-048 (NL compile) and backtest tallies only.
- Classification: **new**.

## 11. Scope

Gating the roster family on the flag.

## 12. Out of scope

AFL Tables period scores.

## 13. Proposed fix boundary

In `buildAflApiSettleRecords` or `planRosterFamily`, map `periodScoresReproduceFinalScore === false` to a roster-family refusal, and record a data issue in the writer.

## 14. Proposed validation

DB-free: `tests/afl-api-settle-plan.test.ts` or `tests/afl-api-match.test.ts` with the bundle in §8, asserting that the roster record carries no projection.

## 15. Decisions / unresolved questions

- The refusal reason name and its data-issue type (operator or implementation choice).

## 16. Next action

Code fix plus DB-free test.
