# AFLDB-ISSUE-265 — A settle unit can lose a match-lock deadlock to a legacy CSV promotion, with no in-run retry

## 0. Status

- **Status:** Open. **Mitigation approved (Option 3, 2026-10-05), not yet implemented.** No production
  code has changed.
  - **Phase A window 2 (2026-10-05 16:22:35) PASSED, census CLEAN** (§17.14). A1, A2 and A3 passed 3/3,
    none skipped. All three base-tree shapes (C2, C1, F-265-1) are now demonstrated with real settles.
  - Phase A window 1 (15:23:57) FAILED, census CLEAN (§17.12). It is kept as historical evidence.
  - **Phase A is closed and retired** (§17.15). It must not run again once the gate changes the behaviour
    it expects. Phase B replaces it.
  - The final implementation plan is in §18, the Phase B assertions in §19, and the D-265-5 timeout analysis
    in §20. **D-265-5 (300 s wait, 330 s gate-statement bound), D-265-14 (Phase B case B11) and D-265-15
    (archive the Phase A tooling) were accepted on 2026-10-05 (§20.7).** The S0 checkpoint is prepared
    (§18.1). **The mitigation is not implemented.**
  - **2026-10-05 timeout trace (§20.1–§20.5):**
    - The `afldb_test` `statement_timeout = 120000 ms` was the probe's own transaction-local setting. It
      is withdrawn as context.
    - In repository configuration, neither settle nor the promotion has any `statement_timeout`.
    - The helper now also raises `statement_timeout` above the wait, for the gate statement only, and
      restores both settings afterwards. The gate wait is therefore effective whatever the host sets.
    - "Blocks nothing" is corrected: a waiting settle's queued request delays later promotions.
    - The S0 commit list is fixed in §18.1.
- **Opened:** 2026-10-04 (from AFLDB-ISSUE-264 F-002; operator decision D-264-11).
- **Severity:** **Medium** (raised from Low by the operator on 2026-10-05, D-265-12).
- **Decisions (operator, 2026-10-05):**
  - D-265-1..12 are accepted as recommended (§14.1).
  - **D-265-5 is decided: a 300 s settle gate wait with a 330 s gate-statement bound (§20.7).** ~~The 60 s
    wait stays provisional.~~ The D-265-13 PROD timing query (§16) gives
    **operational context only**: when settles run and how long a committed AFL API settle holds its
    transaction. It **cannot validate** the wait value. That value bounds how long a settle waits
    **behind a promotion**, and PROD does not record promotion durations: `admin-upload` batches stamp
    `completed_at = now()`, which equals `started_at` (§16.4). Choosing the value is an operator
    judgement, not a measured result.
  - Phase A (§17) characterised the current behaviour on the base tree **before** any implementation, and
    passed (§17.14). Implementation follows the S0 checkpoint commit (§18.1).
- **Area:** data integrity / concurrency, source settles versus legacy file intake.
- **Disposition:** a **temporary limitation, accepted by the operator under D-264-11** (ISSUE-264 runbook
  §14.5.3). The acceptance is not a claim that the deadlock is eliminated, and it is not a decision about
  mitigation.
- **Mitigation:** ~~the options in §6 are undecided.~~ Superseded 2026-10-05: Option 3 (§12, as amended
  by §15) is approved by D-265-1/2/9/10.
- **Investigation (2026-10-05, agent, repository and database-free only):** §10–§15. It recommends a
  settle/promotion advisory gate (Option 3, §12). That is a **recommendation, not an approval**. The
  D-264-11 temporary acceptance does not approve any mitigation. Operator decisions D-265-1..13 (§14) are
  needed before implementation. The investigation widens the defect in two ways:
  - **F-265-1** (§10.3): one AFL API settle lock site rolls back the **whole run**, not one unit.
  - The independent review (§15) found a third legacy writer, `match_attendance`. It is pre-existing and
    unordered (cycle C4, §10.2).
- **Origin:** `issues/closed/AFLDB-ISSUE-264.md` §14.2 (F-002), §14.3, §14.4.3 and §14.5.
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

- AFLDB-ISSUE-264 (origin; F-002; D-264-11; runbook `issues/closed/AFLDB-ISSUE-264.md` §14.2-§14.5).
- AFLDB-ISSUE-261 (distinct: end-of-run recompute order, different lock site and writers).
- AFLDB-ISSUE-257 (the Match Sheet authority model and its 5 s `lock_timeout`).

## 9. Next action

~~The operator decides whether to mitigate, and which option in §6.~~ ~~The operator decides
D-265-1..13.~~ Superseded 2026-10-05 (later; corrected the same day):
1. The operator runs the Phase A window on the base tree (§17.9). Phase A characterises the current
   behaviour; it must run **before** any implementation. Nothing has been run yet.
2. The operator runs the D-265-13 PROD timing query (§16, operator command §16.2) and returns its
   output and exit status. It is **operational context** (settle schedule and AFL API settle duration).
   It is not evidence for the 60 s limit (§16.4).
3. The operator decides D-265-5. The 60 s settle gate wait stays **provisional**, and no PROD record
   can validate it. *(Superseded 2026-10-05: D-265-5 is decided as 300 s / 330 s, §20.7. The point that no
   PROD record can validate the value stands.)*
4. Implementation of Option 3 may then proceed. The advisory-lock mitigation is **not implemented**.

ISSUE-265 does not block the ISSUE-264 PROD promotion.

## 10. Investigation (2026-10-05, agent-run; repository and database-free only)

Scope of this pass:
- **Done:** code inspection of both settles, `canonical-apply`, the promotion pipeline and hooks, the settle
  CLIs and units, and the existing tests.
- **Not done:** no database contact, no credentials, no DEV or PROD, no commands, no tests run, no Git
  writes.
- **Status of the evidence:** every statement below is code-traced unless it is marked otherwise. Line
  numbers are against `main` `4b59cb3e`.

### 10.1 Who takes which lock

| Participant | Match-row locks, and when | Other locks the promotion can meet | Wait bound | On `40P01` |
|---|---|---|---|---|
| Settle unit (both providers), `applyCanonicalUnit` (`canonical-apply.ts:969`) | `lockUnitMatchRows` (`:490-506`), inside the unit savepoint (`:1004`, `:1025`). A `player_match_stats` unit takes `FOR SHARE` by key. A rekey takes `FOR UPDATE` ascending. A match-family unit with no rekey takes no up-front lock: its `UPDATE matches` (`:808`) takes `FOR NO KEY UPDATE` at the write. All locks are held to the settle's commit. | `player_match_stats` rows the unit writes, held to commit | none (settle CLIs set no timeout: `tools/current-season/settle-afltables.ts:186`, `settle-afl-api.ts:162`) | the unit rolls back to its savepoint and returns `failure` (`:1267-1291`) |
| AFL Tables unit order | every `match` record first, then every `player_match_stats` record (`BUNDLE_FAMILIES`, `settle-afltables.ts:138-141`; loop `:1873-1878`) | | | |
| AFL API unit order | per match, in feed order: the match family (`settle-afl-api.ts:1605`), then that match's players (`:1656-1660`, `:1814`) | | | |
| **AFL API attendance enrichment** (end of run, `sweepAttendanceEnrichment`, `settle-afl-api.ts:1003-1054`, called `:1946`) | `applyAttendanceEnrichment` takes `SELECT … FROM matches … FOR UPDATE` (`canonical-apply.ts:1394-1401`) as its **first** statement, **before** the owner gate (`:1409-1417`) and the already-sourced gate (`:1423`). So it locks **every** run-owned match (`ownedMatchKeys`, `settle-afl-api.ts:1540-1541`, `:1644`) that has an AFL Tables staging row with complete, non-null attendance (`:1021-1038`). Once AFL Tables has settled a round, that is essentially every AFL-API-owned match of the season, every night. Corrected by review F-002. | | none | rolls back its own savepoint and **rethrows** (`:1481-1485`). The sweep does not catch (`settle-afl-api.ts:1039`), and `runSettleAflApi` rethrows (`:2023-2024`): **the whole run rolls back** (F-265-1) |
| Settle derived recompute (both, end of run) | none on `matches` | `player_match_stats` rows of affected players, all seasons (ISSUE-257 F-S4-01) | none | savepoint retry, backoff 1+2+3 s (`settle-core.ts:234`, `:257-280`). After that, the whole run rolls back |
| `match_results` promotion | hook (`datasets.ts:759-779`): its **existing** matches, `ORDER BY id FOR NO KEY UPDATE`, in one statement, held to commit | inserting a **new** match waits on the unique index if a settle inserted the same key and has not committed | 5 s **in the hook only** (`withLegacyLockTimeout`, `:580-591`, restored after). The pipeline connection sets no timeout (`pipeline.ts:308`), so row and insert waits after the hook are **unbounded** | inside the hook: the retryable refusal. After the hook: a raw error. Either way the submission ends `failed` (`pipeline.ts:425-432`) |
| `player_match_stats` promotion | hook (`:1072-1095`): its matches, `ORDER BY id FOR SHARE`, held to commit | the `player_match_stats` rows it upserts (`:1149-1201`), file order | as above | as above |
| **`match_attendance` promotion** (`datasets.ts:1275-1316`; added by review F-001) | **no hook.** `promoteRow` runs `UPDATE matches … WHERE id = …` **per row, in file order** (`:1307-1315`, through `pipeline.ts:393-400`), so it takes `FOR NO KEY UPDATE` progressively and holds it to commit | none | **unbounded** throughout (`pipeline.ts:308`) | raw error, `failed` |
| AFL API Brownlow settle | none: its units target `brownlow_round_votes` only (`afl-api-brownlow.ts:1082-1093`), so `lockUnitMatchRows` takes no lock | | | **Not a participant.** |

Lock compatibility (PostgreSQL row locks):
- `FOR SHARE` conflicts with `FOR NO KEY UPDATE` and `FOR UPDATE`.
- `FOR NO KEY UPDATE` conflicts with every mode except `FOR KEY SHARE`.
- `FOR UPDATE` conflicts with all four modes.

So a settle's `FOR SHARE` meets the `match_results` hook and `match_attendance`. A settle's match-row
write, and the enrichment's `FOR UPDATE`, meet all three legacy writers.

### 10.2 Who becomes the victim: three cycle shapes

**Victim selection.** PostgreSQL runs **one deadlock check per wait**, when that wait reaches
`deadlock_timeout` (1 s by default). This is recorded in this repository at ISSUE-257 F-S4-01
(`issues/closed/AFLDB-ISSUE-257.md:1480-1484`) and in `settle-core.ts:225-233`. Consequences:
- The victim is the first waiter whose check runs **after the cycle exists**. That is not always the
  first waiter.
- If one side has waited for more than `deadlock_timeout` on the same blocker before the other side closes
  the cycle, its check has already passed and found no cycle. The side that closes the cycle is then the
  victim.
- **Precision (review F-004):** the rule is one check per wait **on one blocker**. A waiter whose blocker
  goes away while another conflicting holder remains waits again, and gets a fresh check after
  `deadlock_timeout`. For example, a row-lock waiter queued behind X, where X commits but the promotion
  still holds the row. The A2 choreography in §13.2 depends on exactly that fresh check.
- This refines §3. "The promotion is normally the victim" holds only when the settle closes the cycle
  within about 1 s of the promotion starting to wait.

| Shape | How it forms | Settle is the victim when | Who can hit it | Promotion's fate |
|---|---|---|---|---|
| **C1, post-hook row wait** | The promotion holds its matches and waits, **unbounded**, on a `player_match_stats` row that an **earlier** settle unit wrote. The settle then needs a match the promotion holds. | The settle began waiting first (tested at the lock-statement level: `match-results-promotion.test.ts:1370-1414`). The reverse ordering makes the promotion the victim. | AFL API against a `player_match_stats` promotion: a match unchanged with changed players, then a later match-family write. AFL Tables cannot reach C1 with the stats hook: its match records all come before its stats records, and its stats units take `FOR SHARE`, which is compatible. | It waits until the settle **commits**, then succeeds |
| **C2, hook-phase wait** | The promotion's ascending hook holds A and waits on B, which the settle holds. The settle later asks for A. | The settle asks for A **more than ~1 s after** the promotion began waiting, and before the promotion's 5 s timeout. **Reasoned from one-check-per-wait; not run.** The F-002 case 8 covers the other ordering only. | Both providers, both hooks | It times out at 5 s with the retryable refusal |
| **C4, unordered `match_attendance`** (review F-001) | The attendance promotion holds M2 (an earlier file row) and waits, **unbounded**, on M1, which a settle unit wrote. The settle's later unit then needs M2. | The settle waits on M2 after the promotion has already been waiting more than ~1 s, or it began waiting first. **Reasoned; not run.** | Both providers, including via the enrichment (F-265-1) | It waits until the settle commits. **Pre-existing on main:** this writer was never ordered, and ISSUE-264 did not touch it |
| **C3, new-match insert** | A `match_results` file inserts a new match whose key a settle inserted and has not committed. The promotion waits unbounded on the unique index, and the settle later needs a match the promotion holds. | The settle closes the cycle more than ~1 s after the promotion began waiting. **Reasoned; not run.** | Both providers, `match_results` only | It waits until the settle commits |

### 10.3 F-265-1 (MED, new): AFL API attendance enrichment can lose the whole run

- **Mechanism.** The end-of-run enrichment takes `FOR UPDATE` on run-owned matches. It does this before
  any gate, so it covers essentially every AFL-API-owned match of the season with AFL Tables attendance in
  staging, every night (§10.1, review F-002). That lock conflicts with all three legacy writers.
- **Failure.** Suppose a promotion holds **any** such match while waiting on a row or match the run wrote
  (C1, C3 or C4), and the enrichment's check fires. No unsourced attendance is required.
  - The `40P01` is rethrown, not contained (§10.1), so **the entire AFL API run rolls back**. That loses
    every unit, not one.
  - No `canonical_apply_failed` finding is written, because the run fails with an exception.
- **Recovery.** The next nightly run re-acquires and re-settles the whole season, so nothing is stranded
  permanently. The cost is a whole lost run and a failed systemd unit.
- **Main versus ISSUE-264.** Partly pre-existing on main. `FOR UPDATE` already conflicted with the
  `match_results` upsert, and with the `FOR KEY SHARE` that a stats insert's foreign key takes. ISSUE-264
  widened it: both hooks now hold every match of the file from the hook to commit.
- **Correction.** §3/§5 and ISSUE-264 §14.4.3/§14.5.2 say the settle's cost is "only its unit". That is
  true for `applyCanonicalUnit`, but **not for this AFL API site**. AFL Tables has no enrichment sweep.
- **Evidence.** Code-traced only. Not run, and not observed on DEV or PROD.

### 10.4 Observations (INFO; no work created here)

- **The derived-recompute retry assumes a writer with a 5 s wait.** Its 6 s backoff exists so that a
  Match Sheet save, which has a 5 s whole-transaction `lock_timeout`, has given up by the last attempt.
  A legacy promotion that waits on recompute rows after its hook has **no** bound. A cycle between the two
  therefore exhausts the four attempts and rolls the whole settle back.
  - Pre-existing on main: the promotions' `player_match_stats` writes are unchanged.
  - Out of scope under §7. The gate in §12 removes it as a side effect, which is noted, not claimed.
- **ISSUE-257 "cycle 1" has the same settle-unit-victim shape** against a Match Sheet save's recompute
  (`AFLDB-ISSUE-257.md:1445-1449`).
  - Pre-existing, and not owned by this issue.
  - §12 does not cover it. The Match Sheet's 5 s whole-transaction bound means an in-run unit retry would
    heal it; see §11, Option 1b.

## 11. Options compared

**Why an in-run retry alone cannot work in C1 and C3.**
- `ROLLBACK TO SAVEPOINT` releases only the failed unit's locks.
- The lock the promotion waits on belongs to an **earlier** unit. That unit's savepoint was released into
  the settle transaction, so the lock is held until the settle commits (`settle-core.ts:254-255` says the
  same of the recompute).
- The promotion's wait after the hook is unbounded, so it never gives the match back.
- A retry asks for the same match again, re-forms the same cycle, and is the victim again: the
  promotion's single check has already run. Every attempt fails until the run ends.
- In C2 the promotion times out at 5 s, so a retry delayed past that succeeds. But the promotion has
  failed by then anyway.

| | 1. In-run `40P01` unit retry | 1b. Unit retry **plus** a whole-transaction 5 s `lock_timeout` on the promotion | 2. Settle pre-locks its matches ascending | **3. Settle/promotion advisory gate (recommended)** |
|---|---|---|---|---|
| Eliminates the cycle | no | no (it occurs, then heals) | yes, if the pre-lock set is complete and strong enough | **yes**, between these participants |
| C1 / C2 / C3 / C4 | futile / heals after more than 5 s backoff / futile / futile | heals all four after a backoff of about 6 s, like F-S4-01 | all four | **all four** (C4 needs §12 item 4) |
| F-265-1 (enrichment, whole run) | no (a different site) | only if the retry is extended to the enrichment | yes | **yes** |
| Both providers | yes (`canonical-apply`) | yes | each settle changed separately | yes: one helper, two call sites |
| Atomicity | a fresh savepoint per attempt; gates re-read | same | unchanged | **unchanged**: no unit, savepoint or ledger change |
| Lock upgrades | none new | none new | **high risk**: a `FOR SHARE` pre-lock upgraded later re-creates the cycle; pre-locking everything `FOR NO KEY UPDATE`/`FOR UPDATE` over-blocks; rekey candidates and new matches are not known up front | **none**: one advisory lock per side, taken once, first |
| Retry bounds | the attempts | about 6 s per occurrence, holding every lock the run has taken | n/a | **none in the settle**; the promotion keeps its existing 5 s bound |
| Added contention | settle hold time grows by up to the backoff | the promotion fails after 5 s on **any** row wait, not only in the hook (changes ISSUE-264 behaviour) | every match of the run locked for the **whole** run: Match Sheet saves and Data Editor edits on any season match refused for its duration | the stats and `match_results` promotions are refused (after 5 s) while an AFL Tables or AFL API settle transaction is open; a settle start waits for an in-flight promotion; promotions serialise with each other |
| Blast radius | `canonical-apply` | `canonical-apply`, `datasets.ts`, `pipeline.ts` error mapping | both settles' unit loops | `settle-core.ts` (helper), the gate call at the start of two `sql.begin` callbacks, `withLegacyLockTimeout`, a new `match_attendance.preparePromotion` |
| Side effects outside scope | none | also heals ISSUE-257 cycle 1 | none | also removes §10.4's promotion-versus-recompute cycle and the two-promotion row-lock cycle (ISSUE-264 §14.3 hazard), by serialisation |

**Option 4, status quo** (D-264-11). It remains a supported position. Under F-265-1 its cost is not only
one unit per occurrence: an AFL API occurrence at the enrichment site loses the whole run until the next
night.

## 12. Recommendation: Option 3, a transaction-scoped settle/promotion gate

**Design (proposed; not implemented).**

1. **Key.** A frozen literal pair in the AFLDB namespace: `(717275, 4)`.
   - Namespace `717275` already holds these keys:
     - key 1: `awards-admin.ts:44-45`, `admin-awards.ts:119-120`, `import_awards.py:382`;
     - key 2: `admin-users.ts:44-45`;
     - key 3: `admin-brownlow.ts:644-645`;
     - season keys 1897–2100: `admin-fixtures.ts:106-111`, `:716`.
   - Key 4 collides with none of them. Single-argument bigint keys live in a separate key space. The review
     checked every usage.
   - The namespace doc comment at `admin-fixtures.ts:105-110` gains key 4.
   - Defined once and shared by both sides, for example as `SETTLE_PROMOTION_GATE` in `settle-core.ts`.
     `datasets.ts` already imports from `src/lib/acquisition/`.
2. **Settle side (shared).** `SELECT pg_advisory_xact_lock_shared(717275, 4)` as the first
   **non-setting** statement of the settle transaction (gate-ordering invariant, below):
   - `runSettleAfltables` (`settle-afltables.ts:1834`);
   - `runSettleAflApi` (`settle-afl-api.ts:1904`).

   It is taken through one helper (`acquireSettlePromotionGate(tx)`), before `loadRefs` and before any
   unit. Granted settle locks never conflict with each other, because shared does not conflict with
   shared. A settle can still wait *behind* another settle's queue: when an exclusive promotion request is
   queued, a later shared request queues behind it (§20.3). The Brownlow settle does not take it (§10.1).
3. **Promotion side (exclusive).** `SELECT pg_advisory_xact_lock(717275, 4)` as the first non-setting
   statement inside `withLegacyLockTimeout`, after its `lock_timeout` setting statements. That means:
   - it is covered by the existing 5 s bound;
   - it comes before either hook's match lock;
   - it is held to the promotion's commit;
   - its `55P03` becomes the existing retryable refusal, whose text already names "a source settle".

   `player_bio` and the award datasets do not take it.
4. **`match_attendance` joins the gate** (review F-001; D-265-10). It gains a `preparePromotion`. Inside
   `withLegacyLockTimeout` that hook:
   - takes the gate;
   - then takes `SELECT id FROM matches WHERE id = ANY(…) ORDER BY id FOR NO KEY UPDATE`, the strength its
     `UPDATE` takes anyway.

   This also closes its own pre-existing unordered-writer cycle with the other two hooks. Without it, the
   completeness claim below is **false** and must be withdrawn.
5. **Settle gate wait bound** (review F-007; D-265-5). The settle runs the gate statement under its own
   transaction-local `lock_timeout` of 300 s (D-265-5, accepted 2026-10-05; §20.7), and restores it immediately afterwards. For that
   statement only, it also raises the transaction-local `statement_timeout` above the wait, so a
   statement cancellation cannot pre-empt the lock timeout. Both settings are restored after the gate
   (§20.2).
   - If it times out, the run fails **before any write**, with a message naming a legacy promotion. The
     next run settles normally.
   - The alternative is an unbounded wait. Then a promotion stuck in a post-hook wait (for example on a
     row held by an open Data Editor transaction) holds the gate until systemd's
     `TimeoutStartSec=3600` kills the settle, and the night's run is lost with a generic timeout.

**Gate-ordering invariant (wording corrected 2026-10-05).** Earlier text called the gate the "first
statement". That is not literally true, and it is not the property that matters. Inside each side's
transaction the order is:
1. **Permitted setting statements:** `SELECT current_setting(…)` reads, and transaction-local
   `SELECT set_config('lock_timeout' | 'statement_timeout', …, true)` calls. They read no table, take no
   row lock and assign no xid.
   - The settle helper issues two before the gate (read both settings, then set both).
   - `withLegacyLockTimeout` issues two before its work (read `lock_timeout`, then set the 5 s value).
   - They must precede the gate. Otherwise the wait would be unbounded, or bounded by the wrong value.
2. **Gate acquisition:** `pg_advisory_xact_lock_shared(717275, 4)` (settle) or
   `pg_advisory_xact_lock(717275, 4)` (promotion).
3. **Canonical work:** `loadRefs`, every `SELECT … FOR UPDATE / FOR SHARE / FOR NO KEY UPDATE`, and every
   `INSERT`, `UPDATE` and `DELETE`.

**The invariant: the gate precedes every data write and every row lock.** Setting statements may come
before it. Canonical work may not. Wherever this runbook, the ledger or the index says the gate is the
"first statement", read "first statement that is not a setting statement". At the call level, the gate call is
the first call in each `sql.begin` callback. The restoring `set_config` calls run after the gate, and on the
settle side before `loadRefs`.

**Why it is reliable.**
- A settle and a promotion can no longer hold row locks at the same time:
  - A promotion that arrives during a settle waits at the gate. It holds nothing the settle wants: only
    its own `data_submissions` row.
  - A settle that arrives during a promotion waits at the gate (before any data statement), holding no granted lock and
    no xid. (Its queued request does order later requests; §20.3.)
- With no hold-and-wait between them, no cycle between them can form: not C1–C4, not F-265-1, and not
  §10.4's recompute cycle.
- **Provided all three match-writing legacy datasets take the gate (item 4)**, the settle cannot be the
  victim of a legacy promotion at any site.
- The review checked the hold-and-wait claim against source:
  - no settle module touches `data_submissions`;
  - the settles' planning-phase rekey searches are unlocked (`settle-afltables.ts:2983`,
    `afl-api-match-resolver.ts:178`), so the gate can be the settle's first lock with nothing held.
- It does not depend on deadlock-detection timing.

**Properties.**
- **Coverage.** Both providers, through one helper and two call sites. Any future match-locking settle
  must call it; §13's static pin enforces this for the two entry points.
- **Atomicity.** Unchanged. The units, savepoints, ledger rows, findings and recovery paths are untouched.
  The gate lock lives to commit or rollback.
- **Lock upgrades.** None. Each side requests one mode once, and nothing re-requests it.
- **Retry bounds.**
  - The settle has no retry and none is needed.
  - The promotion's existing 5 s bound covers the gate wait, and the operator re-promotes, as today.
  - The settle's own gate wait is bounded by item 5 (D-265-5). It fails before any write.
- **Added contention, stated plainly.**
  1. A `match_results`, `player_match_stats` or `match_attendance` promotion is **refused after 5 s while
     any AFL Tables or AFL API settle transaction is open**: the nightly runs (04:30 and 05:00, `TimeoutStartSec=3600`),
     the on-demand AFL Tables trigger, and operator runs. Dry runs included. This applies even for a
     historical season the settle never touches (unless D-265-2 chooses per-season keys).
  2. A settle's start waits for an in-flight legacy promotion to commit.
  3. **Promotions serialise with each other.** A second promotion waits up to 5 s at the gate. This
     changes ISSUE-264's tested property that "FOR SHARE leaves … another stats promotion unblocked"
     (`match-results-promotion.test.ts:1128`); see D-265-6.
  4. Lock-queue ordering (corrected 2026-10-05; §20.3): a settle that arrives while a promotion is queued
     behind another settle waits behind that promotion. If the promotion gives up, the wait is at most
     the promotion's remaining 5 s. If the first settle commits inside that 5 s, the promotion gets the
     gate, and the later settle then waits for the **whole promotion**. Only its own gate wait (D-265-5)
     bounds that wait. The earlier "at most 5 s" was wrong.
- **What it does not fix.** It leaves untouched:
  - ISSUE-257 cycle 1 (settle versus Match Sheet);
  - settle-versus-settle cycles;
  - ISSUE-261;
  - the AFL Tables stale-finding note (§7).

## 13. Validation design

### 13.1 What existing tests prove, and what they do not

| Claim | Status |
|---|---|
| The settle can be the victim against the stats hook (shape C1) | **Lock-statement emulation only**: `match-results-promotion.test.ts:1370-1414`. The emulated settle is one transaction, so its abort frees the promotion. In a real settle the earlier unit's row stays held. |
| The promotion is the victim when it began waiting first | emulation, `:1325-1361` |
| A unit failure is isolated and opens findings (AFL Tables) | real settle, constraint violation, not a deadlock (`settle-afltables.test.ts:3220-3281`) |
| A failure finding closes on a later successful retry | **untested** for both providers |
| Settle-victim shapes C2 and C3 | **untested**, reasoned |
| F-265-1, an enrichment victim rolls back the whole AFL API run | **untested**, code-traced |
| A real settle driven into this deadlock, then a recovery run | **untested** for both providers |
| The AFL API settle against a promotion at all | **untested**. Its suite runs on real season 2026 and the corrected runner refuses it (D-264-10) |

### 13.2 Proposed tests (deterministic, isolated synthetic fixtures)

The orderings are forced with side transactions and `pg_blocking_pids`, using the recursive waiter walk
from the F-002 block (`match-results-promotion.test.ts:972-1003`). Two timing quantities are read rather
than assumed: `SHOW deadlock_timeout`, and the 5 s hook bound. Every fixture lives in a reserved synthetic
season that the window's baseline census proves empty (D-265-7). No real season is touched.

**Phase A: characterisation on the base tree** (optional, D-265-7). This proves the defect with **real**
settles before the change. It also covers the recovery evidence the status quo (Option 4) lacks.
- **A1, AFL Tables, C2.** Pipeline: a real `runSettleAfltables` against a real `match_results` promotion.
  1. Build a bundle with match records MB, MC, MA, MD in that feed order (ids A < B).
  2. A side transaction X holds MC `FOR UPDATE`, and a second side transaction Y holds MD `FOR UPDATE`.
  3. Start the settle. It writes MB, then waits on X.
  4. Start the promotion over MA and MB. Its hook takes MA and waits on MB.
  5. Wait `deadlock_timeout` + 0.5 s, then release X. The settle writes MC, then asks for MA, loses, and
     moves on to MD, where Y stalls it.
  6. Keep Y until the submission reads `failed`. This holds the settle open past the promotion's 5 s
     bound. Without this stall, a small bundle commits first and the promotion succeeds instead (review
     F-003). Then release Y.
  7. Assert:
     - the settle commits with `canonicalApplyFailures = 1` and open `canonical_apply_failed` findings
       for MA's targets;
     - MA is unchanged, and MB and MC are applied;
     - the promotion is `failed` with the retryable refusal.
  8. **Recovery:** re-run the same bundle. Assert:
     - MA is applied by the §9.3 retry (`canonicalRetryApplied` ≥ 1);
     - the findings are resolved `canonical_apply_succeeded`;
     - re-promotion is then possible.
- **A2, AFL API, C1.** Pipeline: a real `runSettleAflApi` against a real `player_match_stats` promotion.
  1. Build units M1 (match unchanged, player *p* changed) and then M2 (match changed).
  2. X holds M2 `FOR SHARE`, which is compatible with the hook.
  3. The promotion's rows are (*p*, M1), with values equal to the settle's so recovery stays clean, and
     one row on M2.
  4. Start the settle. It writes (*p*, M1), then waits on X for M2.
  5. Start the promotion. Its hook passes, then the row (*p*, M1) waits on the settle.
  6. Wait `deadlock_timeout` + 0.5 s, then release X.
  7. Assert:
     - the M2 unit fails with `40P01`, and one finding per target opens;
     - **while a third, stalled unit M3 holds the settle open, the promotion is still blocked by the
       settle.** This is the in-run-retry futility of §11, shown directly;
     - after the commit, the promotion succeeds.
  8. **Recovery:** the next run applies M2 and closes the finding `canonical_apply_succeeded`.
- **A3, AFL API, F-265-1.** The fixture is an `afl_api`-owned match with a complete AFL Tables staging
  attendance row. The canonical attendance may already be sourced: the lock comes before that gate
  (review F-002). The enrichment loses to a stats promotion holding the match in C1. Assert:
  - `runSettleAflApi` rejects with `40P01`;
  - nothing from the run persists, including its `import_batches` row.

**Phase B: if Option 3 is approved and implemented.** These are the acceptance tests for that change.
- **B1.** Repeat the A1 and A2 choreographies.
  - Assert that the promotion is blocked on the settle's backend at the **advisory** lock (`pg_locks`
    `locktype = 'advisory'`), never on a `matches` row.
  - Assert that the settle commits with `canonicalApplyFailures = 0` and no new findings.
  - Variant (i): X is held until the promotion's 5 s bound expires. The promotion is refused
    retryably, writes nothing, and a later re-promotion succeeds.
  - Variant (ii): the settle is allowed to commit, and the promotion then takes the gate and succeeds.
    This must not rely on host speed. The test releases every stall only once the promotion is observed
    waiting on the gate, and asserts the promotion's start-to-gate wait stayed under the bound. If the
    bound is approached, the case is reported as inconclusive rather than passed (review F-003).
- **B2.** Repeat A3 and assert that the AFL API run commits.
- **B3, settle waits for the promotion.** Hold a real hook (as `holdStatsHook`, `:1040-1042`), then start
  a real settle.
  - Assert that its only wait is on the advisory lock, before any unit runs.
  - Release the hook. The promotion commits, and the settle then completes with no failures.
- **B4, settles do not block each other.** Two transactions take the shared gate concurrently, and
  neither waits.
- **B5, promotions serialise.** A second promotion waits on the first's gate. It is refused at 5 s if the
  first is still open, and succeeds otherwise. This replaces the expectation at `:1128`, and adjusts `:1094`
  where the second writer now waits at the gate rather than at the lowest match (D-265-6).
- **B6, `match_attendance`** (if D-265-10 is approved).
  - Its hook takes the gate, then its matches ascending, before any `UPDATE`.
  - A file ordered M2, M1 against a settle that wrote M1 and later writes M2 is refused at the gate. The
    settle commits with no failures. This is the C4 choreography.
- **The existing F-002 settle emulations** (`match-results-promotion.test.ts:1325-1361`, `:1370-1414`)
  still pass after the change, but then emulate an **ungated** writer. D-265-11 decides whether to keep
  them, with a comment saying so, or retire them in favour of B1.

**Database-free (extend existing suites; no new file).**
- `tests/ingest-datasets.test.ts`:
  - each hook's first non-setting statement inside the bound is `pg_advisory_xact_lock(717275, 4)`, issued before the
    matches lock and after the `lock_timeout` set;
  - a `55P03` at the gate maps to the retryable refusal;
  - the existing statement-order pins move by one statement. Both fake-sql tags (`:481`, `:619`) throw
    `unexpected query` today and must answer the gate statement;
  - the registration pin `:495-498` (`['match_results', 'player_match_stats']`) gains `match_attendance`
    if D-265-10 is approved, and a new pin covers that hook's ascending lock.
- `tests/match-sheet.test.ts`, which already pins `settle-core` constants: the gate key literals, and a
  source-text pin that both `runSettleAfltables` and `runSettleAflApi` call `acquireSettlePromotionGate`
  as the first call in their `sql.begin` callback, before `loadRefs` and any other data statement.

### 13.3 Proposed validation sequence (each step needs operator authorisation; nothing here was run)

1. Database-free: `ingest-datasets`, `match-sheet`, typecheck, eslint on the changed files.
2. A guarded `afldb_test` window with ISSUE-264's runner pattern: census, then suites, then a clean
   census.
   - Suites: the new phase B file (and phase A on the base tree, if chosen); `match-results-promotion`
     with the F-002 block updated; `settle-afltables` in full; `datasets`; `submission-promotion`.
   - The AFL API regression coverage comes from the new isolated file only; `settle-afl-api.test.ts`
     stays refused (D-264-10).
3. No build is needed: no framework or route change.
4. Implied work to record with the change:
   - `CHANGELOG.md` `Unreleased`: legacy promotions are refused during settles, and they serialise with
     each other;
   - the admin-upload and settle operations docs under `docs/`;
   - the namespace comment (§12 item 1).
5. DEV: application-only. Acceptance is the absence of `canonical_apply_failed` findings with a `40P01`
   message, plus one promotion attempted during an operator-run settle, which shows the retryable refusal.

## 14. Decisions needed before implementation

| ID | Decision | Recommendation |
|---|---|---|
| D-265-1 | Mitigate, or keep Option 4 (status quo) now that F-265-1 shows an AFL API occurrence can lose the whole run | Mitigate |
| D-265-2 | Mechanism and modes: (i) the settle takes the gate **shared** and the promotion **exclusive**, one global key; (ii) the reverse, which serialises AFL Tables and AFL API settles with each other (an unbounded wait inside `TimeoutStartSec=3600`); (iii) per-season keys, which spare historical-season promotions but need season discovery before the gate and a recheck under lock | (i) |
| D-265-3 | Key `(717275, 4)` | Accept |
| D-265-4 | Promotion gate refusal: reuse `LEGACY_PROMOTION_LOCK_REFUSAL` (it already names a source settle), or add a distinct "a source settle is running" message | Reuse (smallest) |
| D-265-5 | The settle's gate wait. Either a gate-only transaction-local `lock_timeout` (for example 60 s) that fails the run before any write with a message naming a legacy promotion. Or unbounded: then a promotion stuck in a post-hook wait holds the gate until `TimeoutStartSec=3600` kills the settle, and the night's run is lost with a generic timeout | Bounded, 60 s (changed after review F-007) |
| D-265-6 | Accept that legacy promotions serialise with each other, and that the F-002 expectations at `match-results-promotion.test.ts:1094` and `:1128` change accordingly | Accept |
| D-265-7 | Test home and fixtures: one new focused integration file. Neither existing suite has both the settle and promotion harnesses, and `settle-afl-api.test.ts` is runner-refused. It would use reserved synthetic seasons confirmed empty by census, an AFL API fixture moved to a synthetic season, and an update to the runner's allow-list. Also: run phase A on the base tree first, or not; include A3/B2, or not | New file; phase A yes; A3/B2 yes |
| D-265-8 | Record F-265-1 inside ISSUE-265 (same participants, same fix), or open a separate issue | Inside ISSUE-265 |
| D-265-9 | Confirm Options 1, 1b and 2 are not pursued. ISSUE-257 cycle 1 (§10.4) stays outside ISSUE-265 | Confirm |
| D-265-10 | `match_attendance` joins the gate with an ascending `preparePromotion` (§12 item 4). If not, record it as excluded and withdraw §12's completeness claim | Join |
| D-265-11 | The existing F-002 settle emulation tests after the change: keep them, commented as an ungated-writer emulation, or retire them | Keep, commented |
| D-265-12 | Severity. F-265-1 is MED and is folded in (D-265-8), and C4 extends the defect to a third writer. Does ISSUE-265 stay Low? | Raise to Medium if D-265-8 folds F-265-1 in |
| D-265-13 | PROD settle schedule and settle-transaction durations were never examined (§4.3). Contention item 1 (§12) cannot be weighed for PROD without them. Should the operator supply them (for example from `import_batches` started/completed times of settle batches) before approving? | Yes, read-only, operator-run |

### 14.1 Operator decisions recorded (2026-10-05)

The operator accepted the recommendation for **D-265-1 to D-265-12** as written in the table above.

| ID | Decided |
|---|---|
| D-265-1 | Mitigate. |
| D-265-2 | Option (i): the settle takes the gate **shared**, the promotion **exclusive**; one global key. |
| D-265-3 | Key `(717275, 4)`. |
| D-265-4 | Reuse `LEGACY_PROMOTION_LOCK_REFUSAL` for the promotion's gate refusal. |
| D-265-5 | The settle's gate wait is bounded by a gate-only transaction-local `lock_timeout`, and the run fails before any write. ~~The 60 s value is provisional.~~ **Final value, accepted 2026-10-05: 300 s, with a transaction-local 330 s `statement_timeout` for gate acquisition only (§20.7).** The D-265-13 query (§16) is context for it, not evidence: PROD does not record promotion durations (§16.4). |
| D-265-6 | Legacy promotions serialise with each other. The F-002 expectations at `match-results-promotion.test.ts:1094` and `:1128` change accordingly. |
| D-265-7 | One new focused integration file, on reserved synthetic seasons confirmed empty by census. Phase A runs on the base tree first. A3 and B2 are included. The runner allow-list gains the new file. |
| D-265-8 | F-265-1 is recorded inside ISSUE-265. |
| D-265-9 | Options 1, 1b and 2 are not pursued. ISSUE-257 cycle 1 stays outside ISSUE-265. |
| D-265-10 | `match_attendance` joins the gate with an ascending `preparePromotion`. |
| D-265-11 | The existing F-002 settle emulation tests stay, commented as emulating an ungated writer. |
| D-265-12 | Severity raised to **Medium**. |
| D-265-13 | **Open.** The operator runs the read-only PROD timing query prepared in §16. Its output is operational context for D-265-5 (when settles run, how long an AFL API settle holds its transaction). It does not validate the wait value (§16.4). |
| D-265-14 | **Accepted 2026-10-05.** Phase B includes B11, covering both advisory-lock queue shapes (§19.2, §20.3). |
| D-265-15 | **Accepted 2026-10-05.** The five Phase A tooling files are preserved unchanged in `issues/open/AFLDB-ISSUE-265-phase-a/` before S8 changes the active runner (§18.1, §20.7). |

~~Implementation may proceed after the D-265-5 value is confirmed on that evidence.~~ Corrected
2026-10-05: no PROD evidence can confirm the D-265-5 value, because promotion durations are not recorded
(§16.4). Implementation may proceed after Phase A has characterised the base tree (§17) and the operator
has decided D-265-5, with the D-265-13 output as context. The temporary acceptance under D-264-11 is
superseded by these decisions; it was never itself an approval.

## 15. Independent review (2026-10-05, `afldb-reviewer`, read-only)

The reviewer re-read every cited anchor from disk and wrote no file. It graded nothing CRIT. Its findings
and their dispositions:

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| F-001 | HIGH | `match_attendance` (`datasets.ts:1275-1316`) writes match rows per row in file order, with no hook and no bound. §10.1 omitted it, and the "no site" claim was false for it. | **Verified** against source. Added to §10.1 (and as C4 in §10.2) and to §12 item 4. The completeness claim is now conditional on it. Decision D-265-10. Pre-existing on main. |
| F-002 | MED | The enrichment's `FOR UPDATE` comes before the owner and sourced gates, so the exposure is every run-owned match with AFL Tables attendance, not only unsourced ones. | **Verified** (`canonical-apply.ts:1394-1423`). §10.1, §10.3 and A3 corrected. |
| F-003 | MED | A1 (and B1 variant ii) depended on host speed. The settle could commit before the promotion's 5 s bound. | Applied: an MD/Y stall holds the settle open, and B1(ii) gets an inconclusive guard. |
| F-004 | LOW | Victim model: one check per wait **on one blocker**. A changed blocker means a new wait and a new check. | Applied (§10.2). |
| F-005 | LOW | §13.2 "required" and §13.3 "operator-authorised" implied approval. | Reworded. |
| F-006 | LOW | Unstated work: the namespace comment, the fake-sql tags, the registration pin, CHANGELOG/docs, the fate of the F-002 emulations. The key-1 citation was wrong. | Applied (§12 item 1, §13.2, §13.3 item 4, D-265-11). |
| F-007 | LOW | D-265-5 "unbounded" has a concrete bad case. | Applied: recommendation changed to bounded (§12 item 5). |
| F-008 | INFO | Other entry points checked. The rekey rehearsal's gate lands in a savepoint, which is harmless. `repair-match-rekeys` is ungated (operator tool, ascending). The Brownlow and fixtures settles are non-participants. | Recorded. |
| F-009 | INFO | Severity stays Low while a MED finding is folded in. The runner refusal of `settle-afl-api.test.ts` was not re-verified. | D-265-12. The refusal is as recorded in D-264-10 (ISSUE-264 §14.5.1). |

Verified with no finding:
- the §10.1 inventory anchors;
- the §10.3 whole-run rollback and its "partly pre-existing" statement;
- the §11 retry futility;
- the §12 hold-and-wait argument and key non-collision;
- no import cycle from placing the constant in `settle-core.ts`;
- a transaction-level advisory lock taken inside a savepoint is released on rollback to it and otherwise
  held to commit;
- Option 3 is the smallest plan that removes the cycle, **provided F-001 is folded in**.

## 16. D-265-13: PROD settle timing evidence (prepared 2026-10-05; operator-run; not yet run)

**File.** `issues/open/AFLDB-ISSUE-265-prod-settle-timing.sql`. It is psql only, because it uses `\gset`
and `\if`.

**What it is for (corrected 2026-10-05).** It is **operational context**:
- when committed settles ran;
- how long a committed AFL API settle held its transaction, which is how long promotions would be
  refused during it.

It is **not evidence** for the settle gate wait (D-265-5; then provisional at 60 s, decided 2026-10-05 as 300 s, §20.7). That limit bounds how long a
settle waits **behind an in-flight promotion**. PROD does not record promotion durations (§16.4), and no
query of PROD records can supply them.

**Exit status (hardened 2026-10-05).**
- `ON_ERROR_STOP` is set by the script's first line and again on the command line (§16.2).
- A refused target or schema proof now raises a deliberate error after its `ROLLBACK`, so psql exits
  with status **3**. It previously used `\quit`, which exits 0, so a refusal would have looked like
  success.
- Any failed statement also exits 3: a missing column or type, or a `statement_timeout`.
- A lost connection exits 2.
- Only status 0, with `== Done.` as the last line, is a complete result.

Static checks run on the file, without psql or a connection:
- the first command is `\set ON_ERROR_STOP on`;
- no `\quit` remains;
- no non-comment line contains a writing keyword;
- the transaction is `READ ONLY`;
- the last statements are `ROLLBACK` and the `Done` echo.

### 16.1 What the schema can and cannot show (derived from the repository, not assumed)

**Source.** `public.import_batches` (`001_foundations.sql:54-69`): `started_at timestamptz DEFAULT now()`,
`completed_at timestamptz`, `status import_status`, `tool`, `notes`, `validation_result jsonb`. No later
migration alters these columns.

**Tool literals.**
- AFL Tables: `'settle-afltables.ts'` (`settle-afltables.ts:1841`; `settle-report.ts:58`).
- AFL API: `'settle-afl-api.ts'` (`settle-afl-api.ts:179`, `:1908`).
- The Brownlow tool (`'settle-afl-api-brownlow.ts'`) is deliberately excluded: it is not gated (§10.1).

**When the row is written.** The row is inserted **inside** the settle transaction. A run that rolls back
leaves **no row**: an error, a dry run, a HALT, or a `--require-complete-source` refusal (`settle-core.ts:984-990`).
- **Failures are invisible to this query.** It can report only committed runs and their `status`.
- Settles never write `failed` or `rolled_back`. A `running` row could only come from an abnormal end, and
  section 8 counts any.
- Failed-run evidence lives in the systemd journal, which a database query cannot read.

**Start time.** `started_at` = `now()` = the **settle transaction start**. It is after acquisition, which
happens before the transaction in the CLI. So it is not the systemd unit start.

**End time and duration.**
- **AFL Tables:** `completed_at = now()` (`settle-afltables.ts:1944`), which is the transaction start
  again. **Its duration is not recorded**: every row should read `completed_at = started_at`. The query
  classifies such rows `not_recorded` and gives **no** AFL Tables duration statistic. AFL Tables
  transaction durations need another source (the journal).
- **AFL API:** `completed_at = clock_timestamp()` (`settle-core.ts:1056-1071`). The recorded duration runs
  from transaction start to just **before commit**. That covers essentially the whole time a settle would
  hold the gate, excluding commit. Rows written by a build older than I244-F008 would read
  `not_recorded`, and the classifier reports them as such.

**Overlap.**
- Interval overlap is computable only where both ends are recorded (AFL API).
- For AFL Tables only the start instant is known. Section 6b reports AFL Tables starts that fall inside an
  AFL API interval. Section 6c counts the runs whose overlap cannot be assessed.

**Timer schedule.** `started_at` shows when committed runs started. It cannot prove the installed timer
schedule: operator runs, manual starts, `Persistent=true` catch-up and failed runs all distort it. The
repository's timer files (`afldb-settle-afltables.timer` 04:30, `afldb-settle-afl-api.timer` 05:00) are
configuration, not evidence of installation.

**Time zone.** Times print in UTC and in Australia/Melbourne. Both are database clock readings.

### 16.2 Operator command (not run by the agent)

The query uses peer authentication as `postgres` on the PROD host, so no password or DSN is typed into or
printed by it. `sudo` asks for the operator's own password, as recorded for PROD.

From the workstation, there are two SSH connections in total, to keep the firewall burst small:

```powershell
scp D:\dev\afldb-issue-265\issues\open\AFLDB-ISSUE-265-prod-settle-timing.sql afldb:/tmp/issue265-settle-timing.sql
ssh -t afldb
```

Then on the PROD host (bash):

```bash
sudo -u postgres psql -X -v ON_ERROR_STOP=1 -d afldb_prod -f - < /tmp/issue265-settle-timing.sql 2>&1 | tee /tmp/issue265-settle-timing.out; psql_status=${PIPESTATUS[0]}; echo "psql exit status: ${psql_status}" | tee -a /tmp/issue265-settle-timing.out
rm /tmp/issue265-settle-timing.sql
```

- `-f - <` is used because `postgres` cannot read a file in the operator's home; the operator's shell
  reads it.
- `${PIPESTATUS[0]}` is psql's own status. A plain `| tee` pipeline reports tee's status, which is
  almost always 0. It must be read on the same line, before any other command runs. `set -o pipefail`
  is not used because it would persist in the interactive shell.
- `-v ON_ERROR_STOP=1` takes effect before the first line of the script is read. `-X` skips any
  `.psqlrc`, which could otherwise unset it.
- `sudo` prompts on the terminal, not through the pipe, so the prompt does not reach the output file.
- A result is complete only when the last two lines are `== Done. …` and `psql exit status: 0`.
  Status 3 means refused or a failed statement; status 2 means the connection failed.
- Return `/tmp/issue265-settle-timing.out`, or paste it, then delete it from the host.

### 16.3 Expected output

1. **`== 0. Target proof`.**
   - One row: `database = afldb_prod`, `role = postgres`, `transaction_read_only = on`,
     `statement_timeout = 30s`, then the server version, time zone and database clock.
   - Then `TARGET OK`.
   - Any other database or a non-read-only transaction prints `REFUSED: …` and stops with exit status 3,
     having read nothing.
2. **`== 1. Schema proof`.**
   - Seven rows (`completed_at`, `id`, `notes`, `started_at`, `status`, `tool`, `validation_result`)
     with their types, then `SCHEMA OK`.
   - Then the labels `{running,completed,failed,rolled_back}`.
   - A missing column prints `REFUSED` and stops with exit status 3.
3. **`== 2. Coverage`.** Two rows (`afl_api`, `afltables`): rows of all time, the first and last start,
   and rows in the last 30 days. A zero means no committed run of that provider was ever recorded on PROD.
4. **`== 3. Every run`.** One row per committed run in the last 30 days.
   - Expect AFL Tables rows `duration_basis = not_recorded` with `duration_s (null)`.
   - Expect AFL API rows `recorded` with seconds, unless the deployed build predates I244-F008.
   - `season`, `mode` and `auto_apply` are parsed from `notes`; `apply_failures` comes from the counters.
5. **`== 4. Counts`.** Runs per provider × `status` × `duration_basis`, with how many reported canonical
   apply failures. Expected: only `completed`.
6. **`== 5. Duration statistics`.** Two rows.
   - `afl_api`: `duration_samples` n, median, p95, max and min in seconds. The note reads `p95 weak` when
     n < 20; about 30 nightly runs would give n ≈ 30.
   - `afltables`: `duration_samples = 0`, all statistics `(null)`, and the note
     `no recorded duration: metric not available`.
7. **`== 6a/6b/6c`.**
   - 6a: AFL API interval overlaps (expected empty for one nightly unit).
   - 6b: AFL Tables starts inside AFL API intervals.
   - 6c: how many runs per provider are point-only, so their overlap cannot be assessed. That is expected
     to be every AFL Tables run.
8. **`== 7. Start hours`.** A histogram of committed-run start hours. It is evidence of when runs
   started, **not** of the timer.
9. **`== 8. Limitations`.** Counts of `running` rows, `failed`/`rolled_back` rows (expected 0), completed
   rows without an end, end-before-start rows, rows without counters, and last-30-day rows with no
   recorded duration.
10. `== Done.` The transaction is rolled back.
11. `psql exit status: 0`, appended by the operator command (§16.2). A `REFUSED` line is followed by an
    `ERROR: AFLDB-ISSUE-265 timing query REFUSED: …` line and `psql exit status: 3`.

### 16.4 What D-265-5 can and cannot take from it

Operational context (what the query can supply):
- **The AFL API p95 and maximum** give the time a promotion would be refused during a nightly AFL API run.
  This lower bound excludes commit.
- **The start hours** show when committed settles ran. They are not the installed timer.

Evidence for choosing the 60 s limit (what the query **cannot** supply, and nothing on PROD records):
- **The 60 s settle gate bound** concerns the **promotion's** duration, not the settle's: how long an
  in-flight promotion holds the exclusive gate while a settle waits behind it.
  - PROD promotion durations would be in `import_batches` rows with `tool = 'admin-upload'`
    (`pipeline.ts:381-385`). But `completed_at = now()` there too (`pipeline.ts:404`), so they are
    **not recorded**. The query does not read them.
  - Settle durations cannot stand in for them: they measure the other side of the gate.
  - Therefore no PROD record can validate the wait value (written for 60 s; decided 2026-10-05 as 300 s,
    §20.7). It stays an operator judgement. The only knowledge behind it is design knowledge: a promotion holds the gate from its hook
    to its commit, and a small CSV promotion is expected to take seconds. That expectation has never been
    measured.
- **Evidence that could inform it later (not in scope, nothing prepared):**
  - promotion transaction durations measured on `afldb_test` once Option 3 exists (Phase B);
  - a future change that records `clock_timestamp()` at `admin-upload` completion.

  Neither exists today.
- **No metric is available for:**
  - AFL Tables transaction duration;
  - failed or rolled-back runs of either provider;
  - promotion duration;
  - the installed timer schedule.

## 17. Phase A harness (prepared 2026-10-05; executed in two windows; closed)

Status as of 2026-10-05 16:26: **window 2 PASSED (§17.14); Phase A is closed and retired (§17.15).** The
status lines below describe the preparation passes and are kept as written.

Status at preparation: **written and hardened; not run against any database.**
- First pass (2026-10-05): written with no command executed.
- Second pass (2026-10-05, §17.10): typecheck, ESLint, a database-free skip check, and the new runner's
  offline checks were run. No database was contacted and no credential was read.
- No Phase A case has passed or failed; nothing is claimed about the behaviour it characterises.
- No production file changed.

### 17.1 File and gating

- **File.** `tests/integration/settle-promotion-deadlock.test.ts` (new, D-265-7).
- **Gating (hardened 2026-10-05).** The whole file is one `describe.runIf(...)`. It runs only when all of
  these hold:
  - `AFLDB_ISSUE265_PHASE=A`;
  - `AFLDB_ISSUE265_ARMED_AT` is the epoch milliseconds at which the runner launched vitest, at most
    15 minutes old;
  - `AFLDB_TEST_DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL` and `AFLDB_TEST_IMPORT_DATABASE_URL` are set.

  The old §17.9 command (`$env:AFLDB_ISSUE265_PHASE='A'; npx vitest …`) left the variable set in the
  operator's PowerShell session. A later, unrelated vitest run in that session would then have run
  Phase A whenever the DSNs were present. The expiring stamp closes that: an inherited `PHASE=A` alone no
  longer arms the file, and neither does a stale stamp.

  Otherwise every case is skipped. A skipped run is not evidence. Phase A asserts pre-change behaviour (the
  settle loses), so after Option 3 lands it must not run again. Phase B reuses its choreography helpers with
  inverted assertions.
- **No connection unless armed (proved 2026-10-05, §17.10).**
  - `./guard`, which connects at module load, is imported **dynamically** inside the gated `beforeAll`.
  - No other module the file reaches opens a connection on import.
- **DSNs, as the code reads them** (never from `.env`):
  - `AFLDB_TEST_DATABASE_URL`: the owner connection, the side transactions and both settles.
  - `AFLDB_AUTH_DATABASE_URL`: `validateSubmission()` writes verdicts through `authSql`.
  - `AFLDB_TEST_IMPORT_DATABASE_URL` (**required**; the owner fallback is removed). It is copied into
    `AFLDB_IMPORT_DATABASE_URL` for `promoteSubmission()` and the validation authority read
    (`pipeline.ts:154`, `:303`). This way the promotion runs as the import role, as in production. The
    copy is restored in `afterAll`.
- **Target guard (hardened 2026-10-05), before any write.**
  - The URLs, before connecting. Each of the three DSNs must:
    - name **exactly** `afldb_test` (no longer any `_test` suffix);
    - name one host, at the runner's expected endpoint (`AFLDB_ISSUE265_EXPECT_ENDPOINT`);
    - carry no query parameter that could redirect it (`host`, `dbname`, `user`, `options`, …).
  - The live sessions, after connecting (owner, import probe, `authSql`). Each must report:
    - `current_database() = 'afldb_test'`;
    - `current_user = session_user` = the runner's expected role (`AFLDB_ISSUE265_EXPECT_*_ROLE`:
      `afldb_owner`, `afldb_import`, `afldb_auth`);
    - not in recovery.
  - One server: all three must report the same server address, port, database oid and postmaster start
    time.
  - Every expected value missing, and every mismatch, refuses before the preflight census. No DSN or
    secret is printed.

### 17.2 Reserved season: 2078 (repository evidence, Grep)

- **2078 is not a season value anywhere.** It occurs only as other kinds of number:
  - a player id: `data/brownlow/season-votes.csv`, `data/players/sibling-relationships.csv`;
  - ids in `issues/closed/queue-v1-baseline.json` and `issues/closed/backtest-v1-baseline.json`;
  - four `docs/rebuild-manifests/draftguru/bridge-population-scan-20260918-v*` files (not inspected line by
    line).

  It does not occur at all in `tests/`, `tools/` or `src/`.
- **Seasons already claimed near it:**
  - 2073 (`match-results-promotion.test.ts:74`);
  - 2077 (`admin-brownlow.test.ts:1395`);
  - 2079 and 2083 (`data-editor.test.ts:68`, `:902`);
  - 2082 (`derived-rebuild-parity.test.ts:37`);
  - 2093 (`settle-afltables.test.ts:2064`, the S5 applier harness);
  - 2094 (`settle-afltables.test.ts:144`);
  - 2084-2099 more widely, including 2091 and 2099.

  2093 and 2077, 2079, 2083 were not in the brief's "known taken" list. They were found by the same grep.
- **One season for both providers, kept apart by round and date.**
  - A1 (AFL Tables) uses rounds 1-4.
  - A2/A3 (AFL API) use rounds 5-9, on different dates.
  - So no AFL API insert sees an AFL Tables match as a plausible existing fixture: that test is same clubs,
    with at most one of round/date differing (`match-rekey.ts:213-216`).
- **Synthetic identities only.**
  - two club identities, each its own organization, spanning 2078 only (the ISSUE-258 pattern);
  - one venue;
  - two players: *p*, who is bridged to `afl_api` and also holds an AFL Tables identity, as a real importer
    row's player does; and *q*, who exists for the legacy file only.

  No real club, venue or player is referenced. So the end-of-run derived recompute cannot reach a historical
  row:
  - `recomputeSeasonMetadata` and `recomputeClubSeasons` run for 2078 only;
  - `recomputePlayerDerivedStats` runs over *p* and *q* only.
- **Namespaces.**
  - `issue265-`: AFL Tables record ids, scopes and snapshot labels;
  - `2078I265`: embedded in every AFL API provider id;
  - `2078|`: match keys;
  - `afldb-issue-265-`: slugs;
  - `AFLDB-ISSUE-265.csv`: submissions.

### 17.3 What each case asserts

Every ordering is forced with side transactions and the recursive waiter walk copied from
`match-results-promotion.test.ts:972-1003`. Timing is read, not assumed:
- `SHOW deadlock_timeout` is parsed.
- The "check has passed" pause is `deadlock_timeout + 300 ms`, which is 1.3 s at the default (shortened
  2026-10-05, review F-001). The pause starts only once the promotion has been **observed** waiting, so
  its single check fires at most `deadlock_timeout` after that. It was
  `max(deadlock_timeout + 0.5 s, 1.5 × deadlock_timeout)`.
- Each promotion wait is checked directly once observed (review F-002): exactly one ungranted lock, of
  type `transactionid`, with the settle as its only blocker. That is a wait on the settle's transaction,
  not a place in a tuple-lock queue.
- The run refuses if `pause + deadlock_timeout > 3.5 s`, because A1 would then not fit inside the 5 s hook
  bound.

**A1, AFL Tables, C2 (real `runSettleAfltables`, real `match_results` promotion).** *(Choreography revised
2026-10-05 after window 1 failed, §17.12 and §17.13. Before that, X held MC `FOR UPDATE`, Y held MD
`FOR UPDATE`, and the pause was counted from the observation.)*
- **Setup.** A seed settle creates MA, MB, MC and MD in that order, so their ids ascend, and the case asserts
  MA < MB. The run bundle's feed order is MB, MC, MA, MD; it changes attendance on all four.
  - X holds **MA's AFL Tables spine record** (`staging.source_records`) `FOR UPDATE`. That is the first
    lock MA's record takes (`observation-store.ts:93`).
  - Y holds an **uncommitted open `canonical_apply_failed` finding under MA's `matches` key**. Y is always
    rolled back.
  - Neither touches a match row.
- **Choreography.**
  1. The settle writes MB and MC, then queues behind X at MA's record.
  2. The promotion (MA, MB, full score breakdown) queues behind the settle. Its hook takes MA
     `FOR NO KEY UPDATE` (`datasets.ts:776`), which is why MA later conflicts with the settle's UPDATE.
     It then waits on MB, which the settle holds. Its `pg_locks.waitstart` is read.
  3. X is released at `waitstart + deadlock_timeout + 150 ms`, **on the server clock**, so the promotion's
     one check has run.
  4. The cycle is observed directly: the settle waits on the promotion's transaction at MA. That wait began
     more than `deadlock_timeout` after the promotion's wait.
  5. The settle loses MA. On the INSERT of MA's finding it queues behind Y, still holding MB. This is
     observed before the promotion resolves.
  6. The promotion resolves while Y still holds the settle open. Y is then rolled back.
- **Asserts.**
  - The settle commits with `canonicalApplyFailures = 1`.
  - Every open `canonical_apply_failed` finding belongs to MA, includes MA's `matches` key, and carries
    `deadlock detected`.
  - MA's attendance is unchanged; MB, MC and MD are applied.
  - The promotion returns `LEGACY_PROMOTION_LOCK_REFUSAL` with the submission `failed`, and no `admin-upload`
    batch exists for it.
  - The promotion's elapsed time is at least 4.5 s and under 20 s: its hook bound expired, so it was not a
    deadlock victim.
  - The settle reached Y before the promotion resolved. *(Proven on the server clock since 2026-10-05,
    §17.13 F-001. One consistent `pg_locks` snapshot shows the settle already waiting on Y while the
    promotion is still in its original MB wait, with the same `waitstart`. It no longer rests on client
    receive times.)*
  - *(Added 2026-10-05.)* The promotion's MB wait and the settle's MA wait are each exactly one ungranted
    `transactionid` lock, each with the other as its only blocker. The settle's MA wait began more than
    `deadlock_timeout` after the promotion's wait. Y ends rolled back (`HeldAborted`).
- **Recovery.** The same bundle is run again. Assert:
  - `canonicalRetryApplied ≥ 1`, and MA is applied;
  - every finding the run opened is resolved `canonical_apply_succeeded`, and none is open;
  - re-promotion of the same submission succeeds.

**A2, AFL API, C1 (real `runSettleAflApi`, real `player_match_stats` promotion).**
- **Setup.** A seed settle creates M1-M5, owned by `afl_api`, with *p* on each. The run bundle has three units:
  - M1: match unchanged, *p* changed;
  - M2: venue name changed;
  - M3: venue name changed.

  X holds M2 `FOR SHARE` and Y holds M3 `FOR SHARE`. The file is (*p*, M1), with values equal to the settle's,
  then (*q*, M2).
- **Choreography.**
  1. The settle queues behind X.
  2. The promotion queues behind the settle.
  3. Pause, then release X. The promotion's `FOR SHARE` becomes the settle's new blocker, so the settle gets a
     fresh check and loses (review F-004).
  4. The settle queues behind Y.
- **Futility.** While M3 stalls the settle, the promotion is still unresolved and still in the settle's waiter
  set. This is checked twice, 300 ms apart.
- **Asserts.**
  - The settle commits with `canonicalApplyFailures = 1`.
  - The only open finding is `afl_api|apply|match|<M2>|matches`, and it carries `deadlock detected`.
  - M2 is unchanged; M3 is applied.
  - The promotion succeeds after the commit, and (*q*, M2) exists.
- **Recovery.** The next run applies M2. The finding is resolved `canonical_apply_succeeded`.

**A3, AFL API, F-265-1.**
- **Fixture.** A complete AFL Tables attendance row for the `afl_api`-owned M4, keyed by M4's match key, plus
  the spine version it would cite. It is written in the case itself, so the seed run's enrichment never sees
  it.
- **Run bundle.** M4 (match unchanged, *p* changed), then M5 (changed), stalled by Z. M5 is an added stall,
  needed so the promotion's check passes before the enrichment asks for M4.
- **Choreography.**
  1. The settle writes (*p*, M4), then queues behind Z.
  2. The promotion holds M4 `FOR SHARE` and queues behind the settle.
  3. Pause, then release Z. The enrichment's `FOR UPDATE` on M4 (`canonical-apply.ts:1394-1401`, before any
     gate) closes the cycle.
- **Asserts.**
  - `runSettleAflApi` rejects with SQLSTATE `40P01`.
  - A before/after snapshot is unchanged: the spine version counts for M4 and M5, the namespace ledger and
    finding counts, M4's attendance, M5's venue, and zero `import_batches` rows carrying the A3 label.
  - The promotion then succeeds. (*p*, M4) keeps the seed kicks and disposals, and has the promotion's goals.

### 17.4 Synthetic AFL API payloads (no season-2026 fixture used)

- **No 2026 fixture was read.** The three provider payloads are built in code from the emitters' contract in
  `afl-api-bundle.ts`: the known and required columns, CONCLUDED statuses, per-period deltas that reproduce
  the final score, and `venueLocalStartTime`. In May, Australia/Melbourne is AEST (UTC+10), so `05:10Z` and
  `15:10` agree. The real files under `tests/fixtures/afl_api` were not opened.
- **Reference data the reserved season lacks** is supplied to the real functions in memory:
  - **A declared vocabulary `afl_api_2078`** (api round *n* → canonical home-and-away round *n*, 1-9). It is
    added to a parsed copy of `data/reference/source-families.json` and validated by the real
    `parseSourceFamilyRegistry()`. The file on disk is untouched. The run refuses if that key ever appears in
    the real file.
  - **An `AflApiIdentities` object** mapping the synthetic team, venue and comp-season ids.
- **This is a test-input technique, not a code change.** Phase B reuses it.

### 17.5 Census, fingerprints and teardown (hardened 2026-10-05)

- **Preflight (collision check), before any write.** A census proves zero rows in the reserved season and
  the namespaces. Any residue refuses the run, and the teardown then deletes **nothing**. Added
  2026-10-05:
  - `data_issues` by every tracked id, match key and provider id, plus the exact season-gate keys
    `afltables|apply|season|2078|seasons` and `afl_api|apply|season|2078|seasons`;
  - `canonical_applications` by `target_key->>'match_key'` as well as by record id;
  - `promotion_decisions` of namespaced candidates;
  - `stat_availability` and `brownlow_season_votes` for 2078;
  - `staging.afl_api_lineup` and `staging.afl_api_brownlow_vote` for 2078 or a namespaced provider id;
  - the AFL API typed projections by season as well as by provider id.
- **Fingerprints, after the preflight and before setup.** Each is the md5 of the ordered per-row md5s,
  computed outside 2078 and the namespaces. Every filter is null-safe:
  `NOT coalesce(<namespace predicate>, false)`, so a NULL slug or key is fingerprinted, not dropped.
  - Tables: matches, match_period_scores, player_match_stats, players, external_identities, seasons,
    clubs, club_organizations and venues. Added 2026-10-05: stat_availability, brownlow_round_votes,
    data_overrides, data_edits, data_issues, canonical_applications, promotion_candidates and
    import_rejections.
  - **Recompute-written tables, now WITH their ids**: club_seasons, player_clubs, player_career_stats,
    player_season_stats and player_club_season_stats.
    - Phase A's recomputes are scoped to 2078 and to the synthetic players, so no historical id may
    change. (The ISSUE-264 id exclusion existed because `settle-afl-api.test.ts` recomputed real 2026.
    Phase A never runs that suite.)
    - Each also has a `…_values` twin without `id`, only so a mismatch says whether an id was
      re-issued or a value changed. Both must be equal.
- **Between cases.** `afterEach` rolls back any side transaction the case left open, then waits up to
  90 s for the case's settles and promotions. Anything still running **poisons** the file: every later
  case refuses to start, so no case runs into another's locks.
- **Teardown order** (gated `afterAll`, which vitest also runs after a `beforeAll` failure — the same
  reliance as `match-results-promotion.test.ts:747-750`):
  1. Abort every open side transaction (bounded 30 s).
  2. Await in-flight settles and promotions (bounded 120 s). Then terminate each observed backend by
     **pid and `backend_start`**, so a reused pid can never be hit. Termination goes through the owner
     connection and then an import-role connection, because a role may signal only its own backends:
     the settles and side transactions run as the owner, the promotion as the import role. A further
     30 s bound follows.
  3. End every side and settle connection, which the harness now also ends as soon as its work
     finishes. End the process-wide auth pool `validateSubmission()` opened (`authClient.ts`). Each
     `promoteSubmission()` ends its own connection (`pipeline.ts:308`).
  4. Record the retained admin-upload batches (by tracked submission) before their submissions are
     deleted.
  5. Run the scoped deletes in foreign-key order: `player_clubs` before `matches`, and the spine as in
     `settle-afl-api.test.ts:610-761`.
     - Each names tracked ids **and** the season or namespace.
     - `import_batches` are now deleted by **tracked id only** (settle and A3 fixture batches), never
       by a notes pattern alone. An untracked namespaced batch stays, for the census to report.
  6. Run the residue census, which must read zero everywhere. Then compare the fingerprints.
  7. Write the evidence file (`AFLDB_ISSUE265_EVIDENCE_FILE`). Restore the process environment the file
     changed. End the owner connection.
- **Bounded waits.** No await in the file is unbounded:
  - every settle, promotion and side transaction is awaited through `within(label, promise, ms)`;
  - every poll goes through `waitUntil` (20 s), which fails fast with the watched run's own outcome;
  - each case's vitest timeout (180 s) sits above all of these.

### 17.6 Retained-record policy and accounting

- **Deleted.** Everything the run creates, except the three items below. That covers every settle batch and
  the A3 fixture batch, `canonical_applications`, the spine and the typed projections. This follows the
  settle suites' convention (`cleanup122`, `settle-afl-api.test.ts cleanup()`).
- **Retained by convention** (ISSUE-264 §14.3; `submission-promotion` and `match-results-promotion`):
  - the fixture `auth_users` row `issue-265-deadlock-fixture@afldb.test`. Exactly one row exists after
    the run. Whether it pre-existed is recorded.
  - the `sources` `sports_data_lab` row. Exactly one exists. Whether this run seeded it is recorded.
  - **exactly three** `import_batches` rows with `tool = 'admin-upload'`, notes `submission <id>`:
    - A1's re-promotion (`match_results`);
    - A2 (`player_match_stats`);
    - A3 (`player_match_stats`).

    A1's refused promotion leaves none; that is asserted. Their submissions are deleted, so nothing
    references them after teardown.
- **Accounting.**
  - The harness writes the retained batch ids, the tracked ids, any teardown problem, its residue census
    and the names of any changed fingerprints to the evidence file.
  - The runner's census is **load-bearing, not redundant** (review F-005). It fingerprints tables the
    harness does not: the observation spine, `staging.afltables_match` outside 2078, `sources`,
    `auth_users`, `data_submissions` and `promotion_decisions`.
  - The runner's probe then independently checks the following.
    - Every `import_batches` row newer than the baseline must be an `admin-upload` batch for
      `match_results` or `player_match_stats`. Its submission must be gone, and its id must be on the
      harness's list.
    - The count must be exactly 3 when the suite passed 3/3.
    - Fixture user = 1 and `sports_data_lab` = 1.
  - Anything else reads **UNEXPLAINED**. That includes a batch with no evidence file to attribute it to.

### 17.7 Not verified

- **No Phase A case has run.** Nothing about the deadlock behaviour is observed. All of §17.3 is
  expectation.
- **Framework behaviours relied on, not proved against a database:**
  - postgres.js fragments are lazy and nestable;
  - `sql(identifier)` quotes the table and alias names in the `recomputed()` fingerprint helper;
  - vitest runs `afterAll` after a failed `beforeAll`. The existing suites rely on the same.

  Typecheck passed, so the type surfaces are right. The runtime behaviour is unexercised.
- **The lock-semantics assumptions (§17.8) are reasoned from PostgreSQL behaviour and source**, not
  observed.
- **Role privileges are assumed, not read:**
  - that the owner role can see other roles' `pg_stat_activity.state`. The ISSUE-264 window's isolation
    check relied on the same and passed.
  - that `pg_terminate_backend` is refused across roles. The teardown tries the owner, then the import
    role, and reports any backend neither could end.

### 17.8 Remaining assumptions (design blockers resolved 2026-10-05)

1. ~~The guarded runner is the operator's (ISSUE-264's, untracked).~~ **Resolved:** a dedicated runner
   and probe exist under `D:\tmp\issue265\` (§17.10). The ISSUE-264 originals and their evidence are
   unchanged.
2. **A2 relies on a share lock not queuing.** The promotion's `FOR SHARE` on M2 must not queue behind the
   settle's waiting `FOR NO KEY UPDATE`. PostgreSQL does not make a share-lock request sleep when only share
   lockers hold the tuple. This is what §13.2 step 5 already assumes. If it were wrong, the case fails on
   `canonicalApplyFailures` and the promotion outcome, not silently. (Independent review: §17.11.)
3. **A1's recovery assertion assumes only MA's `matches` target was invited.** The run changes attendance
   only, so MA's period-score target should not have been invited (`history_only`, not offered). If it was,
   its finding cannot close: AFL Tables has no moot-close (§4.1). The recovery assertion would then fail.
   That would be a real characterisation finding, not a harness defect.
4. **A3 adds the M5/Z stall.**
   - §13.2 does not name it. It is needed so that the promotion's single deadlock check passes before the
     enrichment closes the cycle.
   - The enrichment sweep runs after every unit (`settle-afl-api.ts:1946`). Its candidates are the AFL
     Tables staging rows with complete attendance whose rendered match key the run owns
     (`:1016-1036`).
   - It applies D-265-7's "forced, not raced" rule and does not change what A3 asserts.
5. **The file was created with the Write tool,** not `node .phaneslight/scripts/cli.js new-file`. The
   operator may register it.
6. **A1 step 5 is the file's one timing-bounded step** (review F-001, MED). It is inherent to shape C2.
   - After X is released, the settle must:
     - finish MC;
     - start MA (spine writes, savepoints, the fresh read, the authority read);
     - begin waiting;
     - run its own deadlock check one `deadlock_timeout` later.
   - All of that must happen before the promotion's 5 s hook `lock_timeout` expires, and every statement
     crosses the tunnel (about 60 ms each). The reviewer estimated the deadlock lands about 3.8–4.3 s
     into the promotion's wait at the old pause.
   - If a slow link misses the budget, the promotion is refused first, releases MA, and the settle
     applies MA cleanly. `canonicalApplyFailures` is then 0 and A1 **fails loudly**. That is a budget
     miss, not evidence that no deadlock occurs.
   - Mitigation:
     - the pause is shortened to `deadlock_timeout + 300 ms`;
     - the evidence file records the measured gaps (`timings.A1`);
     - the probe preflight logs the round-trip time (10 × `SELECT 1`).

     No assertion was weakened.

### 17.9 Operator commands (prepared; none run against a database)

Run from any directory; the runner works on `D:\dev\afldb-issue-265`.
- Run it through `powershell.exe -File`, so every environment change stays in a child process and the
  operator's own session is never touched.
- The base tree has Option 3 **not** applied.
- Start with the operator's usual `afldb_test` SSH tunnel open on `127.0.0.1:55432`, or adjust
  `-TunnelPort`.

```powershell
# 1. Database-free: preconditions, the probe selftest, the guarded skip check.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseA.ps1 -Phase SelfTest

# 2. Read-only: targets, isolation, migration state, collision census and baseline. Writes nothing.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseA.ps1 -Phase Preflight -TunnelHost 127.0.0.1 -TunnelPort 55432

# 3. The guarded Phase A window: steps 1-2 again, an isolation re-check, the ONE suite armed for one
#    launch, then (always, pass or fail) the post-run census reconciled with the harness evidence.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseA.ps1 -Phase Full -TunnelHost 127.0.0.1 -TunnelPort 55432

# After an interrupted window only (read-only): re-census against that window's baseline.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseA.ps1 -Phase Census -TunnelHost 127.0.0.1 -TunnelPort 55432 -BaselineFile D:\tmp\issue265\run-<stamp>-Full\baseline.json -EvidenceFile D:\tmp\issue265\run-<stamp>-Full\harness-evidence.json
```

**Expected result of `-Phase Full`:**
- `Test Files 1 passed (1)` and `Tests 3 passed (3)`: A1, A2, A3; 0 skipped, 0 failed.
- The post-run census reads `CLEAN`:
  - historical fingerprints equal the baseline;
  - zero residue;
  - every single-column foreign key into a namespace row reads zero;
  - exactly three retained `admin-upload` batches, explained;
  - one fixture user and one `sports_data_lab` source.
- `OVERALL: PASS (Full)`.

Any other outcome stops with the reason and leaves the evidence under `D:\tmp\issue265\run-<stamp>-Full\`.

The old commands in this section (`$env:AFLDB_ISSUE265_PHASE='A'; npx vitest …`) are **withdrawn**:
- they left the variable set in the operator's session;
- they no longer arm the file.

### 17.10 Preparation record (2026-10-05, agent; database-free)

**Scope.** Local, database-free commands only:
- no database, credential, DEV or PROD contact;
- no Git write;
- the season-2026 settle fixtures and suites were not run;
- the advisory-lock mitigation was not implemented.

**Harness changes** (`tests/integration/settle-promotion-deadlock.test.ts`):
- Removed the unused `matchIdOf` (the operator's ESLint warning).
- The armed gate, exact target guard, required import DSN and environment restore (§17.1).
- The census, fingerprints, bounded waits, per-case drain, role-aware termination, auth pool disposal,
  tracked-only batch deletes and evidence file (§17.5, §17.6).
- `likeLiteral` became a hoisted function. The new `TRACKED_ISSUE_PATTERNS` constant uses it at module
  load.

**No connection on import (established before the skip check ran).**
- A static scan (`D:\tmp\issue265\tools\import-graph.mjs`: TypeScript `preProcessFile`, nothing executed)
  followed every import of the harness and of `tests/setup.ts`: 44 repository modules.
  - `src/db/client.ts`, whose module load constructs a pool, is **not reachable**.
  - `src/db/authClient.ts` is a lazy proxy.
  - The only module-scope connection is `tests/integration/guard.ts`. It is reached only through the
    dynamic `import('./guard')` inside the gated `beforeAll`, and vitest does not run hooks of a skipped
    suite.
  - The scanner's other flags are function bodies, not module scope.
  - `tests/setup.ts` reads `.env` only if one exists; the worktree has none (checked by path, not
    opened). It connects to nothing.
- The skip check (`tools\Invoke-Issue265SkipCheck.ps1`) then ran vitest twice. For both runs,
  `NODE_OPTIONS` preloaded `tools\block-network.cjs`, which refuses and logs every TCP connect.
  - Run 1: a clean environment.
  - Run 2: `AFLDB_ISSUE265_PHASE=A` inherited, a 2-hour-old stamp, and fake DSNs naming
    `afldb_test@127.0.0.1:9`.
  - Both reported `Test Files 1 skipped (1)`, `Tests 3 skipped (3)`. The preload was active in 4
    processes. **Zero connection attempts.**
  - The process environment was saved, cleared and restored.

**Migration 110 is not required for Phase A.**
- No Phase A file writes or reads a `player_match_stats` override of 2078.
- The settle (`manual-authority.ts:547-561`) and the promotion (`datasets.ts:949`) answer "no authority"
  identically in State A and State B. That is migration 110's own contract (its header: "the new
  application is safe under either CHECK").
- Only the Match Sheet writer probes for State B (`match-sheet.ts:201`), and Phase A does not call it.
- So the runner records the state (A or B; refusing only migrations other than 110 pending, orphan
  ledger rows, or a CHECK/ledger disagreement). It **applies and restores nothing**. ISSUE-264's
  apply/restore step was deliberately not carried over.

**Dedicated tooling** (outside the repository, `D:\tmp\issue265\`):

| File | Role |
|---|---|
| `Invoke-Issue265PhaseA.ps1` | Runner. Derived from `D:\tmp\issue264\Invoke-Issue264Window.ps1` (unchanged). Launches only this one suite, never `settle-afl-api`/`settle-afltables`, never a migration. |
| `issue265-db-probe.mjs` | Read-only probe. Derived from `issue264-db-probe.mjs` and `issue264-window.mjs` (unchanged). Modes: selftest, derive, targets, preflight, isolation, snapshot. The snapshot carries a catalog-driven foreign-key census into every namespace row, fingerprints (club_seasons and the player tables with ids; the spine, staging projections, findings, ledgers, intake, users, sources) and retained-record reconciliation. |
| `tools\Invoke-Issue265SkipCheck.ps1` | The database-free skip check above. |
| `tools\block-network.cjs` | The TCP-refusing preload. |
| `tools\import-graph.mjs` | The static import scan. |

**Offline checks run (2026-10-05):**
- `npm run typecheck` (`next typegen && tsc --noEmit`): exit 0.
- `npx eslint --max-warnings 0 tests/integration/settle-promotion-deadlock.test.ts`: exit 0, no
  warnings.
- The skip check: PASS (above).
- PowerShell parser: 0 errors for both `.ps1` files.
- `node --check` for the three `.mjs`/`.cjs` files: exit 0.
- The probe `selftest`: 20/20, covering:
  - derive rewrites only host, port and database;
  - an exact `afldb_test` is required, so `code_test_db_test` is refused;
  - an endpoint mismatch, a `host`/`dbname` override parameter and a multi-host URL are refused;
  - redaction;
  - the migration verdict for State A, State B, another pending migration and a CHECK/ledger
    disagreement;
  - retained-record reconciliation: three explained batches, a leftover settle batch, a batch whose
    submission still exists, a missing evidence file and a second fixture user.
- The preload's own self-test: two connect styles refused and logged.
- The runner `-Phase SelfTest`: `OVERALL: PASS (SelfTest)`.
- The PROD timing SQL, static (§16):
  - the first command is `ON_ERROR_STOP`;
  - no `\quit` remains;
  - no writing keyword appears;
  - the transaction is `READ ONLY`;
  - both refusals raise.

**Not run (each needs a database, a credential or the operator):**
- the runner's `Preflight`, `Full` and `Census` phases;
- the probe's `derive` on real settings, and its `targets`, `preflight`, `isolation` and `snapshot`;
- every Phase A case;
- the PROD timing query.

### 17.11 Independent review of the harness, runner and probe (2026-10-05, `afldb-reviewer`, read-only)

The reviewer re-read the harness in full, the runner, the probe, both tools and the cited production code.
It wrote and ran nothing. It graded nothing CRIT or HIGH.

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| F-001 | MED | A1 step 5's budget ignored the settle's statement latency over the tunnel. A slow link lets the promotion's 5 s hook bound expire first, and A1 then fails loudly as "no deadlock". | **Applied** (harness, probe, §17.3, §17.8 item 6): the pause is now `deadlock_timeout + 300 ms`; `timings.A1` goes to the evidence file; the probe preflight logs the round-trip time. The step stays timing-bounded: that is inherent to C2 and recorded. |
| F-002 | LOW | The waiter walk could not tell a wait on the settle's transaction from a place in a tuple-lock queue, which is §17.8 item 2. | **Applied:** `expectWaitsOnTransactionOf` checks each observed promotion wait in A1, A2 and A3. It requires exactly one ungranted `transactionid` lock and the settle as the only blocker. |
| F-003 | LOW | A blocked teardown statement could run `afterAll` past its 600 s bound before the evidence was written. | **Applied:** teardown sets the owner's `lock_timeout` to 30 s and `statement_timeout` to 120 s before its deletes. |
| F-004 | LOW | W's player-record ids could be censused but never deleted. | **Applied:** they are added to `TRACKED_RECORD_IDS`. None is expected: W has no stats row. |
| F-005 | INFO | Name the A1 hook's strength. State that the runner census is load-bearing. | **Applied** (§17.3, §17.6). |

**Agent finding, fixed before the review report (not graded by the reviewer).** Without
`pg_read_all_stats`, a role sees `backend_start` only for its own role's sessions. So the teardown would
have read the import-role promotion's start time as NULL and treated that backend as already gone.
- `observe()` now reads an invisible backend through an import-role session.
- `terminateObserved()` decides "gone" or "reused" only from a role that can see the backend.
- A backend whose identity was never recorded is reported, never signalled.

**Verified with no finding:**
- **(a) A2's lock-queue assumption, as claimed.** The PostgreSQL internals are UNVERIFIED from source;
  the reviewer's confidence is about 85%.
  - The M2 unit has only a `matches` target, so the settle's only M2 lock is its UPDATE.
  - The promotion's `FOR SHARE` request does not sleep on a share-only locker, so it bypasses the
    settle's queue.
  - After X commits, the settle waits on the MultiXact's live member, the promotion. That is a new wait
    and a fresh check, and the settle is the victim.
  - The promotion's (p, M1) wait is `ON CONFLICT … DO UPDATE` (`datasets.ts:1174`) on the settle's
    uncommitted row.
- **(b) A3's stall is needed and sufficient, and the fixture reaches M4.**
  - Between M5 and the sweep, only the season-gate finding clear runs.
  - M4 is in `ownedMatchKeys`.
  - The sweep's rendered key equals the fixture's.
  - The `40P01` is rethrown, so the whole run rolls back (`settle-afl-api.ts:2023-2024`).
- **(c) Ordering.** Every other step is forced by observed lock waits. `promotionElapsed >= 4500` is sound.
  Feed order is honoured.
- **(d) Bounds and disposal.** Every await is bounded and every connection is ended.
- **(e) Failed-setup teardown.** It deletes nothing before the census proved absence, and the
  foreign-key order is correct.
- **(f) Predicates.** They are null-safe and correctly escaped. The recomputes stay inside 2078 and the
  synthetic players.
- **(g) The runner.** Its target proof precedes any write. It prints no secret and restores the
  environment. The post-run census always runs. The three retained batches are correct. Its migration
  110 handling applies nothing.

**Remaining uncertainties (recorded, not resolved; no assertion weakened, no scenario emulated):**
1. A1 step 5 still depends on link latency (F-001). A budget miss fails A1 loudly; it is not evidence.
2. The PostgreSQL row-lock semantics behind A2 and A3 are reasoned, not observed. F-002 now makes a
   wrong assumption fail at the exact step.
3. Vitest skipping nested `beforeAll` hooks after an outer `beforeAll` throws: about 80%.
4. Whether the owner can see other roles' `pg_stat_activity.state`. If it cannot, the isolation proof
   refuses, failing closed.
5. The synthetic AFL API payloads are unexercised against `afl-api-bundle.ts`. A shape error fails
   loudly through `buildFailures` before any lock.
6. `loadPlayerMatchStatsAuthority` in State A: about 75%. Phase A writes no such record either way.

**Offline checks re-run after the fixes:**
- `npm run typecheck`: exit 0.
- ESLint `--max-warnings 0` on the harness: exit 0.
- `node --check` on the probe: exit 0.
- Runner `-Phase SelfTest`: `OVERALL: PASS`, covering the probe selftest (20/20) and the skip check
  (3/3 skipped twice, 0 connection attempts).

### 17.12 Phase A window 1 (2026-10-05 15:23:57, `-Phase Full`): FAILED, census CLEAN

**Evidence (preserved unchanged):** `D:\tmp\issue265\run-20261005-152357-Full\` — `00-derive.log` …
`06-post-census.log`, `baseline.json`, `preflight.json`, `06-post-census.json`, `harness-evidence.json`,
`summary.txt`. Operator-run. The agent read it afterwards and contacted no database.

**Window facts.**
- Base tree; Option 3 not applied.
- Migration 110 not applied: State A, recorded and left unchanged.
- PostgreSQL 16.15; `deadlock_timeout` 1000 ms.
- Tunnel round trip: median 64.2 ms, max 96.7 ms.
- Isolation re-check: 0 other sessions.
- Suite: 1 file; 1 failed, 2 passed; 162 s.

| Case | Result | What it shows |
|---|---|---|
| A2, AFL API, C1 | **passed** (25.7 s) | On the base tree the M2 unit lost the deadlock. The promotion stayed blocked by the settle after that unit rolled back (in-run retry futility), then succeeded. The recovery run healed M2. |
| A3, AFL API, F-265-1 | **passed** (12.4 s) | The attendance enrichment lost the deadlock, the whole AFL API run rolled back, and the promotion then succeeded. |
| A1, AFL Tables, C2 | **FAILED** (14.2 s, harness line 1683) | **Unproven.** This window neither demonstrates nor refutes the settle losing MA to a `match_results` promotion. |

**Post-run census: CLEAN.**
- Historical fingerprints equal the baseline.
- Zero residue.
- Foreign-key census: 136 single-column keys checked, 0 non-zero.
- Teardown problems: 0.
- Retained records:
  - two `admin-upload` batches, both `player_match_stats` and both explained: **1222** (submission 325,
    A2) and **1226** (submission 326, A3). The expected third batch, from A1's re-promotion, does not exist
    because A1 stopped before it.
  - one fixture auth user. This run created it (`preexisted: false`); it is retained by convention.
  - `sports_data_lab`, which already existed.

**A1: the ordering observed.** Taken from the log and the evidence file, not from the test name or the
failure label:
1. The settle was observed queued behind X on MC (step 3 passed).
2. The promotion was observed queued behind the settle on MB. Its wait passed the F-002 check: one
   ungranted `transactionid` lock, with the settle as the only blocker.
3. After the 1.3 s pause, X was released.
4. The promotion then returned `{ok: false, LEGACY_PROMOTION_LOCK_REFUSAL}` before any poll saw the settle
   queued behind Y on MD. Y still held MD at that poll: the harness releases Y only after this step.
5. `afterEach` rolled back Y, and the A1 settle then **committed**. Batch 1219 is in `settleBatchIds`
   (between the A1 seed, 1218, and the AFL API seed, 1220), and the harness adds an id there only on a
   resolved settle result.

**Whether the intended deadlock occurred: not determinable from the retained evidence.**
- The refusal text is the same for `55P03` (lock timeout) and `40P01` (deadlock victim)
  (`datasets.ts:565-569`), and the pipeline returns only the text.
- `timings.A1` was assigned after the failing line, so the evidence file's `timings` is `{}`.
- The teardown deleted the A1 settle's batch row and any MA finding, as designed.

Two orderings fit every retained fact:
- **(i) Intended.** The settle lost MA inside MA's unit, then did not reach MD's wait before the promotion's
  `lock_timeout` expired, 5 s after its MB wait began. Reaching MD meant MA's failure path plus MD's whole
  record, all over the tunnel.
- **(ii) No deadlock.** The promotion's `lock_timeout` fired first: while the settle was still finishing MC
  or running MA's record, or while it was waiting on MA before its own check. MA was released and the
  settle applied it.

A third ordering, the promotion as the deadlock victim, is excluded by mechanism, not by evidence.
PostgreSQL runs one check per wait, `deadlock_timeout` after the wait begins. The promotion's MB wait
began before it was observed, and X was released at least 1.3 s after that observation, so the
promotion's check had run before the settle could ask for MA.

A rough statement-count estimate puts the cycle closing about 4 s after the promotion's wait began, which
would favour (ii). That is not evidence: its uncertainty, about ±1 s, spans both.

**Why A1 failed: the harness choreography, not the product.** Everything between the promotion's wait
start and the required observation crossed the tunnel:
- the observation lag, including opening the import-role observer connection lazily inside it;
- the 1.3 s pause, counted from the observation rather than from the wait start;
- the rest of MC's unit;
- MA's whole record up to its `UPDATE matches` (`canonical-apply.ts:808`; `lockUnitMatchRows` takes no
  lock for a match-only unit with no rekey, `:490-506`);
- the settle's 1 s check;
- MA's failure path;
- MD's whole record up to its UPDATE.

At a 64 ms round trip, 5 s cannot hold all of that. Review F-001 had flagged this risk (§17.11,
uncertainty 1); the shortened pause was not enough.

**Disposition.** The window is **FAILED, census CLEAN**. A2 and A3 stand as passing base-tree evidence for
shapes C1 and F-265-1. A1 (C2) remains **unproven**. The choreography is revised in §17.13; the next window
re-runs all three cases.

### 17.13 A1 choreography revision and its independent review (2026-10-05, agent; database-free)

**Scope.** Harness only (`tests/integration/settle-promotion-deadlock.test.ts`, case A1). Not touched:
- production code, `LEGACY_LOCK_TIMEOUT` (5 s) and every substantive A1 assertion;
- A2 and A3;
- the runner and the probe.

No test seam was needed. The advisory-lock mitigation is not implemented. There was no database,
credential, DEV or PROD contact, and no Git write.

**Change.** See the revised A1 entry in §17.3.
- **X moved to MA's spine record.** This removes the rest of MC's unit and MA's earlier records from the
  window. What remains is MA's own record up to its `UPDATE matches`.
- **Y moved to MA's open-finding key, uncommitted.** This removes MA's failure-path writes and all of MD's
  record. The settle stalls after three savepoint cleanups (the driver's `rollback to sN`, then the
  anchor's ROLLBACK TO and RELEASE) and one INSERT. Reaching that INSERT requires the unit failure path,
  so the stall is itself evidence that MA failed.
- **X is released on the server clock.** The release is `pg_locks.waitstart + deadlock_timeout + 150 ms`.
  PostgreSQL arms a wait's deadlock and lock timers from the instant it stamps `waitstart`. The pause no
  longer absorbs the observation lag.
- **New observation:** the cycle itself. The settle waits on the promotion's transaction at MA, and that
  wait began more than `deadlock_timeout` after the promotion's wait. So the promotion's single check had
  run, and the settle's check is the one that finds the cycle.
- **Evidence capture:**
  - `timings.A1` is filled step by step, on the server clock where it can be;
  - `outcomes.A1` holds the settle's counters, the promotion's result, the A1 findings and MA–MD
    attendance. A read-only `afterEach` capture records it before teardown deletes anything, pass or fail;
  - a partial evidence file is written after every case. The runner's CLEAN verdict still comes only from
    its own census.
- **The budget guard is scoped to A1:** `2 × deadlock_timeout + 150 ms ≤ 3 s`.

**Why the production behaviour under test is preserved.** C2 is unchanged:
- the settle holds an earlier unit's match (MB) for its whole run;
- the promotion's hook holds MA and waits on MB under its 5 s bound;
- the settle then asks for MA, closes the cycle and loses; MA's unit rolls back while MB stays held;
- the promotion is refused retryably by `lock_timeout`, with nothing written, and the settle commits the
  rest.

X only chooses when the settle reaches MA. Y only keeps the settle open past 5 s. Neither takes, reorders
or changes the mode of any match lock. `promotionElapsed ≥ 4500` still shows the promotion's refusal was
its timeout, not a deadlock loss.

**Budget, from the promotion's `waitstart`.** The reviewer counted about 22–25 round trips from the
source code, for MA's record from the spine grant to the UPDATE:

| Round trip | Cycle closes | Settle loses | Stall observed | Margin to 5 s |
|---|---|---|---|---|
| 64 ms median | ≈ 2.75 s | ≈ 3.75 s | ≈ 4.05 s | ≈ 1 s |
| 97 ms sustained maximum | ≈ 3.5 s | ≈ 4.5 s | ≈ 4.9 s | marginal |

Window 1, for comparison, needed about 4 s just to close the cycle. A miss fails loudly at `cycle`,
`stalled` or `canonicalApplyFailures`. It is never a false pass, and never evidence of "no deadlock".

**Independent review: `afldb-reviewer`, read-only.** It ran no commands and edited nothing. No CRIT, HIGH
or MED.
- It **agrees with the §17.12 diagnosis.**
- It verified from the source code:
  - `canonical-apply.ts:808` is the settle's first lock on MA, and no earlier statement in MA's record can
    lock MA and turn the loss into a whole-run failure;
  - nothing in the settle before MA's record reaches X's row, and no promotion touches the spine or
    `data_issues`;
  - Y's key equals the settle's (`settle-afltables.ts:386-390`), and Y's uncommitted row interferes with
    no earlier statement and no assertion;
  - no assertion is weakened, and there is no false-pass path.
- The lock-wait semantics (a) to (c) are **reasoned from PostgreSQL internals, high confidence**, not read
  from source in this repository.

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| F-001 | LOW | The "stalled behind Y" wait fails fast if the promotion's promise resolves first. A pass can therefore turn on client latency when the settle's check lands at 4.7–5.0 s. | **Resolved on the server clock (operator instruction, 2026-10-05); see "F-001 resolution" below.** |
| F-002 | LOW | The drain (120 s) plus one 30 s capture equals the 150 s hook timeout. | **Applied:** each capture is bounded at 15 s. |
| F-003 | INFO | There are three cleanup statements, not two. | **Applied** (comment and this section). |
| F-004 | LOW | The A1-only budget guard in the file-level `beforeAll` would refuse A2 and A3 too. | **Applied:** moved into A1's own `beforeAll`. |
| F-005 | INFO | The X-release timing records the planned release, not the actual one. | **Applied:** renamed `promotionWaitToXReleasePlannedMs`. |
| F-006 | LOW | Evidence is written only in `afterAll`, so a killed run loses its outcomes. | **Applied:** a `partial: true` evidence file is written after every case. The probe's CLEAN verdict is census-based (`issue265-db-probe.mjs:627-634`), so a partial file cannot produce a false CLEAN. |
| F-007 | INFO | The `afldb_test` server log for about 15:24:20–15:24:45 on 2026-10-05 can settle window 1's ordering. `ERROR: deadlock detected`, naming the `UPDATE matches … WHERE id = <MA>` statement, means (i). Only `canceling statement due to lock timeout` means (ii). | **Optional, operator-run (§9).** The next window records the outcome directly. |

**Remaining uncertainties.**
1. The lock-wait semantics (a) to (c) are reasoned, not observed. The first passing run checks them
   empirically: `timings.A1.settleCycleWaitToStalledMs` should be about `deadlock_timeout` plus 4 round
   trips.
2. The budget is marginal at a sustained 97 ms round trip.
3. `data_issues` triggers and foreign keys were not reviewed. They could only change Y's lock footprint,
   not the choreography.

**Offline checks after the fixes (2026-10-05):**
- `npm run typecheck`: exit 0.
- `npx eslint --max-warnings 0 tests/integration/settle-promotion-deadlock.test.ts`: exit 0.
- Skip check (`tools\Invoke-Issue265SkipCheck.ps1`): PASS. Both runs reported `1 skipped`, `3 skipped`;
  the preload was active in 4 processes; 0 blocked connection attempts.

**F-001 resolution: the ordering proven on the server clock (2026-10-05, agent; database-free).** The
proposition is unchanged: *the settle reached its intended stall (waiting on Y at MA's finding INSERT)
before the promotion finished.*

- **Limitation, stated before the assertion changed.** The promotion's completion cannot be timestamped
  on the server without a production change:
  - its failure path, `UPDATE data_submissions SET status = 'failed', error = …` (`pipeline.ts:427-431`),
    writes no time column, and `now()` there is its transaction's **start**;
  - `pg_xact_commit_timestamp` needs `track_commit_timestamp`, a server setting that was not verified and
    must not be changed;
  - the import role's `pg_stat_activity.state_change` is visible to that role only, and only until
    `promoteSubmission` closes its connection. That is racy.

  So the end of the promotion's **wait** is used as a lower bound for its completion. Once the wait ends,
  the promotion still rolls back its savepoint, writes `failed` and commits.
- **Proof.** `orderingSnapshot()` reads two wait edges in **one** `pg_locks` snapshot:
  - `pg_lock_status()` copies the main lock table under every partition lock, and transactionid locks are
    never fast-path;
  - the CTE is `MATERIALIZED`, so it is evaluated once.

  The stall step passes only when one snapshot shows **both**:
  - the settle waiting on Y;
  - the promotion still waiting on the settle, in its **original** MB wait (`waitstart` equal to the value
    read when that wait was first observed).

  At that instant the promotion has not finished, and the settle's stall has already begun.
- **Fail-fast, also on the server.** A snapshot in which the promotion's original wait has ended or
  changed before the settle appears on Y fails the case at once, and its server timing is recorded first.
  The promotion's client promise no longer takes part in this step.
- **Evidence (`timings.A1`, server clock, relative to the promotion's `waitstart`):**
  - `promotionWaitToSettleStalledMs`, `promotionWaitToOrderingSnapshotMs` and
    `settleStallToOrderingSnapshotMs`;
  - a bracket for the end of the promotion's wait: `promotionWaitToWaitLastSeenMs` and
    `promotionWaitToWaitEndedSeenMs`. They should straddle 5000 ms, which empirically checks that
    `waitstart` is the `lock_timeout` origin;
  - the client times, recorded only: `stallObservedClientMs` and `promotionElapsedMs`.
- **Changed:** the client assertion `settleReachedY < promotion.finishedAt` is replaced by the snapshot
  proof. Nothing else changed:
  - the 5 s `LEGACY_LOCK_TIMEOUT`;
  - `promotionElapsed ≥ 4500` and `< 20000`, which still distinguish a timeout from a deadlock loss;
  - `settle.done === false` after the promotion resolves;
  - every other substantive assertion.

**F-001 verification: `afldb-reviewer` follow-up, read-only.**
- **Verdict:** the single-snapshot proof is valid and **strictly stronger** than the removed client
  assertion.
  - An ungranted entry exists only while the backend is in ProcSleep. It is removed before the
    `lock_timeout` ERROR is raised, and the promotion must still roll back, write `failed` and commit
    before it resolves.
  - So, in any one snapshot, "promotion edge present" means the promotion finishes after that instant, and
    "settle→Y edge present" means the stall began at or before it.
- `waitstart` equality is a sound identity for one wait: it is stamped once per ProcSleep, and a later wait
  gets a fresh microsecond timestamp.
- The fail-fast cannot fire spuriously, and both new waits are bounded: each resolves by about 6.3 s.
- No CRIT, HIGH or MED.
- The PostgreSQL internals are reasoned from source recollection, high confidence. The bracket above
  confirms them empirically on the first passing run.

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| FU-001 | LOW | The comment misstated why the promotion's MB edge names the settle. A released subtransaction's xid lock is dropped; XactLockTableWait climbs to the settle's held top-level xid. | **Applied** (comment corrected). |
| FU-002 | LOW | `waitstart ≤ clock_timestamp()` proves nothing extra and has a microsecond evaluation-order window. | **Applied:** recorded as `settleStallToOrderingSnapshotMs`, not asserted. The bracket's equivalent comparison is likewise recorded only (`settleStallToWaitLastSeenMs`), for the same reason. |
| FU-003 | INFO | The failure message conflated an absent settle edge with one present but not yet stamped. | **Applied:** `settleOnHolderPresent` column. |
| FU-004 | INFO | A redundant `sameWaitStart` assertion duplicated the probe's own condition. | **Applied:** removed. |
| FU-005 | INFO | The bracket is implied by the main proof; its value is evidence. | **Kept** as evidence, as noted above. |

**Offline checks after the F-001 resolution (2026-10-05):**
- `npm run typecheck`: exit 0.
- ESLint `--max-warnings 0` on the harness: exit 0.
- Skip check: PASS. Both runs reported 3/3 skipped; 0 connection attempts.

**Rerun.** Use the §17.9 commands unchanged: `SelfTest`, then `Preflight`, then `Full`. The expected result
is unchanged: 3/3 passed, census CLEAN with three explained `admin-upload` batches, `OVERALL: PASS (Full)`.
Window 1's evidence directory stays as it is; the runner writes each window to its own
`run-<stamp>-Full` directory.

### 17.14 Phase A window 2 (2026-10-05 16:22:35, `-Phase Full`): PASSED, census CLEAN

**Evidence (preserved unchanged):** `D:\tmp\issue265\run-20261005-162235-Full\`. It holds `00-derive.log`
… `06-post-census.log`, `preflight.json`, `baseline.json`, `harness-evidence.json`, `06-post-census.json`
and `summary.txt`. The window was operator-run. The agent read every file afterwards and contacted no
database. Window 1 (§17.12, `run-20261005-152357-Full\`) stays as historical evidence. This window does
not retroactively settle window 1's A1 ordering, which used the old choreography and remains unproven.

**Window facts.**
- Base tree, with Option 3 not applied. The harness was in its §17.13 state.
- Targets: `afldb_owner`, `afldb_import` and `afldb_auth`. Each was proven at `afldb_test` on
  127.0.0.1:55432, one server (db oid 45428, postmaster start 2026-10-01 17:49:57+10).
- Isolation: 0 other sessions at preflight, and 0 again at the re-check just before launch.
- Settings: PostgreSQL 16.15, `deadlock_timeout` 1000 ms, `lock_timeout` 0, `statement_timeout`
  120000 ms, `max_connections` 100.
  - **Correction (2026-10-05, §20.1):** the `statement_timeout` reading is the **probe's own** value, not
    `afldb_test`'s. `issue265-db-probe.mjs` `readOnly()` runs `set_config('statement_timeout', '120s',
    true)` before `modePreflight` reads `pg_settings` in the same transaction, as `afldb_owner`. The
    import role's effective value on `afldb_test` was therefore never read. The other four readings are
    unaffected, and the evidence files are unchanged.
- Tunnel round trip: median 62.2 ms, max 86.6 ms.
- Suite: `Test Files 1 passed (1)`, `Tests 3 passed (3)`, none skipped, 183.09 s. Runner verdict:
  `OVERALL: PASS (Full)`.

| Case | Result | What it shows on the base tree |
|---|---|---|
| A1, AFL Tables, C2 | **passed** (22.7 s) | The settle lost MA to a `match_results` promotion as the deadlock victim and committed the rest. The promotion was refused retryably by its 5 s bound. A recovery run healed MA. |
| A2, AFL API, C1 | **passed** (26.0 s) | The M2 unit lost. The promotion stayed blocked by the settle while M3 stalled it, which is the in-run-retry futility of §11. The promotion then succeeded, and a recovery run healed M2. |
| A3, AFL API, F-265-1 | **passed** (12.3 s) | The attendance enrichment lost to the promotion, and the **whole** AFL API run rolled back. |

**A1 ordering and timeout bracket.** All values are on the server clock, measured from the promotion's MB
`waitstart`, and come from `harness-evidence.json` `timings.A1`.

| Reading | Value | Meaning |
|---|---|---|
| Promotion MB wait first observed | +530 ms | The F-002 check passed: one `transactionid` wait, with the settle as the only blocker. |
| X release planned | +1150 ms | `deadlock_timeout` + 150 ms. The promotion's single deadlock check had run before the settle could ask for MA. |
| Settle's cycle wait began (on the promotion, at MA) | +2252 ms | More than `deadlock_timeout` after the promotion's wait. The settle's check is therefore the one that finds the cycle. |
| Settle stalled on Y (MA's finding INSERT) | +3419 ms | It is 1167 ms after the cycle wait began: `deadlock_timeout` plus the failure path. This confirms §17.13 uncertainty 1 empirically. |
| **Ordering snapshot** | +3455 ms | One `MATERIALIZED` `pg_locks` snapshot showed both edges: the settle waiting on Y, and the promotion **still in its original MB wait** (same `waitstart`). This was taken 35.6 ms after the stall began. |
| Bracket: promotion wait last seen | +4972.8 ms | The wait was still present. |
| Bracket: promotion wait first seen ended | +5074.6 ms | The wait was gone. The pair straddles 5000 ms, which confirms that `waitstart` is the 5 s `lock_timeout` origin. |
| Promotion elapsed (client) | 6156 ms | The assertion `≥ 4500` and `< 20000` holds, so this was a timeout, not a deadlock loss. |

The §17.13 budget predicted, at a 64 ms round trip, the cycle at about 2.75 s and the stall observed at
about 4.05 s. The observed values were 2.25 s and 3.45 s, which leaves about 1.5 s of margin to the 5 s bound.

**A1 outcomes** (captured before teardown):
- The settle (batch 1228) committed with `canonicalApplyFailures = 1` and `dataIssuesOpened = 1`.
- The finding `afltables|apply|match|issue265-a1-ma|matches` carries the error `deadlock detected`. It was
  resolved `canonical_apply_succeeded` at 2026-10-05 16:24:04.88+11, by the recovery run.
- MA to MD attendance is 32000 after recovery.
- The promotion returned `LEGACY_PROMOTION_LOCK_REFUSAL`.
- The recovery run's `canonicalRetryApplied ≥ 1` and the re-promotion were asserted in-test. The captured
  `canonicalRetryApplied: 0` belongs to the first run.

**Post-run census: CLEAN.**
- The historical fingerprints, 38 tables or projections, equal the baseline.
- Residue: 0 in season 2078 and in every ISSUE-265 namespace.
- Foreign-key census: 136 single-column keys checked, 0 non-zero.
- Harness teardown problems: 0, and harness residue `{}`.
- Every retained row is accounted for. `import_batches` max id went from 1226 to 1237.

**Retained records**, all explained:

| Batch | Tool | Target | Submission | Case |
|---|---|---|---|---|
| 1230 | `admin-upload` | `match_results` | 327 (deleted) | A1 re-promotion |
| 1233 | `admin-upload` | `player_match_stats` | 328 (deleted) | A2 |
| 1237 | `admin-upload` | `player_match_stats` | 329 (deleted) | A3 |

- The fixture auth user `issue-265-deadlock-fixture@afldb.test` is retained unchanged. It already existed
  (`preexisted: true`, created by window 1), and the `auth_users` fingerprint is equal.
- The `sports_data_lab` source is retained unchanged: `seededByThisRun: false`, 1 row, and the `sources`
  fingerprint is equal.
- The deleted rows were the settle batches 1227, 1228, 1229, 1231, 1232 and 1234, and the fixture batch
  1235. None remains.

**Migrations.** The preflight recorded 109 applied, with `110_match_sheet_player_match_stats_authority.sql`
pending (State A). The runner reports "migrations applied or restored by this run: none", and no harness
file runs a migration. **No migration was applied, and the ledger remains at 109.** One limit on that
statement: the post-run census does not re-read `schema_migrations`. "Remains 109" therefore rests on the
preflight reading plus the runner applying nothing, not on a second reading.

**Disposition.** Window 2 is **PASSED, census CLEAN**. A1–A3 are 3/3 base-tree evidence for C2, C1 and
F-265-1. Together with window 1's A2/A3 passes, every Phase A shape has now been demonstrated with real
settles. C4 (`match_attendance`) was never in Phase A. It stays code-traced only on the base tree, and
Phase B case B5 tests it under the gate.

### 17.15 Phase A is closed; Phase B replaces it

**Phase A must not run again once Option 3 lands.** Every A case asserts the defect's own lock edges, and
the gate removes each of them:
- A1 waits for "the promotion queues behind the settle on MB" (`transactionid`, blocker = the settle).
- A2 waits for the promotion's `(p, M1)` row write to queue behind the settle.
- A3 requires the enrichment to lose.

Under the gate, a promotion that arrives during a settle waits on the advisory lock **before** touching any
match. Each A case would therefore fail at its first choreography wait. That failure would be expected,
and it would not be evidence of anything. An A pass on a gated tree would mean the gate is missing.

**Preservation.**
- Both evidence directories stay unchanged: window 1 in §17.12 and window 2 in §17.14.
- The harness file is **untracked** today. The operator should commit it **as window 2 ran it**, together
  with this tracking, before the implementation edits it (§18 step S0). That commit is the durable link
  between the evidence and the exact code that produced it. The evidence files record no file hash.
- The runner and probe in `D:\tmp\issue265\` stay as they are for Phase A. Phase B gets its own mode
  (§18 step S8). **D-265-15 (accepted 2026-10-05):** the five tooling files are also preserved unchanged,
  with SHA-256 hashes, in `issues/open/AFLDB-ISSUE-265-phase-a/` (its `README.md`), so the S8 rewrite
  cannot lose the Phase A runner.

**Mechanism.**
- Phase B replaces the Phase A `describe` in the same file (D-265-7: one focused file). It reuses the
  fixtures, census, teardown, evidence writer and season 2078.
- Phase B is armed by `AFLDB_ISSUE265_PHASE=B` and the same expiring runner stamp. Arming `A` then runs no
  test. The runner expects a non-zero B count, so a stale A arming fails loudly.
- Phase B's `beforeAll` refuses on a tree without the gate. It runs a source-text check that both settle
  entry points call `acquireSettlePromotionGate` and that `withLegacyLockTimeout` takes the exclusive gate.
  Phase B therefore cannot run, and fail confusingly, on the base tree.

**How Phase B replaces each reproduction.** The first part of each choreography is kept, so the same
overlap is forced. The assertion at the point where the cycle used to form is inverted.

| Phase A (defect present) | Phase B (gate present) |
|---|---|
| A1: the promotion waits on the settle's `transactionid` at MB; the settle loses MA (`40P01`), one finding opens | B1/B2: the promotion waits on the **advisory** gate (blocker = the settle) and holds no match lock; the settle commits with 0 failures and no finding |
| A2: the M2 unit loses; the promotion stays blocked by the settle's earlier unit | B3: same forced overlap; M2 applies, 0 failures; the promotion waits at the gate, then is refused and later retried, or succeeds after the commit |
| A3: the enrichment loses and the whole AFL API run rolls back | B4: the AFL API run commits (batch present, enrichment applied); the promotion never takes the match while the settle runs |
| C4 (`match_attendance`): not in Phase A, code-traced | B5: the file M2, M1 is refused at the gate; the settle commits with 0 failures; the re-promotion locks ascending |
| (not reproducible on the base tree) | B6–B10: the gate's own properties (settle waits behind a promotion, timeout, concurrency, serialisation, restoration) |

## 18. Final implementation plan (prepared 2026-10-05; not started)

Approved design: §12 as amended by §15, and decisions D-265-1..12, plus D-265-5 (300 s / 330 s), D-265-14
and D-265-15 accepted on 2026-10-05 (§20.7). No input is open. This is a plan of more than five steps across two modules (acquisition and ingest). Under
`CLAUDE.md` §15, launching it engages `afldb-orchestrator`, with an `afldb-reviewer` plan review first,
unless the operator narrows the launch. §9 binds every agent: no shell, Git or database command runs
without per-task authorisation.

| Step | Who | Change |
|---|---|---|
| S0 | operator | Checkpoint commit: exactly the twelve files in §18.1 (five tracking and harness files, the six files in `issues/open/AFLDB-ISSUE-265-phase-a/`, and `eslint.config.mjs`). Commit the Phase A harness unchanged. Do **not** commit the zero-byte tool-hook strays or any external evidence (§18.1). |
| S1 | agent | `src/lib/acquisition/settle-core.ts`: add (a) `SETTLE_PROMOTION_GATE = { classId: 717275, objId: 4 } as const`; (b) `SETTLE_PROMOTION_GATE_WAIT_MS = 300_000` (D-265-5), and `SETTLE_PROMOTION_GATE_STATEMENT_BOUND_MS = WAIT_MS + 30_000` (330 s), both passed to `set_config` as millisecond strings; (c) `class SettlePromotionGateTimeout extends Error`; (d) `acquireSettlePromotionGate(tx)`. The helper runs four statements (§20.2): (1) `SELECT current_setting('lock_timeout'), current_setting('statement_timeout')`; (2) one `SELECT set_config('lock_timeout', WAIT, true), set_config('statement_timeout', BOUND, true)`; (3) `SELECT pg_advisory_xact_lock_shared(717275, 4)`; (4) one `SELECT set_config(...)` restoring both previous values. A `55P03` becomes `SettlePromotionGateTimeout`, with `cause` kept and a message saying the settle waited `<WAIT>` for a legacy CSV promotion, wrote nothing, and should be re-run once that promotion has finished. Any other error passes through, including a `57014`, which is then an external cancel or the backstop, never the gate wait. It follows `withLegacyLockTimeout`'s idiom, with the key-literal style of the existing namespace users (`admin-users.ts:44-45`). |
| S2 | agent | `settle-afltables.ts:1834` and `settle-afl-api.ts:1904`: `await acquireSettlePromotionGate(tx);` as the **first call** in the `sql.begin` callback, before `loadRefs`, any row lock and any write. The helper's own setting statements run first inside it (gate-ordering invariant, §12). Neither catch block changes: `:1955-1957` and `:2000-2025` already rethrow unknown errors, so a gate timeout fails the run with nothing written. The Brownlow settle is unchanged (§10.1). |
| S3 | agent | `src/lib/ingest/datasets.ts`: `withLegacyLockTimeout` (`:580-591`) takes `SELECT pg_advisory_xact_lock(717275, 4)` **inside its `try`, before `work()` and after the 5 s `lock_timeout` setting statements**. All three hooks therefore get the gate under the existing 5 s bound, and its `55P03` becomes `LEGACY_PROMOTION_LOCK_REFUSAL` (D-265-4). `matchAttendance` (`:1275-1316`) gains `preparePromotion`: refuse a row without a positive `resolved.match_id`, then `withLegacyLockTimeout` → `SELECT id FROM matches WHERE id = ANY(…) ORDER BY id FOR NO KEY UPDATE`. Update the F-002 comment at `:548-558`, which says a settle cycle "can still form", and the hook doc at `:108`. |
| S4 | agent | `admin-fixtures.ts:105-110`: the namespace comment gains key 4. Re-verify the anchor before editing it. |
| S5 | agent | Database-free tests, extending existing suites (§19.3). |
| S6 | agent | `tests/integration/match-results-promotion.test.ts`: change the expectations at `:1094` and `:1128` (D-265-6). Comment the F-002 settle emulations (`:1325-1361`, `:1370-1414`) as emulating an **ungated** writer (D-265-11). |
| S7 | agent | `tests/integration/settle-promotion-deadlock.test.ts`: Phase B replaces Phase A (§17.15, §19). |
| S8 | agent (outside the repository) | `D:\tmp\issue265\` (the Phase A copies stay archived unchanged, D-265-15): a runner mode for Phase B (arms `B`, with the B test count and retained-batch count, and a per-phase timeout that covers the timeout case at the D-265-5 value plus margin). The A arming is removed, and the probe's census reconciliation accepts B's retained batches. |
| S9 | agent | Documentation: `CHANGELOG.md` `Unreleased` (legacy promotions are refused while a settle runs and serialise with each other; a settle waits up to `<WAIT>` behind a promotion, then fails before any write). Also the admin-upload and settle operations pages under `docs/`, found by Grep at the time, not bulk-read. Re-check the comment at `canonical-apply.ts:477`. |
| S10 | agent | Tracking: this runbook, `issues.md` and `IssuesIndex.md`. |

### 18.1 S0 checkpoint commit: exact file list (prepared 2026-10-05; operator-run)

Commit these twelve files, and only these (updated 2026-10-05 for D-265-15 and the lint exception):

| File | State | Why |
|---|---|---|
| `tests/integration/settle-promotion-deadlock.test.ts` | untracked | The Phase A harness, unchanged since the checkpoint was prepared (see the provenance note below). |
| `issues/open/AFLDB-ISSUE-265.md` | modified | This runbook, including the window evidence summary, this plan and the accepted decisions. |
| `issues/open/AFLDB-ISSUE-265-prod-settle-timing.sql` | untracked | The D-265-13 query (§16.2). |
| `issues.md` | modified | The ISSUE-265 ledger entry. |
| `IssuesIndex.md` | modified | The open-issue index entry. |
| `issues/open/AFLDB-ISSUE-265-phase-a/README.md` | untracked | Original paths, hashes, dependencies, invocation, the passing evidence folder, and the provenance caveat. |
| `issues/open/AFLDB-ISSUE-265-phase-a/Invoke-Issue265PhaseA.ps1` | untracked | The Phase A runner, byte-for-byte (D-265-15). |
| `issues/open/AFLDB-ISSUE-265-phase-a/issue265-db-probe.mjs` | untracked | The read-only probe, byte-for-byte. |
| `issues/open/AFLDB-ISSUE-265-phase-a/tools/import-graph.mjs` | untracked | The static import scan, byte-for-byte. |
| `issues/open/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs` | untracked | The TCP-refusing preload, byte-for-byte. |
| `issues/open/AFLDB-ISSUE-265-phase-a/tools/Invoke-Issue265SkipCheck.ps1` | untracked | The database-free skip check, byte-for-byte. |
| `eslint.config.mjs` | modified | One narrow `globalIgnores` entry for the archived `block-network.cjs` (lint exception, below). |

**Lint exception (authorised and applied 2026-10-05).** `npm run lint` is `eslint .`. ESLint reported two
`@typescript-eslint/no-require-imports` errors in the archived `tools/block-network.cjs`, a byte-preserved
historical CommonJS preload.
- `eslint.config.mjs` `globalIgnores` gained exactly one entry,
  `issues/open/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs`, with a comment. The rest of the archive
  folder is still linted, and the archived file is unedited.
- **Verification command:** `node node_modules\eslint\bin\eslint.js --max-warnings 0
  issues/open/AFLDB-ISSUE-265-phase-a tests/integration/settle-promotion-deadlock.test.ts`: exit 0, no
  warnings. It lints `issue265-db-probe.mjs`, `tools/import-graph.mjs` and the harness. Pass the **folder**:
  naming the ignored file explicitly makes ESLint emit "File ignored because of a matching ignore pattern",
  which fails `--max-warnings 0`.
- **On closure:** the runbook and this folder move to `issues/closed/`. The ignore path must then move with
  them, or the lint error returns.

**The rest of the harness's inputs are already tracked and unmodified** at HEAD `4b59cb3e`, according to the
session-start status, which listed no other modified file:
- its imports: `src/db/authClient.ts`; `src/lib/acquisition/` `afl-api-bundle.ts`, `manual-authority.ts`,
  `observation-store.ts`, `observations.ts`, `settle-afl-api.ts`, `settle-afltables.ts`, `settle-core.ts`
  and `source-families.ts`; `src/lib/import-batch-id.ts`; `src/lib/ingest/datasets.ts` and `pipeline.ts`;
- its data file `data/reference/source-families.json`;
- the test config `vitest.config.mts` and `tests/setup.ts`;
- `package.json` and `package-lock.json`.

Nothing else needs committing. The operator should re-check `git status --porcelain` before committing.
The archived files use LF endings. If the operator's Git converts line endings on commit, the committed
blob must still equal the SHA-256 values in the archive `README.md`; check that before relying on them.

**Provenance of the harness: window 2 captured no hash of it.** The runner did not hash the harness, and the
evidence files hold none. Neither a hash taken now nor a filesystem timestamp independently proves the bytes
that window 2 tested.
- At checkpoint preparation (2026-10-05) the file's SHA-256 was
  `5842a29c5ca32108ccc3fd51a078382ed2939c893af8248c1f5a1526efa2e7c8` (120805 bytes), and its last write was
  16:18:17, before the window 2 launch at 16:22:35. These are corroboration only.
- The hash does one job: it detects any change **after** this checkpoint. Before committing, re-hash the file.
  If it differs, stop and report it.
- The window 2 record itself (§17.13–§17.14: the case names, the 3-test count and the harness state it
  describes) is the remaining corroboration. The same limit applies to the archived tooling, whose hashes
  are in its `README.md`.

**Excluded:**
- The ten zero-byte tool-hook strays in the worktree root: `${now`, `0`, `1)`, `` `canonical_round_number``,
  `deriveOne('owner'`, `n`, `new`, `players(id)`, `r.name).join('` and `refused(target.targetTable`.
- Everything under `D:\tmp\issue265\`, which is outside the repository: the run evidence. The runner,
  probe and tools are archived unchanged (D-265-15, above). No connection setting, credential or database
  evidence is committed.

### 18.2 Scope limits and validation sequence

**Not changed:** `LEGACY_LOCK_TIMEOUT` (5 s), canonical-apply's unit and savepoint logic, ledger rows,
findings, the recovery paths, and the Brownlow and fixtures settles. No migration and no privilege change:
advisory lock functions are executable by every role by default, and the import role already uses
namespace 717275 (key 1, `import_awards.py:382`).

**Validation sequence** (each step needs operator authorisation; the commands are given at the time):

1. **Database-free:** the extended `tests/ingest-datasets.test.ts` and `tests/match-sheet.test.ts`;
   `npm run typecheck`; ESLint `--max-warnings 0` on the changed files.
2. **Phase B preparation:** the runner `SelfTest` and the skip check. A disarmed run must skip every B case
   with 0 connection attempts.
3. **Guarded `afldb_test` window, Phase B:** `Preflight`, then the Phase B `Full`. Expected: every B case
   passed, none skipped; census CLEAN; the retained `admin-upload` batches equal the B count; migration 110
   recorded and left unchanged, as in Phase A.
4. **Guarded `afldb_test` regression window** (ISSUE-264 runner pattern): `match-results-promotion` (with
   the F-002 block updated), `settle-afltables` in full, `datasets` and `submission-promotion`.
   `settle-afl-api.test.ts` stays refused (D-264-10). AFL API coverage comes from Phase B only.
5. **Closure:** an independent check of the applied diff against this plan, then the operator commit and
   `npm run merge:ready -- --issue 265`. No build is needed, because no framework or route changes.
6. **DEV** (application-only, `deploy/sync-dev.ps1 -SkipMigrate`). Accept when one promotion attempted
   during an operator-run settle shows the retryable refusal, and no new `canonical_apply_failed` finding
   carries a `40P01` message.

## 19. Phase B assertions (acceptance tests for Option 3)

### 19.1 Observation primitives (read through `pg_locks` and `pg_stat_activity`, server clock)

- **Gate edge.** `locktype = 'advisory'`, `classid = 717275`, `objid = 4`, `objsubid = 2` (the two-int4 key
  form). The settle holds `ShareLock` and the promotion `ExclusiveLock`. A waiter's blocker comes from
  `pg_blocking_pids`.
- **"Before any write" (settle).** While the settle waits at the gate, `pg_stat_activity.backend_xid IS NULL`
  for its pid, so no row has been written. Its granted locks are only its own `virtualxid`, with no
  relation lock: `loadRefs` has not run.
- **"Before any match lock" (promotion).** While the promotion waits at the gate, it holds no `RowShareLock`
  or `RowExclusiveLock` on `matches`, the modes `FOR … UPDATE`/`FOR SHARE` and `UPDATE` take. It may hold
  `AccessShareLock` from reads and its own `data_submissions` row.
- **"Never on a match"**, for every B1–B5 case. `pg_blocking_pids(settle)` never contains the promotion's pid
  in any sample. The promotion's ungranted lock is never a `transactionid` or `tuple` lock.

### 19.2 Cases

| Case | Covers | Choreography | Assertions |
|---|---|---|---|
| **B1** | AFL Tables · `match_results` · promotion refused while a settle holds the gate | A1 fixture. X on MA's spine record holds the settle open after it has written MB and MC. Start the promotion over MA and MB. Hold X past 5 s. | The promotion waits on the gate (`ExclusiveLock`, blocker = the settle) and holds no `matches` row-lock mode. It is refused with `LEGACY_PROMOTION_LOCK_REFUSAL`, elapsed ≥ 4500 ms. The submission is `failed`, with 0 promotion batches and MA/MB unchanged by it. After X releases, the settle commits with `canonicalApplyFailures = 0` and no new finding, and MA–MD are applied. **Retry:** the re-promotion then succeeds (1 batch). |
| **B2** | AFL Tables · `match_results` · promotion succeeds after the settle commits | As B1, but every stall is released only once the promotion is observed on the gate. | The promotion's gate wait ends without refusal, and it succeeds (1 batch) after the settle's commit. It never waited on a match. **Inconclusive guard:** if the promotion's gate wait passes 4000 ms on the server clock, the case fails as INCONCLUSIVE, never as a pass (review F-003). |
| **B3** | AFL API · `player_match_stats` | A2 fixture (M1, M2, M3). X on M2 `FOR SHARE`; M3 stall. | The promotion waits on the gate, not on `(p, M1)`. M2 applies, with 0 failures and no finding. The promotion is refused while M3 stalls the settle (≥ 4500 ms, nothing written). **Retry** after the commit succeeds. |
| **B4** | AFL API · F-265-1 | A3 fixture (an `afl_api`-owned match with AFL Tables attendance staging). | `runSettleAflApi` resolves `applied = true` with its batch present and the attendance enrichment applied. The promotion waited on the gate, then succeeded or was refused and later retried successfully. No `40P01`. |
| **B5** | `match_attendance` · C4 | The settle writes M1 and later M2 (with an M2 stall). The attendance file is ordered M2, M1. | The promotion is refused at the gate with nothing written. The settle commits with 0 failures. **Retry** succeeds. Ascending order is pinned database-free (§19.3), and in the database by holding the re-promotion's hook and reading the matches it holds: both, taken by one statement. |
| **B6** | Settle waits behind a promotion | A real `player_match_stats` promotion passes its hook (gate held) and then waits after the hook on a target row a side transaction holds `FOR UPDATE`: the "stuck promotion" shape. Start a real AFL Tables settle. | The settle's only wait is the gate (`ShareLock`, blocker = the promotion), with `backend_xid IS NULL` and no relation locks. Release the side transaction: the promotion commits (1 batch), and the settle then completes with 0 failures. Record the settle's gate wait on the server clock (context only, §20). |
| **B7** | Timeout, rollback and connection reuse, both providers; lock timeout beats a shorter session `statement_timeout` | As B6, but the side transaction is held **past `SETTLE_PROMOTION_GATE_WAIT`**. The AFL Tables and AFL API settles start concurrently, each on its own `max: 1` client. **The AFL API client opens with a session `statement_timeout` of 60 s** (`connection: { statement_timeout: 60000 }`), below WAIT. The AFL Tables client uses the server default. (Added 2026-10-05, §20.2.) | Both reject with `SettlePromotionGateTimeout` (`cause.code = '55P03'`), elapsed ≥ WAIT on the server clock. Neither is a `57014`, and the 60 s client was not cancelled at 60 s. Nothing persists: no `import_batches` row, no finding, no staging or canonical change (census of the 2078 rows). **Reuse:** on each client, the same `pg_backend_pid()` as before shows no advisory lock held, `current_setting('lock_timeout')` equal to the server default, and `current_setting('statement_timeout')` equal to that client's session value: `1min` on the AFL API client, the server default on the other. **Retry:** release the side transaction; the promotion commits; both settles re-run **on the same clients** and complete. |
| **B8** | Concurrent settles; rollback releases the gate | Overlapping real AFL Tables and AFL API settles, one held open by a stall. Then a dry-run settle followed by a promotion. | One snapshot shows two **granted** `ShareLock` gate entries at once. Neither settle waits on the other at the gate, and both commit. After the dry-run settle returns, a promotion takes the gate with no wait: the rollback released it. |
| **B9** | Promotions serialise | Promotion P1 is stuck after its hook (as B6). Start promotion P2. Then repeat with P1 allowed to commit. | P2 waits on the gate (blocker = P1) and is refused at ≥ 4500 ms with nothing written. **Retry** after P1 commits succeeds. In the second run, P2 succeeds once P1 commits within the bound (inconclusive guard as B2). This replaces `match-results-promotion.test.ts:1128`. |
| **B10** | Timeout restoration within the transaction | Helper-level, in a real transaction: `set_config('lock_timeout', '7s', true)` and `set_config('statement_timeout', '45s', true)`, then `acquireSettlePromotionGate(tx)`. | `current_setting('lock_timeout')` is `7s` and `current_setting('statement_timeout')` is `45s` afterwards, so both previous values are restored rather than reset to `0` or left at the gate's values. The gate is held to commit (visible in `pg_locks`) and gone after it. |
| **B11** *(accepted, D-265-14)* | Queue ordering at the gate (§20.3) | **(a)** Settle S1 (AFL Tables) is held open by a stall. Promotion P waits at the gate. Then settle S2 (AFL API) starts. **(b)** Promotion P1 is stuck after its hook (as B6). Settle S waits at the gate. Then promotion P2 starts. Release P1, and hold S open with a stall. | **(a)** S2 waits at the gate (`ShareLock`), and `pg_blocking_pids(S2)` is `{P}`, not S1: a soft block. When P is refused (≥ 4500 ms), S2 is granted while S1 still holds, so two granted `ShareLock` entries show in one snapshot. Both settles commit. **(b)** `pg_blocking_pids(P2)` contains S, the waiting settle. After P1 commits, S is granted first. P2 is refused at ≥ 4500 ms with nothing written, while S runs. **Retry** of P2 after S commits succeeds. |

Every successful promotion retains exactly one `admin-upload` batch. The expected count, about nine, is
fixed when the harness is written and set in the runner (S8). B7's duration is the D-265-5 value plus
margin, so the case and runner timeouts derive from the constant, not from a literal.

### 19.3 Database-free pins (extend existing suites; no new file)

- `tests/ingest-datasets.test.ts`:
  - In all three hooks, the statement order is `current_setting` → `set_config(5s)` →
    `pg_advisory_xact_lock(717275, 4)` → the matches lock → `set_config(previous)`.
  - A `55P03` at the gate maps to the refusal. A non-lock error passes through.
  - The fake-sql tags at `:481` and `:619` answer the gate statement.
  - The registration pin at `:497` (`['match_results', 'player_match_stats']`) gains `match_attendance`.
  - The `match_attendance` hook issues one ascending `FOR NO KEY UPDATE` and refuses a bad `match_id`.
- `tests/match-sheet.test.ts` (it already pins `settle-core` constants):
  - the key literals, the WAIT value, and `STATEMENT_BOUND_MS > WAIT_MS`;
  - the helper's statement order: one read of both settings → one `set_config` of both → the shared gate →
    one restore of both, to the values read;
  - `55P03` → `SettlePromotionGateTimeout`, with any other error passing through, a `57014` included;
  - a source-text pin that `acquireSettlePromotionGate(tx)` is the first call in the `sql.begin`
    callback (ahead of `loadRefs` and every data statement) in both `runSettleAfltables` and `runSettleAflApi`, and absent from the Brownlow settle.

## 20. D-265-5: the settle gate wait (decided 2026-10-05: 300 s / 330 s, §20.7)

**What the value bounds.** It bounds only how long a settle, at the gate (before any data statement), waits for an in-flight
legacy promotion to release the exclusive gate. A promotion holds the gate from its hook to its commit.

**Trade-off.**
- **Cost of waiting longer: small, but not zero.** *(Corrected 2026-10-05; the earlier text said a waiting
  settle "blocks nothing".)*
  - A settle waiting at the gate holds no granted lock, no row lock and no xid (B6 asserts this).
  - Its **queued** request does delay promotions that arrive after it. They queue behind it, and once the
    in-flight promotion commits, the settle is granted first. Those later promotions are then refused
    while the settle runs (§20.3). That is the same outcome as a promotion that arrives during a settle,
    so it is no new class of cost.
  - The other costs: part of the unit's `TimeoutStartSec=3600` budget (§20.4), and a later failure signal
    at 04:30/05:00, when nobody is watching.
- **Cost of timing out: the whole run.** The settle fails before any write, so nothing is corrupted, but
  that night's settle is lost.
  - AFL Tables can be re-run from the on-demand admin trigger. It starts the systemd unit asynchronously
    (`settle-trigger.ts`), so no HTTP request waits on the gate.
  - AFL API has **no** on-demand trigger (`startSettleRun` starts only the AFL Tables unit). It waits for
    an operator CLI run or the next 05:00 timer.
- **What could hold the gate long.** A promotion of a normal file is expected to take seconds; this is
  design knowledge and has never been measured. A promotion held for minutes is pathological: it is stuck
  after its hook behind another transaction's row lock, because the pipeline has no bound after the hook.
  A longer wait helps exactly when that blocker clears on its own.
- ~~Unverified context: `afldb_test` reports `statement_timeout = 120000 ms` …~~ **Withdrawn 2026-10-05.**
  That reading was the probe's own transaction-local setting (§17.14 correction, §20.1). There is no
  evidence of any `statement_timeout` on the import role. In repository configuration, a stuck promotion
  statement is never cancelled.

**What evidence can and cannot say.**
- The D-265-13 PROD query measures settles, the other side of the gate. It **cannot validate any value**,
  because PROD does not record promotion durations (`completed_at = now()`, §16.4).
- Phase B B6 will record a settle's wait behind a small fixture promotion on `afldb_test`. That is a
  lower-bound illustration on a test host, not PROD evidence.
- The choice is an operator judgement on the asymmetry above.

### 20.1 Effective timeout policy (traced 2026-10-05; repository only, no database contacted)

**Repository configuration.** Nothing in the repository sets `statement_timeout` or `lock_timeout` for
either settle or for the promotion.
- **AFL Tables settle.** `tools/current-season/settle-afltables.ts:183-186` opens
  `postgres(dsn, { max: 1, onnotice, transform })`. There is no `connection` block, so no startup
  parameter is sent. Its one transaction is `sql.begin` at `settle-afltables.ts:1834`, and nothing runs
  in it before the planned gate.
- **AFL API settle.** `tools/current-season/settle-afl-api.ts:159-162` has the same shape. Its
  transaction is at `settle-afl-api.ts:1904`. The ingestion-switch read (`afl-api-ingestion-control.ts:62`)
  is a separate app-role connection, outside that transaction.
- **Promotion.** `pipeline.ts:308` has the same shape. Its only bound is the 5 s transaction-local
  `lock_timeout` in `withLegacyLockTimeout` (`datasets.ts:580-591`). It is restored after the hook, so
  every statement after the hook is unbounded.
- **Only the app and auth pools set `statement_timeout`.** They are `src/db/client.ts:37`
  (`AFLDB_STATEMENT_TIMEOUT_MS`, default 5 s) and `authClient.ts:46` (5 s). Neither carries a settle or a
  promotion.
- **Server and unit level.** Neither settle unit sets `PGOPTIONS`
  (`deploy/afldb-settle-afltables.service`, `deploy/afldb-settle-afl-api.service`). Grep over the
  repository's `*.sql`, `*.sh`, `*.conf`, `*.ps1`, `*.py` and `*.mjs` finds no `ALTER ROLE` or
  `ALTER DATABASE … SET`, and no `postgresql.conf` edit, for either setting.
- **Verdict.** In repository configuration, all three run with the server's defaults. A 300 s gate wait
  would last 300 s **unless the installed host adds a `statement_timeout` at or below it.**

**Installed host: unknown, and not read.** The host could add a `statement_timeout` through any of these:
`postgresql.conf` or `ALTER SYSTEM`; `ALTER DATABASE` or `ALTER ROLE … SET`; or a startup option in the
DSN. None of them is visible from the repository.

**The 120000 ms reading proves nothing about any host.** `issue265-db-probe.mjs` `readOnly()` sets
`statement_timeout` to `120s` transaction-locally before the preflight reads `pg_settings` in that same
transaction, as `afldb_owner` (§17.14 correction). The import role's value was never read, on
`afldb_test` or anywhere else.

**Consequence:** the gate must not depend on the host value. §20.2 makes it independent of it.

### 20.2 Lock timeout versus statement cancellation: the smallest scoped change

**The problem.**
- `statement_timeout` counts the **whole** statement, including time spent waiting for a lock.
- When it is non-zero and at or below `lock_timeout`, it fires first. PostgreSQL's `lock_timeout`
  documentation says exactly this.
- The gate would then fail with `57014` ("canceling statement due to statement timeout"), not `55P03`.
  - The planned helper would pass that through as a generic error.
  - B7's `cause.code` assertion would fail.
  - The effective wait would be the host's value, not D-265-5.
- `57014` is also what `pg_cancel_backend` raises. So `57014` must **not** be mapped to the gate message.

**The change (S1, revised).** For the gate statement only, the helper sets two transaction-local values:
- `lock_timeout = WAIT`;
- `statement_timeout = WAIT + 30 s`.

It then takes the gate and restores **both** settings to the values it read. That is four statements:
one read of both settings, one `set_config` of both, the gate, and one restore of both.
- **Why each statement gets its own timer (inference).** A setting changed by `set_config` applies from
  the next statement. Each postgres.js query is its own protocol cycle, so the gate statement starts
  its own timer under the raised value. Nothing here measured this; B7's 60 s client proves it in the
  database.
- **Why `WAIT + 30 s` and not `0`.** It keeps a server-side bound on the one statement. A tie would
  report the lock timeout anyway, but a strictly greater value does not rely on that tie-break.
- **Later statements keep their existing limits.** On success, both settings are restored before
  `loadRefs`, so every unit runs under exactly the limits it has today: the server defaults, in
  repository configuration. On failure, the transaction aborts and its rollback reverts both settings,
  so the restore is neither reached nor needed. B7's reuse check and B10 prove this.
- **The server enforces the bound.** `lock_timeout` fires inside the backend. If the Node process dies
  while its backend waits (for example, systemd's kill), the backend still leaves the queue at WAIT.
  With an unbounded wait, an orphaned queued request would stay until it was granted.
- **The promotion side is unchanged.** Its 5 s is a `lock_timeout`. (INFO, pre-existing, no work
  created: a host `statement_timeout` below 5 s would surface there as an unmapped `57014`.)

### 20.3 Advisory-lock queue behaviour (corrects "blocks nothing")

- **The rule.** PostgreSQL's lock manager queues a new request behind an **earlier waiting** request it
  conflicts with, even when the new request conflicts with no granted lock. `pg_blocking_pids` reports
  this as a *soft* block, and the PostgreSQL documentation describes it that way. `ShareLock` and
  `ExclusiveLock` conflict in both directions.
- **Shape 1: shared request behind a waiting exclusive one.** Settle S1 holds the gate. Promotion P waits
  for it. Then settle S2 arrives, and S2 waits behind P.
  - If P is refused, S2 is granted at once, alongside S1. That wait is at most P's remaining 5 s.
  - If S1 commits within P's 5 s, P gets the gate. S2 then waits for P's **whole promotion**, bounded only
    by S2's own WAIT.
- **Shape 2: a waiting settle blocks a later promotion.** Promotion P1 holds the gate. Settle S waits for
  it. Then promotion P2 arrives, and P2 queues behind S. When P1 commits, S is granted first. P2 is
  refused after 5 s while S runs.
- **No deadlock.**
  - The waiting settle is at the gate, which precedes every data statement, so it holds no granted lock and no xid.
  - No settle ever waits on `data_submissions` (§12).
  - Soft edges therefore cannot close a cycle here. The deadlock detector can reorder a queue if one ever
    did.
- **Wording corrected:** §12 items 2 and 4, §12 "Why it is reliable", and the trade-off above. Accepted
  test: B11 (D-265-14), which covers both shapes above.

### 20.4 Time budget inside the systemd unit

- **What the limit covers.** Both units have `TimeoutStartSec=3600`, which covers the whole `ExecStart`
  chain: acquisition; for AFL Tables, the offline adjudication; settle planning; **the gate wait**; the
  settle transaction; the post-commit checks. The gate comes after acquisition, so acquisition time is
  spent first.
- **The budget.** Pre-gate work + gate wait (≤ WAIT) + settle processing ≤ 3600 s. At 300 s, 3300 s remain
  for everything else. The gate adds at most WAIT and removes no time from processing.
- **What the repository records.**
  - AFL Tables: the routine no-change run takes about 51 s, and a new-round run takes minutes.
  - A fresh or backfill run measured 1 h 57 min over a workstation tunnel. It is already supervised
    outside this unit (`afldb-settle-afltables.sh:120-121`).
  - AFL API: the repository records no duration. The D-265-13 query (§16) supplies settle-transaction
    durations as context.
- **When the named error wins.** With 300 s, the named gate error arrives before systemd's generic kill,
  unless the pre-gate stages alone take more than 3300 s.
- **The Brownlow unit** (`TimeoutStartSec=180`) does not take the gate and is unaffected.

### 20.5 Installed-host proof (optional, operator-run; not required for implementation)

After §20.2, D-265-5 no longer depends on the host's `statement_timeout`. A record of the host's value is
still useful context. If the operator wants one, run it **read-only**, on the host where the units run,
as the service account, with the environment the monitoring block assumes:

```sh
psql "$AFLDB_IMPORT_DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c "SELECT name, setting, unit, source FROM pg_settings WHERE name IN ('statement_timeout','lock_timeout','idle_in_transaction_session_timeout','deadlock_timeout') ORDER BY name"
```

- `source` separates `default` and `configuration file` from `database`, `user` and `database user`.
- psql honours `PGOPTIONS`, and postgres.js does not necessarily do the same. A `source` of `client`
  therefore means the reading may not match the settle's session.
- The agent has not run this and will not.

### 20.6 Recommendation (accepted as written; see §20.7)

**D-265-5 (final; accepted 2026-10-05, §20.7): a 300 s gate wait, with a 330 s statement bound for the gate statement only.**
- A false timeout costs a night's run. A long wait holds no granted lock, no row lock and no xid. It only
  delays later promotions, which a running settle would refuse anyway (§20.3).
- 300 s is 8% of `TimeoutStartSec=3600`. The run still fails with a named error long before systemd's
  generic kill, and that named error was the reason for bounding the wait (review F-007).
- It is more than an order of magnitude above any plausible healthy promotion. *(The earlier "it outlasts
  one 120 s statement cancellation" was withdrawn; §20.1.)*
- With §20.2, the wait is the effective wait whatever `statement_timeout` the host sets.
- Cost: B7 takes about 5 minutes of wall-clock time.
- **60 s remains acceptable**, with a 90 s bound. B7 then takes about 1 minute. Either way the values
  live in two constants (S1), pinned database-free (§19.3).

**D-265-14 (new): add B11 (queue ordering, §19.2) to Phase B.** Recommended: yes. It turns §20.3 from
documented engine behaviour into a tested property of this gate. It costs two 5 s refusals plus setup.

**D-265-15 (new): archive the Phase A runner before S8 edits it.**
- **Why it matters.** The harness cannot be armed without `D:\tmp\issue265\Invoke-Issue265PhaseA.ps1`,
  which supplies `AFLDB_ISSUE265_ARMED_AT` and `EXPECT_*`. S8 rewrites that runner for Phase B. The S0
  commit keeps the harness code but not its runner. This is the same loss S0 prevents for the harness.
- **Recommended: copy the five files unchanged** into `issues/open/AFLDB-ISSUE-265-phase-a/`, which
  moves with this runbook on closure, and commit them at S0:
  - `Invoke-Issue265PhaseA.ps1`;
  - `issue265-db-probe.mjs`;
  - `tools/import-graph.mjs`;
  - `tools/block-network.cjs`;
  - `tools/Invoke-Issue265SkipCheck.ps1`.

  First read each file in full to confirm that it contains no DSN or secret. Run evidence stays outside
  the repository.
- **Alternatives:** record only their SHA-256 hashes here, or accept the loss.

### 20.7 Decisions accepted (operator, 2026-10-05)

- **D-265-5: accepted.** The settle gate takes a 300 s `lock_timeout` and, transaction-locally and for gate
  acquisition only, a 330 s `statement_timeout`. Both previous settings are restored afterwards (§20.2).
  The values are an operator judgement; no PROD record validates them (§16.4).
  - ~~Alternatives: 60 s / 90 s, or another value.~~ Not chosen.
- **D-265-14: accepted.** Phase B includes **B11**, covering both advisory-lock queue shapes of §20.3:
  case (a) is Shape 1 (a shared request behind a waiting exclusive one), and case (b) is Shape 2 (a waiting
  settle ahead of a later promotion).
- **D-265-15: accepted.** The five Phase A tooling files are preserved in
  `issues/open/AFLDB-ISSUE-265-phase-a/` before S8 changes the active runner.
  - They were read in full first. None contains a DSN, password, token or other credential. The only
    secret-shaped strings are synthetic (a fake password for a `.invalid` host in the probe self-test, and a
    credential-free fake DSN at `127.0.0.1:9` in the skip check).
  - Copies are byte-for-byte; each was verified against its original by SHA-256 and a byte comparison.
  - The folder has a `README.md` (original paths, hashes, dependencies, invocation, the passing evidence
    folder). Run evidence, connection settings and database evidence stay outside Git.
  - The originals in `D:\tmp\issue265\` and the evidence folders are untouched.
- **Window 2 captured no harness hash** (§18.1). Current hashes and timestamps do not independently prove
  the bytes window 2 tested.
- **Offline checks (2026-10-05, database-free).** The PowerShell parser: 0 errors in both `.ps1` files.
  `node --check`: exit 0 for the three `.mjs`/`.cjs` files. The archived runner's `-Phase SelfTest`: probe
  selftest 20/20, and the skip check passed (3 skipped in each of two runs, 0 blocked connection attempts).
  The static import scan of the harness alone: 43 repository modules, 0 unresolved, 5 flags. One is
  `tests/integration/guard.ts:38`, the known module-scope connection, reached only through the gated dynamic
  `import('./guard')`. The other four are function or arrow-function bodies (`authClient.ts:32`, harness
  `:567`, `:568`, `:593`). An earlier scan that also followed `tests/setup.ts` found 44 modules. ESLint `--max-warnings 0` on the three JS files first **failed**, with two
  `no-require-imports` errors in `block-network.cjs`. The operator then authorised a one-file ignore
  (lint exception, §18.1). After it, the folder-form command passes with exit 0 and no "file ignored"
  warning, linting the probe, `import-graph.mjs` and the harness. The harness and the five
  originals were re-hashed afterwards and are unchanged.
- **Not implemented.** No production code, test or runner changed in this step.
