# AFLDB-ISSUE-274 — A settle unit that writes only the `matches` row takes no row lock before its authority read

## 0. Status

- **Status:** Open (2026-10-08). Nothing implemented.
- **Severity:** Medium. **Area:** acquisition / settle concurrency / manual authority.
- **Key file:** `src/lib/acquisition/canonical-apply.ts` (`lockUnitMatchRows`, `applyCanonicalUnit`, the writers).
- **Origin:** full code review at `20a7a4bbdea835cdd3fc5520e65ad47d275bd881` (`issues/reviews/2026-10-08-full-code-review.md`, F-009; partition note R4a-F01). The orchestrator re-read `canonical-apply.ts:490-506` and confirmed it.
- **Classification:** code-proven mechanism. The concurrent interleaving has not been executed.

## 1. Summary

`lockUnitMatchRows` locks the match row only when a retired-identity rekey candidate exists, or when the unit carries a `player_match_stats` target. A unit whose targets are `matches` and/or `match_period_scores` therefore reads manual authority (E4) and re-reads the row (E5) without any lock, and only then issues `UPDATE matches`. A Data Editor score edit that commits in between is overwritten by the source value, while its `data_overrides` row stays active.

## 2. Evidence

- `src/lib/acquisition/canonical-apply.ts`:
  - `:490-506`: the lock is taken only for a rekey candidate (`:491-501`) or a `player_match_stats` target (`:503-505`).
  - `:1026`: `loadManualAuthority`.
  - `:516-518`: an unlocked `SELECT * FROM matches`.
  - `:1106-1112`: E5. `:1165-1185`: E4.
  - `:807-811`: `UPDATE matches … WHERE id`. The writers return `rowsUpdated: 1` without checking the count (`:807-811`, `:891-895`, `:931-935`).
  - The module's own rule (`:14-17`, `:1021-1024`) says authority must be read under a lock that excludes a concurrent human write.
  - `applyAttendanceEnrichment` already does this: `FOR UPDATE` at `:1394-1401` before `loadManualAuthority` at `:1427`.
- `src/db/queries/data-edits.ts:205, :250, :314, :388, :428`: the editor takes `FOR UPDATE`, applies the edit, and upserts the override in one transaction.
- `issues.md:47708` (ISSUE-261 writer table) describes every settle unit as holding the match row `FOR SHARE`. That is true only for player and rekey units.

## 3. Trigger

1. The nightly settle (`--auto-apply`) carries a corrected score for match M.
2. A super admin's Data Editor score edit on M commits after the unit's authority load but before (or while blocking) the unit's UPDATE.

## 4. Expected invariant

A human edit committed during a settle is never overwritten. Authority and baseline are read under a lock as strong as the unit's own write.

## 5. Actual behaviour

Under READ COMMITTED the settle's UPDATE waits, re-evaluates only `id = $1`, and writes the source value over the human's. Later runs see no diff (`nothing_to_write`), so the human value is never restored. The `canonical_applications` row records stale `previous_values`. A concurrent `deleteMatch` in the same window makes the unit log and count an update to a row that no longer exists.

## 6. First wrong layer

`src/lib/acquisition/canonical-apply.ts:490-506`.

## 7. Impact

Silent loss of a human-pinned canonical value, leaving a self-inconsistent state (override active, canonical value from source) and a wrong ledger. The window is narrow, but it is the same race class ISSUE-257 §18.6 item 5 fixed for player rows.

## 8. Reproduction / witness

Not executed. It needs two sessions. See §14.

## 9. Disproof attempts

- E5 compares two reads that both precede the editor's commit.
- E4 is read before the wait.
- The ISSUE-265 settle/promotion gate is not taken by the Data Editor.
- No deadlock or timeout fires.

## 10. Existing-issue search

- ISSUE-257 scoped its lock to Match Sheet and player rows. ISSUE-261 covers the recompute deadlock.
- Classification: **new**, a scope gap adjacent to resolved ISSUE-257 (not a regression).

## 11. Scope

The lock taken by `lockUnitMatchRows` for `matches` and `match_period_scores` targets, and the writers' affected-row checks.

## 12. Out of scope

The Data Editor side, which already locks first.

## 13. Proposed fix boundary

- When the unit carries a `matches` or `match_period_scores` target that resolves to a row, lock that row (`FOR NO KEY UPDATE` or `FOR UPDATE`) before `loadManualAuthority`.
- Make the three writers return the driver's count and treat 0 as `write_failed`.
- Lock order matches the editor and `deleteMatch` (match row first).

## 14. Proposed validation

1. DB-free: a statement-recording `sp` asserting that a lock precedes the authority load for a `matches`-only unit.
2. Integration: editor transaction locks → settle unit → editor commits. Assert the canonical value equals the editor's and that no ledger row was written.

## 15. Decisions / unresolved questions

- Amend the ISSUE-261 writer table wording when this is fixed.

## 16. Next action

Code fix plus tests. Consider sequencing with AFLDB-ISSUE-275 (same function).
