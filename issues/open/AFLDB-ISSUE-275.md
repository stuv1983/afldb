# AFLDB-ISSUE-275 — A settle can insert period scores under a match it refused because a foreign owner created it concurrently

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** acquisition / canonical ownership / provenance.
- **Key file:** `src/lib/acquisition/canonical-apply.ts` (`applyCanonicalUnit`, `readFreshTarget`).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-010; partition note R4a-F02). The orchestrator re-read `canonical-apply.ts:1089-1099` and confirmed it.
- **Classification:** code-proven mechanism. The concurrent interleaving has not been executed.

## 1. Summary

`applyCanonicalUnit` binds `matchId` from the `matches` target's fresh read before that target's E3 (owner) and E5 (baseline) gates decide. If the `matches` target is then refused, `matchId` is not cleared. The same unit's `pending_match` `match_period_scores` target reads an empty set as `new_target` without consulting the parent's owner, passes, and inserts `afltables`-owned period rows under a match another source owns.

## 2. Evidence

- `src/lib/acquisition/canonical-apply.ts`:
  - `:1089-1091`: `if (target.targetTable === 'matches' && fresh.targetId !== null) matchId = fresh.targetId;` runs before E3 (`:1094-1099`) and E5 (`:1106-1112`).
  - Only the rekey / `possible_existing_match` branch (`:1079-1085`) withholds dependents (`fixtureBlocked`).
  - `:589-604`: an empty period set → `new_target`, with no parent-owner check.
- `src/lib/acquisition/settle-afltables.ts:2199-2230, :2414-2440`: the `pending_match` invitation with a null baseline.
- The module's own rules: "a match family is all or none" (`canonical-apply.ts:30-35`), and `settle-afltables.ts:3088-3092`, which forbids a period set under a foreign-owned or source-less match.
- Overlap evidence: both timers run nightly (`deploy/afldb-settle-afltables.timer` 04:30 + 15 min; `deploy/afldb-settle-afl-api.timer` 05:00 + 15 min). Both take the settle gate SHARED (`settle-core.ts:408`). ISSUE-265's runbook measured AFL Tables starts inside AFL API intervals (`issues/open/AFLDB-ISSUE-265.md:718-721`).

## 3. Trigger

1. A fixture neither source has settled yet.
2. The AFL Tables run loads its references with no row for key K, so it plans `matches` (`new_target`) plus `match_period_scores` (`pending_match`).
3. Before that unit runs, the AFL API run inserts K as an `afl_api`-owned match with no period rows.

## 4. Expected invariant

A period set is never written when the same unit's `matches` target was refused.

## 5. Actual behaviour

- `matches` → `foreign_source_owner` (refused).
- `match_period_scores` → `new_target` → insertable → four `afltables` rows and a ledger row are written under the `afl_api` match.
- Afterwards each source is refused on the other's rows on every run. The derived recompute does not include the match.

## 6. First wrong layer

`src/lib/acquisition/canonical-apply.ts:1089-1091`.

## 7. Impact

- Split ownership: child rows owned by a different source than their parent, contrary to the documented contract.
- Perpetual refusal findings on both sides.
- No value corruption.

## 8. Reproduction / witness

Not executed. The integration recipe is in §14.

## 9. Disproof attempts

- The non-concurrent paths hold (an existing row is never `pendingMatch`; the AFL API planner corroborates an existing row).
- The F030 ambiguity guard covers different-round/date rows only.
- The gate is SHARED by design, so it does not serialise the two settles.

## 10. Existing-issue search

- ISSUE-265 (lock deadlock; a different root cause), ISSUE-244 F030 (plausible-fixture INSERT refusal), ISSUE-131.
- Classification: **new**. Cross-references ISSUE-265 (overlap evidence).

## 11. Scope

Dependent-target withholding in `applyCanonicalUnit`.

## 12. Out of scope

Serialising the two settles (an ISSUE-265 design decision).

## 13. Proposed fix boundary

When the unit's `matches` target is refused for any reason, set `fixtureBlocked` / clear `matchId` so `match_period_scores` is withheld. Optionally, make an empty period set inherit the parent row's owner in `readFreshTarget`.

## 14. Proposed validation

Integration (`tests/integration/settle-afltables.test.ts`): after the run's `loadRefs`, pre-insert an `afl_api`-owned match through the `manualAuthorityLoader` hook. Assert that no `match_period_scores` row and no ledger row are written.

## 15. Decisions / unresolved questions

- Whether any DEV or PROD fixture already has split ownership. Read-only census: period rows whose `source_id` differs from the parent match's.

## 16. Next action

Code fix plus integration case. Sequence with AFLDB-ISSUE-274.
