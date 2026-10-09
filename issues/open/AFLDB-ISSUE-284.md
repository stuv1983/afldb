# AFLDB-ISSUE-284 — Brownlow season "accounted" count excludes a drafted source-complete match and blocks Publish

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Low. **Area:** admin Brownlow.
- **Key file:** `src/db/queries/admin-brownlow.ts` (`selectSeasonAggregates`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-019; partition note R2a-F03). The orchestrator confirmed that `player-derived.ts:651` (coverage) uses the facts rule and is unaffected.
- **Classification:** code-proven.

## 1. Summary

The season aggregate counts a match as `imported` only when `entry_status IS NULL AND facts_complete`. A match that already has a complete 3/2/1 from the source, and on which an Admin presses "Save draft", is therefore counted in none of final, voided or imported. The season reads "not complete", and the Publish panel lists a blocker and disables "Publish season…". Meanwhile the publish transaction's own gate, the per-round tables and the pure rule `isMatchAccounted` all count the match as accounted.

## 2. Evidence

- `src/db/queries/admin-brownlow.ts:213` (the `imported` predicate) and `:261-262` (accounted/complete).
- The gate: `admin-brownlow.ts:1313-1316`. Per-round: `:339-342`, `src/app/admin/brownlow/[season]/[round]/page.tsx:51-53`. The badge: `admin-brownlow-ui.ts:113-116`.
- `src/lib/brownlow/entry.ts:529-534` (`isMatchAccounted`), `:416-420` (draft allowed from null).
- The UI: `MatchVoteEditor.tsx:343-352` (Save draft rendered), `PublishPanel.tsx:66-77, :161`.

## 3. Trigger

An Admin (`data.brownlow.draft`) saves a draft on a historical match whose source votes are complete.

## 4. Expected invariant

One accounting rule: a complete 3/2/1 is accounted, whatever its draft row.

## 5. Actual behaviour

The coverage strip and the Publish control disagree with the gate and the round tables, and Publish is blocked in the UI.

## 6. First wrong layer

`src/db/queries/admin-brownlow.ts:213`.

## 7. Impact

The operator is misled, and publishing is blocked until a Super Admin finalises the drafted match. No data effect.

## 8. Reproduction / witness

Not executed (DB-backed).

## 9. Disproof attempts

- No UI guard prevents a draft on an imported match.
- The aggregate does not feed the gate.

## 10. Existing-issue search

ISSUE-155 §27.9 defines accounted as `final + void + imported`. "Imported" is implemented two ways. Classification: **new**.

## 11. Scope

The aggregate predicate and the derived status.

## 12. Out of scope

Coverage (`player-derived.ts`), which is unaffected.

## 13. Proposed fix boundary

Count `facts_complete` without the `entry_status IS NULL` condition for accounting, keeping `imported` as a display count if wanted.

## 14. Proposed validation

Integration (`tests/integration/admin-brownlow.test.ts`): a draft on an imported match → the season is still complete and publish is accepted.

## 15. Decisions / unresolved questions

None.

## 16. Next action

Implementation.
