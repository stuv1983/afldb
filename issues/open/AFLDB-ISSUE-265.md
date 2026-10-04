# AFLDB-ISSUE-265 — A settle unit can lose a match-lock deadlock to a legacy CSV promotion, with no in-run retry

## 0. Status

- **Status:** Open. **Unimplemented.** Nothing has been changed for this issue.
- **Opened:** 2026-10-04 (from AFLDB-ISSUE-264 F-002; operator decision D-264-11).
- **Severity:** Low.
- **Area:** data integrity / concurrency, source settles versus legacy file intake.
- **Disposition:** a **temporary limitation, accepted by the operator under D-264-11** (ISSUE-264 runbook
  §14.5.3). The acceptance is not a claim that the deadlock is eliminated, and it is not a decision about
  mitigation.
- **Mitigation:** the options in §6 are **undecided**. No option has been chosen, designed or approved.
- **Origin:** `issues/open/AFLDB-ISSUE-264.md` §14.2 (F-002), §14.3, §14.4.3 and §14.5.
- **Tracker entry:** `issues.md` (Open Issues table and the ISSUE-265 section); `IssuesIndex.md`.

## 1. Summary

AFLDB-ISSUE-264 made both legacy CSV promotion hooks take match locks, so a promotion and a source settle can
now lock overlapping matches in different orders. If the settle loses the resulting deadlock, only the
settle's current unit rolls back, and the unit is not retried inside that run. The unit is re-offered on the
provider's next in-season run. The deadlock itself is not eliminated.

This is **new relative to `main`**: before ISSUE-264 neither legacy hook took match locks.

## 2. Ownership check

- **AFLDB-ISSUE-261** is a different issue. It owns the end-of-run `recomputePlayerDerivedStats` row-lock
  order against the Data Editor and match-admin writers: a different lock site (`player_match_stats` rows
  of a player, at the end of the run) and different writers. ISSUE-265 concerns a settle **unit's match
  lock** against a **legacy CSV promotion**. Neither mitigation fixes the other.
- No other `issues.md` entry owns a settle unit's match lock against a legacy promotion. `issues.md` was
  searched for deadlock, `40P01` and lock order (ISSUE-264 runbook §14.5.3).
- ID check: a read-only `git grep` over all 84 local and remote refs, and the `issues.md` of every sibling
  `afldb*` worktree, found no ID from 265 up (ISSUE-264 runbook §14.5.3).

## 3. Defect

- **Who takes which lock.**
  - Both settles (AFL Tables and AFL API) apply a unit through `applyCanonicalUnit`
    (`src/lib/acquisition/canonical-apply.ts`). The unit's match lock is `lockUnitMatchRows` (:490), taken
    **inside** the unit savepoint `afldb_canonical_apply_unit` (savepoint :1004, lock :1025). Units are
    taken in feed order, and the locks are held to the end of the settle transaction.
  - The ISSUE-264 promotion hooks in `src/lib/ingest/datasets.ts` lock their **existing** matches in
    ascending id and hold them to commit: `match_results` with `FOR NO KEY UPDATE`, the
    `player_match_stats` hook with `FOR SHARE`. Both bound their wait with `withLegacyLockTimeout`, a
    transaction-local 5 s timeout.
- **The cycle.** The settle holds a later match and asks for an earlier one that the promotion holds, while
  the promotion asks for a match the settle holds. The settle is the victim when its deadlock check fires
  first. The promotion is normally the victim (it fails after its 5 s bound with a retryable message and can
  be promoted again, ISSUE-264 §14.3).
- **Effect when the settle is the victim.**
  - `canonical-apply` rolls only the failing unit back to its savepoint and releases it (rollback at
    :1273-1274, `ROLLBACK TO` then `RELEASE`). The function returns a failure without throwing, so the outer
    settle transaction stays usable and commits its other units.
  - No canonical row and no `canonical_applications` ledger row survive from that unit.
  - The settle increments `canonicalApplyFailures` and opens one `canonical_apply_failed` finding
    (severity `error`) per target in the unit.
  - **There is no in-run retry of the unit.** The derived recompute has its own bounded `40P01` retry; that
    is a different lock site (ISSUE-261).

## 4. Recovery (code-traced; ISSUE-264 runbook §14.5.2)

Neither provider strands the work permanently, in code. The recovery condition for both is a later
**in-season** run of the same provider.

### 4.1 AFL Tables

- Every run acquires the whole in-progress season (`deploy/afldb-settle-afltables.sh`, `--from/--to
  "$season"`), so the record is in the next bundle. Its payload has not moved, so `reconcile()` answers
  `unchanged`.
- `invitationFor` (`settle-afltables.ts`, §9.3 retry) offers a `retry` whenever the automatic proposal still
  differs from the canonical target. The retry passes through every normal gate (ownership, authority,
  disagreement) inside the savepoint.
- On success `recordOutcome` reaches `resolveAppliedFailureFinding`, which closes the finding as
  `canonical_apply_succeeded`.
- **Operator intervention at the documented edges.**
  - The failure finding closes **only** on a successful apply. If, on the next run, the target no longer
    differs (the competing promotion or a Match Sheet save wrote the same values, or authority removed the
    field), or a gate refuses the retry (a new foreign owner or manual authority), nothing is applied and the
    finding stays open with its original deadlock text. Canonical state is then correct or correctly refused,
    but **an operator must resolve the stale finding**: AFL Tables has no moot-close (the I244-F009 healers
    are AFL API only) and writes no refusal finding except for rekey refusals. This is pre-existing and not
    new to ISSUE-264.
  - **DEV has no AFL Tables timer.** An AFL Tables unit on DEV waits for an **operator-run** settle.

### 4.2 AFL API

- The nightly chain acquires every `CONCLUDED` match of the season (`deploy/afldb-settle-afl-api.sh`, no
  `--since`) and settles every unit. Recording an unchanged observation does not skip a unit. Targets are
  rebuilt from a diff against **current canonical values** (match, periods, players), so a target that still
  differs is offered to the applier again.
- On success `recordApplyOutcomeFindings` closes the finding (same type and key,
  `canonicalApplyIssueKey('afl_api', family, externalRecordId, targetTable)`) as `canonical_apply_succeeded`.
  When the target no longer differs, `closeMootApplyFinding` closes it as `canonical_apply_not_needed`. A
  refused retry refreshes the same open row with the refusal reason.
- A unit failure does not trigger the `--require-complete-source` rollback, because its inputs exclude
  `canonicalApplyFailures`.
- **Operator intervention.** None needed in the normal case: the next nightly run recovers the unit. DEV runs
  the AFL API timer (`afldb-settle-afl-api.timer`, 05:00 plus up to 15 min, `Persistent=true`), so recovery
  is about one night.

### 4.3 Both providers: conditions and edges

- **Season must still be in progress.** Out of season both wrappers exit without work, and the applier
  refuses `season_not_in_progress`. A unit lost on a season's **last** in-season run stays unapplied, with
  its open `error` finding in the settle exception report, until an operator settles before the season
  leaves `in_progress_seasons`, or resolves the finding. The same holds today for any
  `canonical_apply_failed` on `main`.
- **Latency.** Recovery takes until the next run: about one night for AFL API; an operator run for AFL
  Tables on DEV.
- PROD scheduling was **not** examined (ISSUE-264 §14.5.2).

## 5. Evidence and its limits

- **Code trace only for recovery**, for both providers (ISSUE-264 §14.5.2). The anchors above were
  re-checked against the tree on 2026-10-04: `lockUnitMatchRows` :490, the unit savepoint :1004, the lock
  call :1025 and the `ROLLBACK TO` / `RELEASE` :1273-1274 in `canonical-apply.ts`; and the promotion hooks'
  `FOR NO KEY UPDATE` / `FOR SHARE` and `withLegacyLockTimeout` in `datasets.ts`.
- **Lock-level reproduction only.** On `afldb_test`, the ISSUE-264 F-002 block characterised the settle as
  the victim at the **lock-statement level**: it emulates `lockUnitMatchRows` and a unit's writes, in the
  AFL Tables shape (ISSUE-264 §14.3 item 8). It was **not run for the AFL API settle**, which uses the same
  `lockUnitMatchRows`.
- **No real settle deadlock or recovery test exists for either provider.** No test drives a real settle
  into a deadlock and then a recovery run.
  - AFL Tables: a unit write failure (a constraint violation, not a deadlock) is shown to roll the unit
    back alone, open one finding per target and let the run continue (`settle-afltables.test.ts`). The §9.3
    retry is tested after an identity resolution, not after a failure. **No test asserts that a
    `canonical_apply_failed` finding is closed by a later successful retry.**
  - AFL API: the finding lifecycle on the same type and key is tested for a **refusal** (opened, refreshed
    on replay, closed as `canonical_apply_succeeded` or `canonical_apply_not_needed`). **No AFL API test
    produces a rolled-back unit.** Failure followed by heal is code-only.
- **Not observed on DEV or PROD.**

## 6. Mitigation options (undecided)

None of these is chosen. Each needs a decision, and the second two change behaviour that ISSUE-264 F-002
deliberately left alone.

1. A **bounded in-run retry** of a unit that failed with `40P01`, re-running inside a fresh savepoint.
2. A **settle-side ascending match-lock order**, for example pre-locking a run's existing matches by id
   before the units. A material change to both settles; out of scope by the ISSUE-264 F-002 decision.
3. Making the **promotion yield** to a running settle.
4. Taking no action beyond the existing recovery path (the status quo of the D-264-11 acceptance).

Any chosen option needs a test that drives a **real** settle into the deadlock and then through recovery,
for each provider it touches. The existing evidence in §5 does not cover that.

## 7. Scope

- **In scope.** Decide whether to mitigate the settle-unit victim case, and how.
- **Out of scope.**
  - AFLDB-ISSUE-261 (end-of-run recompute lock order).
  - `player_match_stats` row-lock cycles between two stats promotions, or between a promotion and a settle,
    which are identical to `main` (ISSUE-264 §14.3).
  - Settle-side lock order for anything other than this conflict.
  - Re-opening the ISSUE-264 behaviour. ISSUE-264 remains independent and does not wait for this issue.
- **Note (pre-existing, not in scope).** An AFL Tables `canonical_apply_failed` finding closes only when a
  later retry applies (see §4.1). A moot-close for AFL Tables would be a separate change.

## 8. Related

- AFLDB-ISSUE-264 (origin; F-002; D-264-11; runbook `issues/open/AFLDB-ISSUE-264.md` §14.2-§14.5).
- AFLDB-ISSUE-261 (distinct: end-of-run recompute order, different lock site and writers).
- AFLDB-ISSUE-257 (the Match Sheet authority model and its 5 s `lock_timeout`).

## 9. Next action

The operator decides whether to mitigate, and which option in §6. Nothing implemented. ISSUE-265 does not
block the ISSUE-264 commit.
