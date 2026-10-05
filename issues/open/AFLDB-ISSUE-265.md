# AFLDB-ISSUE-265 — A settle unit can lose a match-lock deadlock to a legacy CSV promotion, with no in-run retry

## 0. Status

- **Status:** Open. **Mitigation IMPLEMENTED in the working tree (2026-10-05, uncommitted), database
  validation PENDING** (§21). The settle gate, the exclusive gate in the three legacy hooks, the
  `match_attendance` hook, the database-free pins and the Phase B acceptance harness (B1–B11) are written. Only
  database-free checks have run. **No Phase B window and no regression window has run**; nothing is
  committed or deployed. The issue stays open until Phase B, the regression window and DEV acceptance pass.
  - **Later state (2026-10-06, §25):** Phase B passed 11/11 (§23); the regression window **PASSED** after two earlier failed
    verdicts (§24, kept): 32/32, 16/16, 7/7 and 76/76, all censuses clean, migration 110 restored and verified. The build
    (a `-Phase Build` command is prepared, not run), the commit, `merge:ready` and DEV acceptance are pending.
  - **Phase A window 2 (2026-10-05 16:22:35) PASSED, census CLEAN** (§17.14). A1, A2 and A3 passed 3/3,
    none skipped. All three base-tree shapes (C2, C1, F-265-1) are now demonstrated with real settles.
  - Phase A window 1 (15:23:57) FAILED, census CLEAN (§17.12). It is kept as historical evidence.
  - **Phase A is closed and retired** (§17.15). It must not run again once the gate changes the behaviour
    it expects. Phase B replaces it.
  - The final implementation plan is in §18, the Phase B assertions in §19, and the D-265-5 timeout analysis
    in §20. **D-265-5 (300 s wait, 330 s gate-statement bound), D-265-14 (Phase B case B11) and D-265-15
    (archive the Phase A tooling) were accepted on 2026-10-05 (§20.7).** The S0 checkpoint is commit
    62f2cd67 (§18.1). The implementation record, checks and the operator-run Phase B commands are in §21.
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
- **Not implemented** (as of the §20.7 checkpoint). The implementation is recorded in §21.

## 21. Implementation record (2026-10-05, working tree, uncommitted; database validation PENDING)

Authorisation: edit files and run local, database-free commands; read-only Git. No database was contacted, no
credential file read, nothing committed, merged, pushed or deployed. Implemented from the S0 checkpoint
commit 62f2cd67, following §18.

### 21.1 Checkpoint integrity (step 1)

- For each of the five archived files, the committed blob at 62f2cd67 (and at HEAD), the working-tree file, the
  `D:\tmp\issue265\` original and the SHA-256 in the archive `README.md` are **byte-identical** (`cmp` and
  hash). The committed Phase A harness blob equals the pre-checkpoint hash `5842a29c…2e7c8`.
- Git had warned of LF-to-CRLF conversion because the installed Git sets `core.autocrlf=true` (system level),
  and the files had no attributes. A simulated checkout (`git checkout-index` into the scratchpad, read only)
  gave CRLF copies whose hashes all differed. `.gitattributes` now carries one `-text` entry for each of the
  five files (not the README), under `issues/*/AFLDB-ISSUE-265-phase-a/…` so it follows the folder to
  `issues/closed/`. The same simulated checkout is then byte-identical to the originals.
- Limits, recorded in the archive README: the entries protect checkouts that include them (a checkout of
  62f2cd67 itself still converts); and **window 2 captured no harness hash**, so nothing here proves the bytes a
  window executed.

### 21.2 What changed (steps 2–4)

| Path | Change |
|---|---|
| `src/lib/acquisition/settle-core.ts` | `SETTLE_PROMOTION_GATE` `{717275, 4}`, `SETTLE_PROMOTION_GATE_WAIT_MS` 300 000, `…STATEMENT_BOUND_MS` 330 000, `LOCK_NOT_AVAILABLE_SQLSTATE`, `SettlePromotionGateTimeout`, `SettleGateTx`, `acquireSettlePromotionGate(tx)` (§18 S1). It fails explicitly if either current setting cannot be read. |
| `settle-afltables.ts`, `settle-afl-api.ts` | `await acquireSettlePromotionGate(tx);` is the first call in the only `sql.begin` of each (S2). Neither catch changed. |
| `src/lib/ingest/datasets.ts` | `withLegacyLockTimeout` takes `pg_advisory_xact_lock(717275, 4)` inside its `try`, after its two setting statements and before `work()`; `matchAttendance.preparePromotion` (positive `match_id`, one ascending `FOR NO KEY UPDATE`); the F-002 and hook comments (S3). |
| `src/db/queries/admin-fixtures.ts` | namespace comment gains key 4 (S4) |
| `tests/ingest-datasets.test.ts`, `tests/match-sheet.test.ts`, `tests/afl-api-ingestion-safety.test.ts` | database-free pins (S5, §19.3); the third file's fake transaction had to learn the gate statements |
| `tests/integration/match-results-promotion.test.ts` | the second-stats-promotion test now expects the gate refusal and a retry (D-265-6); the emulated-settle tests are re-labelled UNGATED (D-265-11); the count stays 32 (S6) |
| `tests/integration/settle-promotion-deadlock.test.ts` | Phase B, B1–B11, replaces Phase A (S7) |
| `.gitattributes` | the five `-text` entries (§21.1) |
| `CHANGELOG.md`, `docs/admin-and-beta.md`, this runbook, `issues.md`, `IssuesIndex.md` | documentation (S9, S10). The comment at `canonical-apply.ts:477` is about the Match Sheet writer and is still accurate; unchanged. |

**Behaviour.** A settle waits at the gate for an in-flight match-writing promotion for up to 300 s, then fails
before writing (`SettlePromotionGateTimeout`, `cause.code = '55P03'`); a `57014` or `40P01` there passes through
unchanged, so a manual cancellation is never reported as a gate timeout. A promotion that starts during a settle,
or while another match-writing promotion holds the gate, is refused retryably at 5 s with nothing written.
`match_attendance` locks its matches in ascending id.

**Phase B harness.** Reuses the Phase A infrastructure (target guard, census, fingerprints, teardown, `hold`,
`reachOf`). New: gate, row-lock and "no xid, no table lock" observation through `pg_locks` on the server clock;
per-run unique labels and observation times; `client(label, statementTimeoutMs | null)`; the settle runners can
keep a connection (B7) or dry-run (B8). It refuses a tree without the gate before any connection. Order of the
cases: B1, B2, B3, B4, B6, B7, B8, B9, B10, B11, **B5 last**, because its attendance writes re-source M1 and M2
to `manual_admin_edit`. A promotion and a settle that touch one row write the same value. Two settles are
released one after the other, never together (the separate ISSUE-261 recompute contention). Counts: **11
tests; 14 retained `admin-upload` batches** (B1 1, B2 1, B3 1, B4 1, B5 1, B6 1, B7 1, B8 1, B9 4, B11 2).

**Tooling (outside the repository, `D:\tmp\issue265\`).** `Invoke-Issue265PhaseB.ps1`, `issue265-db-probe-b.mjs`,
`tools\Invoke-Issue265SkipCheckB.ps1` (derived from the archived Phase A files, which are unchanged). Differences:
arms `B`; expects 11 tests and 14 retained batches; a 45-minute watchdog around vitest that kills the tree (checked
on every output line; returns 124; the census still runs); retained targets include `match_attendance`; the targets
step reads each role's raw session defaults and **refuses** a window where the import role's `statement_timeout` or
`lock_timeout`, or the owner's `idle_in_transaction_session_timeout`, is non-zero and at most 400 s (B7 holds a
promotion stuck and a side transaction idle for the whole 300 s wait); the skip check adds a variant that arms the
retired `PHASE=A` with a fresh stamp. **The active Phase A runner now refuses** to run once the settle sources carry
the gate or the suite is not the Phase A harness (an edit to that file only; the committed archive copy is
unchanged). The Phase B tooling is not yet archived in the repository; archive it at closure, as D-265-15 did
for Phase A.

### 21.3 Checks run (database-free; step 5)

- `npm run typecheck`: exit 0. `eslint --max-warnings 0` on every changed source and test file and on the
  archive folder: exit 0. `npm run lint` (`eslint .`) reports 384 problems (253 errors) in 100 files (re-measured in §22.4; this line first said 112), **none in a
  file this change touches**; §22.4 proves the whole set is identical on checkpoint 62f2cd67.
- Unit and importer sweep (14 files: `ingest-datasets`, `match-sheet`, `afl-api-ingestion-safety`,
  `settle-season-revalidation`, `submission-review-actions`, `db-promotion-check`, `data-overrides-source-contract`,
  `afl-api-match`, `afl-api-player-bridge-cli`, `catalogue-lookups`, `current-season-import`,
  `workflow-preflight`, `honours-lifecycle-public-contract` and the harness): **1549 passed, 15 skipped, 2
  failed**. The two failures are `honours-lifecycle-public-contract` (`awards.ts` and `grid-solver.ts` scan
  counts). Neither file is touched by this change. §22.1 later ran the same test on checkpoint 62f2cd67: both failures reproduce identically there, so they are pre-existing. (The 1549 / 15 split came from a PowerShell launch; §22.4 explains it.) The first sweep also caught a
  real regression of this change (the `afl-api-ingestion-safety` fake transaction; fixed, 166/166).
- Tooling: PowerShell parse, 0 errors for all three Phase B scripts and the edited Phase A runner; probe-b self-test
  **23/23**; the Phase B runner `-Phase SelfTest` passes, including the network-blocked skip check (clean, stale-B and
  fresh-A variants: 11 skipped each, **0 blocked connection attempts**); the old runner refuses; the watchdog was
  exercised in isolation (a fast command passes its exit code through and redacts; a chatty hang is killed at the
  deadline with 124 and nothing is left running). That test caught a real bug (the deadline was checked only when the
  output stalled), fixed.
- The archived Phase A files still hash to the original values.

### 21.4 Independent review (step 6)

A fresh read-only reviewer (CLAUDE.md §15 lets only the orchestrator spawn `afldb-reviewer`; this session used one
general-purpose agent, §1) verified: gate ordering in both settles and all three hooks; no other legacy writer can
hold a match lock concurrently with a settle; both queue shapes; no deadlock or livelock introduced by the gate
(a settle at the gate holds only its virtual xid); the helper's restore, rollback and error mapping; the unit pins;
the per-case recount to 14 and 11; one-value-two-writers; teardown coverage. **No CRIT.**

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| H1 | HIGH | B3 watched the promotion while waiting for the M2 unit, so a legitimate 5 s refusal could abort the case | **Fixed:** the promotion is no longer watched there; `settle.done === false` still proves the order |
| M1 | MED | B2's INCONCLUSIVE guard: the settle's remaining work after release may not fit 4 s over the tunnel | **Accepted, recorded (§21.6).** The stall already sits on the last record. It fails as INCONCLUSIVE, never a pass |
| M2 | MED | B4's "never a deadlock victim" was vacuous: 55P03 and 40P01 give the same refusal text | **Fixed:** a refused promotion must have waited at least 4500 ms |
| M3 | MED | the probe did not refuse an import-role `lock_timeout`, which also cancels the stuck promotion | **Fixed** in probe-b, with a self-test |
| M4 | MED | B1/B3/B5 sampled the gate-only wait once | **Fixed:** `watchGateWait` samples every 250 ms and asserts every sample (advisory only, sole blocker the settle) |
| L1 | LOW | the source pins sliced a CRLF file with `'\n}\n'` | **Fixed** (harness and `match-sheet.test.ts`) |
| L2 | LOW | `String(undefined)` could reach `set_config` | **Fixed** (explicit error) |
| L3 | LOW | no case registered a forensic capture | **Fixed:** every case writes its runs' outcomes and the findings to the evidence file |
| L4 | LOW | B5's probe connected inside the hook's 5 s budget | **Fixed:** connects first |
| L5 | LOW | B7 keeps two connections idle across the tunnel for over 5 minutes | **Recorded** (§21.6): a drop fails the case, never passes it |
| L6 | LOW | the first retirement check in the old runner could not fire | **Fixed**; the gate-file check was already effective |

### 21.5 Operator-run Phase B commands (guarded `afldb_test` window; nothing here has been run)

Prerequisites: the SSH tunnel to `afldb_test` is up (as for Phase A, `127.0.0.1:55432`); no `.env` in the worktree;
`node_modules` present. Each phase stops at the first refusal. Do not run Phase A again.

```powershell
# 0. offline, no database contact
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseB.ps1 -Phase SelfTest
# 1. read-only: targets (also refuses a short import statement_timeout / lock_timeout or owner idle timeout), preflight, baseline
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseB.ps1 -Phase Preflight -TunnelHost 127.0.0.1 -TunnelPort 55432
# 2. the window: B1-B11 (about 10-15 minutes; B7 alone waits 300 s), then the post-run census
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseB.ps1 -Phase Full -TunnelHost 127.0.0.1 -TunnelPort 55432
# 3. only after an interrupted or failed window, read-only
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265PhaseB.ps1 -Phase Census -TunnelHost 127.0.0.1 -TunnelPort 55432 -BaselineFile D:\tmp\issue265\run-<stamp>-Full\baseline.json -EvidenceFile D:\tmp\issue265\run-<stamp>-Full\harness-evidence.json
```

PASS needs: 1 file and 11 tests passed, none skipped or failed, census CLEAN with exactly 14 retained
`admin-upload` batches, no migration applied by the run. Database-free commands the operator can repeat:
`npm run typecheck`; `npx vitest run tests/ingest-datasets.test.ts tests/match-sheet.test.ts tests/afl-api-ingestion-safety.test.ts`;
`npx eslint --max-warnings 0 <changed files>`.

### 21.6 Not validated, and known risks

- **[Superseded by §23: Phase B ran on 2026-10-05 and passed 11/11.]** **Phase B has not run.** Every database property in §19 is asserted by code that has only been type-checked,
  linted, read by an independent reviewer and skip-checked. A first-window failure for a test-bug reason is possible.
- **B2 and B9 (second run) can end INCONCLUSIVE** if the link is too slow for the settle or P1b to finish inside the
  promotion's 5 s bound. That means rerun on a faster link, not a defect.
- **B7 depends on the environment:** the import role and the owner must have no short session timeouts (the probe
  refuses), and the tunnel must keep two idle connections for over 5 minutes.
- **Regression window not run.** The ISSUE-264 runner (`D:\tmp\issue264\Invoke-Issue264Window.ps1`) lists
  `match-results-promotion` (expects 32 passed, unchanged by this work), `datasets`, `submission-promotion` and only
  the Match Sheet block of `settle-afltables`. §18.2 step 4 asks for `settle-afltables` in full; widening that filter
  is a decision for the operator; §22.6 prepares that widening in a copied runner. The F-002 expectation changes in `match-results-promotion` have not been run.
- The two `honours-lifecycle-public-contract` failures are **pre-existing**: they reproduce identically on checkpoint 62f2cd67 (§22.1). Their cause is not investigated.
- DEV acceptance (§18.2 step 6) and the commit, `merge:ready` and deployment are not done.

## 22. Pre-window verification (2026-10-05 later, agent; database-free)

Authorisation: local database-free commands and read-only Git. No database was contacted, no credential or settings
file read, no DEV/PROD action, no Git mutation, nothing committed. Every hash and count below was measured in this
pass. Evidence: `D:\tmp\issue265\verify-20261005\` (lint and vitest JSON, the summarising scripts, console captures).

### 22.1 The two `honours-lifecycle-public-contract` failures: baseline (item 1)

- **Export.** `git checkout-index -a --prefix=D:/tmp/issue265/baseline-62f2cd67/` (read-only; the index equalled HEAD,
  tree `0cf6f3b9d42033c4c1c0d77fd80c7a562d1018dd`, 1794 files = every tracked file; the same `core.autocrlf=true`
  conversion as the worktree). `node_modules` is a junction to the worktree's, so the dependency versions are the
  same. `package.json`, `package-lock.json`, `vitest.config.mts`, `tsconfig.json`, `tests/setup.ts`, the test file,
  `src/db/queries/awards.ts` and `grid-solver.ts` have identical SHA-256 in both trees. Neither tree has a `.env` and
  no DSN variable was set. The working tree was not changed or stashed.
- **Command, run in each tree:** `npx vitest run tests/honours-lifecycle-public-contract.test.ts` → 11 tests, 9
  passed, **2 failed in both**.
- **Failures, identical in both** (only the duration and the root path differ):
  `src/db/queries/awards.ts scans 19 honours table(s) but carries fewer lifecycle filters: expected 20 to be 19`, and
  `src/db/queries/grid-solver.ts scans 17 honours table(s) ...: expected 23 to be 17`.
- **Classification: pre-existing at checkpoint 62f2cd67; not caused by this work** (neither source file is modified).
  The cause is not investigated. Two observations: the counted filters exceed the scans (20 vs 19, 23 vs 17), so the
  message's "fewer" is misleading; and the test folds CRLF itself (`source()`), so the "Windows CRLF" explanation in
  an earlier record (`issues.md` ~37395) is not shown by this evidence. No new issue is opened here (it is
  tracked-test debt outside ISSUE-265); say if you want one.

### 22.2 `admin-fixtures.ts` and `docs/admin-and-beta.md` (item 2)

- **`src/db/queries/admin-fixtures.ts` (+5/-3): a comment, nothing executable.** Its namespace note said the fixed keys
  in `0xAF1DB` (717275) were 1, 2 and 3. The gate adds key 4 (`SETTLE_PROMOTION_GATE`, `settle-core.ts:297`), so that
  sentence became false. §18 S4 plans exactly this. Every user of 717275 was listed by Grep: `awards-admin.ts` and
  `admin-awards.ts` (key 1), `admin-users.ts` (2), `admin-brownlow.ts` (3), `datasets.ts` and `settle-core.ts` (4) and
  `admin-fixtures.ts` (the season, as the second key). The fixture lock key is a season, and `createFixture`,
  `createFixtures` and the edit path refuse a season outside `maxYear..maxYear+1` (`fixtureSeasonBounds`, an empty
  range when there is no register) before `lockSeason`, or read the season from an existing fixture row (`:1389`).
  So key 4 cannot be reached as a season in practice. (The comment's "1897..2100" is the database range, wider than
  what the writer admits; harmless, unchanged.)
- **Writer and transaction paths affected by that file: none.** Its three transactions (`createFixture` `:1061`,
  `createFixtures` `:1205`, the edit path `:1386`, all on the import role) take only `pg_advisory_xact_lock(717275,
  season)`. They write `fixtures` and audit rows, and touch `matches` only through a plain `SELECT` with no `FOR` clause
  (`:1405`, to decide "played"). No other module writes `fixtures` (Grep of `INSERT INTO|UPDATE fixtures` outside the
  file: none), so a settle never writes it. The fixtures writer is therefore not a match writer, holds no match row lock
  and adds no lock edge with the gate: it never holds the gate, and the gate's holders never take a season lock. No
  change needed. (Grep-based; the neighbouring `players` observation is in §22.3.)
- **`docs/admin-and-beta.md` (+15): the §18 S9 documentation page.** It states which datasets take the exclusive gate
  (`match_results`, `player_match_stats`, `match_attendance`), the 5 s retryable refusal and its wording, that the
  submission is marked `failed` with nothing written, the settle's 300 s wait and its failure before any write, and
  that `player_bio` and the award datasets do not take the lock. Each was checked against the code: the refusal text
  equals `LEGACY_PROMOTION_LOCK_REFUSAL`, the bounds are `LEGACY_LOCK_TIMEOUT = '5s'` and
  `SETTLE_PROMOTION_GATE_WAIT_MS = 300_000`, and only the three datasets carry a `preparePromotion`. It documents a
  behaviour change an administrator can see (a promotion can be refused for 5 s while a settle runs), and it is the
  admin-upload page §18 S9 names. Within the accepted scope.

### 22.3 Gate-ordering invariant, timeouts and restoration (item 3)

**Invariant: the gate precedes every data write and row lock.** (Not "first statement": the timeout reads and sets
come first, §20.7.)

| Entry point | Where the gate is | Evidence |
|---|---|---|
| `runSettleAfltables` | first call in its only `sql.begin` (`settle-afltables.ts:1835-1840`), ahead of `loadRefs`; the derived recompute (`:1919`) is inside the same transaction | one `sql.begin` in the file; pinned DB-free by `match-sheet.test.ts` ("both settles call the gate as the first statement…") |
| `runSettleAflApi` | the same (`settle-afl-api.ts:1905-1910`; recompute `:1968` inside) | the same pin; plus the statement order `read, set, gate, set`, then only non-gate statements, in `afl-api-ingestion-safety.test.ts` |
| `match_results` | `preparePromotion` → `withLegacyLockTimeout` → exclusive gate → `FOR NO KEY UPDATE` (`datasets.ts:774-793`) | the hook's only statement before the gate is in-memory validation |
| `player_match_stats` | `preparePromotion` → `withLegacyLockTimeout` → gate → `FOR SHARE` (`:1087-1110`) | likewise |
| `match_attendance` | `preparePromotion` → `withLegacyLockTimeout` → gate → ascending `FOR NO KEY UPDATE` (`:1330-1343`) | likewise |

- **No other path to a match lock.** The only advisory lock in `datasets.ts` is inside `withLegacyLockTimeout`
  (`:598`), and every `FOR NO KEY UPDATE` / `FOR SHARE` (`:791`, `:1109`, `:1342`) is inside a `withLegacyLockTimeout`
  closure. `rising_star`, `all_australian` and `player_bio` have no hook and write no match row. The promotion
  transaction's earlier statements (`pipeline.ts:313-337`) are the submission's own `FOR UPDATE` and plain reads, then
  the hook runs in a savepoint (`:350-356`).
- **Timeout errors through the existing catches.** `SettlePromotionGateTimeout` extends `Error`, not a dry-run, halt
  or completeness class. `sql.begin` rolls back and rethrows. AFL Tables' outer catch rethrows anything but
  `SettleDryRunRollback` (`:1960`); AFL API's handles `DryRunRollback`, `RequireCompleteSourceRollback` and
  `AflApiSettleHalt` and rethrows the rest (`:2005` onward). So a gate timeout fails the run with nothing written (the
  batch row is inside the transaction), and a `57014` or `40P01` passes through unchanged (unit-pinned for 57014,
  40P01, 23505, 40001). On the promotion side, a `55P03` or `40P01` at the gate becomes the retryable refusal and any
  other error passes through, as before (F-002).
- **Restoration on success.** Statement 4 restores both settings to the values statement 1 read; the unit test uses
  `5s` and `2min` and asserts those come back, not `0` and not the gate's values. The helper throws explicitly if a
  setting cannot be read. In a promotion, `withLegacyLockTimeout` restores `lock_timeout` after `work()`.
- **Rollback on failure.** All four `set_config` calls are transaction-local (third argument `true`; source-pinned,
  and `false` is forbidden by a test). A failure aborts the transaction, and in a promotion rolls back its savepoint,
  so both settings revert; the helper deliberately issues no restore after a failure (pinned: `read, set, gate`).
- **Database confirmation is still outstanding.** B7 (the same clients re-used after a timeout show the server
  defaults) and B10 (restoration inside a real transaction) are the cases that prove this against PostgreSQL, and
  Phase B has not run.
- **Observation, INFO, no work.** A `player_bio` promotion updates `players` rows without the gate, and the settles'
  derived recompute also updates `players` (`player-derived.ts:335,352`). I did not trace whether those can cross.
  The accepted design (§12, D-265-1..12) excludes `player_bio` because it writes no match row, and this issue is the
  match-lock cycle. Not examined further.

### 22.4 Exact commands and counts (item 4)

| Command (run from the worktree unless stated) | Result |
|---|---|
| `npx vitest run tests/honours-lifecycle-public-contract.test.ts`, in the worktree and in the checkpoint export | 9 passed, 2 failed, **identical** in both (§22.1) |
| `npx vitest run tests/ingest-datasets.test.ts tests/match-sheet.test.ts tests/afl-api-ingestion-safety.test.ts` | **3 files, 344 passed**, 0 failed, 0 skipped: 99 + 79 + 166. The checkpoint gives 81 + 68 + 165 = 314, so this work added **30 tests** (18, 11, 1), all passing |
| the 14-file sweep: `npx vitest run` over `ingest-datasets`, `match-sheet`, `afl-api-ingestion-safety`, `settle-season-revalidation`, `submission-review-actions`, `db-promotion-check`, `data-overrides-source-contract`, `afl-api-match`, `afl-api-player-bridge-cli`, `catalogue-lookups`, `current-season-import`, `workflow-preflight`, `honours-lifecycle-public-contract` and `integration/settle-promotion-deadlock` | worktree: 1566 tests, **1553 passed, 2 failed, 11 skipped** (the unarmed harness). Checkpoint export: 1528 tests, 1523 passed, 2 failed, 3 skipped (the Phase A harness). The failures are the same two tests in both: **no new failure** |
| `npm run typecheck` | exit 0 |
| `node node_modules/eslint/bin/eslint.js --max-warnings 0` on the ten changed code files and `issues/open/AFLDB-ISSUE-265-phase-a` | exit 0, no problems |
| `node node_modules/eslint/bin/eslint.js . -f json`, in the worktree and in the export | **exit 1 in both**: 384 problems (253 errors, 131 warnings) in 100 files |

- **Baseline failures versus new ones.** Both known failures are pre-existing (§22.1). There is no failure in this
  sweep that the checkpoint does not also have.
- **Whole-repository lint is FAILING** (`npm run lint` exits 1). The changed files are clean, but that does not show
  the repository's failures pre-date this work; the differential does: after normalising the absolute root that some
  messages embed, the (file, rule, severity, line, column, message) set is **identical in all 100 files** on the
  checkpoint and the worktree, and none of the ten changed code files has a problem. §21.3 said "112 files"; the
  re-measured count is 100 (the 384 and 253 agree).
- **Why §21.3's sweep read 1549 / 15 / 2:** that launch was from PowerShell, where `sh` is not on PATH, and
  `current-season-import.test.ts` has four `it.skipIf(!haveSh)` tests. PowerShell: that file gives 321 passed, 4
  skipped; Git Bash: 325 passed. The same 1566 tests either way.
- **Not run:** every integration suite (they need a database), and the Phase B harness (skipped by design when not
  armed).

### 22.5 Provenance before the first database window (item 5)

Window 2 of Phase A captured no hash of its harness (§18.1); Phase B and the regression window now cannot.

- **New files, all under `D:\tmp\issue265\tools\`:** `Provenance.ps1` (hashing, the static import closure through the
  archived `import-graph.mjs`, manifest writer, recheck) and `Test-Provenance.ps1` (offline test, **21 checks pass**:
  hashes equal `Get-FileHash`; stable manifest hash; a modified file and a deleted file are both reported; an
  incomplete manifest is written and then refused; a tool file outside the tools root is refused; CRLF and LF twins
  share `sha256Lf`).
- **`Invoke-Issue265PhaseB.ps1` (edited, not an archived file):** every run of every phase writes
  `provenance-manifest.json` and `provenance-manifest.sha256.txt` into its own evidence folder **before the tunnel
  check, the settings file, the preconditions and any database contact**, so a refused or failed run keeps it. A
  missing listed file stops the run after the manifest is written. After the run, in `finally`, pass or fail, every
  file is re-hashed: a change turns a passing run into a STOP. New `-Phase Manifest` (no tunnel arguments).
  Proven offline: `-Phase SelfTest` passes (probe 23/23; skip check 11 skipped x 3 runs, 0 blocked connection
  attempts); a `-Phase Preflight` with no tunnel arguments STOPS and its folder still holds the manifest and the
  recheck.
- **What the Phase B manifest covers (58 files):** the harness; its static import closure (43 repository modules including the harness, with the six gate files
  (`settle-core`, `settle-afltables`, `settle-afl-api`, `canonical-apply`, `datasets`, `pipeline`) marked
  `gate-implementation`); `package.json`, the lockfile, `vitest.config.mts`, `tsconfig.json`, `tests/setup.ts`, the
  source-family registry and the installed vitest, postgres and typescript `package.json`; and the runner, the probe,
  the skip check, `block-network.cjs`, `import-graph.mjs` and `Provenance.ps1`.
- **Each entry has `sha256` (working-tree bytes, CRLF on this machine) and `sha256Lf`** (CRLF folded to LF, text
  files). After the operator commits, compare a committed blob with `sha256Lf`:
  `git show <commit>:<path>` piped to `sha256sum`. The harness is LF on disk, so its two hashes are equal.
- **The prepared manifests** are in `D:\tmp\issue265\provenance-prepared-20261005\` (one folder per runner). Phase B:
  manifest hash `606a5fbb39d5a4da1640f63677d79308d9ee5e605d4114b71fc5ce42b21cb5b9`; regression runner (171 files) manifest hash
  `9a30caa63616db1a566094a50c0ed443cb0090879d2faf0f390005679119ab13`; harness
  `tests/integration/settle-promotion-deadlock.test.ts` SHA-256
  `20507181fd46f5a084b99224ecab5612440909c80d4313815cee079ac437ddd8` (152501 bytes). They are a point-in-time record:
  the manifest each run writes supersedes them, and any later edit to a hashed file changes them.
- **Phase A originals, archive and evidence are unchanged.** The five archived files match the README hashes and the
  originals (the probe and three tools) match the README; the archive folder's only Git change is the README, as
  before; no pre-existing evidence folder was changed. **One slip, repaired:** a tool hook wrote three zero-byte files (`${now`, `1)`, `n`) into `run-20261005-162235-Full` and one (`afldb_test`) into
  `D:\tmp\issue265` while the working directory was there (a tool hook writes zero-byte files named after fragments of tool input). I removed exactly those four, and the folder lists its
  original 12 files again.

### 22.6 The full `settle-afltables` suite in the regression window (item 6)

**Review of `tests/integration/settle-afltables.test.ts` (76 tests; unmodified since 2026-10-03).**
- **Target guards.** `import './guard'` first (needs `AFLDB_TEST_DATABASE_URL`, opens a preflight connection); and its
  own `beforeAll` throws unless `current_database()` matches `_test$`. The runner's targets proof and isolation checks
  come before it.
- **Fixtures** are committed (an own-transaction driver cannot be wrapped), namespaced and disjoint from Phase B
  (2078): season **2094**, prefix `issue099-` (one player, one identity, one canonical `matches` row on a dedicated
  key, spine, projection sentinels, an independent-provider claim, `data_overrides`; two real club identities are
  read and, in the suite's own words, never written), and season **2093**, prefix
  `issue122-` (players, matches, stats, Match Sheet authority keyed `2093|issue122-…`, the `club_seasons` and
  other derived rows the end-of-run recompute writes for that season and those players, the repair tool's batch). It borrows the first `auth_users` row as the admin
  for Match Sheet saves.
- **Cleanup** runs as a pre-clean and in `afterAll` (`cleanupIssue099`, `cleanup122`). I read all 54 `DELETE`s and
  the 6 `UPDATE`s: each is scoped by season 2093/2094, by an `issue099-`/`issue122-` key, slug, tool or note, or by an
  id the run created; shared rows (`sources`, `auth_users`) are deleted only if the run created them; the suite
  refuses to start if a row already sits on its dedicated key. No DDL, role or grant change, no subprocess, no
  network; the only `2026` is in argument-parsing assertions.
- **The gate does not disturb its statement-capture test:** the O1 "no DELETE or TRUNCATE" scan reads
  `settle-afltables.ts`, `observation-store.ts` and the CLI source; the gate's SQL lives in `settle-core.ts`.
- **The other AFL API integration suites stay out** (D-264-10): `settle-afl-api.test.ts`,
  `settle-afl-api-brownlow.test.ts`, `-brownlow-backtest` and `-brownlow-reschedule` are all pinned to real season
  2026. They call the gated `runSettleAflApi`; their coverage is Phase B only (§18.2 step 4).

**The census gap, and the fix.** The ISSUE-264 probe fingerprints a fixed table list and counts ISSUE-264's own
fixtures. This suite's fixtures also live in tables that probe does not cover (`staging.*`, `promotion_candidates`,
`import_rejections`, `canonical_applications`, `data_issues`, `brownlow_round_votes`, `player_club_season_stats`), so
a leak there would pass unseen.

**Prepared (outside the repository; the ISSUE-264 originals are byte-unchanged):**
- `D:\tmp\issue265\Invoke-Issue265Regression.ps1`: a copy of `Invoke-Issue264Window.ps1`, with
  `issue265-regression-probe.mjs` and `issue265-regression-window.mjs` copied beside it (the window helper is
  byte-identical to the original; the probe differs only by the header and 21 `settle_*` residue columns, each the
  `count(*)` twin of a `DELETE` in the suite's own cleanup; a script confirms every table is one the suite deletes
  from and no `LIKE` pattern contains `_`). Run: the full suite (**76**), `match-results-promotion` 32,
  `datasets` 16, `submission-promotion` 7, each followed by a census; the build is off unless `-WithBuild`; each suite
  runs under a watchdog (`-SuiteTimeoutMinutes`, default 90) and a skipped test is never a pass; the baseline refuses
  any `settle_*` residue before the run. New offline phases: `-Phase Manifest` and `-Phase Static` (provenance plus
  the preconditions, no settings file, no database). Preconditions now also prove every suite imports the guard, that
  no suite reads the season-2026 AFL API fixtures, and that the suite still carries the namespace constants the probe
  was written for. Three negative tests on a copy (a drifted season constant, a removed `_test` guard, a removed guard
  import) each refused as intended, after a passing control, and the copy was restored byte for byte.
- **An inherited defect fixed in the copy:** the original assigned `$script:Applied` only after the target proof, so an
  early exit read an unset variable under StrictMode. It is initialised at the top.
- `PowerShell` parse: 0 errors for the runner and the module. `node --check`: both `.mjs` files.
- **Exact counts come from the ISSUE-264 windows:** match-results-promotion 32 (last window `211130`, unchanged shape
  at the checkpoint), datasets 16 and submission-promotion 7 (files unmodified since before those windows), and
  settle-afltables 11 + 65 filtered = 76. A drift STOPS that suite, with the restore still running.

**Blockers: none found that stop the full suite running in that window.** Residual risks, all recorded:
- The **new residue SQL has not run against PostgreSQL**. Its tables and columns are the suite's own; an error would
  surface at the read-only baseline, before anything is written.
- The suite's **duration is unmeasured** (the Match Sheet block alone took 175 s over the tunnel); the 90-minute
  watchdog per suite is a ceiling, not an estimate. A watchdog kill can leave fixtures; the migration 110 rollback then
  refuses if an authority row survives, and the window records the exact state.
- **Unmeasured hygiene of the other 65 tests:** a dirty census stops the window with State B applied and the restore
  running. That is a finding, not a safety failure on `afldb_test`.
- Two concurrency tests (`FOR UPDATE NOWAIT`, a settle started and not awaited) are timing-sensitive over the tunnel:
  a flaky failure there is a test failure, not residue.

**Separate window.** It is already a separate launch from Phase B (§18.2 steps 3 and 4), and should stay one: Phase B
applies and restores nothing, while this runner applies migration 110 and restores it. Order: Phase B, then this.

### 22.7 Readiness (item 7)

- **Phase B window: ready for the operator,** after the operator commits (so the code is identifiable by commit as
  well as by hash). Commands are §21.5, with `-Phase Manifest` as an optional first step.
- **Regression window: tooling ready, not run:** `Invoke-Issue265Regression.ps1 -Phase Static` (offline), then
  `-Phase Preflight`, then `-Phase Full`, with `-TunnelHost 127.0.0.1 -TunnelPort 55432`.
- **Remaining blockers:** the operator's commit, the tunnel, and both database windows. The two failing
  `honours-lifecycle-public-contract` tests and the 384-problem repository lint are pre-existing and are not blockers
  to this issue. The Phase B and regression tooling is not yet archived in the repository (do it at closure, as
  D-265-15 did for Phase A; the regression runner needs its own `-text` entries then).
- **Changed paths this pass.** In the repository: `issues/open/AFLDB-ISSUE-265.md`, `issues.md`, `IssuesIndex.md` (this
  section and the corrections above). Outside it, all under `D:\tmp\issue265\`: new `tools\Provenance.ps1`,
  `tools\Test-Provenance.ps1`, `Invoke-Issue265Regression.ps1`, `issue265-regression-probe.mjs`,
  `issue265-regression-window.mjs`, `baseline-62f2cd67\`, `provenance-prepared-20261005\`, `verify-20261005\`; edited
  `Invoke-Issue265PhaseB.ps1`. No source or test file in the repository was changed.

## 23. Phase B window: PASSED 11/11 (2026-10-05 22:41, operator-run; recorded by agent, read-only)

Authorisation for this pass: reading the saved evidence and local offline checks only. No database was contacted,
no Git command run, nothing deployed, **no evidence file edited**. Evidence (outside Git, unchanged):
`D:\tmp\issue265\run-20261005-224117-Full\` (15 files: `summary.txt`, `00-derive` to `06-post-census` logs,
`baseline.json`, `preflight.json`, `harness-evidence.json`, `06-post-census.json`, `provenance-manifest.json` and
`.sha256.txt`, `provenance-recheck.txt`).

### 23.1 Result

`-Phase Full -TunnelHost 127.0.0.1 -TunnelPort 55432`, `OVERALL: PASS (Full)`. Every step exited 0.

| Required | Observed (file) |
|---|---|
| 1 file, 11 tests passed, none skipped or failed | `Test Files 1 passed (1)`, `Tests 11 passed (11)`, no skipped or failed term; 612.19 s (`05-phase-b.log`). All of B1–B11 carry a tick. |
| Targets | 3 connections (owner, import, auth), each `afldb_test` at `127.0.0.1:55432`, db-oid 45428, one server (`01-targets.log`). Raw session defaults of all three roles: `statement_timeout=0 lock_timeout=0 idle_in_transaction_session_timeout=0`, so B7's 300 s wait was not cut short by a role setting. |
| Window state | Zero other sessions (twice: `02`, `04`). 109 applied, 110 pending, **State A**, zero `player_match_stats` authority rows. `deadlock_timeout` 1000 ms, `lock_timeout` 0, server 16.15. |
| Baseline | `BASELINE OK`: no residue in season 2078 or any ISSUE-265 namespace; 136 single-column foreign keys into a namespace row checked, 0 non-zero; `import_batches` max id 1237. |
| Census after the run | `CLEAN: historical fingerprints equal the baseline; no residue; every retained row accounted for.` All 19 residue counts 0; 136 foreign keys checked, 0 non-zero; `import_batches` max id 1268. |
| 14 retained batches, all explained | Ids 1241, 1243 (`match_results`), 1245, 1248, 1249, 1251, 1257–1261, 1264, 1266 (`player_match_stats`), 1268 (`match_attendance`): each `admin-upload`, its submission deleted, each `explained`. Count by case: B1 1, B2 1, B3 1, B4 1, B5 1, B6 1, B7 1, B8 1, B9 4, B11 2 = 14 (`harness-evidence.json`, `06-post-census.log`). |
| Historical fingerprints unchanged | `fingerprintsEqual: true`, `changedFingerprints: []` (`harness-evidence.json`); the census verdict above. |
| Zero teardown problems | `teardownProblems: []`, `residue: {}`; 15 submissions (330–344) created, all deleted; 15 settle batches and 1 fixture batch (1246) removed. |
| Provenance unchanged | 58 files hashed before any database contact, manifest sha256 `606a5fbb39d5a4da1640f63677d79308d9ee5e605d4114b71fc5ce42b21cb5b9` (equal to the prepared value in §22.5); harness `tests/integration/settle-promotion-deadlock.test.ts` sha256 `20507181fd46f5a084b99224ecab5612440909c80d4313815cee079ac437ddd8`, 152501 bytes (equal to §22.5); `provenance recheck: 58 files unchanged since the manifest was written` after the run. |
| No migration applied | `migrations applied or restored by this run: none`; 110 stayed pending (State A) for the whole run. The fixture user pre-existed and the `sports_data_lab` source was not seeded by this run. |

### 23.2 What each case showed (against real settles and real promotions, from the test titles and the recorded outcomes)

| Case | Outcome recorded |
|---|---|
| B1 AFL Tables, `match_results` | promotion refused at the gate while a settle held it with the retryable message, nothing written; re-promotion applied 2 |
| B2 | the promotion waited at the gate, then applied 2 once the settle committed |
| B3 AFL API, `player_match_stats` | refused at the gate, not on `(p, M1)`; the M2 unit applied; re-promotion applied 2 |
| B4 AFL API attendance (F-265-1) | the run was not lost; the promotion applied 1 after waiting at the gate |
| B5 `match_attendance` | refused at the gate with nothing written; the re-promotion applied 2, locking in ascending id |
| B6 | a settle waited behind a stuck promotion holding nothing, then completed |
| B7 | both settles gave up after the full wait with the named error (300.26 s and 300.32 s elapsed; 301.1 s server-side, inside the 330 s bound), wrote nothing, and their connections were reused |
| B8 | two settles held the shared gate together; a dry-run rollback released it; the promotion then applied |
| B9 | the second of two promotions was refused while the first held the gate; its retry applied |
| B10 | `acquireSettlePromotionGate` restored both previous settings and held the gate to commit |
| B11 | a waiting promotion delayed a later settle, and a waiting settle delayed a later promotion |

### 23.3 What this does and does not show

- **Shown, on `afldb_test` in State A, in one window:** with the gate in place, the settle-versus-promotion
  shapes of §19 behaved as designed with real settles and real promotions, and the run left no residue.
- **No protection against an ungated writer is claimed or shown.** The gate separates the two settles from the three
  legacy hooks (`match_results`, `player_match_stats`, `match_attendance`) only. Phase B drove no writer that lacks
  the gate: not a Match Sheet save, a Data Editor save, `player_bio`, an award dataset, nor any direct SQL. The
  F-002 emulations in `match-results-promotion.test.ts` still emulate an **ungated** writer (D-265-11), and the
  ISSUE-261 recompute contention is a separate open issue. Nothing here retires the original deadlock for any of
  those paths.
- **Not done, so the issue stays open:** the regression window (§22.6), DEV acceptance (§18.2 step 6), the
  operator's commit, `merge:ready`, and any PROD action. The code under test was uncommitted (HEAD `62f2cd67`);
  the manifest identifies it by hash only.
- **Not shown:** behaviour on a faster or slower link (B2 and B9 can end INCONCLUSIVE, §21.6), State B, or real
  settle and promotion durations on PROD (D-265-5: PROD records cannot validate the 300 s figure).
- The harness evidence file stores truncated outcome strings; the full logs are the record.

### 23.4 Correction to the active Phase B probe (wording only)

`D:\tmp\issue265\issue265-db-probe-b.mjs` printed, in its migration-state check, "Phase A does not need migration
110 ... (runbook §17.10)", a Phase A sentence inherited when the probe was derived. The two `log(...)` strings now
read "Phase B neither applies nor requires migration 110: this check records the migration state and never changes
it." and "The Phase B window of 2026-10-05 passed in State A (110 not applied); see runbook §23." No check,
condition, constant or other line changed. The §17.10 reasoning was Phase A's and is not asserted for Phase B.

| | SHA-256 | Bytes |
|---|---|---:|
| Before (equals the hash the run's manifest recorded) | `10c97a9185216267049a94d930ab2100d516cf74ba4a93640f946cf079e00a6a` | 52139 |
| After | `6dbdca25bdd2f9014bcfcf8cd03b59e6446393c239691189c67ff4546187df7b` | 52130 |

`node --check` exits 0 and the probe self-test passes 23/23 (no database contact). The 2026-10-05 run's manifest
therefore names the **before** hash, and the file now on disk differs from it by those two strings. That manifest
and the rest of the run folder were not touched. The archived Phase A tooling was not touched. The same sentence
remains in the archived Phase A runner and probe (`Invoke-Issue265PhaseA.ps1`, `issue265-db-probe.mjs`), by D-265-15.
The other Phase A mentions in the Phase B probe are comments (the derivation note in its header, the `readOnly()`
note near line 296 and the recompute-fingerprint note near line 490) and were left alone.

### 23.5 Next: the regression window (`D:\tmp\issue265\Invoke-Issue265Regression.ps1`), operator-run

It runs the full `settle-afltables` suite (76) and `match-results-promotion` (32), `datasets` (16) and
`submission-promotion` (7) in that order after **applying migration 110 to `afldb_test`** and, always, rolling it
back. It is a separate launch from Phase B. Run from any directory, one step at a time, and stop at the first
refusal.

```powershell
# 1. offline, no database contact, no settings file read: provenance + preconditions
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265Regression.ps1 -Phase Static
# 2. read-only against afldb_test: targets, window preflight (writes a capture), baseline
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265Regression.ps1 -Phase Preflight -TunnelHost 127.0.0.1 -TunnelPort 55432
# 3. the window: applies 110, four suites with a census after each, then ALWAYS the rollback of 110
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265Regression.ps1 -Phase Full -TunnelHost 127.0.0.1 -TunnelPort 55432
```

**Expected from Static** (new folder `D:\tmp\issue265\run-<stamp>-Regression-Static\`): `provenance: 171 files hashed`
(prepared manifest sha256 `9a30caa63616db1a566094a50c0ed443cb0090879d2faf0f390005679119ab13`; it repeats exactly
only if no hashed file changed since §22.5, and a different value is not a failure by itself but must be
explained), four `provenance: suite ...` lines, `preconditions OK`, `provenance recheck: 171 files unchanged ...`,
`migration 110 applied by this run: False`, `restore: not applicable (migration 110 was never applied by this run)`,
`OVERALL: PASS`. The Phase B probe edit is not in this manifest (the runner hashes its own probe, not probe-b). No
`.env` is in the worktree (checked).

**Expected from Preflight** (folder `...-Regression-Preflight\`, with `capture.json` and `baseline.json`): the same
provenance lines; `TARGETS OK: every connection is afldb_test, at the expected endpoint, one server, intended
roles.`; `ISOLATION OK`; `MIGRATION STATE OK: 109
applied (newest 109), exactly [110_match_sheet_player_match_stats_authority.sql] pending, State A, zero
player_match_stats authority`; `captured: ledger 109 rows ...` with `data_overrides 92 rows` (as in the Phase B
baseline); `BASELINE OK` with every `residue` line 0, including the 21 new `settle_*` counts; `import_batches max id
1268`; `OVERALL: PASS`; `restore: not applicable`. Phase B's rows are absorbed into the baseline: its season 2078
and namespaces are disjoint from the 2093/2094 and ISSUE-264 residue the probe counts. The `absorbed
import_batches` lines list only `match_results`, `player_match_stats` and `player_bio`, so the `match_attendance`
batch 1268 is not listed (informational; the probe's explained-target list omits it and it still sits inside the
baseline ceiling). A `DIRTY`, `REFUSED` or `STOPPED` result means do not run Full.

**Expected from Full:** after the preflight and baseline steps, `02-migrate-status` reports exactly one pending
migration (110); an isolation re-check; migration 110 applied by `tools/db/migrate.ts --target test`; `STATE B OK`;
then exactly **32, 16, 7 and 76** passed, **zero skipped, zero failed**, each followed by a clean census; no build
(off unless `-WithBuild`); then the restore; final `restore: RESTORED and census clean`, `migration 110 applied by
this run: True`, `OVERALL: PASS`. The duration is unmeasured (the 11-test Match Sheet block alone took 175 s over
the tunnel); each suite has a 90-minute watchdog (`-SuiteTimeoutMinutes`, 10 to 240).

**Migration 110 after a failure or interruption (read from the runner and `issue265-regression-window.mjs`).**
- The runner records "110 applied" only after `STATE B OK`. From then, **every** stop (a failed or timed-out suite,
  a count or skip drift, a dirty census, a build failure) runs the restore in a `finally`: pre-restore census, then
  ONE rollback transaction (`ACCESS EXCLUSIVE` on `data_overrides`, 10 s `lock_timeout`, 60 s `statement_timeout`)
  that first re-proves isolation, State B and **zero `player_match_stats` authority rows (active or inactive)**,
  then restores the captured CHECK, comment and ledger, verifies the result equals the capture inside the
  transaction, and commits; then a read-only `verify-restored` against the capture and a final census. Anything
  short of `RESTORED and census clean` exits 1 and says so.
- **The rollback refuses, by design, and never deletes authority.** If a failed suite left an authority row, 110
  stays applied, the runner records the exact state (`92-state-after-failed-rollback`) and stops database work. That
  is an operator decision, not an automatic repair.
- **If applying 110 leaves an unverifiable state** (neither State A nor State B verifies), no automatic restore runs:
  the runner records `UNKNOWN`, logs the state and stops.
- **Interruption (Ctrl+C, closed console, killed process, tunnel drop):** a PowerShell `finally` normally runs on
  Ctrl+C, but that was not tested here and nothing runs after a killed process or a lost tunnel, so treat the
  restore as **not guaranteed**. Recover with the capture taken during the window preflight, before 110 was applied:
  ```powershell
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265Regression.ps1 -Phase Restore -TunnelHost 127.0.0.1 -TunnelPort 55432 -CaptureFile D:\tmp\issue265\run-<stamp>-Regression-Full\capture.json -BaselineFile D:\tmp\issue265\run-<stamp>-Regression-Full\baseline.json
  ```
  `-Phase Restore` runs the restore steps only. If the database is in fact still State A, the rollback guard refuses,
  nothing changes, `92-state-after-failed-rollback` shows the state, and the run reports a failed restore: that
  outcome is harmless and means no restore was needed. Leftover sessions from a killed run must have closed first,
  because the guard needs isolation. Without `-BaselineFile` the census proves only zero residue.

### 23.6 State

ISSUE-265 **stays open**. Done: mitigation implemented (uncommitted), Phase B 11/11 on `afldb_test`. Pending: the
operator's commit, the regression window (§23.5), `merge:ready`, DEV acceptance (§18.2), PROD. No source or test
file in the repository was changed by this pass; the changes are this section, `issues.md`, `IssuesIndex.md`,
`CHANGELOG.md`, and the two probe strings in §23.4.

## 24. Regression window: FAILED twice (dirty census); cause confirmed; correction and cleanup prepared (2026-10-06)

Authorisation for this pass: reading saved evidence and local offline work only. **No database was contacted by the
agent, no Git command mutated anything, nothing was deployed, no cleanup was run, and no evidence file or baseline was
edited.** The diagnostic in §24.3 was operator-run and read-only. The code and tooling changes below are uncommitted.

### 24.1 The two regression windows (both kept as failed; neither verdict is changed)

| | Window 1 | Window 2 |
|---|---|---|
| Evidence (outside Git, unchanged) | `D:\tmp\issue265\run-20261005-231059-Regression-Full\` | `D:\tmp\issue265\run-20261006-052853-Regression-Full\` |
| Time (local, +11:00) | 2026-10-05 23:10:59 to 23:22 | 2026-10-06 05:28:53 to 05:40:23 |
| Suites | 32/32, 16/16, 7/7, 76/76 passed; the first three post-suite censuses CLEAN | identical |
| Census after `settle-afltables` | **DIRTY** (exit 3): `settle-afltables.ts / staging.source_record_versions x3: UNEXPLAINED` | **DIRTY**, same |
| Migration 110 | applied, rolled back, verified against the capture (`91-rollback`, `92-verify-restored`) | same |
| Provenance | 171 files unchanged | 171 files unchanged |
| Verdict | `STOPPED - check after tests/integration/settle-afltables.test.ts is dirty`; final census dirty | same |

Window 1 was **not recorded when it happened**, and window 2's baseline silently absorbed window 1's three leftovers: the
`absorbed import_batches` list names only admin-upload targets, and the baseline fingerprint (270 to 309 rows, +39 = 15 +
2 + 19 + 3) took them in. `BASELINE OK` therefore did not mean "no earlier unexplained batches". ISSUE-265 stays open and
**regression acceptance is outstanding**.

### 24.2 Cause

`tests/integration/settle-afltables.test.ts`, S6 block (`LABEL_S6 = 'issue122-s6-cli'`): the CLI owns its transaction, so
each of its three `--apply --auto-apply` runs commits a real `import_batches` row (notes `AFLDB-ISSUE-099 settle;
snapshot=issue122-s6-cli; season=2093; mode=apply`). `cleanup122` deleted only `notes LIKE '%issue122-apply-test%'`, so
those rows were never removed although the S6 header claims it is "torn down by the same cleanup". The probe's residue
predicate is the `SELECT count(*)` twin of the suite's DELETEs, so it had the **same blind spot**: residue was zero while the
batches survived, and only the unexplained-batch rule caught them. The census was right. My §22.6 review read the 54
DELETEs for scope but not for coverage of what the suite creates, and missed this.

### 24.3 Operator diagnostic (read-only, 2026-10-06 07:55 +11:00)

Evidence: `D:\tmp\issue265\diag-s6-batches-20261005-205549\` (`diagnostic.txt`, `diagnostic.json`, sha256 of the JSON
`09ea147e…1619`), run with `D:\tmp\issue265\issue265-batch-ownership-diagnostic.mjs` (sha256 `6d46f5f1…0850`).

- 18 `settle-afltables.ts` batches exist and **all 18 are S6-labelled**; no other settle batch exists.
- **Six belong to the failed windows:** 1339, 1340, 1341 (window 1) and 1477, 1478, 1479 (window 2). Each triple has
  `canonicalRowsInserted` 6, 0, 1, matches the S6 test's three applies, and sits inside its window by timestamp.
- **Twelve are historical** (all 2026-10-03): 66, 67, 68; 325, 326, 327; 543, 544, 545; 639, 640, 641. Same signature.
- Probe residue predicate and suite cleanup matched **0 of 18**. S6 spine remnants: 0 versions, 0 records, 0 matches in 2093.
- **Every one of the 38 foreign keys into `import_batches`, and every batch-named column, counts 0** for the S6 batches.
- Server: postmaster started 2026-10-01 17:49:57 +10, so **no restart** during either window.

**Unexplained, recorded without a cause.** (a) The id gaps: the match-results suite consumed 35 ids in window 1 but 100 in
window 2 for the same 34 retained rows (a 65-id gap, 1341 to 1407); the settle suite shows a 32-id gap before S6 in both. (b) The id
sequence `last_value` is **1544** while the highest existing batch id is 1479 (another 65). Nothing was reset by anyone
and nothing here depends on it. Candidates (a sequence skip, activity on `afldb_test` outside the window) are unverified.

### 24.4 Correction (uncommitted)

| Change | Where | What it does |
|---|---|---|
| Suite teardown | `tests/integration/settle-afltables.test.ts` | `cli()` records each batch id its call committed in `s6CommittedBatchIds`, including a batch committed by a call that then throws (id high-water mark plus exact notes; review F-002). `cleanup122` deletes `id = ANY(recorded) AND tool AND target_table AND status='completed' AND notes = <exact S6 notes> RETURNING`, after every statement that deletes a row citing a batch, and throws after the season cleanup if it removed fewer than it recorded. **No label DELETE**, so the twelve historical batches are untouched. |
| Pin tests | `tests/match-sheet.test.ts` ("ISSUE-265 S6 batch teardown") | six database-free tests pin the above; a deliberate switch to a label DELETE makes two fail. 85/85 pass in the file. |
| Probe | `D:\tmp\issue265\issue265-regression-probe.mjs` | an S6 census (every S6-labelled and every other `settle-*` batch, with each row's md5) at the baseline and at every check; the baseline accepts only the twelve pinned rows and **refuses** otherwise, a check refuses any new, missing or changed S6 row; ids are recorded for any new non-promotion batch. `s6-selftest` 12/12, no database. |
| Exception (proposed) | `D:\tmp\issue265\s6-historical-exception.json` | the twelve rows pinned field by field from the diagnostic; **shipped unapproved** (`approved:false`), so the probe fails closed until the operator sets `approved`, `approvedBy`, `approvedOn`. It can never pin the six cleanup ids. `rowMd5` ships null; `--mode verify` prints the twelve values to copy in, after which the probe enforces them. |
| Runner | `D:\tmp\issue265\Invoke-Issue265Regression.ps1` | four new suite markers (an unfixed suite is refused before any database contact), the exception file in the provenance manifest, and the probe self-test inside the Static phase. |
| Cleanup tool | `D:\tmp\issue265\issue265-s6-cleanup.mjs` | see §24.5. Not run. |

The pre-fix probe and runner are archived **unchanged** in `D:\tmp\issue265\archive-pre-s6-fix\` (probe `a97c105d…8de8`,
runner `7676d628…1965`), equal to the hashes in both failed runs' manifests. Final hashes: suite `0a4ed9b2…7196`, probe
`35495179…79e3`, runner `66398224…3c64`, exception `582f4664…c452`, cleanup tool `2c101821…5899`. The original baselines and
the diagnostic are untouched.

### 24.5 Cleanup tool (operator-run; default is a read-only Plan)

Removes **exactly** ids 1339, 1340, 1341, 1477, 1478, 1479 and nothing else. Guards: `afldb_test`, `afldb_owner`, the
tunnel endpoint (host, port and database rewritten from `AFLDB_TEST_DATABASE_URL`), isolation (no other open transaction,
lock or prepared transaction), no non-internal trigger or rule on `import_batches`, the six rows equal the diagnostic's
values field for field, the S6 census is exactly the six plus the twelve pinned, no other settle batch, and no foreign key or
batch-named column cites any of the six. **Execute**, in one transaction: lock `FOR UPDATE`, re-run every guard, save the
complete rows and fsync, issue the one DELETE (id, tool, target, status, exact notes; `RETURNING`), require exactly six rows
equal to the saved ones, require (still inside) every other batch byte-identical (count and hash sum), the twelve historical
rows unchanged, 22 core-table counts unchanged and the id sequence unchanged, then commit. Anything else rolls back. It
never resets a sequence and issues no other write (the self-test scans its own source for that). **Verify** (read-only)
proves the six are gone, the twelve unchanged, every other batch identical to the saved pre-state, and that the two failed
windows' saved baselines are **explained by exactly these removals**: window 1's baseline (270 rows, ids <= 1268) is
reproduced exactly, and window 2's (309 rows, ids <= 1341) equals the current table plus the three removed window-1 rows,
by exact BigInt arithmetic on the stored hashes. The failed runs' baselines are read, never replaced.

```powershell
& "C:\Program Files\nodejs\node.exe" D:\tmp\issue265\issue265-s6-cleanup.mjs --selftest   # no database
& "C:\Program Files\nodejs\node.exe" D:\tmp\issue265\issue265-s6-cleanup.mjs              # PLAN (default, read-only)
& "C:\Program Files\nodejs\node.exe" D:\tmp\issue265\issue265-s6-cleanup.mjs --mode execute --execute-confirmed --confirm DELETE-S6-BATCHES-1339-1340-1341-1477-1478-1479
& "C:\Program Files\nodejs\node.exe" D:\tmp\issue265\issue265-s6-cleanup.mjs --mode verify
```
Exit codes: 0 ok; 2 refused or error; 3 Execute outcome UNKNOWN (COMMIT sent, not answered: run Verify first); 4 committed but
the post-commit Verify failed. Each run writes a new folder `D:\tmp\issue265\s6-cleanup-<mode>-<stamp>\`.

### 24.6 Offline checks (no database)

`node --check` on every `.mjs`; PowerShell parse 0 errors; cleanup tool `--selftest` **16/16** against an in-memory fake (plan
makes no write or lock; execute deletes only the six and saves them before the delete; a delete that returns five rows, a
moved core table and a touched other batch each roll back completely; every guard refuses before any delete; COMMIT
unanswered is UNKNOWN; a post-commit evidence-write failure still reports COMMITTED; the 180 s delete timeout is restored;
more than 200 batch columns refuses; the baselines are explained). Mutation checks on a copy: a widened or id-less DELETE, a
dropped status predicate, a dropped core-table, other-batch or reference check, a late save and a dropped confirmation are
each caught; one (dropping only the returned-row count) is not, because the exact-id-set and row-total checks still roll it
back. Probe replay against the real diagnostic rows: refuses exactly the six at baseline now, passes the cleaned twelve,
names three NEW rows for a window that ran the old suite. Typecheck exit 0; ESLint `--max-warnings 0` clean on both test
files. `-Phase Static`: `run-20261006-082255-Regression-Static`, PASS, 172 files, manifest `92cb3011…9b7f`.

### 24.7 Independent review (afldb-reviewer, read only, no execution)

No CRIT and no HIGH. It judged deletion scope, locking and races, historical-row preservation and the baseline arithmetic
**sound**. Findings and disposition:

| ID | Grade | Finding | Disposition |
|---|---|---|---|
| F-001 | MED | a post-commit evidence-write or baseline-load failure would exit "error" with no COMMITTED record | **Fixed:** baselines are loaded before any connection; COMMITTED is logged first; evidence-write failures warn |
| F-002 | MED | `cli()` recorded the id only after `runSettleCli` returned; its post-commit report can throw | **Fixed** (suite and pin test) |
| F-003 | LOW | 30 s statement timeout vs about 222 sequential-scan foreign-key checks in the one DELETE (those columns are deliberately unindexed, migration 044) | **Fixed:** 180 s for that statement, then restored to 30 s |
| F-004 | LOW | watchdog hard-exit mid-transaction wrote no outcome | **Fixed:** 900 s, writes `WATCHDOG_EXIT` |
| F-005 | LOW | header's UNKNOWN definition contradicted the correct code; UNKNOWN shared exit 2 | **Fixed:** header corrected, UNKNOWN exits 3 |
| F-006 | INFO | `LIMIT 80` truncated the batch-column list silently | **Fixed:** refuses above 200 |
| F-007 to F-009 | INFO | transient refusal on an autovacuum worker or unobservable session; hashes depend on session TimeZone (do not alter role settings before the run); "ROLLED BACK" can precede a dead tunnel's backend aborting (a re-Execute inside 120 s refuses on `lock_timeout`) | none required; recorded for the operator |

Not verified by the reviewer: the driver's typing of `$1::bigint[]` (the Plan run executes the same parameterised reads
first, read-only) and `afldb_owner`'s `pg_read_all_stats` membership (a transient refusal either way).

### 24.8 State

ISSUE-265 **stays open**. Done: mitigation implemented (uncommitted), Phase B 11/11, root cause of both failed regression
windows confirmed, suite and probe corrected, cleanup tooling prepared and independently reviewed. **Not done:** the cleanup (not
run), the operator's commit, a clean regression window (acceptance outstanding), `merge:ready`, DEV acceptance, PROD.
**Do not run a third Full window before the cleanup**: each leaves three more batches and the next baseline would refuse.

Next, in order, operator-run: (1) review and commit the repository changes (the suite and `tests/match-sheet.test.ts`);
(2) run the cleanup Plan and read it; (3) Execute once, then Verify, and keep the folders; (4) copy the twelve `rowMd5`
values Verify printed into `s6-historical-exception.json` and set `approved`, `approvedBy`, `approvedOn` (the operator's
decision); (5) `-Phase Static`, `-Phase Preflight` (its baseline must show the twelve historical ids and `BASELINE OK`),
then `-Phase Full` (§23.5). Changed paths this pass: in the repository, `tests/integration/settle-afltables.test.ts`,
`tests/match-sheet.test.ts`, this section, `issues.md`, `IssuesIndex.md`, `CHANGELOG.md`; outside it, the files listed in §24.4
and §24.5 under `D:\tmp\issue265\`.

### 24.9 Cleanup executed and verified (operator-run, 2026-10-06 08:28 +11:00)

**Status: COMMITTED; post-commit VERIFY PASSED.** Recorded from the saved evidence only; nothing was re-run and no database was contacted.

| Evidence | Path |
|---|---|
| Plan (read-only, before) | `D:\tmp\issue265\s6-cleanup-plan-20261005-212824\` |
| Execute | `D:\tmp\issue265\s6-cleanup-execute-20261005-212854\` (`log.txt`, `execute-result.json`, `rows-before-delete.json`, `rows-deleted-returning.json`) |
| Verify (read-only, after) | `D:\tmp\issue265\s6-cleanup-verify-20261005-212854-after-execute\` (`verify.json`: `problems: []`) |

- **Target:** `afldb_owner@127.0.0.1:55432/afldb_test`. Isolation OK (0 other sessions, no lock). No non-internal trigger or
  rewrite rule on `import_batches`. Postmaster unchanged (started 2026-10-01 17:49:57 +10).
- **Deleted, one transaction:** exactly ids 1339, 1340, 1341, 1477, 1478, 1479 (six rows returned, each equal to its saved row).
  S6 census before: 18 batches = the six + the twelve pinned (scope guard OK). 38 foreign key / batch-column checks, 0 citations.
- **State change:** `import_batches` 348 rows (max id 1479) to **342 rows (max id 1444)**; id sequence `last_value` **1544
  unchanged** (not reset). The 342 other rows are byte-identical before and after (hash `-167730445606291829766`); 15 core
  tables equal window 2's saved baseline (22 compared in-transaction, all unchanged).
- **Historical twelve present and unchanged:** 66, 67, 68, 325, 326, 327, 543, 544, 545, 639, 640, 641. Their `row_md5` values
  are identical in the Plan and in the post-commit re-read.
- **Failed windows explained, not replaced:** window 1's baseline (270 rows, ids <= 1268) is reproduced exactly; window 2's
  (309 rows, ids <= 1341) = the current 306 rows + exactly the three removed window-1 batches; batches in (1341, 1479] equal
  window 2's final census minus its three settle batches (15 + 2 + 19 admin-upload rows).
- **Both failed regression verdicts (`run-20261005-231059-Regression-Full`, `run-20261006-052853-Regression-Full`), the diagnostic,
  the archived pre-fix probe and runner, and every original baseline are untouched.**

**Exception file prepared, still unapproved.** `D:\tmp\issue265\s6-historical-exception.json` now carries all twelve `rowMd5` values
(copied from the Execute log's post-commit read, cross-checked against the Plan's `row_md5`; `approved: false`, `approvedBy` and
`approvedOn` null). Its hash therefore changed from the §24.4 value `582f4664…c452`; the next manifest records the new one.

| id | rowMd5 | id | rowMd5 |
|---|---|---|---|
| 66 | `8e7f477cd552048e34e2167a2ff9e593` | 543 | `94839d1ff5ec3c28bf989e6f3ed03da8` |
| 67 | `27eabc8c105682a8aecde90f1265464c` | 544 | `1c2443e52104d2b4f7daf9a4e9bf625c` |
| 68 | `461beefb08b8077baa917a5cdcf9fcb5` | 545 | `d8f6dc01d11b82ee37b98b2d6f7423cf` |
| 325 | `95e66e634e1636ad795eabc43a0e7f3b` | 639 | `97d9b77413551d639d2c787c6d534800` |
| 326 | `c29467ed738ab44c6877a5437b6f6e11` | 640 | `53ad6f9aca2b3cd3063a3bf210e7c039` |
| 327 | `6bdfda15dbafd9a137bb6e210a56a879` | 641 | `5985b534342372a8f8fb05f7664fd17f` |

**Probe self-test corrected (tooling, not evidence).** `s6-selftest` case 1 asserted the *shipped* file had `rowMd5` null and was
unapproved with exactly three problems, so filling `rowMd5` (and, later, the operator's approval) would have failed the Static
phase. It now accepts a null or md5-hex `rowMd5` and either state: unapproved with exactly the three approval problems, or approved
with none. No enforcement logic (`s6ValidateException`, `s6Evaluate`) changed. The probe's hash changed from §24.4's `35495179…79e3`;
**the self-test was re-run afterwards (2026-10-06, local, no database): `s6-selftest: 12/12 passed`, exit 0**, with the exception
file as it now stands (unapproved, twelve `rowMd5` filled). A separate offline check confirmed every `rowMd5` equals both the
Execute log's post-commit value and a value in the Plan's `plan.json` (12 of 12, 0 mismatches).

**How the probe uses the exception.** At baseline it requires the live S6/settle census to equal the approved exception row for
row: an unapproved file, a failed-window id (1339-1341, 1477-1479), a row count other than twelve, a different tool, target,
status or notes, or a blank approver each refuse; a live row not pinned is **additional**; a pinned id absent is **missing**; any
field or `rowMd5` that differs is **changed**. At every later check it requires the census to equal the baseline's stored census
(ids and row md5): new, missing and changed rows are each named and each makes the check DIRTY.

**State.** Cleanup **verified**. Outstanding: the operator's approval of the exception (`approved`, `approvedBy`, `approvedOn`),
the commit, and a fresh regression window (`-Phase Static`, `-Phase Preflight` whose baseline must
show the twelve historical ids and `BASELINE OK`, then `-Phase Full`). ISSUE-265 stays open; regression acceptance is outstanding.

### 24.10 Historical exception APPROVED; Static re-run PASS (2026-10-06 08:46 +11:00)

*Supersedes the "unapproved" statements in §24.4 and §24.9, which stay as the record of their time.*

- **Approval (operator):** `s6-historical-exception.json` now has `approved: true`, `approvedBy: "Stu"`, `approvedOn:
  "2026-10-06T08:46:18.9124732+11:00"`, and a `status` of `APPROVED - retain exactly the twelve pinned historical S6 rows
  unchanged; no additional or changed rows permitted.` The operator edited the approval fields and `status` only.
- **Pins unchanged:** the twelve ids (66, 67, 68, 325, 326, 327, 543, 544, 545, 639, 640, 641) and `pinnedIds` are as before,
  and **all 12 rows x 14 fields (the 13 row fields plus `rowMd5`) equal the saved Plan's rows: 0 differences**. Every
  `rowMd5` also equals the Execute log's post-commit value. `schema` 1, `label` `issue122-s6-cli`.
- **`s6-selftest` against the approved file:** **12/12 passed**, exit 0, no database contact. Case 1 now takes its approved branch
  (zero problems).
- **Static phase (offline, no settings read, no database contact):** `run-20261006-084649-Regression-Static`, **OVERALL: PASS**.
  172 provenance files hashed and unchanged on re-check; manifest sha256 `aa12433b…7714`; `preconditions OK`; the runner's
  own `s6-selftest` passed. Evidence: `D:\tmp\issue265\run-20261006-084649-Regression-Static\`.

| File | Current SHA-256 (also in that manifest) | Earlier value (historical, §24.4) |
|---|---|---|
| `s6-historical-exception.json` | `1878c54544362ac6061abb6e048db5e3cf2016f9efa81947a07511adfa945ff7` | `582f4664…c452` (as shipped); the unapproved, `rowMd5`-filled state was not hashed |
| `issue265-regression-probe.mjs` | `a5ee5aa44d822b733df39eaecf0ea4b8cee5f231ba0154a6a7f6c44fde7cb698` | `35495179…79e3` (before the case-1 edit); pre-fix `a97c105d…8de8` archived |
| `Invoke-Issue265Regression.ps1` | `66398224eba2c30d0b759f761b5f2c5eeda0d706b067cdc882505a86d3aa3c64` | `66398224…3c64` (unchanged) |
| `issue265-s6-cleanup.mjs` (executed tool) | `2c10182199f245e7258a1ad9d275ffb9f378747e15828985f8868e09be315899` | `2c101821…5899` (unchanged; not regenerated) |

**State.** Cleanup committed and verified; exception **approved**; Static **PASS**. Still pending: the operator's commit and
**fresh regression acceptance** (`-Phase Preflight`, whose baseline must show the twelve historical ids and `BASELINE OK`, then
`-Phase Full`). No Full window has run since the cleanup. ISSUE-265 **remains open**.

## 25. Regression window PASSED (operator-run 2026-10-06 08:56 +11:00); build-only phase prepared (2026-10-06)

*Supersedes "No Full window has run since the cleanup" in §24.10 and "no regression window has run" in §0; both stay as the
record of their time.* Recorded from the saved evidence only. **No database was contacted by the agent, no Git command mutated
anything, nothing was deployed, no integration suite was re-run, migration 110 was not applied, and no evidence file or
baseline was edited.** The one Static run in §25.5 is offline.

### 25.1 Result

Evidence (outside Git, read and left unchanged): `D:\tmp\issue265\run-20261006-085603-Regression-Full\` (`summary.txt`,
`00-derive` to `93-final-check` logs, `capture.json`, `baseline.json`, the per-suite `*-check.json`, `provenance-manifest.json`,
`provenance-recheck.txt`). `-Phase Full`, target `afldb_owner@127.0.0.1:55432/afldb_test`. **`OVERALL: PASS`.**

| Step | Result |
|---|---|
| Preflight (read-only) | isolation OK (0 other sessions); 109 applied, exactly `110_match_sheet_player_match_stats_authority.sql` pending; State A; zero `player_match_stats` authority; captured ledger 109 rows, CHECK 13 literals, comment 358 chars, `data_overrides` 92 rows |
| Baseline (read-only) | `BASELINE OK` with the twelve approved S6 rows (taken 2026-10-05T21:56:07Z); `import_batches` 342 rows, max id 1444 |
| Migration 110 | applied by the repository runner (241 ms); State B verified (ledger equals capture plus 110; CHECK equals the captured literals plus `player_match_stats`, validated; zero authority rows) |
| `match-results-promotion` | **32/32** passed (168 s); post-suite census clean |
| `datasets` | **16/16** passed (3.4 s); clean |
| `submission-promotion` | **7/7** passed (9.8 s); clean |
| `settle-afltables` (full) | **76/76** passed (455 s), none skipped; clean |
| Restore | pre-restore census clean; guarded rollback of 110 only (isolation OK; CHECK, comment and ledger reversed); `92-verify-restored`: ledger, CHECK definition, comment and validation flag equal the capture, zero authority rows |
| Final census (2026-10-05T22:07:07Z) | **CLEAN**: historical fingerprints equal the baseline, all 35 residue counts 0, retained `fixture_auth_users` 2 and `sports_data_lab_source` 1 (by design) |
| Provenance | 172 files hashed before any database contact; **172 unchanged** at the end (`provenance-recheck.txt`); manifest sha256 `aa12433b89a2a008ec074870735942d4f912cc1b843292cf16f5594a7be07714` |

Every post-suite census (06, 07, 08, 09), the pre-restore census and the final census read `CLEAN`. Suite files were the
fixed ones: `settle-afltables.test.ts` sha256 `0a4ed9b2…7196`, `match-results-promotion.test.ts` `2c9cf090…7eeb`,
`datasets.test.ts` `fa218d2c…2442`, `submission-promotion.test.ts` `fc5360b1…5a79` (all equal to the Static manifests).

### 25.2 The S6 census and the retained batches (what the §24 fix was for)

- **S6 census unchanged since the baseline at every check**, 12 rows: 66, 67, 68, 325, 326, 327, 543, 544, 545, 639, 640, 641.
  The probe compares each row's `row_md5` as well as its id; the census reported no new, missing or changed S6 row. **No new
  S6 residue**: the corrected S6 teardown (§24.4) removed the three batches it committed, and the probe saw none.
- **36 new `import_batches` rows were retained, all `admin-upload`, all explained** as append-only promotion batches by the
  probe: 15 `match_results`, 2 `player_bio`, 19 `player_match_stats` (15 + 2 + 19 = 36). They exist by design: the promotion
  suites promote real submissions and the importer never deletes a batch. After the run `import_batches` max id is **1582**
  (baseline 1444). The id values are not contiguous with the row count (1445 to 1582 is 138 values for 36 rows); this is the
  same unexplained id-gap pattern already recorded in §24.3 (a), and **no cause is claimed**. The id sequence `last_value` was
  not re-measured in this window.
- The 342 baseline rows are byte-identical (the final fingerprint equals the baseline's: `n` 342, hash `-167730445606291829766`).

### 25.3 What is preserved (nothing replaced)

Both earlier failed verdicts stand as recorded: `D:\tmp\issue265\run-20261005-231059-Regression-Full\` and
`D:\tmp\issue265\run-20261006-052853-Regression-Full\` (§24.1, both **DIRTY**). The diagnostic (`diag-s6-batches-20261005-205549`),
the cleanup Plan, Execute and Verify folders (§24.9), the archived pre-fix probe and runner (`archive-pre-s6-fix\`), and every
original baseline are untouched. This window's own `baseline.json` is a new baseline for a new window; it replaces nothing.

### 25.4 What this does and does not show

**Shown:** the four affected integration suites pass in full against `afldb_test` with migration 110 applied (State B), the
corrected S6 teardown leaves no residue, the historical rows and the twelve S6 batches are unchanged, and migration 110 was
restored and verified against the capture. The regression window the plan required (§18.2 step 4, §22.6) is **satisfied**.
**Not shown, and not claimed:** the build; DEV behaviour; PROD; protection against writers that do not take the gate (Match
Sheet and Data Editor saves, `player_bio`, the award datasets, direct SQL; §23); the unexplained id-gap and sequence anomalies
(§24.3). `afldb_test` is left in State A (migration 110 not applied), as before the window.

### 25.5 Build-only phase prepared (not executed)

The regression runner could only build inside a Full window (apply 110, run the four suites, then `npm run build`). Rerunning
that to obtain a build is not wanted, so the runner now has a **`-Phase Build`**. Inspection of the build path:

- `npm run build` is `next build --webpack && node tools/build/prepare-standalone.mjs`. `prepare-standalone.mjs` makes **no
  database contact** (it copies assets and refuses to ship a `.env*`).
- The database is touched by **prerendering**: eight async `generateStaticParams` functions (`players/[slug]`, `clubs/[slug]`,
  `seasons/[year]`, `matches/[id]`, `venues/[slug]`, `awards/[slug]`, `brownlow/[year]`, `honour-teams/[slug]`; the `records`
  one is synchronous) and the prerendered pages themselves read through `src/db/client.ts`, which throws if `DATABASE_URL` is
  unset. During a build it opens a pool of 2 per prerender worker (`NEXT_PHASE=phase-production-build`) with
  `statement_timeout` 5 s. These are application read paths; the build issues no write of its own, and `afldb_app` holds
  read-only grants. The earlier ISSUE-264 builds as `afldb_app` on `afldb_test` (e.g. `run-20261004-202018`) generated
  1,515 pages with 19 workers in about 13 s and passed.
- The worktree has no `.env`, so `DATABASE_URL` comes only from the runner's process environment. Build output (`.next/`,
  `next-env.d.ts`, `*.tsbuildinfo`) is gitignored.

`-Phase Build` runs the runner's existing read-only gates first (provenance manifest, preconditions including the S6 self-test,
every `*DATABASE_URL` in the session cleared, all four roles derived to the tunnel endpoint and proved to target `afldb_test`
under the intended role including **`afldb_app`**, isolation, State A, capture, a baseline that refuses residue and any
unapproved S6 row), then runs **only** `npm run build` with `DATABASE_URL` set to the derived `afldb_app` URL, clears it, and
compares a post-build census with the baseline. It applies no migration, runs no suite, writes nothing to the database, and
needs no restore. Redaction, environment restore and the provenance re-check are unchanged.

| File | SHA-256 |
|---|---|
| `D:\tmp\issue265\Invoke-Issue265Regression.ps1` (now, with `-Phase Build`) | `a8797920804b65e526e1875ef8731fe01692a78524d023e3b396086476379d69` |
| `D:\tmp\issue265\archive-pre-build-phase\Invoke-Issue265Regression.ps1` (the runner as it was for the PASS in §25.1, unchanged) | `66398224eba2c30d0b759f761b5f2c5eeda0d706b067cdc882505a86d3aa3c64` (equal to the §24.10 value) |

The change is three edits (the `ValidateSet`, one `$SkipBuild` line, one phase block) plus a header note. Offline checks:
PowerShell parse **0 errors**; `-Phase Static` `D:\tmp\issue265\run-20261006-091157-Regression-Static\` **OVERALL: PASS**
(172 files hashed and unchanged, manifest sha256 `aa11c52d…0ebc4`, which differs from §24.10's `aa12433b…7714` as expected
because the runner is hashed into it; the four suite hashes are identical; `s6-selftest` passed). The probe, the exception file and the window helper are unchanged.
One tool-hook artefact: writing the runner's step title text (a `DATABASE_URL` arrow followed by `afldb_test`) made the hook
create a zero-byte file named `afldb_test` at the repository root; it was removed (it was this pass's own file). Three older
zero-byte strays remain untracked (§25.7).

**Operator-run command** (the SSH tunnel to `127.0.0.1:55432` must be up; nothing else is needed):

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\tmp\issue265\Invoke-Issue265Regression.ps1 -Phase Build -TunnelHost 127.0.0.1 -TunnelPort 55432 -BuildRole app
```

Expected: a new folder `D:\tmp\issue265\run-<stamp>-Regression-Build\`; `build role: app`; `01-preflight` ISOLATION OK and `MIGRATION STATE
OK` (State A, 110 pending); `BASELINE OK` listing the twelve S6 ids; `30-build` exit 0 with `Generating static pages ... (1515/1515)`
(the count may differ with the data) and `prepare-standalone: standalone bundle ready`; `30-build-check` CLEAN; `npm run build: exit 0,
check clean`; `OVERALL: PASS`; `restore: not applicable`; `provenance recheck ... unchanged`. A refusal or STOPPED before `30-build`
means the build never ran and nothing was written. Afterwards read-only `git status` should show no new tracked change.

### 25.6 State

ISSUE-265 **stays open**. Done: mitigation implemented, Phase B 11/11, root cause of the two failed windows fixed and cleaned up,
**regression window PASSED**. Pending, in order, operator-run: (1) review and commit (§25.7); (2) the build-only command above
(**since run and PASSED, §25.8**); (3) `npm run merge:ready -- --issue 265`; (4) the operator merges and pushes; (5) DEV
acceptance (§18.2) and smoke; (6) PROD.

### 25.7 Proposed commit contents (nothing staged; Git is operator-run)

Branch `issue/265-settle-deadlock` on `62f2cd67`. **Stage by explicit path, not `git add -A`.** Eighteen modified tracked files,
no new tracked file:

| Group | Files |
|---|---|
| Source (gate and hooks) | `src/lib/acquisition/settle-core.ts`, `src/lib/acquisition/settle-afltables.ts`, `src/lib/acquisition/settle-afl-api.ts`, `src/lib/ingest/datasets.ts`, `src/db/queries/admin-fixtures.ts` (comment only) |
| Tests | `tests/ingest-datasets.test.ts`, `tests/match-sheet.test.ts`, `tests/afl-api-ingestion-safety.test.ts`, `tests/integration/match-results-promotion.test.ts`, `tests/integration/settle-afltables.test.ts`, `tests/integration/settle-promotion-deadlock.test.ts` |
| Docs and tracking | `docs/admin-and-beta.md`, `CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, `issues/open/AFLDB-ISSUE-265.md`, `issues/open/AFLDB-ISSUE-265-phase-a/README.md` |
| Attributes | `.gitattributes` (five `-text` entries for the archived Phase A tooling, D-265-15) |

**Do not stage:** the three zero-byte untracked strays at the repository root, named `deriveOne('owner'`, `error)` and
`parseTarget('owner'` (tool-hook artefacts of earlier passes, safe for the operator to delete); and anything under `D:\tmp\`,
which is outside the repository (the runner, probe, window helper, exception file, cleanup tool and all evidence stay there
unless separately prepared and reviewed for archival). Git warns that `issues/open/AFLDB-ISSUE-265-phase-a/README.md` and
`tests/integration/settle-promotion-deadlock.test.ts` have LF endings that Git will convert on the next touch (`core.autocrlf`);
the provenance manifests record LF-folded hashes for the suites, so this does not affect the evidence.

### 25.8 Build-only phase PASSED (operator-run 2026-10-06, run `20261006-092204`)

*Supersedes "build-only phase prepared (not executed)" in §25.5 and "Not shown: the build" in §25.4 for the build only; both stay as
the record of their time.* Recorded from the saved evidence only. **No database was contacted by the agent, nothing was staged or
committed, nothing was deployed, no test or build was re-run, and no evidence file was edited.** The only Git commands used were
read-only (`status`, `diff --name-only`, `diff --stat`, `ls-files --others`).

Evidence (outside Git, read and left unchanged): `D:\tmp\issue265\run-20261006-092204-Regression-Build\` (`summary.txt`,
`00-derive` to `30-build-check` logs, `30-build.log`, `capture.json`, `baseline.json`, `30-build-check.json`,
`provenance-manifest.json` and `.sha256.txt`, `provenance-recheck.txt`). `-Phase Build`, `-BuildRole app`, target
`afldb_app@127.0.0.1:55432/afldb_test` for the build, tunnel endpoint `127.0.0.1:55432`. **`OVERALL: PASS`.**

| Step | Result |
|---|---|
| Preconditions | `s6-selftest` passed (no database contact); all four roles derived to `afldb_test`; target proof (`00-targets`) exit 0 |
| Preflight (read-only) | `01-preflight` exit 0: isolation OK (no other session holds a transaction or lock); 109 applied, exactly `110_match_sheet_player_match_stats_authority.sql` pending; State A; zero `player_match_stats` authority |
| Baseline (read-only) | `BASELINE OK`; twelve S6 rows pinned (66, 67, 68, 325-327, 543-545, 639-641), exception approved 2026-10-06 08:46, `rowMd5` pinned on 12 of 12; `import_batches` 378 rows, max id 1582 (the §25.1 post-window state: 342 + 36) |
| `npm run build` | **exit 0**. Next.js 16.3.1 (webpack); compiled successfully in 21.0 s; TypeScript finished in 26.5 s; **1,515/1,515 static pages** with 19 workers in 13.6 s (the figure the §25.5 expectation cited) |
| Standalone preparation | `prepare-standalone` ran and ended **`standalone bundle ready`**: no `.env*` under `.next/standalone` (checked before and after), `.next/static`, `public` and `deploy/coming-soon` copied, `.next/cache` created. It logged `AFLDB_ENV is not production; building with development headers` (a build-environment note, not a defect) |
| Post-build census (`30-build-check`) | exit 0, **CLEAN**: historical fingerprints equal the baseline, all 35 residue counts 0, retained `fixture_auth_users` 2 and `sports_data_lab_source` 1 (by design), `import_batches` max id 1582 and `newSinceBaseline` empty (the build wrote nothing) |
| S6 pins | **unchanged**: census 12 rows [66, 67, 68, 325, 326, 327, 543, 544, 545, 639, 640, 641], same `row_md5` values as the baseline |
| Provenance | **172 files hashed before any database contact, 172 unchanged** at the end (`provenance-recheck.txt`); manifest sha256 `aa11c52d3dfaeadbdd2342bd012b60b76f213174483ac37371960a8140a0ebc4` (equal to the §25.5 Static value, as expected for an unchanged runner) |
| Migration and restore | migration 110 **not applied** by this run; restore not applicable; `afldb_test` remains in State A |

**Warnings in `30-build.log` (recorded as observed; none is claimed to be pre-existing, and none was compared with an earlier build
log in this pass):**

1. `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` (Next.js `middleware-to-proxy`). The build summary
   lists `ƒ Proxy (Middleware)`. This pass did not locate or change the middleware file.
2. `⚠ Compiled with warnings in 1155ms`: `./node_modules/next/dist/esm/server/app-render/dynamic-rendering.js` reports "A Node.js API
   is used (process.cwd at line: 1044) which is not supported in the Edge Runtime", with the import trace
   `…/request/connection.js` ← `…/web/exports/index.js` ← `…/api/server.js`. It appears **twice** in the log and originates in
   `node_modules/next`, not in repository code.
3. The standalone note above (`AFLDB_ENV is not production`) is informational.

The warnings did not fail the build (exit 0, `Compiled successfully`). Whether either predates this branch has **not** been
established; if it matters, compare against an earlier `afldb_app` build log (for example the ISSUE-264 build
`run-20261004-202018` named in §25.5) rather than assuming.

**Working tree after the build (read-only Git, 2026-10-06):** branch `issue/265-settle-deadlock`, HEAD `62f2cd67`, nothing staged.
Exactly the **eighteen** modified tracked files of §25.7 (`18 files changed, 2911 insertions(+), 678 deletions(-)`, before this
§25.8 and its tracker notes are counted); **no new tracked change from the build** (`.next/`, `next-env.d.ts` and
`tsconfig.tsbuildinfo` are ignored). Untracked: only the three zero-byte strays of §25.7.

**What this shows and does not show.** Shown: the branch's source (as it stood in the 172-file provenance set) produces a clean
production build with standalone preparation against `afldb_test` as `afldb_app`, without writing to the database and without
disturbing the historical rows or the twelve S6 pins. **Not shown, and not claimed:** the commit; `merge:ready`; DEV deployment or
behaviour; PROD; protection against writers that do not take the gate (§23); the unexplained id-gap and sequence anomalies (§24.3).

**State.** ISSUE-265 **stays open**. Done: mitigation, Phase B 11/11, regression window PASS (§25.1), **build PASS (this
section)**. Pending, in order, operator-run: (1) review and commit the eighteen files (§25.7, which now also carry this
section); (2) `npm run merge:ready -- --issue 265`; (3) the operator merges and pushes; (4) `deploy/sync-dev.ps1` to DEV and
DEV acceptance (§18.2) and smoke; (5) PROD.
