# AFLDB-ISSUE-265 — A settle unit can lose a match-lock deadlock to a legacy CSV promotion, with no in-run retry

## 0. Status

- **Status:** Resolved (2026-10-14, owner decision D-PROD-10; §28.31). **Latest (2026-10-14, §28.31): the owner decided D-PROD-10 and authorised closure on the retrospective passive-acceptance result (batch 47 and batch 53, two counted runs, every §28.7 limitation preserved). The closure documentation is PREPARED LOCALLY (branch `fix/issue-265-close`); commit, merge and push are PENDING. The ISSUE-265 PROD hold is NOT released: it releases only after the closure documentation is merged, pushed and verified. B1 and D-PROD-11 are separate and unchanged; no deployment is authorised.** *Previous latest (2026-10-14, §28.30; its "closure is NOT decided" and "The issue stays open" are superseded by §28.31):* **Latest (2026-10-14, §28.30):the N2 retrospective capture was RUN (2026-10-14 10:13:43 +11:00, exit 0), verified (archive `3a311425…cf43`, manifest file `760e3622…d6a2`, 25 of 25 files) and graded. The owner accepted invocation `55a9060a…` (import batch 53, 2026-10-14 04:37:15–04:38:02) as the second counted AFL Tables run under D-RETRO-265-20261014, retrospectively: counted runs are 2 of 2 (batch 47; batch 53), and nights 9–13 October stay uncounted. Every element of the §28.6 passive-acceptance row is met on that credit. Closure is NOT decided (D-PROD-10 is outstanding); the B1 pause, the PROD hold and D-PROD-11 are separate and untouched; the contention, missed per-night evidence, web-journal and `copytruncate` limitations stand. The issue stays open.** *Previous latest (2026-10-08, §28.28; its "N2 NOT run" is superseded by §28.29–§28.30):* **N1 graded from the copied, verified evidence — NIGHT COUNTED 1 (batch 47, 2026-10-08
  04:37:45–04:38:23, independently re-derived). PROD acceptance is 1 of 2 counted AFL Tables runs, so it is not achieved. The approved B1 criterion now
  permits the Match Sheet player-statistic pause to lift (the operator's act; not observed). N2 instructions are prepared for 2026-10-09 after 06:00
  (NOT run). The issue stays open.** *Earlier (2026-10-07, §28.27): deployed to PROD (`cd3cf782`, migration 110 applied, C1 PASS), graded from the
  copied evidence; PROD acceptance was 0 of 2 counted AFL Tables runs.* *Earlier (2026-10-06): committed as `cd3cf782`, deployed to DEV, DEV acceptance PASSED (§27); PROD
  acceptance pending.** *History as first written:* **Mitigation IMPLEMENTED in the working tree (2026-10-05, uncommitted), database
  validation PENDING** (§21). The settle gate, the exclusive gate in the three legacy hooks, the
  `match_attendance` hook, the database-free pins and the Phase B acceptance harness (B1–B11) are written. Only
  database-free checks have run. **No Phase B window and no regression window has run**; nothing is
  committed or deployed. The issue stays open until Phase B, the regression window and DEV acceptance pass.
  - **Later state (2026-10-06, §25):** Phase B passed 11/11 (§23); the regression window **PASSED** after two earlier failed
    verdicts (§24, kept): 32/32, 16/16, 7/7 and 76/76, all censuses clean, migration 110 restored and verified. The build
    (a `-Phase Build` command is prepared, not run), the commit, `merge:ready` and DEV acceptance are pending.
  - **DEV acceptance (2026-10-06, §26):** the build passed (§25.8); `cd3cf782` is on DEV. Revision 3 was **refused at
    candidate selection** (no already-`manual_admin_edit` match before 2025). **D-DEV-5 was approved**: `match_results` with exact
    restatement. The complete revision 4 pack is prepared and its offline checks pass; it has **not run on DEV**. The issue stays
    open.
  - **DEV acceptance PASSED (operator-run 2026-10-06 13:34–13:47 +11:00; §27).** G PASS, S SUCCESS, D PASS, P PASS, R PASS.
    Submission 68 (`match_results`, match 16407) was refused retryably after 5,070.650 ms while the real AFL Tables settle held the
    gate. Settle batch 107 completed with 0 changes and 0 units rolled back. The manual retry produced batch 108, with match values and
    provenance unchanged, no additional match, and no deadlock finding. Two deviations are recorded in §27.3. **PROD acceptance is
    pending; the issue stays open.** The commit is `cd3cf782`, and it is deployed on DEV (supersedes the "commit, merge:ready and DEV
    acceptance pending" lines above).
  - **PROD deployment and acceptance plan prepared, NOT EXECUTED (2026-10-06; §28).** Target `cd3cf782` by SHA. By local
    records PROD is at `1111ab19` with ledger 109, so the range carries migration 110 (ISSUE-257) and other unreleased work. The
    plan uses passive acceptance on the scheduled settles, and the controlled promotion is a proposal only. Operator decisions
    D-PROD-1..10 are open. Nothing was run.
  - **§28 refined and the read-only C0 pack prepared offline (2026-10-06; §28.10). NOT RUN; §28 still NOT EXECUTED.**
    - The in-place release meets ISSUE-257's requirements. The rebuilt-promotion replay and A4.4 obligations do not apply to it.
    - Migration 110 must follow the application, but in the same window (D-PROD-3 → B1). A multi-night State A would refuse every
      Match Sheet player-statistic correction for its whole duration.
    - `db:status` and `sync-dev.ps1` are unfit for this PROD step.
    - Deploy-mode preflight is accepted only with two exact FAILs.
    - Pack: `D:\tmp\issue265\prod-c0-pack-r1\`, archive sha256 `2f22cd3a…f1e8`.
    - Next: the operator runs C0. D-PROD-3, -5, -6, -7 and -9 wait for it.
  - **C0 ran on PROD and is graded (2026-10-06 18:16:57 +11:00; §28.11). Deployment NOT AUTHORISED; §28 otherwise NOT
    EXECUTED.**
    - Evidence `run-20261006-181657-ProdC0`, manifest `dbb3e5cc…1b09`, 46/46 files verified. 8 of 42 items exited non-zero:
      five report absent units, timers or `.env` names, one is a permission limit (polkit), one is a capture-script defect (disk),
      and one is the expected deploy-mode preflight FAIL, whose only FAIL is the 36 classified settle manifests.
    - PROD: HEAD `1111ab19` on `main`; ledger 109, no 110; CHECK without `player_match_stats`, guard 0 (**State A**); BUILD_ID
      `rjrdXKga5b7MBY_LjXA06`; health ok; only the AFL Tables unit and timer installed, and its service is the 2026-09-02 revision
      (no effect today); no submissions (R-258-1 census 0); 65 GB free.
    - 9 visible AFL Tables runs (2026-09-28 12:20 → 2026-10-06 04:38), all successful no-ops, no deadlock in any visible source.
      The server log and systemd's own journal lines are unreadable by `arm`.
    - The range is 26 commits and more than "110 plus two deny lists" (§28.11.6 corrects §28.10.5).
    - Next: D-PROD-3 (B1), D-PROD-12 (unit drift) and D-PROD-13 (N-k evidence access); optional sudo O1/O2.
  - **Decisions and gates pack (2026-10-06; §28.12). Deployment NOT AUTHORISED; D-PROD-4 NOT approved.**
    - Approved: D-PROD-3 = B1; D-PROD-12 = do not reinstall the AFL Tables unit in this window; D-PROD-13 = interactive sudo
      read-only journal and server-log captures.
    - Gates pack r1 `D:\tmp\issue265\prod-gates-pack-r1\` (manifest `071dc08e…3c67`, archive `e4ec2313…e27b`): D2/D3 script, G-START,
      the D5 preflight grader (fully in-class still grades `BLOCKED-PENDING-D-PROD-4`), and `sudo-capture.sh`. Offline checks and
      stubbed dry runs pass; nothing has run on PROD.
    - Next: the operator runs the C0 sudo supplement and, on its own authorisation, D2 (`g2 --i-authorise-d2-fetch`), then
      returns both folders.
  - **C0 sudo supplement graded (§28.13)** and **D2 graded (2026-10-06 19:35:19 +11:00; §28.14). Deployment NOT AUTHORISED;
    D-PROD-4 NOT approved.**
    - D2 evidence `run-D2-20261006-193519-Prod`, manifest `5eebb526…c32b`, 26/26 verified, inventory exact. `FRESH T-EXACT`
      (`origin/main` = `cd3cf782`); every D3 range comparison IDENTICAL; `PREDICTED-COLLISION-FREE`; post-fetch preflight
      `AS-PREDICTED` (36 known manifests, behind 26, missing-base 110). The fetch changed only `origin/main`, `origin/HEAD` and
      `FETCH_HEAD`: HEAD, `main`, the index and the working tree are unchanged. Preparation results, not acceptance.
    - Range classified (§28.14.4): 14 docs-only, 2 test/hygiene, 1 data/tooling, 9 runtime commits, of which 2 carry
      infrastructure (two uninstalled unit files; migration 110 and its rollback guard).
    - Deploy pack r1 `D:\tmp\issue265\prod-deploy-pack-r1\` (manifest `d8413f73…7e5a`, archive `d5e61848…12d8`): D5, DS/C1, D7,
      rollback with the migration-110 guard and reversal, N-k with server-log positive controls; every open decision a required
      flag. Offline checks and stubbed dry runs pass; nothing has run on PROD.
    - Next: the operator decides D-PROD-4 (binding) and D-PROD-1, -2, -5, -9, -14, -15, -16 (§28.14.7); deployment needs its own
      authorisation.
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

## 26. DEV acceptance (§18.2 step 6): revision 3 refused at candidate selection; D-DEV-5; revision 4 pack prepared (2026-10-06)

*Recorded 2026-10-06 by the agent. Preparation only, not acceptance.* The fix is commit `cd3cf782`, deployed to DEV
(rollback point `ebbe2c00`, DEV `BUILD_ID` `299AIEC7YxKq3a00-SUNJ`, as the operator's DEV acceptance runs reported). The
acceptance packs sit outside Git under `D:\tmp\issue265\`, and every step in them is operator-run (CLAUDE.md §9). For the
grading model (G gate, S settle, D deadlock, P provenance, R manual retry), D-DEV-1..4 and the history of revisions 1–3,
see the pack README §0–§2. **In preparing revision 4, the agent contacted no host or database, uploaded no submission,
launched no settle, promoted nothing, ran no Git command and changed no saved evidence.**

### 26.1 Revision 3 candidate selection REFUSED on DEV (operator-run, 2026-10-06)

Revision 3 (`D:\tmp\issue265\dev-acceptance-cd3cf782\`) used a `match_attendance` restatement of a match that was already
`manual_admin_edit` (D-DEV-2). Its §4.3 `sql/10-candidates.sql` refused on DEV:

> DEV acceptance candidate selection refused: zero historical matches before 2025 are already `manual_admin_edit` with
> complete attendance and no open finding.

The refusal comes before the upload, so no submission was staged, no window was armed, no settle was started, and nothing
was promoted. **The refusal is the designed outcome of that query, not a defect.** Its evidence folder is kept on DEV, and
revision 3 is kept byte-for-byte; the agent has not read the DEV folder. (An earlier revision 3 run stopped at §4.1: the
installed settle unit differed from the repository copy. The pack's `unit-remediation.sh` covers that, and its outcome is
not recorded here.)

### 26.2 D-DEV-5 (operator, APPROVED 2026-10-06)

DEV acceptance switches to **`match_results` with exact restatement**. D-DEV-2's "already `manual_admin_edit`" requirement is
withdrawn for this dataset only. D-DEV-1 (no freeze, one armed automatic attempt), D-DEV-3 (real settle), D-DEV-4 (timing
and deadlock evidence), the manual retry R, and G/S/D grading are unchanged. The operator required:

| Requirement | How the revision 4 pack enforces it |
|---|---|
| the pipeline-generated `match_key` equals the stored key | `10-candidates.sql` reproduces `resolveClub`/`resolveVenue` and the key render (`datasets.ts:545-549`, `:806-809`); `15-precheck.sql` re-renders the key from the pipeline's own resolved values and refuses (`would INSERT A DUPLICATE`) before arming |
| every column the upsert writes equals its stored value | `15-precheck.sql`: the payload is the nine stored values, and the resolved values equal the stored `round_number`, `round_type`, club ids, `venue_id`, scores, `result`, `winner_club_id`, `margin`, with `is_final` false (`datasets.ts:829-842`). R: `matchWrittenColumnsChanged=[]` |
| omitted optional fields and every provenance column stay unchanged | the CSV has no goals, behinds or attendance column (resolved NULL = COALESCE/CASE-kept, `:834-849`). R: `matchOmittedOptionalColumnsChanged=[]` (goals, behinds, `attendance`, `attendance_status`, `attendance_source_id`) and `matchProvenanceColumnsChanged=[]` (`source_id`, `source_record_id`, `import_batch_id`, `imported_at`; never in the SET list, `:854-860`) |
| the refused attempt keeps every stored column and `xmin` | P: the same `xmin`, `rowmd5` and every column at S0, at arm and at S2; census 1/1 and an unchanged season count |
| the manual retry keeps every column, moves `xmin`, adds no match, one explained batch | R: whole row identical, `xmin` moved; census `key_count = identity_count = 1` with an unchanged season count; the retry batch's `matches_owned = 0` (an INSERT stamps `import_batch_id`, `:817/827`); exactly one `admin-upload` batch with `target_table=match_results`, the traced counts and `started_at = completed_at = promoted_at` |

`player_match_stats` was rejected as the trigger: its upsert always overwrites `import_batch_id` (`datasets.ts:1215`). A
correction to revision 3, for information: `matches` **does** carry the provenance quartet (migration 064). Revision 3's
`match_attendance` conclusions still hold, because its UPDATE writes none of those columns.

### 26.3 Revision 4 pack (complete, assembled locally; NOT RUN on DEV)

**`D:\tmp\issue265\dev-acceptance-cd3cf782-rev4-pack\`** (DEV copy: `~/issue265-dev-acceptance-r4`). The folder is
self-contained: 23 files plus `MANIFEST.sha256` (sha256 of the manifest file
`e66ad50a2f6f9dbc0400809bb6155330e8c65b585c9cf5218ec774afcdcfc5c8`). The operator does no assembly or patching. It was built
from revision 3 plus the earlier revision 4 delta (`D:\tmp\issue265\dev-acceptance-cd3cf782-r4\`, now superseded), with the
watcher patch applied cleanly (watcher sha256 `241c0ec5…69e98`, as the delta predicted). Revision 3 and the delta were
hashed before and after and are unchanged. Additions over the delta:
- **No additional match.** `sql/12-match-row.sql` adds a `census` (`key_count`; `identity_count` = matches with the same
  season, `match_date`, home club and away club; `season_count`). `sql/14-promotion-state.sql` adds each batch's
  `matches_owned`. `sql/15-precheck.sql` and `sql/10-candidates.sql` require the match to be the only one with its season,
  date and clubs.
- `lib/evidence-core.mjs` grades all of this, and names omitted optional columns apart from file-written ones. The self-test
  gains census, `matches_owned` and per-column omitted-field cases.
- One complete README (`README-DEV-ACCEPTANCE.md`, revision 4), with §0b on D-DEV-5, the `match_results` write-path trace, the
  new §4.0/§4.3/§4.4, P and R criteria, retained state and §8 offline checks.

**Offline checks run by the agent (2026-10-06, workstation, Node v22.21.0, on the final folder; the operator authorised
these):** `bash -n` on the four shell scripts OK; `node --check` on every `lib/*.mjs` OK; `lib/watch-core.selftest.mjs` →
`SELFTEST-OK`; `lib/evidence-core.selftest.mjs` → `EVIDENCE-SELFTEST-OK`; no CR bytes; `sha256sum -c` of the manifest OK.
**Not run:** any SQL. psql is not on the workstation, so `10/11/12/14/15/20/40` execute for the first time on DEV, read-only.

**Retained DEV state if accepted ("refused, then R"):** one `match_results` submission (`promoted`); one `admin-upload` batch
(owning no match); the audit rows; the match rewritten with identical values (new `xmin`, provenance unchanged); one consumed
`matches` identity value; plus whatever the real settle applies.

### 26.4 Operator commands (prepared; none run by the agent)

Transfer (workstation, Git Bash; refuses if the DEV folder exists):
```bash
ssh dev 'test ! -e ~/issue265-dev-acceptance-r4' \
  && scp -r /d/tmp/issue265/dev-acceptance-cd3cf782-rev4-pack dev:issue265-dev-acceptance-r4 && echo COPIED
```
Offline checks, then the read-only stages to candidate selection: pack README §4.0 (expects `MANIFEST-OK`, `SELFTEST-OK`,
`EVIDENCE-SELFTEST-OK`, `SYNTAX-OK`), §4.1, §4.2 and the first block of §4.3. `exit=3` with `REFUSED: no historical
home-and-away match can be restated exactly …` means **stop**: no synthetic fixture is prepared, and any further step
needs a new proposal.

### 26.5 State

ISSUE-265 **stays open**. DEV acceptance has **not** run: revision 3 was refused at candidate selection (§26.1), and the
revision 4 pack is prepared but not run. Next (operator): transfer the pack, run README §4.0–§4.3 (offline and read-only),
and return the candidate output. §4.4 onwards writes to DEV: staging, the armed window and R.
*Superseded by §27: the revision 4 run on 2026-10-06 passed.*

## 27. DEV acceptance PASSED (revision 4, operator-run 2026-10-06 13:30–13:47 +11:00; verified by agent from saved evidence)

*Recorded 2026-10-06 by the agent from the saved evidence only.* **The agent contacted no host or database, re-ran nothing,
ran no Git command, and changed no evidence file.** The only commands run were local and read-only: `sha256sum`, the pack's
`lib/check-evidence.mjs` re-run on the saved files, and Node reads of the JSON. The verdict below rests on the files, not on
their summaries.

### 27.1 Evidence integrity

Folder `D:\tmp\issue265\run-20261006-133026-DevAcceptance\` (DEV `~/issue265-dev-acceptance-r4/out-20261006-133026`).
`MANIFEST.sha256` = `c0adf47f67cd3408efba5d18bf96be0e1c206f3125fb5ec092410488b0c038ac` (as expected). **52 of 52 listed files
OK.** The folder holds exactly those 52 files plus the manifest; nothing is unlisted or missing. Two files are empty by design:
`gate-after-unit.txt` (gate free after the unit) and `journal-errors.txt`. Pack `dev-acceptance-cd3cf782-rev4-pack` manifest:
OK.

### 27.2 Setup

| Item | Evidence | Result |
|---|---|---|
| Deployed code | `01-deployed-state.txt`, `deployed-at.txt` | DEV checkout `HEAD` `cd3cf7827da15dc73968bf775c62b975c5f26587`; `afldb` active since 2026-10-06 09:44:40 +11:00 (MainPID 1353409); "Installed unit identical; settle idle"; `DEPLOYED-STATE-OK`. The eight untracked `settle-*.json` operational manifests are listed (allowed). **`BUILD_ID` does not appear in any evidence file**, so `299AIEC7YxKq3a00-SUNJ` is not re-verified by this folder (it rests on the operator's earlier reports). The file is a condensed operator summary, not the raw README §4.1 output |
| Target | `02-target*.txt`, `00-target.txt` | `afldb_import` on `afldb_dev`, PostgreSQL 16.15, `read_only on`, TCP `127.0.0.1:5432` with a loopback client (one host); server `lock_timeout`/`statement_timeout` 0 (defaults) |
| Settle season | `settle-season.txt` | 2026; matches must be before 2025 |
| Candidate | `03-candidates*.txt`, `match-id.txt` | exit 0; 15,913 qualifying; 16407 is the first listed: 2024 R1, 2024-03-07, Sydney v Melbourne, 86–64, S.C.G. (venue 37), source `afltables` |
| CSV | `match_results_m16407.csv`, `csv.sha256` | the two expected lines; sha256 `1cd8153c…6ef5`, equal to the submission's `content_sha256` in S1–S3 |
| Submission | `promotion-state-S1.json`, `08-audit.txt` | **68**, `match_results`, 1 row, `approved` with no promotion state (staged 12:44:25, validated 12:44:56 as 1 ok/0/0/0, approved 12:45:12) |
| Precheck | `15-precheck.txt` | `PASSED` (dataset, payload and resolved restatement, rendered key equal to the stored key, single identity); `other_open_submissions 1` (information only) |
| Baseline | `baseline-origin.txt` | S0 files were **inherited** from `out-20261006-122525` ("new pre-arm attempt"). S0 (12:26:54) precedes the upload (12:44:25). `since_batch_id` 106. Earlier aborted attempts are separate folders and were not used as this window's evidence |

### 27.3 Grading (pack README §5)

**G, gate: PASS** (`gate-verdict.txt` `GATE_ATTEMPT=PASS code=REFUSED_DURING_SETTLE_HOLD`).
- G1: `gate-observation.json` shows one **granted `ShareLock`** on `(717275,4)` by backend 1546130 (`afldb_import`/`afldb_dev`).
  Its client port 54614 is the socket of pid 1546082, `tools/current-season/settle-afltables.ts --label settle-2026-2026-10-06-1334
  --apply --auto-apply --require-complete-source`, in cgroup `/system.slice/afldb-settle-afltables.service`. The unit's InvocationID
  at observation was `2de612ae5ec84cb9a8584d72814ecfe0`. **Deviation:** `unit-final.txt` has a blank `InvocationID` (and blank exec
  timestamps) after the unit went inactive, so the literal InvocationID equality cannot be checked. Equivalent identity holds
  instead: the journal lines from pid 1546082 report `Applied as import batch 107`, the unit MainPID 1545784 writes
  `AFLDB_SETTLE_SUCCESS label=settle-2026-2026-10-06-1334`, and both pids and the label equal the observation's.
- G2: one attempt (`promotion-attempt.lock`, 13:35:13.434Z) for submission 68, approved at preflight (`watcher-ready.json`).
  `deployedRefusalEqualsPack: true`.
- G3: `errorIsExactRefusal: true`; client monotonic `elapsedMs` **5,070.650178** (≥ 4,990); server `waitstart`-based wait
  4,992.36–5,022.96 ms (≥ 4,990).
- G4: the agent tallied `gate-samples.jsonl` independently: 433 samples (1 pre, 230 attempt, 202 post); **227 samples with the
  settle's granted `ShareLock` and the promotion's ungranted `ExclusiveLock` together, spanning 4,976.0 ms** (the watcher reports
  4,977) against a 4,000 ms minimum; the promotion was never granted; no other session. The settle was first seen free at
  13:36:09.255Z, after the attempt.
- G5: `promotion-result.json` before/after: `xmin` 407714 and `rowmd5` `ab5191489659b3d10a13ecc19137ae18` unchanged; submission
  `failed` with the exact refusal (07-after-settle §C `error_is_exact_refusal = t`), `import_batch_id`/`promoted_at` NULL; zero batches.

**S, settle operation: SUCCESS** (`settle-outcome.txt`). `Result=success`, `ExecMainStatus=0`, the journal is readable and
`AFLDB_SETTLE_SUCCESS` is present. 07-after-settle §A: exactly one `settle-afltables.ts` batch since 106, **batch 107
`completed`**, 10,246 records read, `apply_failures 0`, `retry_applied 0`, issues opened/refreshed 0. The journal reads: "0 canonical
row(s) inserted, 0 updated, 0 ledger row(s), 0 retried after resolution, 0 refused at the write, **0 unit(s) rolled back**", with
`canonicalApplyFailures: 0`. `gate-after-unit.txt` is empty; `gate_timeout=no`, `postcommit_isr_failure=no`,
`postcommit_incomplete_source=no`. The journal's "Open canonical apply failures (20)" is a listing of **existing** open
`foreign_source_owner` findings, not new ones (the §E count since deployment is 0).

**D, deadlock: PASS.** 07-after-settle and 08-after-retry sections D, E and F have **0 rows**; `deadlock_text=no`; the promotion
error has no deadlock text. `deadlock_findings|0|none` is identical in S0, S1, S1b, S2 and S3. `canonical_apply_failed`
open/total stays **60/60** in all five snapshots.

**P, refused path: PASS.** `check-refused-path.txt` `REFUSED_PATH_CHECK=PASS`, and the agent's local re-run of
`check-evidence.mjs refused` also gives PASS (exit 0). S0, arm and S2 have `xmin` 407714, the same `rowmd5`, and a whole row equal
to S0 (independently compared): source `afltables`, provenance `source_id 10`/`source_record_id '16407'`/`import_batch_id 4`/
`imported_at 2026-09-26`, attendance 40012 `complete`, goals and behinds 12.14/9.10. The census is `key_count 1`,
`identity_count 1`, `season_count 216` throughout. The submission changed in exactly `status`/`error`. The sequence did not move
(17278 → 17278).

**R, manual retry: PASS.** `check-retry.txt` `RETRY_CHECK=PASS`; the local re-run also gives PASS (exit 0). The UI Promote at
13:42:47.574 +11:00 gave **batch 108**: `admin-upload`, `sports_data_lab`, `target_table match_results`, `completed`, records
1/1/0/0, `validation_result`/`error` NULL, notes `submission 68`, `started_at = completed_at = promoted_at` to the microsecond,
**`matches_owned 0`**, the only batch since the baseline. Match: `xmin` 407714 → **610398**; written, omitted optional, provenance
and unexplained column changes all `[]`; `rowmd5` unchanged; whole row equal to S0; census 1/1/216 → 1/1/216
(`noAdditionalMatch true`). Submission: exactly `error`, `import_batch_id`, `promoted_at`, `promoted_at_us`, `status`. **One
sequence advance** (17278 → 17279, information only, as predicted for `INSERT … ON CONFLICT`).

**Audit** (`08-audit.txt`): 1052 `upload.staged`, 1053 `submission.validated` (`ok 1, errors 0, warnings 0, duplicates 0`),
1054 `submission.approved`, 1055 `submission.promoted` (`applied 1, batchId "108"`). There is **no** `submission.promote_failed`,
and the automatic pipeline attempt has **no audit row**, as designed (`promoteSubmission` writes none).

**Overall: G PASS, S SUCCESS, D PASS, P PASS, R PASS → DEV ACCEPTED**, with two recorded deviations that do not change any
criterion's outcome: the blank final `InvocationID` (G1 identity proven by pid and label instead), and `BUILD_ID` not present in
this folder.

### 27.4 Timer exception (Brownlow)

`timers.txt` (at arm, 13:34:36) lists `afldb-settle-afl-api-brownlow.timer` (every 5 min; next 13:35:00) and
`afldb-settle-afl-api.timer` (next 2026-10-07 05:10). The operator recorded an exception (`timer-exception.txt`): the Brownlow
timer may fire while its enablement flag stays disabled, and the flag is not to be enabled during acceptance.
`brownlow-disabled-journal.txt` shows the 13:20, 13:25 and 13:30 runs each logging "`AFLDB_AFL_API_BROWNLOW_ENABLED` is not
'true' … Nothing to do" and finishing in the same second, before any acquisition or database access. The timer was enabled
when listed. **Limits:** the saved journal does not contain the 13:35:00 firing that fell inside the window, and the timer's
state after the window was not captured. Consistent with a disabled run: the gate samples saw no session other than the settle
and the promotion, and section G shows no AFL API batch since deployment.

### 27.5 What this does and does not show

Shown on DEV, against the deployed `cd3cf782`: a real AFL Tables settle holds the shared gate for its whole apply; a
legacy `match_results` promotion attempted during that hold is bounded by its 5 s wait, refused retryably, and writes nothing;
the settle is unaffected and commits; a manual retry afterwards succeeds with exactly the traced effects and no change to match
values or provenance; no deadlock finding appears.

**Not shown on DEV, and not claimed:** the AFL API settle (`afldb_test` Phase B only); a settle **waiting behind** a promotion
(the reverse direction, the 300 s wait, B6/B7 on `afldb_test` only); the `player_match_stats` and `match_attendance` write paths
on DEV (same gate, P/R not exercised here); and any writer that does not take the gate (Match Sheet and Data Editor saves,
`player_bio`, direct SQL).

### 27.6 State

ISSUE-265 **stays open**: **PROD acceptance is pending**. No PROD acceptance plan exists yet; the next step is to prepare one
(operator decision), then PROD deployment and acceptance, operator-run. Retained on DEV: submission 68 (`promoted`), batch 108, audit rows
1052–1055, match 16407 rewritten with identical values (`xmin` 610398), one consumed `matches` identity value, and settle batch
107 with its snapshot and manifest (`settle-2026-2026-10-06-1334`). Preserved: revision 3's candidate refusal (§26.1), every
earlier failed or refused verdict, and the earlier aborted DEV attempts' folders.
*Superseded in part by §28: a PROD plan is now prepared (not executed).*

## 28. PROD deployment and acceptance plan (prepared 2026-10-06) — **NOT EXECUTED**

> **NOT EXECUTED. Nothing in this section has been run on any host or database.** It is a plan for operator decision
> (§28.8). Authorisation for this pass: local read-only repository inspection and documentation edits only. The agent
> contacted no host or database, ran no Git command (the local refs and reflog were read as files), fetched nothing,
> deployed nothing, started no settle, promoted nothing, and changed no evidence. Every command below is operator-run,
> each on its own authorisation (CLAUDE.md §9, §12).

**Read for this plan:** this runbook §0, §18.2, §20, §23, §25–§27; the revision 4 pack README §1, §2, §4, §5 and its
`sql/00`, `sql/20`, `sql/40` and `lib/dsn.sh`; every unit, timer and wrapper in `deploy/` (AFL Tables, AFL API, Brownlow, which
also carries the scheduled fixture-identity step, e-mail intake, and the web unit); `docs/deployment.md` §3, §7b, §7d and §11;
`tools/dev/preflight-core.ts`; migration 110's header; `issues/closed/AFLDB-ISSUE-257.md` §18.13; `issues/closed/AFLDB-ISSUE-258.md`
R-258-1; `issues/closed/AFLDB-ISSUE-264.md` §14.4.4 and §14.7.4; and the ISSUE-220 PROD record in `issues.md`.

### 28.1 Target revision

**Local records (read from files; not refreshed by a fetch):**

| Item | Value | Source |
|---|---|---|
| local `main` | `cd3cf7827da15dc73968bf775c62b975c5f26587` | `.git/refs/heads/main` |
| `origin/main`, as last updated locally | the same SHA, set by the operator's push at epoch 1791240087 (2026-10-06 09:41:27 +11:00) | `.git/refs/remotes/origin/main` and the last line of its reflog |
| branch `issue/265-settle-deadlock` | the same SHA | `.git/refs/heads/issue/265-settle-deadlock` |
| PROD checkout, last recorded | `1111ab19`, migration ledger 109/109 with 0 pending (ISSUE-220 PROD rollout; resolved 2026-10-01) | `issues.md`, ISSUE-220 entry |
| later PROD deployment | **none recorded.** ISSUE-257, ISSUE-258 and ISSUE-264 each record "PROD promotion outstanding" | `issues.md` (those entries) |

Whether the remote has moved since is **unknown**. A fetch was outside this pass's authorisation.

- **Tested implementation commit:** `cd3cf782`. Phase B, the regression window and the build ran on the tree that became it
  (§23, §25), and DEV acceptance (§27) ran on the deployed commit itself.
- **No later documentation commit exists locally.** The DEV acceptance record (§27), this section and the tracker edits are
  uncommitted in this worktree.
- **Proposed target T (D-PROD-1, option A, recommended): exactly `cd3cf7827da15dc73968bf775c62b975c5f26587`.** Deploy it by SHA
  (`git merge --ff-only <full SHA>`), not as "whatever `origin/main` is".
- **Option B:** a later commit D that contains documentation only. Accept it only if, after the fetch,
  `git merge-base --is-ancestor cd3cf782 D` succeeds and `git diff --name-only cd3cf782 D` lists only `issues.md`,
  `IssuesIndex.md`, `CHANGELOG.md` and paths under `issues/`. The deployed source then equals the tested source. The evidence
  names both SHAs.
- **Stop** if, after the fetch, `origin/main` holds any commit beyond `cd3cf782` that touches anything else. Such a commit is
  not part of this deployment, and choosing a target that includes it needs a new decision.

**How the operator proves what is deployed (captured in C1, §28.6):**
- **HEAD.** `git rev-parse HEAD` equals the full SHA of T. `git --no-optional-locks status --porcelain=v1 --untracked-files=all`
  shows no tracked change, and every untracked path is in the class C0 recorded (§28.2).
- **BUILD_ID.** Read both `.next/BUILD_ID` and `.next/standalone/.next/BUILD_ID`; `deploy/server-cluster.mjs:148-151` reads the
  standalone file first. The two must be equal, must differ from the C0 value, and must have an mtime after the deployment
  started. **PROD's value is not expected to equal DEV's `299AIEC7YxKq3a00-SUNJ`**, because every build gets a new ID.
- **Running service.** `systemctl show afldb -p ActiveState -p SubState -p MainPID -p ExecMainStartTimestamp -p NRestarts
  -p InvocationID`. `MainPID` differs from C0, and `ExecMainStartTimestamp` is later than the BUILD_ID mtime. Re-query from a
  **fresh SSH connection at least two minutes later**: an immediate re-query can race systemd's property update (recorded PROD
  lesson, 2026-08-18). The `x-afldb-build` header is off on PROD at the last record (`AFLDB_TRACE_REQUESTS` unset), so it is not
  the identity proof.
- **Effective unit configuration.** For every unit in §28.3, record: `systemctl cat` (the fragment plus every drop-in);
  `systemctl show -p FragmentPath -p DropInPaths -p ExecStart -p User -p WorkingDirectory -p EnvironmentFiles -p UnsetEnvironment
  -p TimeoutStartUSec -p Nice`; and the fragment's sha256, diffed against the deployed checkout's `deploy/` copy. A `git` checkout
  never changes an installed unit file, but it **does** change the wrapper scripts that the units' `ExecStart=` runs from the
  checkout.
- **Code on disk.** Both settles run `tsx` from the checkout's source at each start. **The settle side therefore switches to T as
  soon as the checkout moves**, whereas a promotion runs inside the web process and switches only after the build and the
  restart. Pins: `grep -n 'await acquireSettlePromotionGate(tx);' src/lib/acquisition/settle-afltables.ts
  src/lib/acquisition/settle-afl-api.ts` (one line each, `:1839` and `:1909` at T); `grep -n 'pg_advisory_xact_lock('
  src/lib/ingest/datasets.ts` (`:598`); `grep -n 'SETTLE_PROMOTION_GATE_WAIT_MS = 300_000' src/lib/acquisition/settle-core.ts`.

### 28.2 Pre-deployment capture (C0) and rollback

**The deployment range is not migration-free.**
- ISSUE-265 adds no migration, schema or privilege change (§18.2).
- At T, `src/db/migrations/` ends at `110_match_sheet_player_match_stats_authority.sql`.
- PROD's last recorded ledger is 109/109 (ISSUE-220). Unless PROD was changed without a record, **migration 110 (ISSUE-257) is in
  the range and pending on PROD.** No other migration above 109 exists at T.
- Migration 110 has a **mandatory order**: the new application must be live **before** it (migration header, lines 20-26;
  ISSUE-257 §18.13). It also changes the rollback rules (below). Its handling is D-PROD-3.
- The range also carries the other unreleased work since PROD's HEAD. By the records this means at least ISSUE-257, ISSUE-258 and
  ISSUE-264, each with PROD obligations: the migration 110 order, and R-258-1 (re-validate pre-deployment legacy submissions before
  promoting them). The operator's `git log --oneline $PREV..$T` is the authority for the full list (D-PROD-2).

**C0: read-only capture on PROD, before anything changes.** Run as `arm` in **one** SSH session (`ssh afldb`; SSH bursts trip
the firewall IPS). Each item is written once into a new folder and keeps its own exit status. A failure stays visible and does
not stop the remaining read-only items.

```bash
set -o pipefail -o noclobber
cd ~/projects/afldb
mkdir -p ~/issue265-prod && OUT=~/issue265-prod/C0-$(date +%Y%m%d-%H%M%S) && mkdir "$OUT" || echo "REFUSED: no new folder"
cap() {  # cap <file> '<command>': stdout+stderr, the command text, a timestamp and the exit status; never overwrites
  { printf '## %s\n## at %s\n' "$2" "$(date --iso-8601=ns)"; bash -o pipefail -c "$2"; echo "exit=$?"; } > "$OUT/$1" 2>&1
  echo "$1: $(tail -n 1 "$OUT/$1")"; }
cap clock.txt     'date --iso-8601=ns; date +%s; timedatectl'
cap git.txt       'git rev-parse HEAD; git log -1 --format="%H %cI %s"; git rev-parse origin/main; git --no-optional-locks status --porcelain=v1 --untracked-files=all'
cap build.txt     'for f in .next/BUILD_ID .next/standalone/.next/BUILD_ID; do printf "%s " "$f"; cat "$f"; echo; stat -c "%y %n" "$f"; done'
cap web.txt       'systemctl show afldb -p ActiveState -p SubState -p MainPID -p ExecMainStartTimestamp -p NRestarts -p InvocationID; systemctl cat afldb'
for u in afldb afldb-settle-afltables afldb-settle-afl-api afldb-settle-afl-api-brownlow afldb-email-intake; do
  cap "unit-$u.txt" "systemctl show $u -p LoadState -p ActiveState -p SubState -p Result -p ExecMainStatus -p FragmentPath -p DropInPaths -p ExecStart -p User -p WorkingDirectory -p EnvironmentFiles -p UnsetEnvironment -p TimeoutStartUSec -p Nice -p InvocationID; systemctl cat $u; f=\$(systemctl show $u -p FragmentPath --value); [ -n \"\$f\" ] && sha256sum \"\$f\" deploy/$u.service && diff \"\$f\" deploy/$u.service && echo IDENTICAL"
done
cap timers.txt    'systemctl list-timers --all --no-pager "afldb*"; for t in afldb-settle-afltables afldb-settle-afl-api afldb-settle-afl-api-brownlow afldb-email-intake; do systemctl show $t.timer -p LoadState -p UnitFileState -p ActiveState -p TimersCalendar -p TimersMonotonic -p RandomizedDelayUSec -p Persistent -p LastTriggerUSec -p NextElapseUSecRealtime; systemctl cat $t.timer; done'
cap jobs.txt      'systemctl list-jobs --no-pager; systemctl list-units --all --no-pager "afldb*"'
cap flags.txt     'grep -o "\"in_progress_seasons\": *\[[^]]*\]" data/reference/seasons.json; grep -c "^AFLDB_AFL_API_BROWNLOW_ENABLED=true$" .env; grep -c "^AFLDB_SETTLE_TRIGGER=systemd$" .env; ls -l /etc/polkit-1/rules.d/ | grep -i afldb'
cap journal-access.txt 'id -nG; journalctl -u afldb-settle-afltables -n 1 --no-pager'
for u in afldb-settle-afltables afldb-settle-afl-api afldb-settle-afl-api-brownlow; do
  cap "journal-7d-$u.txt" "journalctl -u $u --since -7d -o short-iso-precise --no-pager | grep -E 'Started|Finished|Failed|AFLDB_SETTLE_(SUCCESS|FAILURE)|Applied as import batch|rolled back|deadlock detected|40P01|SettlePromotionGate|waited 300 s|SOURCE COMPLETENESS|ISR invalidation failed|Nothing to do'"
done
cap migrations.txt 'AFLDB_MIGRATE_TARGET=prod npm run --silent db:status'
cap preflight-readonly.txt 'npm run --silent preflight -- --mode read-only --environment prod --dsn-env AFLDB_PROD_DATABASE_URL --expect-database afldb_prod'
cap disk.txt      'df -h ~; du -sh .next node_modules'
```

C0 also takes the read-only database captures (§28.4 SQL), through the `use_role import` helper with its read-only `PGOPTIONS`:
`p00-target` (refuses unless `afldb_import` on `afldb_prod` and read-only; prints the timeout settings, `pg_db_role_setting`
overrides and the logging settings `log_destination`, `logging_collector` and `log_directory`); `p20-state`; `p40-after` over the
last 14 days as the **baseline of normal nightly outcomes**; and `p41-submissions` (the R-258-1 census). The optional D-265-13
query (`issues/open/AFLDB-ISSUE-265-prod-settle-timing.sql`, §16.2) adds settle-duration context.

**Expected C0 facts that change the plan if they differ:**
- HEAD `1111ab19…`, with 109 applied and 0 pending relative to that checkout.
- Every installed unit either identical to its repository copy or with a recorded explanation.
- The register `[2026]`; Brownlow flag count `0`. In `flags.txt`, a final `exit=1` only means the polkit `grep` found no rule:
  record it and do not treat it as a failure.
- No afldb job and no active settle.
- Whether `afldb-settle-afl-api.*` is installed at all. The records say it was not (docs §7d; ISSUE-232 "PROD: nothing installed or
  authorised").

**Rollback (application), with the revision C0 actually captured, `$PREV`:**
- **Triggers.** A deployment-success check fails (§28.6), or the operator decides on an acceptance FAIL or a regression.
- **Before anything else, read-only:** record the migration state.
  - **State A** (110 not applied; D-PROD-3 option A): an application rollback is safe ("new | old" and "old | old" are both safe,
    ISSUE-257 §18.13).
  - **State B** (110 applied): run `npx tsx tools/db/issue257-rollback-guard.ts --target prod` first. `PERMITTED` → restore
    migration 102's CHECK (`issues/closed/AFLDB-ISSUE-257.md` §19), then roll the application back. `REFUSED` → **roll forward
    only.** Never delete authority rows to make the guard pass (docs §11).
- **Same timing rules as the deployment** (§28.3): no settle active, no promotion in flight.
- **Steps** (docs §11, adapted to PROD's recorded practice):
  1. `git checkout --detach $PREV`. This leaves `main` at T for a later decision, and no reset or clean is used.
  2. `npm ci --include=dev` (PROD's `.env` sets `AFLDB_ENV=production`, so plain `npm ci` would prune `tsx`).
  3. `npm run build`, with `AFLDB_ENV` exported as in the 1111ab19 rebuild (ISSUE-220 record).
  4. Restart by `kill "$(systemctl show afldb -p MainPID --value)"`. `Restart=always` respawns the service; sudo needs a password
     on PROD.
  5. Verify as in C1: HEAD = `$PREV`, a **new** BUILD_ID (a rebuild never reproduces C0's; C0 keeps the old value on record),
     health, and units unchanged.
- **What a rollback changes.** The settles run `$PREV`'s code from their next start, because they compile from source. At
  `1111ab19` neither the ISSUE-264 match locks nor the gate exist, so the ISSUE-265 cycle cannot form there (§1). Rows written
  after the deployment by normal settles and promotions stay; ISSUE-265 itself writes nothing at deployment.
- **Optional (D-PROD-9):** before the build, copy the current `.next/standalone` and `.next/static` to
  `~/afldb-recovery/<PREV short>-<C0 BUILD_ID>/`, outside the checkout. This follows the DEV host's ISSUE-257 recovery copies, and
  `disk.txt` decides whether it fits. It records the old bundle; the documented rollback still rebuilds.

### 28.3 Scheduled writers and deployment timing

**Intended configuration, from the repository.** This is not PROD's live state, which C0 captures.

| Unit (timer) | Repository schedule | Database writes | Takes the gate at T? |
|---|---|---|---|
| `afldb-settle-afltables` | `04:30`, `RandomizedDelaySec=15min`, `Persistent=true`; `TimeoutStartSec=3600`; routine no-change run about 51 s (wrapper monitoring block) | `settle-afltables.ts --apply --auto-apply --require-complete-source` as `afldb_import` | **yes, shared** (`settle-afltables.ts:1839`) |
| `afldb-settle-afl-api` | `05:00`, 15 min random, `Persistent=true`; `TimeoutStartSec=3600` | `settle-afl-api.ts --apply --auto-apply --require-complete-source` | **yes, shared** (`settle-afl-api.ts:1909`). Its PROD installation is not recorded (C0 decides) |
| `afldb-settle-afl-api-brownlow` | every 5 min (`*:0/5`), not persistent; `TimeoutStartSec=180` | only when `AFLDB_AFL_API_BROWNLOW_ENABLED=true`: `settle-afl-api-fixtures.ts` (fixture-identity spine observations and a batch) and `settle-afl-api-brownlow.ts`. With the flag off, the wrapper exits before any acquisition or database access | **no**: the Brownlow and fixtures settles are unchanged (§18.2) |
| `afldb-email-intake` | 2 min after boot, then every 5 min, `Persistent=true` | none directly: it POSTs to the web route, which **stages** submissions. No promotion | no (staging is not a promotion). Exit 75 during the web restart is expected noise (unit comment) |
| `afldb` (web) | always running | admin **Promote** (legacy promotion); Match Sheet and Data Editor saves; the on-demand "Fetch current AFL data now" starts the AFL Tables unit (needs `AFLDB_SETTLE_TRIGGER=systemd` plus the polkit rule) | promotions take it **exclusively** (`datasets.ts:598`); the Match Sheet, Data Editor, `player_bio`, award writers and direct SQL do not |

**Fixture ingestion.** There is no separate fixture unit in `deploy/`. The only scheduled fixture writer is step 2 of the Brownlow
chain, and it is outside the gate. ISSUE-229's fixture writer is not built. Admin fixture edits are web writes outside the gate.

**Markers.**
- Both nightly wrappers print `AFLDB_SETTLE_SUCCESS label=<label>` as their last step.
- On any non-zero exit they print `AFLDB_SETTLE_FAILURE label=<label> exit=<n>` (AFL Tables) or `AFLDB_SETTLE_FAILURE
  season=<s> exit=<n>` (AFL API, Brownlow).
- The settle CLIs log `Applied as import batch <N>: … <k> unit(s) rolled back. …` (`settle-afltables.ts:412-419`,
  `settle-afl-api.ts:354-359`).
- A gate timeout is the error text "The settle waited 300 s for a legacy CSV promotion to finish, wrote nothing, and was
  stopped. …" (`SettlePromotionGateTimeout`, `settle-core.ts:312-317`).

**Operator-run live checks** are C0's `unit-*`, `timers.txt`, `jobs.txt` and `flags.txt`, and the G-START check below.

**Why deployment must not overlap active work.**
- `npm ci` replaces the `node_modules` that a running `tsx` settle loads lazily.
- `git merge` rewrites wrapper scripts that a running `/bin/sh` reads as it goes.
- The build is CPU-heavy on a 2 vCPU host with PostgreSQL co-located.
- Between the checkout and the restart, the settles already run T while promotions still run the old web bundle, so the gate
  protects only one side. Keep checkout → restart short, and keep both outside any settle or promotion.

**Window (D-PROD-5).** Daytime, for example 10:00–16:00 Australia/Melbourne. At least 60 minutes from any nightly firing, and
never 04:15–06:00. Legacy uploads and promotions, Match Sheet saves and the on-demand settle are paused by agreement for the window
only. No timer is changed.

**G-START, immediately before the checkout** (read-only; stop if any item fails):
1. Every `afldb-settle-*` unit is `inactive`.
2. `systemctl list-jobs` lists no afldb job.
3. Both nightly timers' `NextElapseUSecRealtime` are 60 minutes or more away.
4. The Brownlow flag count is `0`, and its latest run has finished. If the flag is `true`, **stop and decide**: the chain then writes
   every 5 minutes.
5. The `p20-state` gate count is `0`.
6. No `afldb_import` session is `active` or `idle in transaction` (`pg_stat_activity`, same role, so visible).
7. No `import_batches` row is `running`.

**Deployment steps (D1–D7), operator-run after the decisions in §28.8.** The changing part runs **detached**
(`setsid nohup bash <script> > <log> 2>&1 < /dev/null &`), so a dropped SSH session cannot leave `.next` half-written (recorded
PROD practice). The script stops at the first failure (`set -Eeuo pipefail`). Before each of its steps it checks that every
`afldb-settle-*` unit is inactive, and **stops without killing anything** if one is active.
1. **D1.** C0 (§28.2).
2. **D2.** `git fetch origin`. This is a Git mutation of the remote-tracking refs, authorised at the time. Record
   `git rev-parse origin/main`.
3. **D3. Range review** (read-only, saved into a new folder):
   - `git merge-base --is-ancestor HEAD $T`;
   - `git log --oneline HEAD..$T`;
   - `git diff --stat HEAD $T`;
   - `git diff --name-status HEAD $T -- src/db/migrations deploy tools/maintenance/privileges.sql data/reference/seasons.json
     package.json package-lock.json .env.example`.
   - The intersection of `git diff --name-only --diff-filter=A HEAD $T` with C0's untracked paths must be empty, or the
     fast-forward would refuse.
   - **Stop on any migration other than exactly 110**, on any change to an installed unit's repository copy that is not explained,
     or on a register change.
4. **D4.** G-START.
5. **D5. The deployment:**
   - `git merge --ff-only $T`, and verify HEAD;
   - `npm ci --include=dev`;
   - `AFLDB_MIGRATE_TARGET=prod npm run db:status`, expecting exactly `110` pending;
   - `npm run build`, with `AFLDB_ENV` exported;
   - record both BUILD_IDs;
   - `kill "$(systemctl show afldb -p MainPID --value)"`;
   - poll `http://127.0.0.1:3100/api/health` every 2 s for up to 120 s, for HTTP 200 with `status` and `database` both `ok`.
   - **No migration runs in D5.**
6. **D6. C1** (§28.6) from a fresh connection, at least two minutes after the restart.
7. **D7 (D-PROD-3 option B only).** Migration 110 as ISSUE-257's own PROD step, after C1 passes and on its own authorisation:
   `AFLDB_MIGRATE_TARGET=prod npm run db:migrate`, then `db:status` (110/110), with the State B check from ISSUE-257.

**Preflight.** `npm run preflight -- --mode deploy --environment prod --dsn-env AFLDB_PROD_DATABASE_URL --expect-database
afldb_prod` **will FAIL by design** here, for two reasons:
- **The untracked nightly settle manifests.** Deploy mode FAILs on any untracked path; only promotion mode tolerates the known
  `settle-*.json` class (`preflight-core.ts:288-304`).
- **A pending migration**, on the recorded 2026-09-14 PROD behaviour (after the checkout, with 110 pending).

ISSUE-220 stashed the manifests to get a clean run. D-PROD-4 decides between the two approaches. The recommended one: no stash.
Take a tar plus sha256 copy of the manifests, run `--mode read-only`, and record the deploy-mode FAILs with every path listed.
*(Superseded by §28.10.4. Read-only mode still FAILs on pending 110 and drops about ten deploy checks. Also, `db:status` in
C0 and D5 is not read-only (§28.10.3), and the C0 sketch in §28.2 is replaced by the pack in §28.10.6.)*

### 28.4 Passive acceptance (preferred)

**What it uses.** The existing scheduled settles only: no extra settle, no promotion by the operator, no timer change.

**Observation period (D-PROD-6, recommended).**
- It starts at C1.
- It ends at the morning capture after the **second counted AFL Tables run**. Add **one counted AFL API run** if C0 shows that
  unit installed and its ingestion switch on.
- It lasts at most **7 nights**. If fewer runs count within 7 nights, the result is INCONCLUSIVE.
- **Why two.** The first counted run proves that the gated code runs under PROD's real unit, environment, timer and database. The
  second shows that the first left no residue (no held gate, no new or refreshed deadlock finding) and repeats the result.
- **Why a no-change night still counts.** The gate is the first call of every apply transaction, whatever the data. DEV batch 107
  (0 changes) held it (§27.3).

**Nightly capture N-k** (read-only, one new folder per morning, for example 07:00, after both windows; built with the same `cap`
helper):
- **Journals.** For each settle unit since the previous capture: `journalctl -u <unit> -o short-iso-precise` and `-o json`. The
  JSON keeps `_SYSTEMD_INVOCATION_ID`, `_PID` and `__REALTIME_TIMESTAMP` on every line, so the invocation is identified even after
  the unit goes inactive, which is the gap DEV hit (§27.3).
- **Unit and timer state.** `systemctl show <unit> -p Result -p ExecMainStatus -p ExecMainStartTimestamp -p ExecMainExitTimestamp
  -p InvocationID` for each unit, and `LastTriggerUSec` and `NextElapseUSecRealtime` for each timer.
- **Brownlow.** Every Brownlow firing in the interval, and the timer's state **after** it (both were DEV gaps, §27.4).
- **The web unit's journal**, searched for `deadlock detected|40P01`, because the promotion runs in the web process.
- **The PostgreSQL server log** for the interval, searched for `deadlock detected` with its `DETAIL` lines. It is the authoritative
  record of any deadlock, independent of the application's findings. It needs sudo (interactive, operator), at the location
  `p00-target` reported.
- **Database:** `p20-state`, then `p40-after` with `since_batch_id` = C1's `batches_max` and `deployed_at` = C1's
  `ExecMainStartTimestamp`.

**SQL** (read-only; column names as in the DEV pack's `sql/20` and `sql/40`, which ran on DEV):
- **`p20-state`** (diffable):
  - `clock` = `clock_timestamp()`;
  - `target`;
  - `batches_max`;
  - `cap_fp` = the count, the open count and `md5(string_agg(id, severity, entity_id, md5(description), md5(details),
    resolved_at, resolution ORDER BY id))` over `issue_type = 'canonical_apply_failed'`;
  - one `cap_row|id|xmin|open|content-md5` line per such row;
  - `deadlock_fp` = the count and md5 over `id`, `xmin`, `md5(description)`, `md5(details)` and `resolved_at` of every
    `data_issues` row whose `details::text` or `description` matches `~* '(deadlock detected|40P01)'`;
  - `gate` = the count of `pg_locks` rows on `(717275, 4, objsubid 2)` in this database.
- **`p40-after`:** the DEV `sql/40` sections A–G. Section A is widened to `tool IN ('settle-afltables.ts', 'settle-afl-api.ts')`.
  Section C lists every legacy dataset (`match_results`, `player_match_stats`, `match_attendance`) with `error = <exact refusal>`.
- **`p41-submissions`** (R-258-1): counts by dataset and status for those three datasets in `staged`, `validated`, `approved` and
  `failed`, with the minimum and maximum ids.
- **`p30-gate-sample`** (optional G-obs only): `pg_locks` ⋈ `pg_stat_activity` on `(717275,4)`, giving pid, mode, granted,
  `waitstart`, `usename`, `application_name`, `backend_start`, `xact_start` and `client_port`, with `clock_timestamp()`.

**Why fingerprints, not `detected_at`.** A refreshed open finding keeps `detected_at`: `writeSettleDataIssue` runs `ON CONFLICT
… DO UPDATE` over severity, description, details and `entity_id` (`settle-core.ts:522-537`).
- The content md5 catches a refresh that changed the text.
- The per-row `xmin` catches a refresh that wrote identical text.
- A new id catches a new finding.
- Every changed, touched or new row is read (D/E/F) and classified. **Deadlock text → FAIL.** Anything else is context, reconciled
  with that run's `dataIssuesOpened` and `dataIssuesRefreshed` counters.

**A run counts** when all of these hold:
1. Its timer fired (systemd's `Started` line for the unit).
2. Its invocation's journal holds `AFLDB_SETTLE_SUCCESS label=<L>`, with `Result=success` and `ExecMainStatus=0`.
3. It logged `Applied as import batch <N>: … 0 unit(s) rolled back`.
4. Exactly one `completed` batch N of that tool has `started_at` inside the run.
5. `validation_result->>'canonicalApplyFailures' = 0`. For AFL API, use the journal count if that key is absent.
6. There is no gate-timeout text.

**A run does not count, but is not a FAIL by itself:**
- an acquisition failure before any database contact;
- `FAILED_POSTCOMMIT` (`--require-complete-source` or ISR) that **matches the C0 14-day baseline**;
- a "nothing to settle" exit.
Each is recorded with its cause.

**What passive observation proves, and what it does not.**
- **Proves, for the counted runs:** the deployed gated settle code runs under PROD's real units, environment and timers; it takes
  the gate and commits without a gate timeout; no deadlock appears in the journal, the server log or `data_issues` after the
  deployment; and existing findings change only in explained ways.
- **With G-obs (D-PROD-7):** also that a settle held a granted shared `(717275,4)` on PROD. Only settles take the gate in shared
  mode, so a granted `ShareLock` row inside a unit's active interval is a settle's.
- **Does not prove** that a promotion is refused under contention on PROD. That holds unless a real promotion happens to overlap
  a settle's hold, and even then it is shown only by the refusal text plus timing; without G-obs samples there is no lock-level
  proof.
- **Also not proved by passive observation:** the reverse-direction 300 s wait; the AFL API settle, if it is not installed and
  enabled on PROD; and every writer outside the gate.

### 28.5 Controlled promotion on PROD (proposal P-CTRL only; NOT authorised)

**Recommendation: do not run it** unless the operator needs PROD-specific proof of the refusal path.
- The refusal code path is the same commit that DEV proved against a real settle (§27).
- P-CTRL writes permanent audit and batch rows to PROD.

**If chosen (D-PROD-8), it needs its own pack revision and review before any use.**
- **Dataset.** `match_results` with exact restatement (the D-DEV-5 analogue, §26.2): one historical home-and-away PROD match from a
  season before `settle_season - 1`.
- **Candidate selection on PROD.** A PROD revision of `10-candidates.sql` and `15-precheck.sql` selects it. The target checks
  refuse unless the connection is `afldb_prod`. The checks are the same as on DEV: the rendered `match_key` equals the stored key,
  every written column equals its stored value, the match is unique by season, date and clubs, there is no open finding, and there
  is no active `data_overrides` row. **DEV's match 16407 and submission 68 are DEV ids and are not assumed to exist on PROD.**
- **Settle.** Either the scheduled 04:30 run, which needs an operator awake and an arm window of at least 30 minutes against the
  15-minute random delay (the pack's 900 s would not cover it), or an on-demand run. The on-demand run is an extra real settle; it
  needs the polkit rule or an interactive `sudo systemctl start`. No artificial hold, no timer change, no synthetic fixture.
- **Expected writes ("refused, then R").**
  - One `data_submissions` row: staged, validated, approved, then `failed` with the exact refusal, then `promoted`.
  - One `data_submission_rows` row.
  - `auth_audit_log` rows: `upload.staged`, `submission.validated`, `submission.approved` and `submission.promoted`.
  - One `admin-upload` batch, `target_table = match_results`, owning 0 matches.
  - The match row rewritten with identical values (`xmin` moves; the provenance quartet is unchanged), and one consumed `matches`
    identity value.
  - The settle's own batch, snapshot, manifest, ISR revalidation and any real season data.
  - Provenance of the promotion lives in the batch and the submission (§26.2).
- **Risks.**
  - **A missed race** (hold shorter than 5 s): the attempt promotes. The result is INCONCLUSIVE, with writes equal to R's. Another
    attempt needs a new submission and a new decision.
  - **A wrong candidate proof** would INSERT a duplicate match. The precheck refuses that before arming, and the census and
    `matches_owned` detect it afterwards.
  - **Queueing.** A promotion waiting at the gate can delay a later-arriving settle by at most its remaining 5 s (§20.3, shape 1).
- **Evidence:** DEV's G/P/R files with the PROD target, plus §28.4's fingerprints.
- **Cleanup: none.** The rows are append-only audit and provenance, retained as on DEV (pack §6). Deleting them is not proposed.

### 28.6 Criteria, outcomes and evidence

**Three separate verdicts.**

| Verdict | PASS requires | Otherwise |
|---|---|---|
| **Deployment success (DS)**, at C1 | HEAD = T (full SHA). No tracked change, and untracked paths only in C0's classes. Both BUILD_IDs equal, new, and with an mtime after D5 began. `afldb` active/running, with a new `MainPID` and a start after the BUILD_ID mtime, confirmed from a fresh connection at least 2 min later. Local health 200, `ok`/`ok`. Public health over the real network path (the last recorded public host is `beta.afldb.com`; confirm it). `Strict-Transport-Security` present in `.next/routes-manifest.json`. Migration state exactly as D-PROD-3 chose. Every installed unit fragment and timer equal to C0 (sha256). Source pins present (§28.1) | **DEPLOYMENT FAILED** → rollback decision (§28.2). Acceptance does not start |
| **Acceptance (passive)**, at the end of the period | DS PASS. The required counted runs (§28.4). No gate-timeout text. Deadlock checks clean: journals of every afldb unit and of the web, the PostgreSQL log, D/F empty for rows opened since the deployment, and `deadlock_fp` unchanged from C1. Every `cap_fp` change explained and free of deadlock text. Every promotion in the period either succeeded or ended `failed` with the exact refusal text | see below |
| **Closure** | A separate operator decision after an acceptance PASS (D-PROD-10), recorded with the residual limits of §28.7 | the issue stays open |

**FAIL:**
- any deadlock text after the deployment involving a settle or a promotion, wherever it appears;
- a gate timeout that no in-flight promotion explains;
- an error raised by the gate code other than its timeout;
- a deployment-attributable regression of the web service or of a unit.

**INCONCLUSIVE:**
- too few counted runs in 7 nights (no in-progress season, the timer not firing, a unit absent, failures before any database
  contact, or FAILED_POSTCOMMIT matching the baseline);
- unreadable journals or a missing capture;
- a gate timeout explained by a stuck promotion. That is designed behaviour (§20), but it is not acceptance; the run is
  re-checked the next night.

INCONCLUSIVE never becomes PASS by re-reading. It needs more nights or a new decision.

**Required evidence and its timestamp sources.**
- Raw `git rev-parse HEAD` and status.
- Both BUILD_IDs with mtimes.
- `systemctl show` and `systemctl cat` of every unit and timer at C0 and C1.
- Each run's `_SYSTEMD_INVOCATION_ID` from journal JSON, plus `InvocationID` while the unit is active where available.
- Timer `LastTriggerUSec` and `NextElapseUSecRealtime`, and systemd's `Started` and `Finished` lines.
- Timestamp sources:
  - host clock: `date --iso-8601=ns` and epoch, with `timedatectl` for zone and NTP;
  - journal `__REALTIME_TIMESTAMP` (host);
  - PostgreSQL `clock_timestamp()`;
  - `import_batches.started_at`, which is the server's transaction start.
  The database is co-located on PROD, so the host and server clocks are one kernel clock. `p00-target`'s `addresses` line
  confirms this.

**Evidence hygiene.**
- Every capture goes into a **new** folder; `mkdir` refuses an existing one.
- Files are written once, under `noclobber`.
- Each command's text, stdout, stderr and exit status are kept. A failing read-only command is recorded, not hidden or retried
  silently.
- After each capture: `sha256sum * > MANIFEST.sha256` and `chmod a-w`.
- Copy each folder to a **new** workstation directory, `D:\tmp\issue265\run-<stamp>-Prod<Phase>\`, behind a `test ! -e` guard as
  in pack §4.0, then verify the manifest there.
- No DEV or `afldb_test` evidence folder is opened for writing. The DEV run `run-20261006-133026-DevAcceptance` (manifest
  `c0adf47f…038ac`) stays as it is.

### 28.7 Limits carried into any PROD claim

- **DEV did not exercise the AFL API settle or the reverse-direction 300 s wait.** Both are proved on `afldb_test` only (§23, B3,
  B4, B6, B7). PROD passive observation adds the AFL API settle only if that unit is installed, enabled and counted. The 300 s wait
  stays `afldb_test`-only, because nothing here stalls a promotion on purpose.
- **Writers outside the gate stay outside its protection:** Match Sheet and Data Editor saves, `player_bio`, the award datasets,
  the Brownlow and fixtures settles, and direct SQL. ISSUE-261 is separate.
- **The DEV deviations stand as recorded (§27.3, §27.4), and this plan does not alter them:**
  - `BUILD_ID` was checked at deployment and preparation but is absent from the sealed DEV folder.
  - The final unit `InvocationID` is blank; process correlation and the journal label provide the identity.
  - The saved Brownlow journal shows the 13:20, 13:25 and 13:30 disabled no-op runs, but not the 13:35 firing or the timer state
    after the window.
  - The pre-upload baseline was inherited from `out-20261006-122525`, with its origin recorded.
  - Earlier aborted attempts and failed verdicts remain separate.
  §28.4 and §28.6 are designed so that PROD evidence does not repeat the first and third gaps.

### 28.8 Operator decisions required before execution

| ID | Decision | Recommendation |
|---|---|---|
| D-PROD-1 | Target: (A) exactly `cd3cf782`; or (B) a later documentation-only commit, under the §28.1 checks | A |
| D-PROD-2 | Accept that deploying T to PROD also releases everything since PROD's HEAD (at least ISSUE-257, -258 and -264 by the records, with their PROD obligations, including R-258-1), or stop. ISSUE-257's record names `docs/production-promotion.md` for its PROD step; that document governs rebuilt-database promotions, and this plan treats PROD as an **in-place** application deployment. Confirm | accept, as an in-place deployment, after reviewing D3's `git log` |
| D-PROD-3 | Migration 110: (A) application only, PROD stays in State A (Match Sheet changes to player statistics fail closed until 110; rollback stays simple); or (B) 110 applied after C1 passes (D7), as ISSUE-257's separately authorised step, after which rollback needs the guard and becomes roll-forward-only once a record exists | ~~A for this deployment, then (B) on its own authorisation~~ **Superseded by §28.10.2:** B1, meaning 110 in the same window after DS, with Match Sheet player-statistic corrections paused until the first counted night. **Waits for C0** — **B1 APPROVED 2026-10-06 (§28.12.1)** |
| D-PROD-4 | Preflight: accept the documented deploy-mode FAILs with every path listed (`--mode read-only` as the gate), or stash the manifests as ISSUE-220 did | ~~no stash; tar plus sha256 copy, then read-only mode~~ **Superseded by §28.10.4:** no stash and no read-only substitute. Deploy mode is accepted only with the two exact FAILs (known manifests; pending 110 before D7) |
| D-PROD-11 | (added in §28.10.4) Open a separate tooling issue: deploy-mode working-tree classification plus an exact `--expect-pending` | operator's call; outside ISSUE-265 |
| D-PROD-5 | The deployment window, and the pause of uploads, promotions, Match Sheet saves and on-demand settles for the window only | daytime; pause for the window only |
| D-PROD-6 | Observation period and required runs | 2 counted AFL Tables runs, plus 1 AFL API run if installed and enabled; at most 7 nights |
| D-PROD-7 | Optional G-obs: a read-only `p30` sampler (one `psql` session, `\watch 1`, bounded by `timeout`) across one nightly window | optional; useful as lock-level PROD evidence at near-zero risk |
| D-PROD-8 | P-CTRL (§28.5) | do not run, unless PROD-specific refusal proof is required |
| D-PROD-9 | Recovery copy of the current `.next` before the build | yes, if `disk.txt` shows room |
| D-PROD-10 | The closure basis: passive PASS plus the DEV and `afldb_test` evidence, with §28.7's limits stated | the operator's call; recorded at closure, not now |
| D-PROD-12 | (added in §28.11.7) The installed AFL Tables service is the 2026-09-02 revision | do not reinstall in this window; record the drift. **APPROVED 2026-10-06 (§28.12.1)** |
| D-PROD-13 | (added in §28.11.7) How N-k reads the server log and systemd's own journal lines, which `arm` cannot | interactive sudo reads (O1/O2 shape). **APPROVED 2026-10-06 (§28.12.1)** |

**Prerequisite work, after approval and before execution (agent, offline):** assemble a PROD capture pack. It holds `p00`, `p20`,
`p30`, `p40`, `p41`; the `cap`-based C0, C1 and N-k scripts; the detached D5 script with its settle-active guard; and the three DEV
pack DSN helpers (`lib/env-file.mjs`, `lib/dsn-env.mjs`, `lib/dsn.sh`) copied unchanged and hash-verified. It gets offline checks
(`bash -n`, `node --check`, no CR bytes) and a manifest. No SQL has been executed anywhere in preparing this plan.

### 28.9 State

ISSUE-265 **stays open**. This section is a plan, **not executed**. PROD deployment, PROD acceptance and closure are pending
operator decisions D-PROD-1..10. Nothing was deployed, and no host, database, Git state or evidence was touched by this pass.
*(Superseded in part by §28.10: D-PROD-3 and D-PROD-4 are re-analysed, D-PROD-11 is added, and the C0 pack exists.)*

### 28.10 Refinement and the C0 capture pack (2026-10-06, second pass; agent, offline) — §28 still **NOT EXECUTED**

> **Authorisation for this pass:** local read-only repository inspection, offline checks, and documentation and pack edits. No
> Git mutation or fetch, no host or database contact, no deployment, no migration. **Done:** files were read; Git objects were read
> with read-only commands only (`git --no-optional-locks` `log`, `diff`, `show`, `ls-tree`, `merge-base --is-ancestor`, `cat-file`);
> a new pack folder and its archive were written under `D:\tmp\issue265\`; a stubbed dry run was made in the session scratchpad
> against a throwaway repository. **Nothing ran on PROD, DEV or any database.** No existing evidence folder was opened for writing.

#### 28.10.1 The in-place release against ISSUE-257's rebuilt-database promotion guidance

ISSUE-257's closure says "PROD promotion is a separate, separately authorised sequence (`docs/production-promotion.md`)"
(`issues/closed/AFLDB-ISSUE-257.md` §0, §19.5). That document is titled "Promoting a **rebuilt** database to a live database". Its
ISSUE-257 requirements, and whether an in-place release meets them:

| # | Requirement | Source | Why it exists | In-place release |
|---|---|---|---|---|
| R1 | Replay `player_match_stats` overrides after `players` and `matches`, before `rebuild_derived.py` | `docs/production-promotion.md:1339-1374` (§8) | A rebuild re-creates canonical rows from sources. The reinstated human authority must be re-applied to them | **Not applicable.** Nothing is re-created. At ledger 109 the CHECK cannot hold such a record, so there is nothing to replay. Running the replay in place would be an unrequired canonical write (the ISSUE-156 lesson) |
| R2 | Gate A4.4 predicts unresolvable records before a swap | same §8; `db-promotion-check --phase restored/candidate` | Refuse a swap whose replay would fail | **Not applicable** (no candidate, no swap) |
| R3 | The D-257-7 guard before any application rollback below ISSUE-257 | `docs/production-promotion.md:1600-1605` (§10); `docs/deployment.md:1461-1477` (§11) | The old application cannot run against migration 110 | **Applies equally** and is already in §28.2's rollback |
| R4 | The rebuild tooling's own replay (`common.py` branch; fitzRoy reload) | ISSUE-257 §18.13 sequence item 1 | Future rebuilds and reloads | Ships with the code; an in-place release does not run it |
| R5 | Ship all new code → confirm State A → apply 110 and accept → "(4) Repeat on PROD"; keep (1)→(3) short. "**PROD:** no mutation required." | ISSUE-257 §18.13 (`:1031-1042`), §18.14 (`:1084`) | The deploy order of migration 110 | **This is itself an in-place sequence**, and the in-place release is how it is met |

**Finding: compatible.** The obligations that `docs/production-promotion.md` carries for ISSUE-257 bind only a rebuilt-database
promotion. The sequence ISSUE-257 designed for PROD (§18.13) is an in-place one. Its §19.5 citation names a document, not a
requirement that PROD be rebuilt. A **future** rebuilt-database promotion of PROD stays bound by R1 and R2 once PROD holds
`player_match_stats` records. The closed ISSUE-257 runbook was not edited.

#### 28.10.2 Application first, migration 110 second: dependent paths, State A behaviour, evidence

Every path in T that depends on migration 110, and how it behaves under the old CHECK (State A):

| Path | Code | State A behaviour | Class |
|---|---|---|---|
| Match Sheet save that changes any player row | `src/db/queries/match-sheet.ts:196-202` → `buildMatchSheetAuthorityWrites` (`src/lib/acquisition/match-sheet-authority.ts:807-816`) | Whole save refused before any write: "Durable Match Sheet authority is not available until migration 110 is applied; nothing was saved." (`:780-781`) | **Fail-closed refusal, and a lost working function.** At `1111ab19` the same save succeeds (without durable authority, which is the ISSUE-257 defect) |
| Match Sheet save that changes nothing | `match-sheet-authority.ts:815` | No probe, no write | works |
| Return to source, authority panel, `deleteMatch` guard | `match-sheet.ts:387-399` (`loadMatchAuthority`) | No record can exist: nothing to return, an empty panel, no deletion block | nothing to act on (new in ISSUE-257; not a lost function) |
| AFL Tables and AFL API settles | `manual-authority.ts:173-179`, `:266-282` | `player_match_stats` answered from rows → `clear`; period scores and Brownlow still proven by the narrow CHECK | works as at `1111ab19` |
| Legacy promotion authority check (ISSUE-264) | `src/lib/ingest/datasets.ts:901-971` | No record → no refusal | works |
| Rekey carry; AFL API identity-correction STOP | `match-rekey.ts:304-335`; `correct_afl_api_identity.ts` | Nothing to carry or stop | works |
| Rollback guard | `tools/db/issue257-rollback-guard.ts` | "State A", 0 rows, PERMITTED | works |

**Evidence that exists.**
- **Database-free:** `tests/match-sheet.test.ts:466-473` (State A refusal; a no-change save writes nothing).
- **`afldb_test` / `code_test_db`** (ISSUE-257 §19.4): `admin-brownlow` 43/44 in State A, with the same single failure (attributed to
  ISSUE-263) in State B; `code_test_db` old-CHECK C4 7/7 and a 77/77 sweep; `data-editor -t "F-S9-03"` 7/7 State A no-ops. The
  State-dependent integration cases branch on the live CHECK, so each run proves one branch only.
- **ISSUE-265's own windows:** Phase B 11/11 ran in State A (§23.1); the regression window ran its four suites in State B (§25.1).
- **DEV, real data** (ISSUE-257 §19.4 "State A stage", 2026-10-03): settle batch 99 with no new refusal class against batch 91;
  a Match Sheet change refused with no write. Migration 110 was applied at 20:36, about 17 minutes after the State A settle.

**Assessment.**
- **The gap is mandatory.** The old application with the new CHECK is unsafe (ISSUE-257 §18.13, last two rows).
- **State A is evidenced as safe for data integrity**, at all three levels above.
- **State A is not free.** Match Sheet player-statistic corrections are refused for its whole duration, and ISSUE-257 §18.13 asks
  for (1)→(3) to be kept short.
- **The earlier recommendation is not supported.** §28.8 recommended "A for this deployment, then B on its own authorisation",
  which would be a State A lasting the whole observation period (up to 7 nights). ISSUE-257's design does not support that.
- **The evidence supports a short, same-window gap.**
- **Rollback stays simple in State B.** While zero records exist, the guard is PERMITTED (restore migration 102's CHECK, then the
  application). Pausing Match Sheet player-statistic corrections by agreement until the first counted night keeps rollback as
  simple as it is in State A.
- **One schema state for the whole observation period** also removes a confounder from ISSUE-265's passive acceptance.

**D-PROD-3, revised options.** The choice waits for C0, because the ledger and the CHECK may show 110 already applied.
- **B1 (recommended on the evidence).** D7 runs in the same window, immediately after the DS checks pass, and C1 is taken after it.
  Match Sheet player-statistic corrections are paused by agreement until the morning capture after the first counted AFL Tables
  run. One record written earlier makes the release roll-forward-only.
- **A (an explicit trade only).** State A through the observation period (at most 7 nights), with every Match Sheet
  player-statistic correction refused throughout. Then 110 on its own authorisation.
- **Refused:** 110 before the new application is live.

#### 28.10.3 A migration file in the checkout is not a migration applied

- **After `git merge --ff-only`, `110_…sql` is a file only.**
  - Nothing applies a migration as a side effect. `package.json` has no install or build lifecycle hook (its scripts at `:8-40`).
    `npm run build` is `next build` plus `prepare-standalone`. The service runs `deploy/server-cluster.mjs`.
  - A search of `src/`, `deploy/`, `tools/build/`, `next.config.ts` and `package.json` found one deployment-time caller of
    `db:migrate`: `deploy/sync-dev.ps1`.
- **Applied means a ledger row.** That is `afldb_meta.schema_migrations`, written in the same transaction as the SQL
  (`tools/db/migrate.ts:287-298`).
- **The application never reads the ledger.** It decides State A or B from the live CHECK (`manual-authority.ts:638-653`). C0
  records both: `p01` for the CHECK, `p02` for the ledger.
- **What `npm run db:migrate` does.** It applies every pending migration in order, each in its own transaction. Its default
  target is `dev`, which is `AFLDB_OWNER_DATABASE_URL` (`migrate.ts:78-83`, `:128`), unless `--target` or `AFLDB_MIGRATE_TARGET`
  says otherwise. **On PROD, an untargeted `npm run db:migrate` migrates whatever `AFLDB_OWNER_DATABASE_URL` names in PROD's
  `.env`.** C0 records that name's redacted identity (`40-env-names.txt`).
- **`npm run db:status` is not read-only.** It runs `CREATE SCHEMA IF NOT EXISTS afldb_meta` and `CREATE TABLE IF NOT EXISTS …`
  as the owner before its status branch (`migrate.ts:242-250`, `:274`), and it fails in a read-only session.
- **The only deployment script is DEV's, and it is wrong for this release.** `deploy/sync-dev.ps1` defaults to the DEV host
  (`:30`). It runs `git pull --ff-only` (a branch tip, not a SHA), plain `npm ci`, and then `npm run db:migrate` (all pending,
  default target) **before** `npm run build` and the restart, unless `-SkipMigrate` (`:139-152`). That is the migration-first order
  migration 110 forbids, so it **must not be used for PROD**.
- **`docs/deployment.md` §3 also migrates before building** (`:65-73`). That was right for 106–109 (ISSUE-220) and is wrong for 110.

#### 28.10.4 Deploy-mode preflight and the settle manifests

- **Why deploy mode FAILs.** `worktreeFinding()` (`tools/dev/preflight-core.ts:289-316`) returns FAIL for any non-empty
  `git status` in every mode except `promotion` (classified) and `read-only` (WARN).
  - The classification of tracked, known and unknown paths (`classifyWorktreeStatus`, `:267-286`) was added for promotion only
    (ISSUE-243, `:250-258`). Deploy mode prints only a count, never the paths.
  - The nightly settle writes `docs/rebuild-manifests/afltables_fitzroy_core/settle-*.json` into the checkout, and those files
    are untracked. Every nightly run therefore makes deploy mode FAIL.
- **What `read-only` mode loses, against `deploy`.**
  - **Downgraded from FAIL to WARN:** clean working tree (count only); local `main` exists; local `main` contained; behind
    `origin/main`; migration name collisions; branch-local migrations (also non-strict); migration inventory errors; `.env`
    present; `psql` available.
  - **Dropped:** branch must be `main`; ahead of `origin/main`; the default DSN and database; the refusal of a `*_test` target.
  - **Not relaxed:** the database checks. `pending-migration`, `checksum-mismatch` and `unknown-applied-migration` are FAIL in every
    mode (`preflight-core.ts:245-246`), and a detached HEAD fails every mode (`:149`).
  - **So §28.3's "read-only as the gate" was wrong twice.** It drops about ten deploy checks, and after the checkout it still FAILs
    on pending 110.
- **Resolution (D-PROD-4, revised). No tool change in T, no stash, no read-only substitute.**
  - Run `--mode deploy` unmodified at its point in D5: after `git merge --ff-only` and `npm ci --include=dev`, before the build.
    Under B1, run it again after D7.
  - **Accept it only if every FAIL is one of exactly two:**
    1. `working tree is clean`, and a classification taken in the same session (the pack's `lib/classify-worktree.sh`, which uses
       the repository's own regex) shows tracked 0, unknown 0, sync-dev-only 0 and fast-forward collisions 0. The known manifests
       must equal C0's set, plus any a nightly settle wrote since.
    2. `migration pending-migration` naming exactly `110_match_sheet_player_match_stats_authority.sql`, and only before D7.
  - **Any other FAIL stops the deployment.** This mirrors ISSUE-257's DEV exception of 2026-10-03 (ISSUE-257 §19.4), and it keeps
    every deploy check.
- **Follow-up, outside ISSUE-265 and not opened in this pass: D-PROD-11.** A tooling change would remove the exception: deploy mode
  that classifies the working tree as promotion does, lists the paths, and takes an exact `--expect-pending <name>`. The same
  problem was met by ISSUE-220 (a stash), ISSUE-257 (an exception) and ISSUE-265.

#### 28.10.5 Further corrections to §28.1–§28.3

- **The range, computed offline** from the local Git objects, not refreshed by a fetch:
  - `1111ab19` is an ancestor of `cd3cf782`, with 26 commits between them (`c64fade4` … `cd3cf782`).
  - Deployment-relevant changes: **migration 110 only**, and `deploy/afldb-settle-afl-api.service` plus
    `deploy/afldb-settle-afl-api-brownlow.service` (`6661eb66`, the ISSUE-232 deny list).
  - No change to `package.json`, `package-lock.json`, `privileges.sql`, `seasons.json`, `.env.example`, `next.config.ts`,
    `tools/build`, `tools/dev`, `migrate.ts`, `migration-safety.ts`, any wrapper script, `afldb.service`, or the AFL Tables
    unit and timer.
  - T adds 36 paths.
  - D3 still re-checks all of this on the host after the fetch.
  - *(Corrected by §28.11.6: "migration 110 only" plus the two unit files understates the range. It also changes web, settle,
    tooling and data behaviour, each listed there with its obligation.)*
- **The installed AFL API units.** If C0 finds them installed, they keep PREV's shorter deny list after T, because a checkout never
  reinstalls a unit. That is a credential-boundary matter for ISSUE-232, not for ISSUE-265.
- **§28.2's C0 `cap` sketch is superseded** by the pack (§28.10.6), and so is its `db:status` item. §28.3's D5 `db:status` is
  replaced by the deploy-mode preflight (which reads the ledger read-only) or by `p02`.
- **`log_directory`.** §28.2 said `p00-target` prints it. It is a superuser-only setting, and `pg_settings` hides it from
  `afldb_import`. The log location now comes from `pg_lsclusters`. Its content needs sudo when the log is not group-readable
  (pack O1).
- **`npm ci --include=dev`.** §28.2's reason, "PROD's `.env` sets `AFLDB_ENV=production`, so plain `npm ci` would prune `tsx`", is
  **unsupported**: npm does not read `.env`, and ISSUE-220's PROD rollout ran plain `npm ci` and then vitest 24/24 (ISSUE-220 §0a).
  `--include=dev` is kept as an explicit choice. C0 records `npm config get omit` and `NODE_ENV`.

#### 28.10.6 The C0 pack, revision r1 (prepared offline; NOT RUN)

- **Location:** `D:\tmp\issue265\prod-c0-pack-r1\`, 21 files plus `MANIFEST.sha256` (manifest sha256 `e27217be…1f8c`).
- **Archive:** `D:\tmp\issue265\prod-c0-pack-r1.tar`, sha256 `2f22cd3a1f2a415b22da11e42559a37391b8cfbef6192282e6d197171f5328e1`.
- **Read this first:** `README-PROD-C0.md`.
- **What it captures.**
  - Host and clock; revision, branch and refs; the classified working tree, with the fast-forward collision check and a tar
    of the manifests.
  - `deploy/` against PREV and T; the migration files present.
  - Both BUILD_IDs and HSTS; the web unit, health, listener, cgroup and environment **names**.
  - All five units (fragment, drop-ins, and the installed hash against PREV, T and HEAD); four timers; jobs; processes, by
    command name only; polkit.
  - `.env` names, the non-secret flags and the redacted DSN identities, including what an untargeted `db:migrate` would hit; the
    npm `omit` setting.
  - 14 days of settle journals; the web journal's lock lines; the PostgreSQL log location and any `deadlock detected` it can read.
  - The repository preflight at HEAD in read-only and deploy modes.
  - The database captures, all read-only: `p00` (target and settings), `p01` (live CHECK and guard count), `p02` (ledger, owner
    DSN), `p05` (ingestion switches, app DSN), `p20` (fingerprints), `p30` (gate), `p40` (14-day baseline), `p41` (R-258-1
    census), `p42` (activity), `p50` (D-265-13 timing).
- **Copied unchanged and hash-verified** against the DEV revision 4 manifest: `lib/env-file.mjs`, `lib/dsn-env.mjs`, `lib/dsn.sh`
  and `sql/30-gate-sample.sql` (now `p30`). `p50` is this runbook's §16 file, unchanged.
- **Offline checks run:**
  - `bash -n` on all five shell files and `node --check` on both `.mjs` files: OK. No CR bytes and no zero-byte files.
  - The classifier fixture test: 8 of 8 cases correct.
  - A stubbed end-to-end dry run against a throwaway repository: control flow, quoting, per-command exits, role routing,
    `PGOPTIONS` read-only, no credential value in the evidence, and a manifest that verifies. It proves nothing about PROD's
    real output.
- **Every SQL file except the unchanged `p30` copy is UNTESTED.** `p00`, `p20` and `p40` are derived from DEV-executed files.
  `p01`, `p02`, `p05`, `p41` and `p42` are new. `p50` has never run. The compatibility and permission review is in the pack's
  README §5.
- **Operator commands** (README §3; three SSH connections):
  1. Workstation: `sha256sum -c MANIFEST.sha256`, and the archive hash.
  2. `scp D:\tmp\issue265\prod-c0-pack-r1.tar afldb:issue265-prod-c0-pack-r1.tar`.
  3. On PROD: unpack into a new folder, verify, then `bash ~/issue265-prod-c0-pack-r1/c0-capture.sh`.
  4. `scp -r` the printed `~/issue265-prod/C0-<stamp>` to a new `D:\tmp\issue265\run-<stamp>-ProdC0\`, behind a `Test-Path`
     guard, then `sha256sum -c` it there.
  - **Optional O1** (sudo; separate authorisation): `deadlock detected` lines from the server log, into its own sealed folder.

#### 28.10.7 Unresolved blockers

1. **C0 has not run.** PROD's actual HEAD, ledger, CHECK, units, timers, switches and baselines are unknown. Everything below
   depends on them.
2. **D-PROD-3** (B1 or A) and **D-PROD-4** (the two-FAIL exception rule) need operator decisions.
3. **There is no D5 deployment script, by instruction.** It is written only after C0 and the decisions.
4. **Every PROD SQL revision is untested** until C0 runs. A failing item is recorded, not hidden, and may need a pack revision.
5. **If PROD's HEAD is not `1111ab19`, or is detached,** the range, the expected hashes and the preflight analysis must be redone.
   A detached HEAD fails every preflight mode.
6. **Whether the AFL API units are installed and enabled is unknown,** so the number of counted runs required is unknown
   (D-PROD-6).

#### 28.10.8 Which decisions can be taken now, and which wait for C0

- **Now (C0 does not inform them):**
  - D-PROD-1: target A, exactly `cd3cf782`.
  - D-PROD-2: accept the 26-commit range as an in-place release (§28.10.1, §28.10.5).
  - D-PROD-4: the exception rule (§28.10.4).
  - D-PROD-8: P-CTRL, recommended not run.
  - D-PROD-10: the closure basis, decided at closure.
  - D-PROD-11 (new): open a separate tooling issue for the deploy-mode preflight, or not.
- **Wait for C0:**
  - **D-PROD-3:** the ledger and the CHECK (110 may already be applied), and whether any Match Sheet activity must pause.
  - **D-PROD-5:** the real timer schedule, the Brownlow flag, and any active job or session.
  - **D-PROD-6:** which settle units are installed, and the AFL API switches.
  - **D-PROD-7:** `pg_stat_activity` visibility and the timer windows.
  - **D-PROD-9:** free disk.
  - **The R-258-1 handling:** the `p41` census.
  - **The explanation of any installed-unit drift.**

#### 28.10.9 State

**§28 remains NOT EXECUTED.** ISSUE-265 stays open. Nothing was deployed, migrated, fetched or run on any host or database.
Next: the operator runs C0 (pack README §3) and returns the folder. The agent grades it against README §4 and then asks for the
decisions that waited for C0.
*(Superseded in part by §28.11: C0 ran and is graded there. §28.10.5's range bullet is corrected in §28.11.6.)*

### 28.11 C0 graded (operator-run on PROD 2026-10-06 18:16:57–18:17:06 +11:00; graded by agent from the saved copy) — deployment **NOT AUTHORISED**

> **Authorisation for this pass:** local read-only inspection of the evidence and the repository, read-only local Git object
> reads (`git --no-optional-locks` `merge-base --is-ancestor`, `rev-list`, `log`, `diff`, `diff-tree`, `show`), and documentation
> edits. **Not done:** no host, SSH or database contact; no fetch or other Git mutation; no migration; no unit or timer change; no
> evidence edit. The sealed C0 folder was only read. C0's overall `exit 0` means the capture ran to the end, **not** that every
> check passed.

#### 28.11.1 Evidence integrity

- **Folder:** `D:\tmp\issue265\run-20261006-181657-ProdC0\` (PROD `~/issue265-prod/C0-20261006-181657`).
- **`MANIFEST.sha256` file hash:** `dbb3e5cc5258cbf24f1d1f346e183c6d80c1cacd5b5dd8b21d586a31f34c1b09`, equal to the expected value.
- **Listed files:** 46 of 46 verified, 0 mismatched, 0 missing. **Inventory:** 47 files on disk, the 46 listed plus
  `MANIFEST.sha256` itself. No unlisted file, no subfolder, and no `7x-SKIPPED.txt` (p00 passed, so every database item ran).
- **Cross-checks:** the copied `12-settle-manifests.tar` hashes to `a683c950…c2529`, the value PROD printed inside `12`. The pack
  self-verified on PROD (`00`: 21/21 OK, its manifest `e27217be…1f8c`, equal to the local pack).
- **`exits.tsv`:** 42 items, 34 with exit 0 and 8 non-zero (§28.11.2). The other three data files (`11-status-porcelain.z`,
  `11-known-manifests.z`, `12-settle-manifests.tar`) are by-products of items `11` and `12`.
- **Host and clock:** `afldb-prod`, user `arm` (groups `arm sudo users`), Ubuntu kernel 6.8.0-137, 2 vCPU, 3,915 MB RAM, no swap,
  up 51 days. Australia/Melbourne (AEDT, +11:00), NTP synchronised. Node v22.23.2 (the settle wrappers' default path exists), npm
  10.9.8, psql 16.15, git 2.43.0. The whole capture took 9.4 s.

#### 28.11.2 The eight non-zero items, one by one

| # | Item (exit) | Command that failed and its diagnostic | Class | Deployment blocker? |
|---|---|---|---|---|
| 1 | `30-unit-afldb-settle-afl-api.service` (1) | `systemctl cat` → `No files found for afldb-settle-afl-api.service.` `systemctl show`: `LoadState=not-found`; helper `VERDICT not-installed` | **Absent unit** (README §4.2 expected class) | No. It does mean there is no AFL API settle on PROD to count (D-PROD-6) |
| 2 | `30-unit-afldb-settle-afl-api-brownlow.service` (1) | same: `No files found…`, `LoadState=not-found`, `VERDICT not-installed` | **Absent unit** | No. No 5-minute Brownlow/fixtures writer exists on PROD |
| 3 | `30-unit-afldb-email-intake.service` (1) | same: `No files found…`, `LoadState=not-found`, `VERDICT not-installed` | **Absent unit** | No |
| 4 | `31-timers` (1) | `systemctl cat` → `No files found for afldb-settle-afl-api.timer.` (and the same for `-brownlow.timer` and `afldb-email-intake.timer`), each `VERDICT not-installed`. The AFL Tables timer is loaded, enabled and identical to the repository | **Absent timers** | No |
| 5 | `33-polkit` (2) | `ls: cannot open directory '/etc/polkit-1/rules.d/': Permission denied` [exit 2]; then `sha256sum: '/etc/polkit-1/rules.d/*afldb*': Permission denied` [exit 1]. The glob stayed literal because the directory cannot be listed | **Permission** (root-only directory); a minor capture robustness defect (the loop hashes an unexpanded glob) | No. The rule's installed state is **unknown**. It matters only for the on-demand settle, and `.env` has no `AFLDB_SETTLE_TRIGGER=systemd` (count 0), so the web never asks systemd to start a settle. The rule file is unchanged in the range |
| 6 | `40-env-names` (2) | `describe_dsn AFLDB_PROD_IMPORT_DATABASE_URL` → `… is not defined in /home/arm/projects/afldb/.env` [exit 2]; the same for `AFLDB_PROD_AUTH_DATABASE_URL` [exit 2]. All other commands exit 0 or an accepted `exit 1` | **Absent names**, reported as a failure because the pack treats an undefined name as an error (capture-script exit semantics, not a fault) | No. Both are operator maintenance DSNs (ISSUE-224/251) that no deployment or settle step reads |
| 7 | `61-preflight-deploy` (1) | `FAIL working tree is clean — 36 changed/untracked path(s)`. `Preflight result: BLOCKED (1 blocker(s), 1 warning(s))`. The warning is `SSH reachability was not requested` | **Expected baseline FAIL** (§28.10.4, exception class 1) | Not now; **graded again at D5** (below) |
| 8 | `80-disk` (2) | `ls: cannot access '/home/arm/afldb-recovery': No such file or directory` [exit 2]. The command was marked `allow1`, but `ls` exits 2 for a missing path | **Capture-script defect** (wrong accepted exit code); the true answer is "absent" | No. `df` shows 65 GB free (77 GB, 16 % used) |

**Item 7 in detail.** It has exactly one FAIL. Every other deploy-mode check passed: repository root, branch `main`, contains
local `main`, `origin/main` ahead 0 / behind 0 (as last fetched on PROD; no fetch ran), migration-name collisions, `.env`, the
MSYS guard, `git`, `psql`, `pg_restore`, `AFLDB_PROD_DATABASE_URL` present, the database reachable as `afldb_owner` on
`afldb_prod`, and **migration parity 109/109**. The FAIL's count, 36, equals the classification taken in the same session
(`11-worktree`): `tracked=0`, `known_operational=36`, `sync_dev_only=0`, `unknown_untracked=0`, `ff_collisions=0`, `VERDICT
only-known-operational-artefacts`. **This is consistent with exception class 1 at C0 time. It is not an approval.** D-PROD-4's rule
applies at D5, after the checkout, and is graded there on that run's own output: every FAIL must be class 1 (with the known set
equal to C0's 36 plus manifests written since) or class 2 (`pending-migration` naming exactly `110_…`, before D7). Any other FAIL
stops the deployment. Read-only mode (`60`) gave `READY (0 blocker(s), 1 warning(s))` with parity 109/109.

**Defects of the pack (r1) for any later revision; none invalidates this C0:** item 8's accepted exit code; item 6's exit semantics
for optional names; item 5's glob over an unreadable directory; and the journal items below, which cannot show systemd's own lines
to `arm`.

#### 28.11.3 Actual PROD state at C0

| Area | Captured fact | Source |
|---|---|---|
| Revision | HEAD `1111ab193882566b7ba7e3fc8d69b2f7c62c6c40` on `refs/heads/main` (not detached), committed 2026-10-01 15:56 +10 "fix(deploy): restore ISSUE-220 credential boundary". Local `main` and `refs/remotes/origin/main` are the same SHA, ahead 0 / behind 0, **as of PROD's last fetch** (freshness unknown). T `cd3cf782` is **not present** locally (expected before D2). One worktree, no stash. Remote `origin` uses the deploy-key alias `github.com-afldb-deploy` | `10` |
| Worktree | 0 tracked changes; 36 untracked paths, all known settle manifests under `docs/rebuild-manifests/afltables_fitzroy_core/` (`settle-2026-09-02-1958` … `settle-2026-2026-10-06-0437`); 0 unknown; 0 collisions with T's 36 added paths. A tar copy is in the folder. No manifest exists for 2026-09-23 to 2026-09-27; the 31 manifests up to 2026-10-01 04:36 all carry mtime 2026-10-01 18:10:57 +10 (rewritten during the ISSUE-220 rollout). C0 does not establish why | `11`, `12` |
| `deploy/` | 17/17 equal to PREV. Against T exactly two differ: `afldb-settle-afl-api.service` and `afldb-settle-afl-api-brownlow.service` | `13` |
| Migration files | 109 files, last `109_import_reads_player_match_period_stats.sql`; `110_…` and `tools/db/issue257-rollback-guard.ts` absent | `14` |
| Build | `.next/BUILD_ID` = `.next/standalone/.next/BUILD_ID` = `rjrdXKga5b7MBY_LjXA06` (mtimes 2026-10-01 18:06:30 and 18:08:51 +10). `server.js` 18:08:51. HSTS present (count 1). 0 `.env*` files under standalone. Sizes: standalone 824 MB, static 3.0 MB, `node_modules` 676 MB | `20` |
| Web | `afldb` active/running, enabled, `MainPID=1892284` since 2026-10-01 18:09:58 AEST, `NRestarts=0`, no drop-ins, two `next-server` workers. Local health `{"status":"ok","database":"ok"}` HTTP 200; listener `127.0.0.1:3100`; cwd the checkout. Process environment names: `DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL`, `AFLDB_AUTH_DATABASE_URL`, the session and SMTP secrets, `AFLDB_ENV`, `NODE_ENV`, `AFLDB_WORKERS`, `AFLDB_POOL_MAX`. No `AFLDB_TRACE_REQUESTS`, no `AFLDB_SETTLE_TRIGGER` | `21` |
| Installed units | `afldb.service` = PREV = T (`a3444840…149a`), identical to the checkout. **`afldb-settle-afltables.service` DRIFTS** (§28.11.4). The AFL Tables timer = PREV = T, identical. AFL API, Brownlow and e-mail intake services and timers: **not installed** | `30-*`, `31` |
| Timer | `afldb-settle-afltables.timer`: `OnCalendar=*-*-* 04:30`, `RandomizedDelaySec=15min`, `Persistent=yes`. Last trigger 2026-10-06 04:37:58 AEDT; next elapse 2026-10-07 04:41:18 AEDT. The service's last run: 04:37:58–04:38:38, `Result=success`, `ExecMainStatus=0` | `30`, `31` |
| Active work | No systemd job; no failed unit; the only matching process is the web `node` (pid 1892284). `pg_stat_activity`: two `afldb_app` sessions (state not visible to `afldb_import`); no other `afldb_import` session. No `running` batch | `32`, `77`, `73` |
| Flags and register | `in_progress_seasons` `[2026]`. `.env`: `AFLDB_AFL_API_BROWNLOW_ENABLED=true` count 0; `AFLDB_SETTLE_TRIGGER=systemd` count 0; `AFLDB_ENV=production` count 1; `NODE_ENV` defined once (value not read). No `AFLDB_REVALIDATE_SECRET` or `_URL`, so post-settle ISR invalidation is inert on PROD (season pages refresh on their ISR hour). Ingestion switches: `site_settings` has **no** `acquisition.%` row (`switch_count 0`) | `40`, `41`, `79` |
| DSN identities (redacted) | `DATABASE_URL` afldb_app; `AFLDB_IMPORT_DATABASE_URL` afldb_import; `AFLDB_AUTH_DATABASE_URL` afldb_auth; `AFLDB_OWNER_DATABASE_URL` **afldb_owner on `afldb_prod`**; `AFLDB_PROD_DATABASE_URL` afldb_owner on `afldb_prod`. All `localhost:5432`, one definition each, password present. So an untargeted `db:migrate` on PROD would migrate `afldb_prod` itself. `AFLDB_PROD_IMPORT_*` and `AFLDB_PROD_AUTH_*` are not defined | `40` |
| npm | `npm config get omit` and `include` empty; `NODE_ENV` unset in the shell; `tsx` and `vitest` links present (2026-10-01 18:00). A plain `npm ci` in this shell would install devDependencies; `--include=dev` stays an explicit choice | `40` |
| Server and session | PostgreSQL 16.15, server `::1` = client `::1` (co-located). `deadlock_timeout` 1 s; `log_lock_waits` off; `logging_collector` off; `log_destination` stderr; no idle timeouts; `statement_timeout`/`lock_timeout` set by the client only. `afldb_import` belongs to no monitoring role; 3 superuser-only settings hidden | `70` |
| **Ledger** | **109 rows**, last `109_import_reads_player_match_period_stats.sql`; **`ledger_110 = f`**. 001–105 applied 2026-09-27T20:53Z (the rebuilt-database promotion), 106–109 applied 2026-10-01T06:47Z (ISSUE-220) | `72` |
| **Live CHECK** | One `data_overrides` entity CHECK, **13 literals**, does **not** admit `player_match_stats` (`check|t|…|13|f`). **Guard 0** (no `player_match_stats` authority row). Overrides by entity: `players` 92 (all active) | `71` |
| Batches and findings | `max_id=45`; `running=0`; `admin_upload=0`. `canonical_apply_failed`: 36, all open, **all `xmin` 43538** (one transaction: AFL API settle batch 32). `deadlock_fp 0|none`. **Gate 0**; `p30` empty | `73`, `74` |
| **Legacy submissions (R-258-1)** | `p41` returned **no rows and no error**: `data_submissions` holds no row of any dataset or status visible to `afldb_import`. Section C of `p40` agrees for the window | `76`, `75` |
| Disk and memory | `/` (and `~`): 77 GB, 12 GB used, **65 GB available**. Memory ~3.0 GB available. `~/afldb-recovery` absent. `arm` has no crontab | `80`, `81` |

**State A confirmed.** The ledger has no 110, the CHECK does not admit `player_match_stats`, and no authority row exists. D-PROD-3
can be decided on this basis (§28.11.7).

#### 28.11.4 Installed-unit drift: `afldb-settle-afltables.service`

- **Installed:** `/etc/systemd/system/afldb-settle-afltables.service`, sha256 `f777395a…2b77`, mtime 2026-09-03 05:55:47 +10, no
  drop-ins. **Repository (PREV = T = HEAD):** `ac8d6085…715b`.
- **Identified by local Git objects:** the installed file is byte-identical to `887263a5:deploy/afldb-settle-afltables.service`
  (2026-09-02, "Add ISSUE-122 AFL Tables production scheduling"), the unit's first revision. Three later repository revisions were
  never installed: `7c66ae78` (ISSUE-134, a comment), `5987ac2e` (adds `AFLDB_DEV_DATABASE_URL` to `UnsetEnvironment=`) and
  `7f242ecc` (ISSUE-244 I244-F029, a comment).
- **Directive difference:** only `UnsetEnvironment=`, which lacks `AFLDB_DEV_DATABASE_URL`. The rest of the diff is comments
  (the revalidation secret and `AFLDB_SKIP_DOTENV`). The DEV host showed the same difference on 2026-10-06, reported by the
  operator during the DEV acceptance preparation; it is not recorded in §27.
- **Effect on PROD today: none.** PROD's `.env` does not define `AFLDB_DEV_DATABASE_URL` (`40`), so there is nothing to strip. The
  `AFLDB_SKIP_DOTENV` behaviour lives in the wrapper script, which runs from the checkout and is already current.
- **The range does not touch this unit** (`git diff 1111ab19 cd3cf782` lists no change to the AFL Tables service, timer, wrapper or
  the polkit rule). The drift is pre-existing and outside ISSUE-265. It needs a recorded decision, D-PROD-12 (§28.11.7).

#### 28.11.5 Journals, batch history and deadlock findings

**Visibility limits (read first).**
- `arm` is not in `adm` or `systemd-journal` (`50`: "You are currently not seeing messages from other users and the system").
  Lines the units' own processes write (uid `arm`) are visible. **systemd's own `Started`, `Finished`, `Failed` and `Deactivated`
  lines are not.** So a run that failed before the wrapper printed anything would not appear in `51`, and §28.4's counting
  criterion 1 ("systemd's `Started` line") cannot be met from `arm`'s view.
- The PostgreSQL server log (`/var/log/postgresql/postgresql-16-main.log` and `.1` … `.7.gz`, `postgres:adm 0640`) is **not
  readable** by `arm` (`56`, `57`). **The authoritative deadlock record is MISSING from C0.** Deadlocks are logged at ERROR
  regardless of `log_lock_waits`, so the log would show them.

**AFL Tables settle journal (`51`, `54`).** The 14-day query returned entries only from **2026-09-28 12:20:23 +10:00** to
2026-10-06 04:38:38 +11:00. That is 9 invocations, each with `AFLDB_SETTLE_SUCCESS`, `SOURCE COMPLETENESS: COMPLETE` and
`Applied as import batch N: 0 canonical row(s) inserted, 0 updated, 0 ledger row(s), 0 retried after resolution, 0 refused at the
write, 0 unit(s) rolled back`:

| Batch | Label | Start (local) | Kind |
|---|---|---|---|
| 37 | `settle-2026-2026-09-28-1220` | 2026-09-28 12:20 +10 | unit invocation off the timer schedule (trigger not visible) |
| 38–45 | `…-09-29-0445`, `…-09-30-0438`, `…-10-01-0436`, `…-10-02-0444`, `…-10-03-0445`, `…-10-04-0437`, `…-10-05-0442`, `…-10-06-0437` | 04:36–04:45 nightly | scheduled nightly window, every night 2026-09-29 to 2026-10-06 |

All nine are **successful no-op runs**. Each run took about 35–40 s by journal timestamps (for example 04:37:58 → 04:38:38). The
`[warning] … foreign_source_owner` lines each run prints are the report of the 36 open findings, not new findings (`p20`: every
row's `xmin` is still 43538).

**Batch history (`75`, `78`).** The 14-day window is 2026-09-22 07:17Z → 2026-10-06 07:17Z, but this database only holds settle
rows from **2026-09-27 21:04Z**: it was promoted on 2026-09-27 (ledger 001–105 applied at 20:53Z). In the window: 13 AFL Tables
batches (29, 34–45) and 1 AFL API batch (32), all `completed`, `apply_failures` 0, none `running`, `failed` or `rolled_back` at
any time. No promotion batch, no legacy submission.
- **Batches 29, 32, 34, 35 and 36 have no line in the unit journal.** 29 (07:04 +10, snapshot `settle-2026-2026-09-22-0444`) and
  32 (AFL API, 07:11–07:12 +10, 36 findings opened) were run on 2026-09-28 morning; 34–36 at 12:11–12:17 +10. C0 does not show how
  they were started. They are recorded as **not from the unit journal; origin not established by C0**.
- AFL Tables batches record no duration (`completed_at = started_at`); the single AFL API batch took 82.7 s. No overlap is
  assessable for AFL Tables (`78` §6c).

**Missing evidence.**
- 2026-09-22 18:17 → 2026-09-28 12:20 +10: no unit-journal entries, and no manifests for 2026-09-23 to 2026-09-27. Whether the
  timer fired and failed, or did not fire, is **not established**.
- No `Started`/`Finished`/`Failed` line for any run (permission).
- No PostgreSQL server log (permission).

**Deadlock findings.** None anywhere C0 could see: no `deadlock detected`, `40P01`, gate or 300 s text in any settle journal
(`54`); none of `deadlock detected|40P01|55P03|lock timeout|canceling statement` in the web journal (`55`); no
`canonical_apply_failed` or other `data_issues` row mentioning a deadlock, at any time (`75` D and F, `deadlock_fp 0`). This is
**absence in the visible sources**, not proof: the server log was unreadable.

**AFL API and Brownlow journals (`52`, `53`):** `-- No entries --`, consistent with the units being absent.

**Observation period.** Journal-evidenced: **2026-09-28 12:20:23 +10:00 → 2026-10-06 04:38:38 +11:00** (about 7.7 days, 9 runs,
all successful no-ops). Database-evidenced: 2026-09-27 21:04Z → 2026-10-05 17:38Z. Nothing before 2026-09-27 21:04Z exists in
this database.

#### 28.11.6 The release range, recomputed (corrects §28.10.5)

Computed from local Git objects only: `1111ab19` (captured PROD HEAD) is an ancestor of `cd3cf782` (exit 0); **26 commits**;
`115 files changed, 35,459 insertions, 968 deletions` (77 modified, 36 added, 1 renamed, 1 deleted). The renamed and deleted paths
are runbooks under `issues/`. Unchanged across the range: `package.json`, `package-lock.json`, `tools/maintenance/privileges.sql`,
`data/reference/seasons.json`, `.env.example`, `next.config.ts`, `tools/build`, `tools/dev`, `tools/db/migrate.ts`,
`afldb.service`, the AFL Tables service, timer and wrapper, `server-cluster.mjs` and the polkit rule.

> **Correction.** §28.10.5 said the deployment-relevant changes were "migration 110 only, and" the two AFL API unit files. That
> is **incomplete**. The range also changes web-process behaviour (ISSUE-256, -257, -258, -264, -265, -232), settle behaviour from
> the moment of `git merge` (ISSUE-255, -257, -265), rebuild/promotion tooling, and tracked data (ISSUE-225). The earlier line is
> kept above as written.

**When each change takes effect.** Settles compile from the checkout, so their code switches at `git merge`. The web process
switches at the build and restart. Rebuild and promotion tools change only when someone runs them.

| Issue (commits) | What changes | Files (non-test) | Takes effect | Release obligation on PROD |
|---|---|---|---|---|
| ISSUE-257 (`92f2bdf6`, `a27f7104`, `39a9fed1`) | Durable Match Sheet authority over source-owned player statistics: authority writes on save, the authority panel and Return to source, a `deleteMatch` guard, settles that honour records, rekey carry, identity-correction STOP; a client-bundle fix for Brownlow entry; mobile layout | `match-sheet.ts`, `match-sheet-authority.ts` (new), `MatchSheetEditor.tsx`, `data-editor/actions.ts`, `page.tsx`, `match-admin.ts`, `canonical-apply.ts`, `manual-authority.ts`, `manual-source-key.ts` (new), `match-rekey.ts`, `settle-afltables.ts`, `settle-afl-api.ts`, `settle-core.ts`, `afl-api-identity-correction.ts`, `brownlow/entry.ts` | web at restart; settles at merge | **Migration 110 after the application is live** (State A until then: a Match Sheet save that changes a player row is refused, nothing saved). Rollback in State B needs `tools/db/issue257-rollback-guard.ts` (PERMITTED while 0 records). D-PROD-3 |
| ISSUE-257 tooling | Rebuild replay of `player_match_stats` decisions; preflight before the fitzRoy reload's delete; promotion inventory/check/dependencies; rollback guard (new); identity-correction rehearsal and CLI | `tools/migration/common.py`, `import_fitzroy_core.py` (rebuild path only: `--require-in-season` refuses database work at `:3507`, so the nightly chain is unaffected), `correct_afl_api_identity.ts`, `tools/db/promotion-*.ts`, `issue257-rollback-guard.ts`, `afl-api-identity-correction-rehearsal.ts` | only when run | None at deployment. A **future rebuilt-database** promotion of PROD is bound by R1/R2 (§28.10.1) once records exist |
| ISSUE-257 migration | `110_match_sheet_player_match_stats_authority.sql` (new). **The only migration in the range** | — | only when `db:migrate` runs | As above. Never before the new application |
| ISSUE-258 (`e7b57ede`) | Legacy CSV intake keeps existing optional figures when a column is absent or malformed | `src/lib/ingest/datasets.ts` | web at restart | **R-258-1:** re-validate any pre-deployment legacy submission before promoting it. C0 census: **zero submissions exist** (`76`). Re-check at G-START |
| ISSUE-264 (`ebbe2c00`) | Legacy promotion respects Match Sheet authority (refuses protected fields, no re-insert of removed players) | `datasets.ts`, `pipeline.ts`, `manual-authority.ts`, `match-sheet.ts` | web at restart | None beyond the 110 order; inert while no record exists |
| ISSUE-265 (`cd3cf782`; checkpoint `62f2cd67`) | Settles take the gate shared (300 s / 330 s); the three legacy promotion hooks take it exclusively; `match_attendance` ordered | `settle-core.ts`, `settle-afltables.ts`, `settle-afl-api.ts`, `datasets.ts`, `admin-fixtures.ts` (comment), `docs/admin-and-beta.md`, `.gitattributes`, `eslint.config.mjs` | settles at merge; promotions at restart | Keep merge → restart short and outside settles and promotions (§28.3); passive acceptance (§28.4) |
| ISSUE-232 (`6661eb66`) | AFL API and Brownlow unit deny lists widened; the admin units panel and `settle-trigger.ts` read `LoadState`, so an uninstalled unit shows as not installed rather than idle | `deploy/afldb-settle-afl-api.service`, `deploy/afldb-settle-afl-api-brownlow.service`, `AflApiSettleUnitsPanel.tsx`, `settle-trigger.ts`, docs | unit files: only if installed (**they are not**, `30`); panel at restart | None for this deployment. Installing those units is ISSUE-232's own, separately authorised step |
| ISSUE-255 (`f6d189d0`) | AFL API settle suppresses unused-emergency `player_match_stats` rows | `afl-api-bundle.ts`, `afl-api-settle-plan.ts`, `settle-afl-api.ts`, `tools/current-season/settle-afl-api.ts` | AFL API settle only; **no AFL API unit on PROD** | None while the unit is absent |
| ISSUE-256 (`3e98fb7b`) | NL search rejects unsupported career-ranking metrics instead of failing internally | `src/search/nl/plan.ts`, `src/db/queries/nl/player-career.ts` | public search at restart | None recorded. A user-visible behaviour change; an optional smoke query after C1 |
| ISSUE-225 (`4c0dfb39`) | Seven co-captaincy rows in the tracked CSV; Gridley known-answer adjudications (test corpus); importer tweak | `data/awards/captaincies.csv`, `data/players/gridley-known-answer-adjudications.csv` (new), `tools/migration/captaincies.py`, `tools/db/rebuild-test.ts`, `tools/validation/issue225-dev-acceptance-probe.ts` (new), `.gitignore` | only on a captaincies reload or rebuild | None at deployment. PROD's `captaincies` stays as it is; ISSUE-225 records "PROD was not changed; it needs its own promotion decision" |
| Documentation and repository hygiene | Tracker and runbook commits (`c64fade4`, `30b36ef0`, `9e1da6b1`, `2940cdb2`, `e4026bb2`, `5a85226c`, `2574d138`, `6a0891c1`, `17f7d9f5`, `1c1a4805`, `3ed70ab1`, `14c289e8`, `7d02e781`, `09feda5c`, `4b59cb3e`); `docs/deployment.md`, `docs/production-promotion.md`, `docs/architecture.md`, the acquisition doc, `README.md`, `playbooks/issue.md` (new), `.phaneslight/config.json`; `.gitattributes` adds `-text` lines for newly added files only | — | none | None. `.gitattributes` touches no existing tracked file, so the checkout should not report tracked changes; C1 checks this |

**D3 still re-checks the range on the host after the fetch.** These figures are from the workstation's object store, which holds the
same SHAs.

#### 28.11.7 Decisions this C0 informs (recommendations; none is taken here)

| ID | What C0 shows | Recommendation |
|---|---|---|
| D-PROD-1 | HEAD is the recorded `1111ab19`; T is absent on PROD and needs D2's fetch | A: exactly `cd3cf782`, unchanged |
| D-PROD-2 | The range is 26 commits with the content of §28.11.6, not "110 and two deny lists" | Accept as an in-place release only with §28.11.6's table in view |
| D-PROD-3 | **State A**: ledger 109, `ledger_110 = f`, CHECK 13 literals without `player_match_stats`, guard 0 | **B1** stands: 110 in the same window after the DS checks, Match Sheet player-statistic corrections paused until the morning after the first counted AFL Tables night |
| D-PROD-4 | Deploy mode's only FAIL now is the 36 classified known manifests | Rule unchanged; graded at D5 on that run's output (§28.11.2) |
| D-PROD-5 | One timer only, 04:30 + up to 15 min; no Brownlow, AFL API or intake writer; no on-demand trigger; no submissions | Daytime window as proposed; G-START items 1, 3, 4 reduce to the AFL Tables unit and timer |
| D-PROD-6 | No AFL API unit, no `acquisition.%` switch row | **Two counted AFL Tables runs**, at most 7 nights; no AFL API run is required or possible. §28.7's AFL API limit stays |
| D-PROD-7 | `afldb_import` cannot see other roles' states but `pg_locks` is unrestricted | Optional, as before |
| D-PROD-9 | 65 GB free; the old bundle is about 827 MB | Yes: the recovery copy fits |
| **D-PROD-12 (new)** | The installed AFL Tables unit is the 2026-09-02 revision (§28.11.4); no effect today | **Do not reinstall in this window**: keep C1's unit hashes equal to C0 and avoid a sudo step unrelated to ISSUE-265. Record the drift; reinstalling it is a separate hardening step |
| **D-PROD-13 (new)** | `arm` cannot read systemd's lines or the server log | For N-k: either an interactive sudo read each morning (O1 + O2 below), or replace §28.4 criterion 1 with `systemctl show` `LastTriggerUSec`/`InvocationID` plus the unit's own `_SYSTEMD_INVOCATION_ID` from `journalctl -o json`, and accept the server log as missing (then a deadlock can only be excluded from the journals and `data_issues`). Recommendation: sudo reads, so the PROD record does not repeat DEV's gaps |

#### 28.11.8 Optional follow-up evidence (prepared; NOT RUN; separate authorisation; sudo, interactive)

C0 stays sealed and is never re-run into its folder. One SSH session on PROD, one new sibling folder, read-only:

```bash
O=~/issue265-prod/C0-20261006-181657-sudo; test ! -e "$O" && mkdir "$O" || { echo "REFUSED: $O exists"; exit 1; }
# O1: deadlock blocks in every server log file (authoritative deadlock baseline)
sudo bash -c 'for f in /var/log/postgresql/postgresql-16-main.log*; do echo "== $f"; case "$f" in *.gz) zcat -- "$f";; *) cat -- "$f";; esac | grep -n -B2 -A6 "deadlock detected"; echo "[grep exit ${PIPESTATUS[1]}; 1 = none]"; done' > "$O/o1-pglog-deadlocks.txt" 2>&1; echo "exit=$?" >> "$O/o1-pglog-deadlocks.txt"
# O2: systemd's own lines for the AFL Tables unit over C0's window, and the oldest retained entry
sudo journalctl -u afldb-settle-afltables --since "2026-09-22 18:17" --until "2026-10-06 18:17" -o short-iso-precise --no-pager | grep -E "Started|Finished|Failed|Deactivated|Consumed|AFLDB_SETTLE_(SUCCESS|FAILURE)" > "$O/o2-systemd-lines.txt" 2>&1; echo "exit=$?" >> "$O/o2-systemd-lines.txt"
sudo journalctl -u afldb-settle-afltables -o short-iso-precise --no-pager | head -n 3 > "$O/o2-oldest.txt" 2>&1; echo "exit=$?" >> "$O/o2-oldest.txt"
( cd "$O" && sha256sum * > MANIFEST.sha256 ) && chmod a-w "$O"/* "$O"
```

It answers two open points only: whether any deadlock appears in the server log before deployment, and whether the timer fired
(and how runs ended) between 2026-09-22 and 2026-09-28. Neither is a deployment blocker by itself; both make the acceptance
baseline complete. Copy it back to a new `D:\tmp\issue265\run-20261006-181657-ProdC0-sudo\` behind a `Test-Path` guard.

#### 28.11.9 Blockers and state

**Blockers to any deployment step:**
1. **No authorisation.** D-PROD-1..13 are undecided. **Deployment is NOT AUTHORISED.**
2. **No D5/C1/N-k scripts exist** (by instruction). They are written offline only after the decisions, and the N-k design depends
   on D-PROD-13.
3. **Remote freshness is unknown.** D2's fetch and D3's range review on the host must still confirm that `origin/main` holds
   exactly T (or a documentation-only successor under §28.1).
4. **D5's preflight is ungraded until it runs.** C0's single FAIL is consistent with the rule; the post-checkout run must be graded
   FAIL by FAIL.

**Not blockers, recorded:** the absent AFL API, Brownlow and intake units and timers; the unknown polkit rule (no on-demand trigger
configured); the absent `AFLDB_PROD_IMPORT/AUTH` names; the pre-existing AFL Tables unit drift (D-PROD-12); the missing server log
and systemd lines (D-PROD-13, O1/O2).

**State.** ISSUE-265 **stays open**. §28 remains **NOT EXECUTED** apart from C0, which is graded here. PROD is unchanged by this
pass. Smallest next step: the operator decides D-PROD-3 (B1), D-PROD-12 and D-PROD-13 (with the decisions §28.10.8 marked "now");
O1/O2 is optional and runs only on its own authorisation.
*(Superseded in part by §28.12: D-PROD-3, -12 and -13 were decided; O1/O2 is replaced by the gates pack's `sudo-capture.sh`.)*

### 28.12 Decisions of 2026-10-06 and the gates pack r1 (D2, D3, D4, D5 re-grading, D-PROD-13) — deployment **NOT AUTHORISED**

> **Authorisation for this pass:** the operator approved D-PROD-3, D-PROD-12 and D-PROD-13, and asked the agent to continue
> through the remaining gates, including D2 remote-freshness verification and D5 re-grading. **Deployment is not authorised.** The
> approval is **not** an exception for the current deploy-mode preflight FAIL. **Done by the agent:** local reads; read-only
> `git --no-optional-locks` object reads of the workstation repository; a new pack folder and archive under `D:\tmp\issue265\`;
> offline checks; stubbed dry runs in the session scratchpad against a throwaway `--shared` clone and a throwaway bare
> "remote" (the only Git writes, all inside the scratchpad). **Not done:** no host, SSH, GitHub or database contact; no fetch or
> other Git mutation in any real repository; no evidence edit.

#### 28.12.1 Decisions recorded

| ID | Decision (operator, 2026-10-06) | Effect on the plan |
|---|---|---|
| **D-PROD-3** | **B1, approved.** Migration 110 in the same window, after the deployment-success checks; Match Sheet player-statistic corrections paused until the morning after the first counted AFL Tables night | D7 follows DS in the same window; C1 is taken after D7; preflight is graded `d5-pre110` before D7 and `d5-post110` after it |
| **D-PROD-12** | **Approved: do not reinstall the AFL Tables unit in this window.** The drift (`887263a5` revision, §28.11.4) stays recorded | C1's unit check compares against C0's installed hash `f777395a…2b77`, **not** the repository copy |
| **D-PROD-13** | **Approved: interactive sudo read-only captures** of the journal and the server log | §28.4 counting criterion 1 is met from systemd's own `Started`/`Finished` lines read with sudo; the server log enters every N-k. `sudo-capture.sh` (below) is the tool |

**Still open:** D-PROD-1, -2, -4, -5, -6, -7, -8, -9, -10, -11. **D-PROD-4 is not approved**, so no deploy-mode preflight FAIL is an
accepted exception, the current one included.

#### 28.12.2 What "D2 remote-freshness verification" and "D5 re-grading" can and cannot mean today

- **D2 runs on PROD**, as `git fetch origin` in PROD's checkout (§28.3). That is a Git mutation of PROD's remote-tracking refs and an
  outward network call, so it is **operator-run**, on its own authorisation, with the gates pack's `g2` script. The agent cannot
  run it and has not.
- **What the workstation knows (not freshness):** its own `origin/main` is `cd3cf782`, set by the operator's push at
  2026-10-06 09:41:27 +11:00 (reflog). No fetch has run since. PROD's remote branch set at C0 equals the workstation's except
  `main` and `origin/HEAD`.
- **D5 cannot be re-graded until D5 runs**, because the graded run is the deploy-mode preflight **after** the checkout. What exists
  now is the **grader** and a **static prediction**, both below. The future D5 script calls the grader; nothing here runs D5.

#### 28.12.3 The static prediction (from `tools/dev/preflight.ts`, `preflight-core.ts` and `tools/db/migration-safety.ts`)

| When | HEAD / `origin/main` | Predicted deploy-mode FAILs | Must PASS |
|---|---|---|---|
| C0 (graded) | 1111ab19 / 1111ab19 | WT only (36 known manifests) | parity 109/109; branch relationship 0/0; collision-free |
| **After D2, before the checkout** | 1111ab19 / T | WT; `branch relationship to recorded origin/main` with `ahead: 0; behind: 26` (deploy FAILs when behind, `preflight.ts:168-169`); `migration missing-base-migration` for 110 (the checkout lacks a base-ref migration, `migration-safety.ts:133-137`, error severity) | parity 109/109 (the database is compared with the checkout's 109) |
| **D5, after `merge --ff-only T` and `npm ci`** | T / T | WT (C0's 36 plus any manifest written since); exactly one `migration pending-migration`: `110_match_sheet_player_match_stats_authority.sql is pending in the target database.` (`migration-safety.ts:159`) | branch relationship 0/0; collision-free (no unmerged ref claims a migration number or name differently) |
| **After D7** | T / T | WT only | parity 110/110 |

- **Collision check, predicted clean.** `findMigrationConflicts` scans every ref not merged into `origin/main` (`relevantRefs`,
  `migration-safety.ts:239-252`). Against the workstation's refs with T as base, three remote refs stay unmerged
  (`origin/fwab/next-16`, `origin/opus/issue-166-admin-fetch-auth-bypass`, `origin/sonnet/issue-224-s9-unblock`). None holds a
  migration name absent from T or a same-named file with different content. Refs GitHub holds that neither host has fetched are
  unknown, and `g2` item 60 re-checks this on PROD after the fetch.
- **`git diff --shortstat` is not comparable across checkouts.** The dry run showed 35,460 insertions where the workstation shows
  35,459: the 1111ab19 `.gitattributes` lacks T's `-diff` line for one fixture, so that file is counted as text. Item 50 compares
  only the commit list, the `--no-renames` path list, migration blobs and `deploy/` hashes, which do not depend on attributes.

#### 28.12.4 The gates pack r1 (prepared offline; NOT RUN on PROD)

- **Location:** `D:\tmp\issue265\prod-gates-pack-r1\`, 20 files plus `MANIFEST.sha256` (file hash
  `071dc08eb4d263f4771210232810f9de175f0e8f92b3a7cbdf7c34e80d693c67`). **Archive:** `D:\tmp\issue265\prod-gates-pack-r1.tar`,
  sha256 `e4ec2313da3d995c5f5f692649be7aa67db37fafd0cc6d696f67164e39d9e27b`. Read `README-PROD-GATES.md` first.
- **`g2-fetch-and-range.sh --i-authorise-d2-fetch` (D2 + D3).** Refuses without the flag, unless HEAD is `1111ab19` on `main`, with
  a tracked change, with the AFL Tables unit not inactive, or between 04:15 and 06:00. Its only state change is `git fetch origin`
  (no prune). It records `git ls-remote` before and after and the refs before and after. It proves HEAD, `main`, the index and the
  porcelain status unchanged. Verdicts:
  - `FRESH T-EXACT`, the only one that continues unchanged;
  - `DOC-ONLY-SUCCESSOR`, which needs D-PROD-1 option B (undecided);
  - `STOP non-documentation-successor`, `STOP T-not-on-origin-main`, `STOP T-not-fetched`, `STOP remote-moved-during-capture`,
    `STOP remote-not-read`.
  D3: commit list (26), `--no-renames` path list (116 lines), migration blobs (110), `deploy/` hashes (17) and added paths (36) are
  each diffed against the offline `expected/`, plus exactly `A 110` and exactly the two AFL API units. It also runs the migration
  collision prediction on PROD's refs and the deploy-mode preflight post-fetch baseline, graded `post-fetch` (`AS-PREDICTED`
  confirms the second row of §28.12.3 and approves nothing).
- **`g4-gstart.sh` (D4).** Read-only, 13 checks: HEAD/branch, `origin/main` = T, worktree (tracked 0, unknown 0, every C0 manifest
  present), every settle unit inactive, no job, timer ≥ 60 min, outside 04:15–06:00, Brownlow flag 0 and no on-demand trigger,
  health 200 ok/ok, gate 0, no running batch, no other `afldb_import` session active or idle in transaction, and **R-258-1** (no
  open `match_results`/`player_match_stats`/`match_attendance` submission). Its PASS is valid only at the moment taken; D5 re-runs it.
- **`lib/grade-preflight.mjs` (D5 re-grading).** Grades one deploy-mode transcript FAIL by FAIL, using the classification taken in
  the same session, under profiles `c0`, `post-fetch`, `d5-pre110` and `d5-post110`. Anything outside the classes, an unexpected
  WARN, a count mismatch, a vanished C0 manifest, a tracked or unknown path, a second or different pending migration, a wrong role,
  behind `origin/main` or a truncated transcript gives `BLOCKED`. **If every FAIL is inside its class, the verdict is
  `BLOCKED-PENDING-D-PROD-4` while D-PROD-4 is unapproved.** `ACCEPTED-UNDER-D-PROD-4` needs an explicit `--rule-approved yes`,
  which nothing in the pack passes.
- **`sudo-capture.sh <LABEL> "<since>" "<until>"` (D-PROD-13).** `sudo -v` once, then `sudo -n` reads only. It captures:
  - the server log file list, every `deadlock detected` block with context, and per-file counts of deadlocks and lock-timeout
    cancels;
  - systemd's own lines for the three settle services and timers;
  - the AFL Tables unit's journal JSON (`__REALTIME_TIMESTAMP`, `_SYSTEMD_INVOCATION_ID`, `_PID`, `JOB_RESULT`, `EXIT_STATUS`);
  - the oldest retained entry and the journal disk usage;
  - the web unit's lock and restart lines.
  Every redirection runs as `arm`, and it ends with `sudo -k`. It replaces §28.11.8's O1/O2 and serves both the C0 supplement and
  every N-k morning.
- **Unchanged copies** of C0 r1's `classify-worktree.sh`, `prod-roles.sh`, `dsn.sh`, `dsn-env.mjs` and `env-file.mjs` (hashes
  verified). `lib/capture.sh` fixes C0 r1's disk-item defect (`runsh … accept=1,2`).
- **Offline checks:**
  - `bash -n` and `node --check`: all OK. No CR bytes and no zero-byte files.
  - The grader on the **real** C0 files: `c0` → `AS-PREDICTED`; `d5-pre110` → `BLOCKED` (no pending 110), correctly.
  - The grader self-test: **18/18**.
  - Stubbed dry runs (throwaway clone and remote; stubbed `systemctl`, `curl`, `psql`, `sudo`, `journalctl`):
    - `g2`: refused without the flag. With it, `FRESH T-EXACT`, every D3 comparison IDENTICAL, `PREDICTED-COLLISION-FREE` over 22
      unmerged refs, and HEAD, `main` and the worktree unchanged. A tracker-only successor gave `DOC-ONLY-SUCCESSOR`; a `src/`
      successor gave `STOP non-documentation-successor`.
    - `g4`: 13/13 with healthy stubs; an open legacy submission failed D4.
    - `sudo-capture`: arguments quoted correctly.
    - No stub password reached any evidence file.
  - These prove control flow and comparisons only. **`sql/g4-gstart.sql` has never run.**

#### 28.12.5 Operator sequence (pack README §3; one PROD session, three SSH connections)

1. Workstation: verify the pack manifest and the archive hash; `scp` the archive up.
2. PROD: unpack into a new folder and verify. Then:
   - (a) the C0 supplement, `sudo-capture.sh C0SUPP-20261006-181657 "2026-09-22 18:17" "2026-10-06 18:17"` (authorised by
     D-PROD-13);
   - (b) **only on its own authorisation**, `g2-fetch-and-range.sh --i-authorise-d2-fetch` (D2 + D3).
   Outside 04:15–06:00, with the AFL Tables unit inactive.
3. Copy both folders back into new `D:\tmp\issue265\run-<name>-Prod\` folders behind `Test-Path` guards, then verify each manifest.
   The agent grades them. `g4` is not part of this session; it belongs immediately before a checkout.

#### 28.12.6 Blockers and state

1. **Deployment is NOT AUTHORISED.**
2. **D-PROD-4 is not approved.** Even a fully in-class D5 preflight grades `BLOCKED-PENDING-D-PROD-4`, so D5 cannot proceed until it is.
3. **D2 has not run.** Remote freshness and PROD's post-fetch refs are unproven.
4. **No D5, C1 or N-k script exists.** They are written offline only after D2 is graded and the deployment decisions are taken.
   They will call `g4-gstart.sh`, `lib/grade-preflight.mjs` (`d5-pre110`, then `d5-post110` after D7) and `sudo-capture.sh`.
5. Still undecided: D-PROD-1 (the pack's comparisons assume option A), -2, -5, -6, -7, -8, -9, -10, -11.

ISSUE-265 **stays open**. §28 remains **NOT EXECUTED** beyond C0. PROD is unchanged by this pass.

### 28.13 The C0 sudo supplement graded (operator-run on PROD 2026-10-06 19:19:44–19:19:48 +11:00; graded by agent from the saved copy) — deployment **NOT AUTHORISED**

> **Authorisation for this pass:** local read-only inspection of the evidence, the C0 folder, the gates pack and the repository,
> and documentation edits. **Not done:** no host, SSH or database contact; no fetch, Git command or other mutation; no evidence
> edit. **D2 was not run.** The supplement's overall exits are 0, which means only that each capture ran to the end. Every
> conclusion below rests on the captured content.

#### 28.13.1 Evidence integrity

- **Folder:** `D:\tmp\issue265\run-SUDO-C0SUPP-20261006-181657-20261006-191944-Prod\` (PROD
  `~/issue265-prod/SUDO-C0SUPP-20261006-181657-20261006-191944`).
- **`MANIFEST.sha256` file hash:** `533706af8e76bc095eb7d26707d968ab1905bbb0e45171912423d602bb939a4a`, equal to the expected value.
- **Listed files:** 12 of 12 verified, 0 mismatched, 0 missing. **Inventory:** 13 files, the 12 listed plus the manifest. There is
  no subfolder and no zero-byte file.
- **`exits.tsv`:** 11 items, all `0`. The twelfth listed file is `exits.tsv` itself.
- **Pack on the host:** item `00` prints the pack manifest `071dc08e…3c67`, equal to §28.12.4, and `pack-verified`. The script that
  ran is `sudo-capture.sh` of gates pack r1, label `C0SUPP-20261006-181657`.
- **Host and window:** `afldb-prod`, user `arm` (`uid=1000`, groups `arm sudo users`). Window `--since "2026-09-22 18:17"`
  `--until "2026-10-06 18:17"`, in host local time: 2026-09-22 08:17Z → 2026-10-06 07:17Z. The whole capture took 3.1 s.
- **Sensitive content:** none. The folder holds no credential, DSN or SQL literal. There are no server-log excerpts, because there
  were no matches.
- **How an accepted exit is read.** `runsh` runs each command under `bash -o pipefail`, and `cap` writes stdout and stderr into the
  item file. So `[exit 1: accepted]` on `reader | grep` means grep found no match, or a reader exited 1. A reader that failed would
  have printed its own error (a sudo password prompt, `gzip: … unexpected end of file`) into the item. No item contains one, and
  each sudo item starts with `sudo -n true` → `sudo-timestamp-valid`.

#### 28.13.2 PostgreSQL server log: deadlock blocks and lock-error counts

**Files (`10`):** eight files under `/var/log/postgresql/`, `postgres:adm 0640`. The rotations are weekly:

| File | Size | Last write (mtime) | Approximate content |
|---|---|---|---|
| `postgresql-16-main.log` | 2,243 | 2026-10-06 18:17:22 +11 | 2026-10-04 → 2026-10-06 18:17:22 |
| `.log.1` | 18,810 | 2026-10-04 00:00:01 +10 | 2026-09-27 → 2026-10-04 |
| `.log.2.gz` | 2,178 | 2026-09-27 00:00:01 +10 | 2026-09-20 → 2026-09-27 |
| `.log.3.gz` | 2,354 | 2026-09-20 00:00:01 +10 | 2026-09-13 → 2026-09-20 |
| `.log.4.gz` | 63,472 | 2026-09-13 00:00:01 +10 | 2026-09-06 → 2026-09-13 |
| `.log.5.gz` | 14,949 | 2026-09-06 00:00:01 +10 | 2026-08-30 → 2026-09-06 |
| `.log.6.gz` | 2,320 | 2026-08-30 00:00:01 +10 | 2026-08-23 → 2026-08-30 |
| `.log.7.gz` | 6,845 | 2026-08-23 00:00:01 +10 | up to 2026-08-23; first line not captured |

The "Approximate content" column is inferred from the rotation times. No first or last line was captured. The live log was last
written at 18:17:22, 16 s after C0 finished, and not again before the capture read it at 19:19:45. What was written at 18:17:22 was
not captured.

**Result (`11`, `12`).**
- Each file was searched whole, outside the window too. `grep -n -B2 -A8 "deadlock detected"` matched **nothing in any of the
  eight files** (`11`).
- An independent second pass counted per file (`12`): **`deadlock=0` and `lock_timeout=0`** (`canceling statement due to lock
  timeout`) in all eight.
- **Dates, database, statements, attribution:** none, because there is no block to attribute. The server log covers the whole
  cluster, so the zero holds for every database on it, not only `afldb_prod`.
- **Would a deadlock have been logged?** Yes, on C0's settings (`70`): `log_min_messages = warning` and `log_min_error_statement =
  error`, both default. A deadlock ERROR, with its `DETAIL` and `STATEMENT`, is written to this log. `logging_collector` is off and
  `log_destination` is `stderr`; the Debian cluster wrapper writes that stream to these files.

**Why this is more than "the capture exited 0"**, and its limits:
- The positive basis:
  - sudo was valid inside the same item;
  - no reader error was captured;
  - two separate read passes agree file by file;
  - the file list, sizes and rotation dates are consistent with readable, non-empty files.
- **Limit: there is no positive control.** No per-file line count, first or last timestamp, or known-present string was captured.
  A file that read as empty without an error would also give 0. This is unlikely, but the evidence does not exclude it.
- **Not counted:** `canceling statement due to statement timeout`, and `could not obtain lock` (55P03 from `NOWAIT`). Neither is the
  ISSUE-265 interaction, but neither is excluded.
- **`log_line_prefix` was not captured.** Attributing a future block to a database and process depends on it.

#### 28.13.3 Historical failures versus evidence relevant to the proposed release

- **No historical failure appears in any captured source.** That covers the server log (about seven weeks, cluster-wide), the AFL
  Tables unit journal (9 of 9 runs successful, below) and the web unit journal (no lock, cancel or crash line). The 36 open
  `canonical_apply_failed` findings (AFL API batch 32, a manual run on 2026-09-28, one transaction, `xmin` 43538; C0 `p20`) are
  historical apply findings. They are not deadlocks (C0 `deadlock_fp 0`), and no server-log deadlock accompanies them.
- **What the zero means for this release.**
  - Everything captured ran on `1111ab19`, which has no gate.
  - In the window, PROD had no legacy promotion (C0: zero `data_submissions` rows), no AFL API unit, and only AFL Tables settles
    that changed nothing.
  - **The ISSUE-265 interaction (a settle against a legacy promotion) therefore never had the opportunity to occur on PROD.**
  - The supplement is a **clean pre-deployment baseline**: any deadlock or lock-timeout cancel in an N-k capture is new. It is **not**
    evidence that the defect is absent from PROD, and **not** evidence that the mitigation works there.
- **No `SettlePromotionGate` or `waited 300 s` text** appears in the unit's JSON journal (`21`). That is expected on `1111ab19`
  and proves nothing about the gate.

#### 28.13.4 systemd: invocation identities, settle outcomes and the 2026-09-22 → 2026-09-28 gap

**AFL Tables service (`20`, `21`).** These are systemd's own lines, now visible. Every run has the same complete shape:
- pid 1 `Starting`;
- the wrapper lines, carrying `_SYSTEMD_INVOCATION_ID`;
- `Applied as import batch N: 0 … 0` and `AFLDB_SETTLE_SUCCESS label=…`;
- pid 1 `Deactivated successfully`;
- pid 1 `Finished` with `JOB_RESULT=done` and the same `INVOCATION_ID`;
- `Consumed …`.

There is no `Failed` line, and no record carries `EXIT_STATUS`. All nine runs are on one boot (`b77c04f1…`).

| # | `INVOCATION_ID` | Wrapper / child pid | `Starting` → `Finished` (local) | Batch | Label | Outcome |
|---|---|---|---|---|---|---|
| 1 | `bfaab8fc5bc74d9b9429f031cc7cd84f` | 1755980 / 1756130 | 2026-09-28 12:20:23.312 → 12:20:58.733 +10 (35.4 s) | 37 | `settle-2026-2026-09-28-1220` | success, no-op |
| 2 | `3f5e4327e6564cdba7322ae3823d219b` | 1783771 / 1783887 | 2026-09-29 04:45:01.204 → 04:45:34.831 +10 (33.6 s) | 38 | `…-09-29-0445` | success, no-op |
| 3 | `29f2033149b1426e84654ee18f7a8df2` | 1823466 / 1823581 | 2026-09-30 04:38:48.896 → 04:39:22.156 +10 (33.3 s) | 39 | `…-09-30-0438` | success, no-op |
| 4 | `989a8302d62842c89eee699f207e1aaa` | 1864920 / 1864998 | 2026-10-01 04:36:45.531 → 04:37:21.919 +10 (36.4 s) | 40 | `…-10-01-0436` | success, no-op |
| 5 | `1cdf7217acc64e63ab7aaf871d7f7b50` | 1909619 / 1909712 | 2026-10-02 04:44:28.069 → 04:45:07.712 +10 (39.6 s) | 41 | `…-10-02-0444` | success, no-op |
| 6 | `ed4eb4beb51547128591579ad173e912` | 1950075 / 1950156 | 2026-10-03 04:45:01.206 → 04:45:41.013 +10 (39.8 s) | 42 | `…-10-03-0445` | success, no-op |
| 7 | `b8ad040174dc4ab19ac73adbc56bd31d` | 1987998 / 1988077 | 2026-10-04 04:37:35.533 → 04:38:14.681 +11 (39.1 s) | 43 | `…-10-04-0437` | success, no-op |
| 8 | `4e26b334981441c4ab862211c4a9e1d0` | 2027898 / 2027976 | 2026-10-05 04:42:29.575 → 04:43:07.519 +11 (37.9 s) | 44 | `…-10-05-0442` | success, no-op |
| 9 | `77933f8a468a4a3f9e29dd7a1bb66028` | 2067582 / 2067664 | 2026-10-06 04:37:58.118 → 04:38:38.895 +11 (40.8 s) | 45 | `…-10-06-0437` | success, no-op |

"No-op" means `0 canonical row(s) inserted, 0 updated, 0 ledger row(s), 0 retried after resolution, 0 refused at the write, 0
unit(s) rolled back`.

**Correlation with C0.**
- The nine batches and labels equal §28.11.5 exactly.
- Run 9 equals C0's `systemctl show`: `InvocationID=77933f8a468a4a3f9e29dd7a1bb66028`, `ExecMainStartTimestamp` 04:37:58 and
  `LastTriggerUSec` 04:37:58 (`30`, `31`).
- So D-PROD-13's method works on PROD. §28.4 counting criterion 1 can be met from systemd's own lines, read with sudo. Unlike DEV
  (§27), the invocation identity is recorded and is not blank.

**Run 1's trigger (C0: "not visible").**
- `Started afldb-settle-afltables.timer` at 12:20:23.291 was followed 21 ms later by `Starting afldb-settle-afltables.service`.
- This is consistent with `Persistent=yes` catching up a missed run when the timer is activated (inference; the cause of the timer's
  activation is not captured).

**The 2026-09-22 18:17 → 2026-09-28 12:20 gap (C0: "fired and failed, or did not fire, is not established").** Resolved: **the
service did not run under systemd in that period.**
- With full journal visibility, there is no `Starting`, `Failed` or `Finished` line for the service, and no timer line, before
  2026-09-28 12:20:23.
- The unit's oldest retained entry is 2026-09-04 04:31:21 +10 (`22`), so the gap is not a retention loss.

Two consequences:
- Batches 29, 32 and 34–36 (2026-09-28 07:04–12:17 +10) were **not** started by `afldb-settle-afltables.service`. Batch 32 is an
  AFL API batch, and no AFL API unit exists. Who started them is still not recorded. Manual runs during the 2026-09-27/28 promotion
  are plausible, not established.
- **Why the timer was inactive before 12:20:23 is not established.** The capture's pattern has no `Stopped` or `Stopping`, so a
  timer stop or disable inside the window would not show. The web unit's stop/start cluster on 2026-09-26 → 2026-09-28 (below)
  falls in the same promotion period. That is context only.

**Retention (`00`, `22`).**
- `journald.conf` sets none of `Storage`, `SystemMaxUse`, `SystemKeepFree`, `MaxRetentionSec` or `MaxFileSec`
  (`systemd-analyze cat-config`, grep exit 1, no error), so defaults apply.
- The journal totals 611.0 M on a 77 GB filesystem with 65 GB free (C0 `80`).
- Retention covers the C0 window and any N-k window comfortably. The storage mode was not captured directly. Every run is on one
  boot, so survival across a reboot is not demonstrated.

**Web unit (`23`).**
- In the window: 8 `Stopped` and 8 `Started` lines. They are 2026-09-26 21:21–21:54 (three cycles), 2026-09-27 11:14 and
  14:29 → 14:45, 2026-09-28 10:13 and 10:22 → 11:23, and 2026-10-01 18:09:58.
- The last start equals C0's `MainPID` start (2026-10-01 18:09:58).
- There is no `Main process exited` line, and no `deadlock detected`, `40P01`, `55P03`, `lock timeout` or `canceling statement`
  text. This journal shows only what the application prints; the server log (§28.13.2) is the authority.

#### 28.13.5 Missing units versus missing or inaccessible logs

| Unit | Supplement (sudo) | C0 | Classification |
|---|---|---|---|
| `afldb-settle-afltables.service` / `.timer` | 9 complete runs; timer `Started` 2026-09-28 12:20:23 | loaded, enabled, timer = repository; service = the `887263a5` revision (D-PROD-12) | **Installed and logged.** The arm-only view in C0 lacked systemd's lines; the sudo view has them |
| `afldb-settle-afl-api.service` / `.timer` | no matching line (grep exit 1 accepted; sudo valid; no error) | `No files found…`, `LoadState=not-found`, `LastTriggerUSec=` empty | **Absent unit**, not an inaccessible log. The journal query alone cannot tell "never installed" from "installed and idle"; C0's `systemctl` evidence does |
| `afldb-settle-afl-api-brownlow.service` / `.timer` | the same | the same | **Absent unit** |
| `afldb-email-intake.service` / `.timer` | not captured (not in the pack's unit list) | `LoadState=not-found` | Absent unit (C0 only); no bearing on ISSUE-265 |
| PostgreSQL server log | read with sudo, 8 files | unreadable by `arm` (`postgres:adm 0640`) | **Present and now read.** The C0 gap is closed |

#### 28.13.6 Findings

| ID | Grade | Finding | Effect |
|---|---|---|---|
| S-1 | INFO | Zero `deadlock detected` and zero lock-timeout cancels in all eight server-log files, about 2026-08-16 → 2026-10-06 18:17:22, cluster-wide (§28.13.2) | Closes C0's missing-server-log gap; this is the pre-deployment baseline |
| S-2 | INFO | The zero is a baseline, not acceptance evidence: no promotion, no AFL API unit and no gate code existed on PROD in the window (§28.13.3) | PROD acceptance still depends on the N-k captures after the deployment |
| S-3 | INFO | Nine invocation identities, all `JOB_RESULT=done`, all no-op successes; run 9 equals C0's `InvocationID` (§28.13.4) | D-PROD-13's method is proven on PROD |
| S-4 | INFO | The service did not run under systemd between 2026-09-22 18:17 and 2026-09-28 12:20; batches 29, 32 and 34–36 did not come from the unit; why the timer was inactive is not established | Corrects C0's open point; historical, no bearing on the release |
| S-5 | LOW | The wrapper prints `[monitor] failure marker: AFLDB_SETTLE_FAILURE …` (and a matching success banner) at the start of **every** run. A bare `AFLDB_SETTLE_FAILURE` or `AFLDB_SETTLE_SUCCESS` match is therefore a false hit on every run | The N-k grader must count only a `MESSAGE` that **begins** `AFLDB_SETTLE_(SUCCESS\|FAILURE) label=`, plus systemd's `Finished`/`Failed` and `JOB_RESULT`, keyed by `INVOCATION_ID` |
| S-6 | LOW | `sudo-capture.sh` r1 has no positive control on server-log reads (no line count or first/last timestamp per file), no `Stopped`/`Stopping` in its systemd pattern, and does not record `log_line_prefix` | Fold into the N-k revision; none invalidates this supplement |
| S-7 | INFO | The journal `--since` is local time, so after the DST change 14 calendar days are 335 h. The supplement starts at 2026-09-22 08:17Z, while C0's database window started at 07:17Z | Immaterial here: the database holds nothing before 2026-09-27 21:04Z. N-k windows should be stated in UTC or with an offset |
| S-8 | INFO | The final `sudo -k` runs after the last item, so the folder does not show it | Operator confirmation only |

There is no MED or higher finding.

#### 28.13.7 Blockers and the next step

**Blockers** (unchanged from §28.12.6, except that the supplement is now done):
1. **Deployment is NOT AUTHORISED.**
2. **D-PROD-4 is not approved.** Even a fully in-class D5 preflight grades `BLOCKED-PENDING-D-PROD-4`.
3. **D2 has not run.** Remote freshness and PROD's post-fetch refs are unproven.
4. **No D5, C1 or N-k script exists.** The N-k script should take S-5 and S-6.
5. Still undecided: D-PROD-1, -2, -5, -6, -7, -8, -9, -10, -11.

The supplement **removes** C0's two evidence gaps (the server-log baseline, and systemd's lines with the 2026-09-22 → 2026-09-28
gap). Neither was a blocker. What remains open is non-blocking: S-6's capture limits, the unknown timer-inactivity cause before
2026-09-28, and the unrecorded starter of batches 29, 32 and 34–36.

**Is D2 (fetch and range review) the next useful step?** Yes, as the next **evidence** step. The supplement neither requires nor
changes it. Three conditions apply:
- **Authorisation.** D2 needs its own authorisation, outside 04:15–06:00, with the AFL Tables unit inactive.
- **`origin/main` must stay at T.** `g2` continues only on `FRESH T-EXACT` (D-PROD-1 option A). If any commit reaches `origin/main`
  before D2, `g2` returns `DOC-ONLY-SUCCESSOR`, which needs D-PROD-1 option B (undecided). That includes the uncommitted tracker
  and runbook edits now on `issue/265-settle-deadlock`. So either keep `origin/main` at `cd3cf782` until D2, or decide D-PROD-1
  first.
- **D2 does not unblock the deployment on its own.** D-PROD-4 is still the binding decision. D2's freshness also ages: `g4`
  re-checks `origin/main = T` at D4/D5 regardless.

ISSUE-265 **stays open**. §28 remains **NOT EXECUTED** beyond C0 and this supplement. PROD is unchanged by this pass.

### 28.14 D2 graded (operator-run on PROD 2026-10-06 19:35:19–19:35:32 +11:00; graded by agent from the saved copy) and the deploy pack r1 — deployment **NOT AUTHORISED**

> **Authorisation for this pass:** local read-only inspection, offline pack preparation and documentation edits. **Done:** file
> reads; sha256 checks; read-only `git --no-optional-locks log --name-status` of the workstation repository (per-commit
> classification); a new pack folder and archive under `D:\tmp\issue265\`; offline checks; stubbed dry runs in the session
> scratchpad against throwaway `--shared` clones at `1111ab19` and throwaway bare "remotes" at T (the only Git writes, all inside
> the scratchpad). **Harness incident, disclosed:** in the first dry run the harness's PATH let the real `npm` shadow its stub, so
> a real `npm ci` ran once inside a throwaway scratchpad clone (packages from the npm registry or cache). No AFLDB host, database,
> SSH or GitHub contact was made by it, and nothing outside the scratchpad changed. The harness was corrected and re-run on fresh
> clones. **Not done:** no host, SSH or database contact; no fetch, push, commit or other Git mutation in any real repository; no
> migration, build, service, timer, settle or promotion; no evidence edit. The D2 result below is a **preparation** result. It is not
> deployment acceptance and approves nothing.

#### 28.14.1 Evidence integrity

- **Folder:** `D:\tmp\issue265\run-D2-20261006-193519-Prod\` (PROD `~/issue265-prod/D2-20261006-193519`).
- **`MANIFEST.sha256` file hash:** `5eebb526d6403a069abe87b17ac4bf7e61e23415bedd07eb997b6a01d392c32b`, equal to the expected value.
- **Listed files:** 26 of 26 verified (`sha256sum -c`), 0 mismatched, 0 missing. **Inventory:** 27 files, exactly the 26 listed plus
  `MANIFEST.sha256`; no subfolder, no zero-byte file. The inventory is exactly what `g2` writes on its `FRESH T-EXACT` path:
  `40-successor-paths.txt` exists only on a successor path and is correctly absent.
- **`exits.tsv`:** 15 items; 14 exit 0. `70-preflight-deploy-postfetch.txt` exit 1 is the deploy preflight's own `BLOCKED`, which is
  the baseline being graded (item 72), not a capture failure.
- **Pack on the host:** item `00` printed the gates pack manifest `071dc08e…3c67` (= §28.12.4) and 20/20 `OK`.
- **Host and clock:** `afldb-prod`, `arm` (uid 1000; groups `arm sudo users`), git 2.43.0, node v22.23.2. The capture ran
  19:35:19.084 → 19:35:32.454 +11:00 (13.4 s): outside 04:15–06:00, with the AFL Tables unit inactive (`g2` refuses otherwise).
- **Independent re-checks on the workstation:** `50-range-commits.txt`, `50-range-name-status.txt` and `50-added.txt` are byte-identical
  to the pack's `expected/` files; the 36 paths in `71-known.z` equal C0's 36 and equal the 36 `??` entries of `11-status-before.z`.

#### 28.14.2 Refs and worktree before and after: the fetch changed remote-tracking refs only

| What | Before the fetch | After the fetch | Source |
|---|---|---|---|
| `HEAD` | `1111ab193882566b7ba7e3fc8d69b2f7c62c6c40`, attached to `refs/heads/main` | the same | `10`, `30` |
| `refs/heads/main` | `1111ab19…` | `1111ab19…` ("HEAD and main UNCHANGED") | `10`, `30` |
| refs (heads, remotes, tags) | 59 | 59; `diff` shows exactly two changed lines: `refs/remotes/origin/HEAD` and `refs/remotes/origin/main`, each `1111ab19…` → `cd3cf782…` | `10-refs-before.list`, `30-refs-after.list`, `30` |
| fetch output | — | `1111ab19..cd3cf782  main -> origin/main`, nothing else (no new branch or tag) | `21` |
| `.git/FETCH_HEAD` | 2026-10-01 16:29:59 +10, 98 bytes | 2026-10-06 19:35:27 +11, 7,406 bytes | `10`, `30` |
| index and tracked files | "index and tracked files match HEAD" (`diff-index --cached` and `diff-files` quiet) | porcelain status byte-identical to before (`cmp`), so still no staged or unstaged tracked change | `11`, `31` |
| working tree | `11-status-before.z` sha256 `92e78f6d…c8ad`: 36 `??` entries, all known manifests | `31-status-after.z` and `71-status.z` have the same sha256 | `11`, `31`, `71`, manifest |
| T `cd3cf782` in the object store | absent ("as C0") | present | `10`, `40` |

**HEAD, `main`, the index and the working tree were unchanged by the fetch.** The one state change was the expected one.

#### 28.14.3 The verdicts (as captured)

- **Freshness (`40`): `VERDICT FRESH T-EXACT`.** `git ls-remote origin` read `refs/heads/main` and `HEAD` = `cd3cf782…` both before
  (19:35:19–21) and after (19:35:27–29) the fetch, and `origin/main` after the fetch is `cd3cf782…`. The remote was already at T and did
  not move during the capture. No successor commit exists, so D-PROD-1 option B does not arise.
- **Range (`50`): every comparison IDENTICAL.** `HEAD` is an ancestor of T (fast-forward possible); 26 commits; commit list
  IDENTICAL; `--no-renames` name-status (116 lines: 37 A, 77 M, 2 D) IDENTICAL; deployment-relevant paths exactly `M` of the two
  AFL API unit files and `A src/db/migrations/110_match_sheet_player_match_stats_authority.sql`; migrations exactly one, 110, added;
  `deploy/` exactly the two AFL API units (neither installed on PROD); migration blobs at T IDENTICAL (110); `deploy/` hashes at T
  IDENTICAL (17); added paths IDENTICAL (36), none present untracked (grep exit 1, accepted). `git diff --shortstat` printed
  `115 files changed, 35460 insertions(+), 968 deletions(-)`: 35,460 against the workstation's 35,459, exactly as §28.12.3 predicted
  (`.gitattributes`); information only.
- **Collision prediction (`60`): `VERDICT PREDICTED-COLLISION-FREE`.** Scanned five refs: `refs/heads/main` `1111ab19`,
  `origin/main` `cd3cf782` (the base) and the three unmerged remote refs §28.12.3 named (`origin/fwab/next-16` `81840c16`,
  `origin/opus/issue-166-admin-fetch-auth-bypass` `61efe226`, `origin/sonnet/issue-224-s9-unblock` `3de4eef9`). No duplicate number,
  no duplicate name with different content, and no base-versus-T difference. PROD holds fewer refs than the workstation (the stubbed
  dry run scanned 22); D5's preflight scans PROD's own refs, so this is the relevant set.
- **Post-fetch preflight (`70`–`72`): `VERDICT AS-PREDICTED`.** Deploy mode at `1111ab19` after the fetch: `BLOCKED (3 blocker(s),
  1 warning(s))`. The FAILs are exactly `working tree is clean` (36), `branch relationship to recorded origin/main` (`ahead: 0;
  behind: 26`) and `migration missing-base-migration` naming 110; `migration parity (109/109)` PASS; database `afldb_prod` as
  `afldb_owner`; the only WARN is SSH-not-requested. Same-session classification: tracked 0, known 36, sync-dev-only 0, unknown 0,
  collisions 0. Graded: `CLASS WT` (36 = C0's 36 + 0 written since), `CLASS BEHIND`, `CLASS MISSING110`.
- **What this does not mean.** `AS-PREDICTED` confirms the second row of §28.12.3; it is not an accepted exception. D-PROD-4 is
  still unapproved, so a fully in-class D5 preflight would still grade `BLOCKED-PENDING-D-PROD-4`. D2's freshness is a 19:35 fact;
  under option A the deployment is by SHA, and D5's G-START re-checks `origin/main = T` on PROD's recorded ref (it does not refetch).

#### 28.14.4 The 26-commit range: deployment infrastructure versus application behaviour

Classified from the per-commit `--no-renames --name-status` of `1111ab19..cd3cf782` (workstation object store; the same SHAs D3
verified on PROD). "At merge" = the settles compile from the checkout; "at restart" = the web bundle.

| # | Commit | Subject | Class | What changes on PROD, and when |
|---|---|---|---|---|
| 1 | `c64fade4` | docs: resolve ISSUE-220 | docs only | none |
| 2 | `6661eb66` | harden AFL API settle units (ISSUE-232) | **infrastructure** + web | Infra: `deploy/afldb-settle-afl-api{,-brownlow}.service` deny lists. **Not installed on PROD** (C0), and a checkout never installs a unit: no effect. Web: `AflApiSettleUnitsPanel.tsx`, `settle-trigger.ts` read `LoadState` (an absent unit shows as not installed), at restart |
| 3 | `f6d189d0` | suppress unused AFL API emergency rows (ISSUE-255) | settle (AFL API only) | `afl-api-bundle.ts`, `afl-api-settle-plan.ts`, `settle-afl-api.ts`, `tools/current-season/settle-afl-api.ts`; **inert**: no AFL API unit on PROD |
| 4 | `30b36ef0` | docs: resolve ISSUE-232/255 | docs only | none (`docs/deployment.md`, acquisition doc) |
| 5 | `4c0dfb39` | ISSUE-225 co-captains, Gridley adjudication | data and tooling | `data/awards/captaincies.csv`, `captaincies.py`, `rebuild-test.ts`, a validation probe, `.gitignore`, tests: only on a captaincies reload or rebuild. PROD's `captaincies` is unchanged |
| 6 | `9e1da6b1` | docs: resolve ISSUE-225 | docs only | none |
| 7 | `2940cdb2` | docs: resolve ISSUE-226 | docs only | none |
| 8 | `e4026bb2` | docs: resolve ISSUE-230 | docs only | none |
| 9 | `5a85226c` | test: ISSUE-229 evidence | tests / repository hygiene | a test fixture and a `.gitattributes` line; no runtime effect |
| 10 | `2574d138` | docs: ISSUE-229 status | docs only | none |
| 11 | `6a0891c1` | docs: close ISSUE-234 | docs only | none (`README.md`) |
| 12 | `3e98fb7b` | NL: reject unsupported career metrics (ISSUE-256) | web | `src/search/nl/plan.ts`, `src/db/queries/nl/player-career.ts`: public search behaviour, at restart |
| 13 | `17f7d9f5` | docs: resolve ISSUE-256 | docs only | none |
| 14 | `1c1a4805` | docs: ISSUE-229 tracking | docs only | none |
| 15 | `3ed70ab1` | docs: review findings 257–260 | docs only | none (`playbooks/issue.md`) |
| 16 | `92f2bdf6` | Match Sheet authority (ISSUE-257) | **infrastructure** + web + settle + tooling | Infra: **migration 110** (applied only by D7), `tools/db/issue257-rollback-guard.ts` (the rollback guard), promotion tools (rebuilt-database promotion only), `docs/deployment.md`, `docs/production-promotion.md`. Web at restart: Match Sheet editor, Data Editor actions and page, `match-admin.ts`, `match-sheet.ts`, `match-sheet-authority.ts`. Settles at merge: `canonical-apply.ts`, `manual-authority.ts`, `match-rekey.ts`, both settles, `settle-core.ts`, AFL API identity correction. Tooling when run: `common.py`, `import_fitzroy_core.py` (rebuild path), `correct_afl_api_identity.ts` |
| 17 | `a27f7104` | Brownlow client-bundle fix (ISSUE-257) | web (+ shared settle module) | `brownlow/entry.ts`, `manual-authority.ts`, `manual-source-key.ts` |
| 18 | `39a9fed1` | Match Sheet mobile layout (ISSUE-257) | web | `MatchSheetEditor.tsx`, at restart |
| 19 | `14c289e8` | docs: close ISSUE-257 | docs only | none |
| 20 | `e7b57ede` | preserve optional figures in partial CSV imports (ISSUE-258) | web (legacy intake and promotion) | `datasets.ts`, at restart; R-258-1 (0 submissions at C0; G-START re-checks) |
| 21 | `7d02e781` | docs: close ISSUE-258 | docs only | none |
| 22 | `09feda5c` | docs: runbook link | docs only | none |
| 23 | `ebbe2c00` | legacy promotion respects Match Sheet authority (ISSUE-264) | web (+ shared settle module) | `datasets.ts`, `pipeline.ts`, `match-sheet.ts`, `manual-authority.ts` |
| 24 | `4b59cb3e` | docs: close ISSUE-264 | docs only | none |
| 25 | `62f2cd67` | test: ISSUE-265 Phase A checkpoint | tests / repository hygiene | tests, `eslint.config.mjs`, tooling under `issues/`; no runtime effect |
| 26 | `cd3cf782` | settle/promotion advisory gate (ISSUE-265) | settle + web | Settles take the gate shared, **at merge**; the three legacy promotion hooks take it exclusively, **at restart**; `admin-fixtures.ts` (comment), `docs/admin-and-beta.md`, `.gitattributes` |

- **Totals:** 14 docs-only, 2 tests/repository hygiene, 1 data/tooling, **9 that change runtime application behaviour** (2, 3, 12, 16,
  17, 18, 20, 23, 26). Of those, **2 also carry deployment infrastructure** (2: two unit files PROD does not have; 16: migration 110,
  the rollback guard, rebuilt-database promotion tooling).
- **Deployment infrastructure unchanged across the range** (D3 path list plus §28.11.6): `package.json` and `package-lock.json` (so
  `npm ci` reproduces the same dependency tree), `next.config.ts`, `deploy/server-cluster.mjs`, `afldb.service`, the AFL Tables
  service, timer and wrapper, the polkit rule, `tools/maintenance/privileges.sql`, `tools/build`, `tools/dev` (preflight),
  `tools/db/migrate.ts`, `seasons.json`, `.env.example`.
- **The only infrastructure actions the release needs on PROD** are therefore: the checkout, `npm ci`, the build, the restart, and
  migration 110 (D7, B1). No unit is installed or reinstalled (D-PROD-12), no privilege script runs, no `.env` changes.

#### 28.14.5 Findings of this pass

| ID | Grade | Finding | Effect |
|---|---|---|---|
| D2-1 | INFO | `FRESH T-EXACT`; the remote was at T before the fetch; no successor | D-PROD-1 option A stands without option B |
| D2-2 | INFO | The fetch changed only `origin/main`, `origin/HEAD` and `FETCH_HEAD` (§28.14.2) | PROD's checkout is still exactly C0's |
| D2-3 | INFO | Collision scan on PROD: three unmerged remote refs, none conflicting | D5's preflight should print collision-free |
| P-1 | LOW | **`next build` deletes `.next` (except `cache`, `dev`, `lock`, `trace`) before building** (`node_modules/next/dist/build/index.js:623-625`; `cleanDistDir: true` by default, `dist/server/config-shared.js:98`; `next.config.ts` does not override it). The live web serves from `.next/standalone`, so from the build's start until the restart it runs from deleted files, and a failed build leaves no bundle to restart into. Every recorded PROD in-place build has had this window (ISSUE-156, ISSUE-220); the request-level effect during a build is expected but **not observed** | D-PROD-9 (recovery copy) becomes the basis of build recovery; new D-PROD-15; keep the build inside the paused window |
| P-2 | LOW | Found by the stubbed dry run and **fixed before sealing**: the pack's first draft moved a failed `.next` aside **inside the checkout** (`.next.<reason>-<stamp>`). `.gitignore` ignores only `.next/`, so that folder became an unknown untracked path and would have failed every later preflight and stopped the rollback | Aside folders now go to `~/afldb-recovery/aside-<reason>-<stamp>` (same filesystem: a rename). Re-tested |
| P-3 | INFO | `g4-gstart.sh` requires `HEAD = 1111ab19`, so its PASS exists only before the merge; D5 runs it as its first step | none |

There is no MED or higher finding.

#### 28.14.6 The deploy pack r1 (prepared offline; **NOT RUN on PROD**)

- **Location:** `D:\tmp\issue265\prod-deploy-pack-r1\`, 39 files plus `MANIFEST.sha256` (file hash
  `d8413f734a6534e634603a87b62072d9cad5448b38c03a4ab6bce704aa4d7e5a`). **Archive:** `D:\tmp\issue265\prod-deploy-pack-r1.tar`, sha256
  `d5e61848362568ce367acd32394ab7f752adf45052fd1b9e1be9534bff0912d8`. Read `README-PROD-DEPLOY.md` first.
- **Scripts.**
  - `d5-deploy.sh` (detached): G-START via `g4-gstart.sh`; D-PROD-9 recovery copy of `.next` (except `cache`) with sha256, listing
    and a C0 `BUILD_ID` check; `git merge --ff-only T` (HEAD and `main` verified, tree classified); `npm ci --include=dev` with
    `NODE_ENV` unset; deploy preflight graded `d5-pre110`; rollback guard (PERMITTED, State A); the four source pins; `npm run build`
    with `AFLDB_ENV=production`; build checks (BUILD_IDs equal, new, after D5 start; no `.env*` under standalone; HSTS); restart by
    `kill MainPID` with a 2 s × 60 strict health poll. Every state-changing step re-runs the settle guard first and refuses rather than
    kills. It stops at the first failing step and writes `90-outcome.txt`. **Build recovery:** on a build failure with
    `--on-build-failure restore` it restores C0's bundle and restarts (exit 20); with `stop` it restores nothing (exit 20) and the
    outcome names `r-rollback.sh --bundle recovery-copy`.
  - `c1-capture.sh --phase ds|c1`: read-only, from a fresh connection ≥ 2 min after the restart; 20 checks (G1–G2, B1–B5, W1–W3,
    H1–H2, U1–U4, P1, M1, D1, F1). DS expects State A and `d5-pre110`; C1 expects State B with zero records and `d5-post110`. C1 records
    `C1_BATCHES_MAX`, the web start, MainPID and BUILD_ID for N-k.
  - `d7-migrate-110.sh` (B1): refuses unless the DS folder says `DS PASS` and the web is still the DS process and bundle; proves State
    A and exactly one pending migration (110) first; applies through `tools/db/migrate.ts --target prod` and requires exactly
    `applying 110_… ok` and `Applied 1 migration(s).`; then State B, zero records, guard PERMITTED, `d5-post110`, health. A failed
    apply records the state (the runner's transaction leaves State A).
  - `r-rollback.sh --bundle keep|recovery-copy|rebuild`: **the migration-110 rollback guard.** It reads the state from the database.
    In State B it runs `tools/db/issue257-rollback-guard.ts` **while still at T** (the tool does not exist at PREV): exit 2 REFUSED
    stops the run with "roll forward only" (exit 2, nothing changed); PERMITTED runs `sql/r110-reversal.sql` only with
    `--i-authorise-110-reversal`. The reversal is one transaction: `SHARE ROW EXCLUSIVE` on `data_overrides`, the count re-checked
    under the lock (no record is ever deleted), migration 102's 13 literals and comment restored, the ledger row removed, and C0's
    CHECK md5 `f163aaed…`, comment md5 `72ef0d6f…`/358 and ledger 109 verified before COMMIT. Then `checkout --detach PREV`, `npm ci`,
    the bundle and the restart.
  - `nk-capture.sh`: the N-k morning capture. Host state and identity against C1; p20, `n40-runs`, p40 since the deployment, p30, p41;
    the **server-log positive controls** (a pattern self-test of every grep on synthetic lines; per file bytes, line count, first and
    last line, `gzip -t`; and, with `--log-marker yes`, a `RAISE WARNING` marker that must be read back exactly once from the live log);
    the server log searched whole; the unit's journal as **JSON with `_SYSTEMD_INVOCATION_ID`/`INVOCATION_ID`**; systemd lines including
    `Stopped`/`Stopping` (S-6); the web journal; retention; and `sudo -k` recorded inside the last item (S-8). `--since` must carry a
    UTC offset (S-7). `lib/grade-journal.mjs` grades the night: markers **anchored** at the start of `MESSAGE` (S-5), the banners
    counted and never matched, the timer trigger correlated, `Applied … 0 unit(s) rolled back`, the batch row (completed, after C1,
    inside the run, `canonicalApplyFailures` 0), gate-timeout text → REVIEW, deadlock text → FAIL.
  - Unchanged, hash-equal copies: `g4-gstart.sh`, `sql/g4-gstart.sql`, `lib/capture.sh`, the classifier, role and DSN helpers, the
    preflight grader and its self-test, and `expected/*` from gates pack r1; `sql/p00`, `p01`, `p02`, `p20`, `p30`, `p40`, `p41` from C0
    pack r1 (those ran on PROD in C0).
- **Refusal guards:** README §2. Each unresolved choice is a required flag with no default (§28.14.7). Without it the script exits 3
  having changed nothing.
- **Offline checks run (2026-10-06, workstation):**
  - `bash -n` on all 13 shell files and `node --check` on all 6 `.mjs` files: OK. No CR bytes, no zero-byte file. Every copied file is
    byte-equal to its source.
  - `sql/r110-reversal.sql`: its comment hashes to `72ef0d6f…` with length 358 and it lists 13 literals, matching C0's `p01` capture
    and migration 102. Migration 110's comment hashes to `37f2fe81…`/590 (used by D7 and C1).
  - `grade-preflight.selftest.mjs`: 18/18.
  - `grade-journal.selftest.mjs`: **19/19**, 14 synthetic cases and 5 against the **real PROD journal JSON of the C0 supplement**:
    9 invocations found; batches 37–45 matched once each; every run's two `[monitor]` banners never counted as a marker; only the
    run whose start was correlated with a timer trigger counted. The trigger value fed to that test was derived from the run's own
    first line, not read from PROD.
  - Stubbed dry runs (throwaway clones and bare remotes in the scratchpad; stubbed `systemctl`, `curl`, `sudo`, `journalctl`,
    `psql`, `npm`, `tsx`; a real `sleep` process stood in for the web MainPID):
    - Refusals, each exit 3 with nothing changed: no flags; D-PROD-4 not approved; a wrong window date; a settle active;
      `--on-build-failure restore` without a recovery copy; DS earlier than 2 minutes; DS without D-PROD-4; D7 without its
      authorisation; N-k without an offset in `--since`; N-k without `--log-marker`.
    - The happy path: D5 exit 0 (G-START 13/13; preflight `CLASS WT` 36 + `CLASS PENDING110` → `ACCEPTED-UNDER-D-PROD-4` under the
      flag; build checks; restart and health) → DS **20/20 PASS** → D7 exit 0 (exactly one migration applied; State B confirmed) →
      C1 PASS → N-k: night `COUNTED 1`, L1 positive control read back once, every state check PASS, and `sudo -n` failing after
      `sudo -k`.
    - Rollback: one `player_match_stats` record → guard REFUSED → **exit 2, nothing changed**; State B without the reversal flag →
      exit 10, nothing changed; with it → reversal, State A, `checkout --detach PREV`, recovery copy restored, restart, exit 0 (HEAD
      PREV detached, `main` still T).
    - Build failure with `restore`: exit 20, web back on C0's `BUILD_ID`, checkout at T; then `r-rollback.sh --bundle keep` → exit 0.
      This scenario exposed P-2 on the first attempt; the fixed pack passed it on a fresh clone.
    - N-k negative controls: a suppressed marker → `L1 FAIL` ("the server-log zero is NOT evidence"); an injected `deadlock detected`
      line → `L3 FAIL`; a restarted web and moved HEAD → `H1`–`H3 FAIL`; night verdict REVIEW. `--log-marker no` → `L1` PASS marked
      STRUCTURAL ONLY.
    - Also observed: with the real preflight, a run that is not in class stops D5 at the grade (`PREFLIGHT NOT ACCEPTED`), before the
      build, with the web untouched.
  - **These prove control flow, guards, parsing and evidence layout only.** The stubs answered with the outputs the scripts expect,
    so they prove nothing about PROD's real outputs.
- **Untested (nothing here has run on PROD or against any database):** `sql/r110-reversal.sql`, `sql/n05-log-control.sql` and
  `sql/n40-runs.sql` have never been executed; whether PROD's server log records the marker (it should under `log_min_messages =
  warning`); the real `npm ci`, `npm run build`, `tools/db/migrate.ts --target prod` and rollback-guard outputs on PROD (the parsing
  follows the source text); `tar` time and size of the recovery copy on PROD (about 1.6 GB expected; 65 GB free at C0); a real
  `kill` / `Restart=always` respawn timing (proven on PROD before, 2026-08-18 and ISSUE-220); the journal JSON's `Starting` line
  carrying no invocation id (the grader keys on the unit's own lines and systemd's `Finished`/`Deactivated`, which do).

#### 28.14.7 Remaining decisions, with recommendations and their effects

Kept unchanged: **D-PROD-3 = B1**, **D-PROD-12**, **D-PROD-13** (all approved 2026-10-06). **D-PROD-4 is not approved.** Deployment
is not authorised.

| ID | Decision | Recommendation | Effect if taken as recommended | Pack flag |
|---|---|---|---|---|
| **D-PROD-4** | Accept deploy mode with exactly two FAIL classes: WT (known manifests, same-session classification, C0's 36 present) and `pending-migration` naming exactly 110 before D7 | **Approve** | The grader can return `ACCEPTED-UNDER-D-PROD-4` at D5, DS, D7 and C1; any other FAIL still stops. Without it nothing proceeds. Alternatives: stash the manifests (ISSUE-220), which hides the tree; or ship the D-PROD-11 tooling first, which delays this release | `--d-prod-4 approved` |
| **D-PROD-1** | Target: A (exactly `cd3cf782`) or B (a docs-only successor) | **A** (D2: `FRESH T-EXACT`, no successor) | Deploy by SHA. Tracker commits made later are not deployed and do not affect D5, which does not refetch | `--target <full SHA>` |
| **D-PROD-2** | Accept the 26-commit in-place release | **Accept**, with §28.14.4 in view | Releases 9 runtime changes (web at restart, settles at merge) and migration 110; no unit, privilege or `.env` change | `--range-accepted 26` |
| **D-PROD-5** | Window and pauses | **Daytime, one date, at least 60 min from 04:30** (e.g. 10:00–16:00 +11:00). Pause legacy uploads and promotions, Match Sheet and Data Editor saves and on-demand settles for the window; Match Sheet player-statistic corrections stay paused until the morning after the first counted night (B1) | The build window (P-1) falls inside the pause. The scripts refuse 04:15–06:00 and within 60 min of the timer | `--window-confirmed <date>` |
| **D-PROD-9** | Recovery copy of `.next` before the build | **Yes** (now the basis of build recovery, P-1) | About 1.6 GB under `~/afldb-recovery/`; enables a no-build restore of C0's bundle | `--recovery-copy yes` |
| **D-PROD-15** (new) | On a build failure: restore C0's bundle and restart at once, or stop | **restore** | The web returns to C0's bundle *(recovery time unmeasured: the earlier "within the health poll" assurance is withdrawn, §28.15 RV-8)*; the checkout stays at T (settles on T, promotions on C0's code: the same mixed state as the normal merge-to-restart interval, §28.3, with promotions paused for the window); then `r-rollback.sh --bundle keep` promptly, or a retry. With `stop`, the web keeps running from deleted files until the operator acts | `--on-build-failure restore` |
| **D-PROD-14** (new) | The public host for DS/C1's network-path health check | **`beta.afldb.com`** (last recorded; `afldb.com/api/health` 404s through Cloudflare by design) | DS H2 proves DNS, TLS and Caddy, not only the process | `--public-host` |
| **D-PROD-16** (new) | The server-log positive control: one `RAISE WARNING` marker line written to PROD's server log per N-k | **Yes** | Each N-k proves the reader sees fresh content of the live log, so a zero deadlock count is evidence. With `no`, only the structural control (line counts, first and last lines) and L1 is marked STRUCTURAL ONLY | `--log-marker yes` |
| **D-PROD-6** | Observation period | **2 counted AFL Tables runs within 7 nights** (no AFL API unit on PROD) | One N-k each morning; the agent tallies counted nights | — |
| **D-PROD-7** | G-obs `p30` sampler across a nightly window | **Decline for this deployment** | No lock-level PROD proof that a settle held the gate. The gate call is the first statement of every apply transaction, so a counted run on T already shows it succeeded; DEV §27 holds the lock-level proof. It would need an unattended overnight process | — (not in the pack) |
| **D-PROD-8** | P-CTRL | **Do not run** | No PROD-specific refusal proof; no permanent audit or batch rows written for a test | — |
| **D-PROD-10** | Closure basis | **Decide at closure:** passive PASS plus DEV and `afldb_test` evidence, with §28.7's limits | none now | — |
| **D-PROD-11** | A separate tooling issue for deploy-mode worktree classification and `--expect-pending` | **Open it, outside ISSUE-265** (three issues have now met the same FAIL) | No effect on this deployment | — |
| Authorisations | D5; D7 (B1 approved the design, the run needs its own); rollback if needed; N-k sudo reads (D-PROD-13 covers them) | — | — | `--i-authorise-deployment`, `--i-authorise-d7-migration-110`, `--i-authorise-rollback` (+ `--i-authorise-110-reversal`) |

#### 28.14.8 Blockers and state

1. **Deployment is NOT AUTHORISED.**
2. **D-PROD-4 is not approved.** It remains the binding decision: D5, DS/C1 and D7 refuse without it.
3. **Open decisions:** D-PROD-1, -2, -5, -9, -14, -15, -16 (each a required pack flag), and -6, -7, -8, -10, -11.
4. **The pack is untested on PROD.** Its new SQL has never run; its parsing of real `npm`, build, migrate and guard output follows the
   source, not an observation. The first real run is D5 itself, which stops at the first deviation.
5. **D2's freshness ages.** It needs no re-run for option A (a deploy by SHA), but any non-documentation push to `main` before D5 needs a
   new decision on what is being released.

ISSUE-265 **stays open**. §28 remains **NOT EXECUTED** beyond C0, the supplement and D2. PROD's checkout is unchanged except for D2's
remote-tracking refs. This pass changed nothing on any host or database.

### 28.15 Review of deploy pack r1 before an approval request (2026-10-06; agent, offline) — r1 **NOT READY**; deployment **NOT AUTHORISED**

> **Authorisation for this pass:** local read-only inspection, offline tests and documentation edits only. **Done:** file reads;
> sha256 checks; extraction of the r1 archive into the session scratchpad with `diff -r` against the folder; two stub tests in the
> scratchpad that used the pack's own `lib/capture.sh` and its N-k grading code; one new documentation file,
> `D:\tmp\issue265\prod-deploy-pack-r2-draft\README-PROD-DEPLOY.md`; and these tracker edits. **Not done:** no host, SSH,
> database or GitHub contact; no Git command; no pack script edited; no r2 archive built; no migration, build, service, timer, settle or
> promotion. The r1 folder and archive are unchanged and every earlier verdict stands. This review approves no decision.

- **r1 identity (verified in full):** `MANIFEST.sha256` file `d8413f734a6534e634603a87b62072d9cad5448b38c03a4ab6bce704aa4d7e5a`,
  39/39 OK, no zero-byte file; archive `prod-deploy-pack-r1.tar` `d5e61848362568ce367acd32394ab7f752adf45052fd1b9e1be9534bff0912d8`,
  44 entries, content identical to the folder. Draft README sha256
  `ce0b1b1fcba45bf2580b2a99f738e17a81923f1e0dffc889b964624f272a33c7`. No r2 archive or manifest exists.
- **Findings** (full table, failure-by-step matrix and the commands are in the draft README §1–§10):

| ID | Grade | Finding (short) |
|---|---|---|
| RV-1 | **HIGH** | Build-failure item 41 restarts the web even when the settle guard refused or the restore failed (`runsh` never stops an item). **Confirmed** offline. The same non-blocking guard pattern is in `r-rollback.sh` steps 40 and 50 |
| RV-2 | **HIGH** | N-k `L3` grades "0 deadlocks" PASS when the server log was not read (an expired sudo timestamp, a failed `find` or a failed reader). **Confirmed** offline |
| RV-3 | MED | `restore` covers the build item only; failures at build checks (45) and restart/health (50) restore nothing, and the rollback's order keeps the web down through `npm ci` |
| RV-4 | MED | Item 41 runs under the 300 s default timeout: verify + 1.6 GB extract + restart can exceed it mid-extract |
| RV-5 | MED | The health poll is 60 iterations (120–720 s), not 120 s; the item timeout truncates it |
| RV-6 | MED | `npm ci` is unnecessary (lock unchanged PREV→T) and is the step whose failure also breaks the rollback; new D-PROD-17 `verify-only` |
| RV-7 | LOW | A build failing before `cleanDistDir` still triggers a needless restore and restart |
| RV-8 | LOW | The "within the health poll" recovery assurance (§28.14.7) has no measurement; withdrawn |
| RV-9 | LOW | Plausible, not verified: old-process ISR write-back into the tree being rebuilt |
| RV-10 | LOW | An aside folder after a `prepare-standalone` failure can hold `.env*` copies |
| RV-11 | LOW | No path for MainPID 0 between respawns, or for a `failed` unit (needs interactive sudo) |
| RV-12 | MED | Marker count not anchored: a statement-log copy of the literal gives 2 hits; the line is not tied to the session |
| RV-13 | MED | Marker sought in the live file only; no opening boundary, so rotation coverage and the window start are unproven |
| RV-14 | LOW | A missing marker grades the night REVIEW, not INCONCLUSIVE; `--log-marker no` passes L1 |
| RV-15 | INFO | The marker step is described as "READ ONLY"; it is an intentional server-log write |
| RV-16 | LOW | `--window-confirmed "$(date +%F)"` in the usage text confirms nothing |

- **P-1 restated (draft README §2).** The deletion is traced: `build/index.js:623-625`; workers import
  `../.next/standalone/server.js` (`server-cluster.mjs:191`). The request-level effects of the build window are **possible**:
  - re-forked workers fail to start;
  - routes not yet loaded fail, or later load new-build code;
  - `/_next/static` returns 404 (perhaps masked at the edge);
  - ISR pages are re-rendered.

  **No outage has been observed.** None was measured either. A **full** outage has two possible paths only: RV-1, and a new bundle
  that never becomes healthy (RV-3).
- **Settles after a restore (§4).** They stay on **T**: the restore replaces `.next` only, and settles run `tsx` on the checkout.
  Promotions stay on C0, in State A. This is the designed §28.3 interval, contained by the D-PROD-5 pauses and the timer guard, but
  only an operator action ends it. Run `r-rollback.sh --bundle keep` inside the same window.
- **Release directory (§7).** No existing guidance covers one. It would need a second `node_modules` and `.env` at build time, and the
  bundle embeds the absolute build root (`outputFileTracingRoot`, seen in a local build), whose runtime use is unverified. Pointing
  the unit at it conflicts with D-PROD-12. **Recommendation: in-place for this release, with the r2 fixes.** The release-directory
  build becomes a tooling follow-up outside ISSUE-265, rehearsed on DEV first.
- **D-PROD-16 redesign (§8).** Identity is checked before raising (`ON_ERROR_STOP`) and the backend pid, cluster and log settings are
  recorded. Visibility is an anchored `WARNING:  <marker>` line tied to `[pid]` and `user@db`. Rotation and the window boundaries are
  covered by **bracketing markers** (C1 raises the first; each N-k reads the previous one), searched across all files. The write is
  declared in the item as intentional. Missing evidence grades **INCONCLUSIVE**, never PASS: L0 read completeness, L1 closing
  marker, L1b opening marker. With `no`, the best grade is `COUNTED-STRUCTURAL`.

**Blockers and state.**
1. **Do not request deployment approval on r1.** RV-1 and RV-2 (HIGH) need script changes. This pass was not authorised to make them.
2. **Next (agent, on a new authorisation for offline pack preparation):** build r2 per the draft README:
   - fixes RV-1…RV-7, RV-11…RV-16;
   - `--npm-ci`, C1 `--log-marker` and N-k `--prev`;
   - the added negative dry runs (README §11);
   - a new manifest and archive recorded here.
3. **Operator:** D-PROD-4 (binding), D-PROD-1, -2, -5, -9, -14, -15, -16 and the new **D-PROD-17**, with the flags in README §9; then
   -6, -7, -8, -10, -11. None is approved by this section.
4. ISSUE-265 **stays open**; deployment is **NOT AUTHORISED**; nothing changed on any host or database.

### 28.16 Deploy pack r2 built and sealed offline (2026-10-06; agent) — deployment **NOT AUTHORISED**; no decision approved

> **Authorisation for this pass:** local pack edits, offline tests and documentation updates only. **Not done:** no PROD, DEV,
> database, network or GitHub contact; no Git mutation (the repository was only read: one `git clone --shared` into the session
> scratchpad as the sandboxes' object source, plus read-only `rev-parse`/`ls-tree`); no deployment, migration, service, timer,
> settle or promotion. r1 and every sealed evidence folder are unchanged (r1 manifest `d8413f73…7e5a` and archive
> `d5e61848…12d8` re-verified; draft README `ce0b1b1f…33c7` unchanged).

- **Pack:** `D:\tmp\issue265\prod-deploy-pack-r2\` — 44 files + `MANIFEST.sha256`; manifest-file sha256
  `7c17a16e7a6f0bd370b3eac2ca3a0e7937395f1ae0ccd0e67857c1e09ffa9231`. **Archive** `D:\tmp\issue265\prod-deploy-pack-r2.tar`
  sha256 `3cc7076c3313f6d8e41a7552651a39bef5cb9c1f99910c6577fea2886c15b4da` (49 entries; extracted content identical to the
  folder, `diff -r`). Files are read-only. Read `README-PROD-DEPLOY.md` first.
- **Offline tests:** `D:\tmp\issue265\prod-deploy-pack-r2-offline-tests\` — 95 files + manifest `94f54f068e862cc0caaf44cd183ec3755505ca8aec1102ddd04fda7a836a32e0`;
  archive `prod-deploy-pack-r2-offline-tests.tar` `99f8b8e871aa03cfdc7828ab118372e32cde2d64b2e170be74f78f6692c032e4`.
- **Changes (README §1):**
  - RV-1: every guard is `guard || return 1` inside the item's function. The restore and the restart are separate items, and a
    restart happens only after a restore that exited 0 with both BUILD_IDs C0's. The rollback is built the same way.
  - RV-2: new `lib/grade-pglog.mjs`. L0 read completeness covers both scans: item exits, `sudo -n true` at start and end, the
    listing, every reader and scanner exit via `PIPESTATUS`, `gzip -t`, a stable family, and stable line counts. L3 is graded only
    when L0, L1 and L1b pass; otherwise INCONCLUSIVE, or REVIEW when a deadlock line cannot be placed. Journal reads are now
    exit-checked too: J0 for the settle journal, W1 for the web journal.
  - RV-3/RV-4/RV-5: D5 recovers from failures at 40, 45 and 50. Exit codes: 20 contained, 21 restore refused or failed (no
    restart), 22 restored but restart or health failed, 23 `stop`. Every step has an explicit timeout, and health has a 180 s
    wall-clock deadline counted only from a new MainPID. The rollback restores and restarts the web before the checkout and
    dependency steps; both scripts refuse unless `deploy/server-cluster.mjs` is the same blob at PREV and T.
  - RV-6: **D-PROD-17** `--npm-ci verify-only|reinstall` is required (README §7). Verify-only first proves the package blobs are
    equal at PREV, T and in the working tree. New `lib/verify-deps.mjs` then requires: every lock entry installed at its locked
    version and recorded identically in npm's hidden lockfile; absences only for optional entries that do not fit this host or
    that no installed package wants; no extraneous entries; next, react, typescript, tsx, esbuild and its platform binary, and an
    `@next/swc` binding for this platform; engines satisfied. Probes then run `next --version`, `tsx --version`, the SWC load
    and an esbuild transform, followed by `npm ls --all --offline`. It writes nothing and refuses on any doubt. It runs before the
    merge and again after it.
  - RV-7, RV-10, RV-11 and RV-16 are implemented. RV-12/13/14/15 use bracketing markers: C1 `--log-marker` (item 75, check M2)
    and N-k `--prev`. The scan covers every rotated file in order. The marker is built server-side, with an anchored and
    session-tied match. Missing evidence grades INCONCLUSIVE, and `--log-marker no` grades `COUNTED-STRUCTURAL` at best.
  - The r1 claim of "two full-outage paths only" is withdrawn. README §2 lists seven modes supported by inspection and the tests,
    stated as not exhaustive. They include a web exit during the build window and a database outage read as an unhealthy bundle.
    No recovery time is promised.
- **Defects found while building r2 (fixed in r2):** `verify-deps.mjs` given `--project .` turned its probe paths into bare
  module names, so every verify-only run would have refused; it now resolves the path. N-k `S3` passed when both `cap_fp` reads
  were empty.
- **Checks run (all on the workstation):** `bash -n` on every shell file and `node --check` on every `.mjs`; no CR bytes and no
  zero-byte files; the 28 unchanged files are byte-identical to r1.
  - Self-tests with node's network blocked: grade-preflight 18/18; grade-journal 19/19, including the real C0 PROD journal JSON;
    verify-deps 28/28; grade-pglog 43/43. `verify-deps.mjs --probe yes` on the workstation's real installed tree reports
    `SUITABLE` (Windows bindings).
  - **Stub dry runs of the sealed scripts: 378/378 assertions in 57 cases.** Groups: H (harness lockdown), F (refusals,
    D5→DS→D7→C1→N1→N2, State-B rollback), N (23 N-k negatives), D (19 D5 failure stages), R (10 rollback cases). The sandbox
    `PATH` holds only stubs and allowlisted local tools. Node's network is blocked, `kill` can hit only the stub web PID, and any
    `command not found` fails the case. Each case asserts that no forbidden later action occurred: kill, merge, checkout,
    build, extract, move, or reversal.
  - The harness's own defects found during development are not pack results: positional `$1` inside `eval`, stale template
    stubs, and a `$'\r'` that Git Bash empties.
- **Limits:** the stubs answer as the scripts expect, so this proves control flow, guards, refusals, parsing and evidence only.
  Never run on PROD: `npm ls` and the dependency probes, `next build`, `migrate.ts`, the rollback guard, `sql/n05`, `n40`,
  `r110`, the real log line format and rotation names, mawk (approximated by `gawk --posix`), and real kill/respawn timing.

**Remaining decisions (none approved by this pass; flags in README §9):** D-PROD-4 (binding), D-PROD-1, -2, -5, -9, -14, -15,
-16, -17; then -6, -7, -8, -10 (including whether `COUNTED-STRUCTURAL` may count) and -11. Each of the deployment, D7, rollback
and 110 reversal authorisations is its own. An interactive-sudo start of a failed unit (README §5) would also need its own
authorisation.

**Blockers and state:** deployment is **NOT AUTHORISED**; D-PROD-4 is not approved; ISSUE-265 **stays open**; nothing changed on
any host or database. Next: operator review of r2 and the decisions above. Request an approval only on r2, never on r1.

### 28.17 r2 review: item 41 untouched-check and the completed-rollback branch state (2026-10-06; agent, offline) — r2 **NOT READY** (UC-1); deployment **NOT AUTHORISED**

> **Authorisation for this pass:** local read-only inspection and documentation edits. **Not done:** no host, database, network
> or GitHub contact; no Git command of any kind; no shell command; no harness run. r2 (`7c17a16e…9231`, `3cc7076c…b4da`), its
> offline-test folder and every evidence folder were only read and are unchanged. The demonstration below is a trace of the
> sealed code against the sealed harness fixture, **not an executed run**.

**Point 1 — `41-untouched-check` (`lib/bundle.sh:66-80`, called at `d5-deploy.sh:237`): DEFECT UC-1 (MED).**

- **What it verifies:** `.next/BUILD_ID` and `.next/standalone/.next/BUILD_ID` equal C0's (content) with mtimes before
  `D5_START_EPOCH`; the **mtime only** of `.next/standalone/server.js`; and, only `if [ -s next.tar.list ]`, that the number of
  entries outside `./cache` equals the copy listing's line count. No other file's content, size, mode, mtime or name is
  compared. Exit 0 prints "C0's bundle is intact on disk" and D5 exits 20 without a restore or a restart (`d5-deploy.sh:239`).
- **Demonstration (trace, sealed harness fixture `harness/lib.sh:49-54`):** C0 `.next` = `BUILD_ID`, `routes-manifest.json`,
  `standalone/server.js`, `standalone/.next/BUILD_ID`, `standalone/.next/server/app/index.html` (`c0page`),
  `static/chunks/a.js`, `cache/x`, all mtimes 2026-10-01 18:00. Outside `./cache`, `find` prints 13 names and the copy's
  `tar -tf` 13 lines (`./` + 12). Build mode `fail_before_clean` plus either alteration:
  - (a) `printf X > .next/standalone/.next/server/app/index.html` (same name, new content, new mtime); or
  - (b) `mv .next/static/chunks/a.js .next/static/chunks/b.js` (same count, different name set, old mtime kept).
  Every predicate holds: a = b = C0; am, bm, sm < D5 start (none of the three files was touched); n = l = 13. Result: exit 0,
  `NEXT-UNTOUCHED`, D5 exit 20, no restore. **A same-count alteration produces "C0 untouched".** Not executed (no shell
  authorised); the trace is deterministic over `bundle.sh:68-79`.
- **Where same-count changes come from:** the build itself is unlikely to cause one. `cleanDistDir`
  (`node_modules/next/dist/build/index.js:623-624`) deletes both BUILD_IDs, so a run past it is caught. A partial delete that
  aborts lowers the count. The realistic sources are the live web's own runtime writes: on-demand ISR files and fetch/image
  cache under `standalone/.next/`, which the copy includes (only top-level `./cache` is excluded). r2 itself counts such writes
  as RV-9 INFO. Other sources are another process or a filesystem fault. Today a NEW runtime file makes the count differ, so the
  check says TOUCHED, which is conservative. An in-place rewrite passes as untouched. The item's claim ("intact on disk") is
  stronger than its evidence.
- **Consequence:** the web is not restarted and keeps serving from memory. Its next restart, or a lazy chunk load, reads the
  unverified files. Grade MED, not HIGH: no path restarts onto them inside D5, and exit 20 sends the operator to
  `r-rollback.sh --bundle keep`. But `keep` trusts `dp_bundle_is_c0`, which is also BUILD_ID-based, so the unverified tree would
  then be restarted by the rollback.
- **Smallest fix (r3, `lib/bundle.sh` `dp_next_untouched` only; NOT applied, r2 stays sealed):**
  1. Keep the BUILD_ID and mtime lines as a cheap first stop.
  2. Make the copy mandatory: `dp_recovery_copy_verify` must pass (sha256 of `next.tar` = item 15's), otherwise
     `NEXT-TOUCHED: cannot compare`. Remove the `if [ -s … ]` skip. Under `--on-build-failure restore` the copy is already
     required (`d5-deploy.sh:74`).
  3. **Name-set equality** in place of the count. Take `find .next -mindepth 1` and the copy's `tar -tf` with `./` and trailing
     `/` removed. Drop the names `cleanDistDir` itself keeps, `^\./(cache|dev|lock|trace)` (mirrors Next's
     `/^(cache|dev|lock|trace)/`, tested on the relative path, `recursive-delete.js:123-124`). Sort both with `LC_ALL=C` and
     compare with `cmp`. Write both lists and the first 50 `diff` lines into the item.
  4. **Content equality:** `tar --compare -f "$RECOVERY_DIR/next.tar" -C .next --exclude=./dev --exclude=./lock
     --exclude='./trace*'`. GNU tar reads every member, then reports contents, size, mode, mtime and type differences and
     missing files. Any non-zero exit means TOUCHED; print the count and the first 50 lines. Steps 3 and 4 together prove
     .next equals the copy outside the kept names.
  5. Raise item 41's limit from 120 s to 1800 s, the same as item 15. It now reads the archive twice and the live tree once, and
     its duration on PROD is not measured. A timeout counts as TOUCHED, so a restore follows.
  - **Cost, stated:** any runtime ISR or cache write by the live web between items 15 and 41 now means TOUCHED, then a restore
    and a restart. RV-7's no-restart path then holds only for a quiet window. The `lock`/`trace` exclusion keeps Next's own
    pre-clean writes from forcing a restore: lockDistDir defaults to true (`config-shared.js:278`), the lock is acquired before
    the clean (`index.js:618-621`) and unlinked on exit (`lockfile.js:131-141`), and trace is rewritten.
  - Same treatment, decision only: `rb_keep` should call the same comparison before `r-rollback.sh --bundle keep` restarts.
- **Negative tests (proposed harness additions, `cases.sh` group D after D06; stub `stubs.sh:262` gains modes):**
  - `D06a-alter-same-count`: the `fail_before_clean_alter` stub writes `tampered` into
    `.next/standalone/.next/server/app/index.html`, then `touch -d '2026-10-01 18:00:00'` (old mtime), then fails. Expect
    `^NEXT-TOUCHED`, a `Contents differ` line in 41, `^RESTORE ok`, one kill, rc 20. **On r2 this case would FAIL**: r2 prints
    `NEXT-UNTOUCHED`. That failure is the executable form of this demonstration.
  - `D06b-swap-same-count`: `fail_before_clean_swap` renames `static/chunks/a.js` to `b.js`. Expect `^NEXT-TOUCHED`, a name-set
    diff naming both, restore, rc 20.
  - `D06c-kept-names-only`: `fail_before_clean_trace` rewrites `.next/trace` and creates and removes `.next/lock`. Expect
    `^NEXT-UNTOUCHED` and no restore (positive control for the exclusion).
  - `D06d-copy-unverifiable`: `fail_before_clean` plus `fault.corrupt_copy_on_build`. Expect `NEXT-TOUCHED: cannot compare`,
    then 41-restore `RESTORE REFUSED`, rc 21, no kill.
  - D06 stays as it is (positive).

**Point 2 — completed rollback (`r-rollback.sh:27-31, 158, 226`; README §10 line 206): scripts PASS; README gap LOW (doc only).**

- **State after exit 0:** HEAD detached at PREV `1111ab19`; `refs/heads/main` = T `cd3cf782`; `origin/main` = T (D2);
  working tree = PREV; `.next` = C0 (keep/recovery-copy) or a PREV rebuild; database State A. Settles run PREV's source:
  `deploy/` runs no Git and no preflight, so the timer is unaffected.
- **Why preflight fails, precisely** (`tools/dev/preflight.ts:124-174`, `preflight-core.ts:148-158, 289-316`):
  - the detached HEAD FAILs the branch check in every mode;
  - "contains local main" (main = T is not an ancestor of PREV): FAIL, WARN in read-only;
  - "behind origin/main 26": FAIL, WARN in read-only;
  - deploy mode also FAILs on the known untracked settle manifests.
  **Attaching main at PREV would remove only the first two. The origin/main FAIL stays in merge, deploy and promotion mode**,
  because origin/main is T. README line 206 names only the detached HEAD.
- **Should rollback leave main at PREV instead? No.**
  1. It does not make any gated mode pass (origin/main stays behind 26).
  2. It re-arms the sealed D5: `d5-deploy.sh:80-82` (HEAD = PREV, attached to main, origin/main = T) would all pass, so the
     same r2 command could re-ship T with the rollback's cause unresolved. Today the detached HEAD refuses it at line 81.
  3. It arms the routine `git pull` deploy habit, which would fast-forward main PREV→T silently. Settles switch at once, the web
     at the next build. Today `git pull` on a detached HEAD fails loudly.
  4. It is a backward ref rewrite (`branch -f`/`checkout -B`/`reset`) that removes the only local branch at T. r-rollback is
     built on "no reset, no clean". The detached state is the correct fail-closed latch.
- **Holding state (no action):** stay detached at PREV until an exit is decided. Allowed: settles, web, admin promotions
  through the application (no preflight). Not allowed: any preflight-gated operation. **Never** run `git checkout main`,
  `git switch main` or `git pull` here. Any of them moves the checkout to T at once: settles run T while the web is C0, which
  is the README §4 mixed state. Never `git branch -f main 1111ab19`, never `reset`.
- **Evidence preservation, before any exit (operator; read-only Git, no ref change):** record
  `git rev-parse HEAD refs/heads/main refs/remotes/origin/main`, `git symbolic-ref -q HEAD || echo detached`,
  `git reflog -n 5 HEAD`, `git reflog -n 3 refs/heads/main` and `git status --porcelain=v1 --untracked-files=all` into a new
  sealed capture folder. Re-verify the ROLLBACK and D5 folders' manifests (`sha256sum -c`). Copy them off-host. Never move or
  delete `~/issue265-prod/*`, `~/afldb-recovery/1111ab19-…` or any `aside-*` folder.
- **Exit A — keep PREV durably** (a repository-wide decision: it also reverts ISSUE-225/255/256/257/258/264 on main and so on
  DEV; proposed **D-PROD-18**):
  1. Workstation, own authorisation, normal review/merge path: on a branch from `origin/main` (T), `git read-tree --reset -u
     1111ab19…`, then commit R "revert main to the 1111ab19 tree (ISSUE-265 PROD rollback)". Check
     `git rev-parse R^{tree}` = `git rev-parse 1111ab19^{tree}` and `git merge-base --is-ancestor cd3cf782… R`. Merge R to
     origin/main.
  2. PROD, its own authorisation, inside a window with the settle guard inactive:
     - `git fetch origin main`, then check origin/main = R, R's tree = PREV's tree, and T an ancestor of R;
     - `git update-ref -m "issue265: main T->R (tree = PREV)" refs/heads/main R cd3cf7827da15dc73968bf775c62b975c5f26587`.
       This is a guarded fast-forward: it refuses unless main is still exactly T. main is not checked out, so it is permitted;
     - `git checkout main`. The trees are equal, so no file changes and the build stays valid;
     - check: HEAD = R on main, `git status --porcelain=v1 --untracked-files=no` empty, BUILD_ID unchanged;
     - `preflight --mode read-only`, then the needed mode. Expected: branch, main and origin PASS; deploy still FAILs on the
       known manifests (the D-PROD-4 class).
     T stays in history as R's parent; the rollback evidence is untouched.
- **Exit B — roll forward:** a fix T′ on top of T on origin/main, deployed by a **new pack revision**. r2's D5 cannot be reused
  after a rollback (it refuses at line 81, correctly). The attach (`update-ref main T′ T` + `checkout main`) changes the tree
  PREV→T′ and is the deployment's merge step, so it belongs inside that pack's guarded D5 and must never be done by hand first.
- **README fix (r3, text only):** replace line 206 with the precise preflight consequence, the never-list, and pointers to
  Exits A and B. No script change is needed for Point 2.

**Grade:** r2 is **NOT READY** while UC-1 is open (one MED; script change in `lib/bundle.sh` plus four harness cases). Point 2:
scripts PASS, README LOW. r3 would change `lib/bundle.sh` and the item-41 limit in `d5-deploy.sh`, and add the README §10 text,
the four D06a–d cases and the stub modes. That work needs an offline-preparation authorisation; r2 and its archive stay sealed.
Deployment **NOT AUTHORISED**; D-PROD-4 not approved; ISSUE-265 **stays open**.

### 28.18 Deploy pack r3 built and sealed offline: UC-1 fixed, D06a–e, rollback holding state documented (2026-10-07; agent) — deployment **NOT AUTHORISED**; no decision approved

> **Authorisation for this pass:** local pack edits, offline tests and documentation updates only. **Not done:** no PROD, DEV,
> database, network or GitHub contact; no repository Git mutation (the repository was only read: a `git clone --shared` into
> scratch sandboxes as the object source, node_modules metadata, the installed next/tsx for the dependency probes with the
> network blocked, and its ignored `.next` build output copied read-only for one realism test); no deployment, migration,
> service, timer, settle or promotion. r1 (`d8413f73…7e5a`, `d5e61848…12d8`), r2 (`7c17a16e…9231`, `3cc7076c…b4da`), r2's
> tests (`94f54f06…32e0`, `99f8b8e8…32e4`), the r2 draft README (`ce0b1b1f…33c7`) and every evidence folder were re-verified
> unchanged after the work. **D-PROD-18 is documented, not implemented and not approved.**

- **Pack:** `D:\tmp\issue265\prod-deploy-pack-r3\` — 44 files + `MANIFEST.sha256`; manifest-file sha256
  `e2c0d04751a0f164999fa65e4144b4f3f8fe817b32fbfe7851f929bfc08ae2c0`. **Archive** `D:\tmp\issue265\prod-deploy-pack-r3.tar`
  sha256 `35e8f2d8e0ec942478655f8929833803adf510a6237dbdf9e0b42f0258eba14a` (49 entries; extracted content identical to the
  folder, `diff -r`). Files are read-only. Read `README-PROD-DEPLOY.md` §0 first.
- **Offline tests:** `D:\tmp\issue265\prod-deploy-pack-r3-offline-tests\` — 230 files + manifest ``09a7ff1d027646e8a45f95b88f3e2dcf25e5bae98969c1d8838be57d8f1a3a4c``; archive
  `prod-deploy-pack-r3-offline-tests.tar` ``62e39f03312621172b9025c1cb0862953fccd51673b87d78d003cda4c7cc08b8``. Entry point `harness/run-all.sh`; `results/SUMMARY.txt`.

**What changed (README §0, §10; per-file diff in the tests' `results/static/static.txt`):**
- **UC-1 fixed** (`lib/bundle.sh` `dp_next_untouched`, rewritten). UNTOUCHED now requires every step:
  1. r2's BUILD_ID/mtime first stop;
  2. the **verified copy, mandatory** (sha256 = item 15's, BUILD_ID C0's), else `cannot compare`. The member list is re-derived
     from the verified archive, not from the unhashed `next.tar.list`;
  3. **exact path sets**: `find .next` against the archive members, excluding only top-level `^(cache|dev|lock|trace)`, which is
     Next's own regex, matched by prefix, top level only (`build/index.js:624`, `recursive-delete.js:123-124`). The real tree
     shows `trace` and `trace-build` at the top level;
  4. `tar --compare -v` over exactly those members, needing exit 0, an empty stderr, and a `-v` listing equal to the member list;
  5. no **ctime** change under `.next` since D5 started (catches a mode put back and a write behind tar's read position);
  6. the copy re-verifies and the BUILD_IDs are still C0's.
  Any error, unreadable entry, escaped name or timeout prints `NEXT-TOUCHED`, and the restore follows. D5 exits 20 without a
  restore only on exit 0 **and** the `NEXT-UNTOUCHED:` line. The item-41 limit goes from 120 s to **1800 s**. The evidence files
  `41u-*` are sealed with the D5 folder.
- **tar --compare characterised, not assumed** (GNU tar 1.35 as on PROD's 24.04; ext4; unprivileged; 76/76):
  - Reported (exit 1): contents at equal size and mtime, size, mtime, file and directory mode, type, symlink target, a broken hard
    link, a missing file.
  - **Errors** (exit 2): an unreadable file or directory, and a symlink replaced by a regular file ("Cannot readlink").
  - **Not reported:** extra files on disk, a directory's mtime alone, a **truncated archive** (exit 0 after 9 of 18 members, no
    message), trailing bytes (exit 0).
  - `--no-recursion`/`--verbatim-files-from`/`--no-wildcards` act only on names that **follow** them; in the wrong order `./`
    recursed over everything.
  - Owner/group differences could not be exercised unprivileged.
- **Live ISR writes, conservative:** nothing the live web writes is excluded (`standalone/.next/server/app`,
  `standalone/.next/cache` are in the copy). A runtime write between items 15 and 41 means TOUCHED, then a restore and a restart
  (D06e, U30, U31). The no-restart path holds only for a quiet window. Whether PROD's web writes during a window is unknown.
- **F-r3-1 (LOW, found by r3's tests, fixed):** every tar call honoured an inherited `TAR_OPTIONS`, so an `--exclude` in the
  environment would have changed the copy, its verification and the restore. Every tar call in `bundle.sh` is now
  `env -u TAR_OPTIONS tar` (U51, U52).
- **Rollback (§28.17 Point 2), documentation only; scripts unchanged:** README §10.1 records the detached holding state, why
  every gated preflight still fails, why it is kept, the restrictions and never-list, and evidence preservation. §10.2 records
  Exit A (**proposed D-PROD-18**: revert commit R with PREV's tree, then a guarded `update-ref` and an attach) and Exit B (roll
  forward in a new pack). Neither is implemented or approved.
- **New proposal D-PROD-19 (not implemented):** apply r3's comparison before `r-rollback.sh --bundle keep` restarts (it still
  trusts BUILD_IDs only).
- Other files: the pack name only (`PACK_REV`, usage paths, header titles); verified mechanically.

**Checks run (workstation; results in the tests folder):**
- Static: manifest verifies; `bash -n` 13/13; `node --check` 10/10; no CR, no zero-byte, no control bytes; every change outside
  `bundle.sh`, `d5-deploy.sh` and the README is the pack name only.
- Self-tests, node network blocked (0 violations): grade-preflight 18/18; grade-journal 14/14 and 19/19 on the real C0 journal;
  verify-deps 28/28; grade-pglog 43/43; `verify-deps --probe yes` on the real tree `SUITABLE`.
- **Linux (WSL Ubuntu, ext4, GNU coreutils/tar/findutils, mawk, `env -i`, `unshare -n -c`):**
  - tar characterisation 76/76;
  - **group U 105/105**: the actual r3 function through the pack's own `cap`, with the copy made by the pack's
    `dp_recovery_copy_create`. Positive: identical tree, D06c (trace, lock, trace-build, dev), top-level cache, a hard link.
    Negative: same-size rewrite, rename, extra and deleted files, file and directory modes, a mode put back, symlink retarget and
    replacement, a file replaced by a symlink, a directory replaced, a FIFO, a broken hard link, a nested `trace`, a BUILD_ID, ISR
    and fetch-cache writes, a copy unverifiable or absent, an unreadable file or directory, a newline or backslash name, a hanging
    compare (exit 124 at the limit), a tar warning with exit 0, a short `-v` listing, the archive swapped during the compare, a
    write behind tar, and an inherited `TAR_OPTIONS`;
  - **group K 4/4**: the SEALED r2 function on the same fixtures prints NEXT-UNTOUCHED, exit 0, for D06a, D06b and a corrupt
    copy (UC-1 reproduced by execution);
  - **real tree 5/5**: this repository's Windows Next 16 build, 33,723 entries outside `cache`, 1.5 GB copy. The source and the
    ext4 stage listings are equal (`840ddb04…f7c4`). Untouched → UNTOUCHED in 6 s, warm. One real file renamed → TOUCHED.
- **Stub dry runs of the sealed r3 scripts: 490/490 assertions in 62 cases (H 2, F 2, N 23, D 24, R 11; run 2).** Group D has 24 cases, including D06a (same size, exact mtime kept: only
  "Contents differ"), D06b (rename), D06c (trace/lock only, no restore, no kill), D06d (unverifiable copy: `cannot compare`, then
  `RESTORE REFUSED`, exit 21, no move, no extract, no kill) and D06e (live ISR write: restore, one kill, exit 20).
- **r2 control in the stub harness: 3/3 cases fail as required (8, 6 and 4 failing assertions).** The same D06a/b/d lines on the sealed r2: r2 prints NEXT-UNTOUCHED and exits 20
  with no restore.
- **Superseded run 1 (kept in the tests folder as `results-run1-superseded-MAX_PATH/`, not counted):**
  - Its long scratch work dir hit Windows MAX_PATH in the sandboxes' `git checkout` ("Filename too long" in 34 case logs).
  - D08 and D18 stopped at their merge (D5 exit 10, the correct pack behaviour), so the totals read 427 passed, 4 failed.
  - That is a harness-environment fault, and it undermines that run's passing cases too.
  - Fixed before run 2: `run-all.sh` refuses a work dir over 24 characters, and `case_clean` fails any case that logs
    "Filename too long".
  - Run 2 is the counted run. Its static, self-test and Linux results were identical to run 1's.
- **Erratum in the sealed r3 README §11:** "D (now 25 cases" should read 24. Descriptive only. It is left as sealed so the pack
  hash and run 2's evidence stay valid; the correction is recorded here and in the tests README.
- Harness defects found while building, not pack results: wrong-order tar options in the first characterisation draft; a
  timezone-dependent mtime restore in the D06a stub (replaced by the exact epoch).

**Limits:** the stubs prove control flow only; the stub harness runs on NTFS, so modes, symlinks and unreadable entries are
proved by the Linux groups. PROD's tree size, item 41's real duration (up to 1800 s, then up to 1800 s of restore), and whether
the live web writes ISR files during a window are unknown. GNU coreutils 9.7 and findutils 4.10 were used (PROD: 9.4, 4.9).

**Remaining decisions (none approved by this pass; README §9):** D-PROD-4 (binding), D-PROD-1, -2, -5, -9, -14, -15, -16, -17;
then -6, -7, -8, -10 (including whether `COUNTED-STRUCTURAL` may count) and -11. Proposed: **D-PROD-18** (post-rollback Exit A)
and **D-PROD-19** (comparison before `--bundle keep`). The deployment, D7, rollback and 110-reversal authorisations are separate,
and so is any interactive-sudo start of a failed unit.

**Blockers and state:** deployment is **NOT AUTHORISED**; D-PROD-4 is not approved; ISSUE-265 **stays open**; nothing changed on
any host or database. Next: the operator reviews r3 (README §0 and §10) and the decisions above. Request an approval only on r3.

### 28.19 Deploy pack r4 built and sealed offline: `--bundle keep` requires the UC-1 proof (2026-10-07; agent) — deployment **NOT AUTHORISED**; no rollback authorised; no decision approved

> **Authorisation for this pass (operator, 2026-10-07):** prepare r4 offline to close the remaining `--bundle keep`
> verification gap: local pack edits, offline tests and documentation updates only. It authorises the verification safeguard,
> not a rollback or a deployment; every outstanding deployment decision stays undecided. **Not done:** no PROD, DEV, database,
> network or GitHub contact; no repository Git mutation (the repository was only read: a `git clone --shared` into scratch
> sandboxes, node_modules metadata, the installed next/tsx for the probes and the installed Next's `cleanDistDir` deletion run
> on a scratch fixture, network blocked); no deployment, migration, service, timer, settle or promotion. r3
> (`e2c0d047…ae2c0`, archive `35e8f2d8…a14a`) and r3's tests (`09a7ff1d…3a4c`, archive `62e39f03…08b8`) re-verified unchanged
> after the work.

- **Pack:** `D:\tmp\issue265\prod-deploy-pack-r4\` — 44 files + `MANIFEST.sha256`; manifest-file sha256
  `aa183ace24c83295289bcdf38ccd646a698f262cd50a5bb192e8634a5f27d0b4`. **Archive** `D:\tmp\issue265\prod-deploy-pack-r4.tar`
  sha256 `6cedef9b77d2bcbb4e83e14dc35144bbe45073db78a2b73673ec66ce368f39a5` (49 entries; extracted content identical to the
  folder, `diff -r`). Read `README-PROD-DEPLOY.md` §0 first.
- **Offline tests:** `D:\tmp\issue265\prod-deploy-pack-r4-offline-tests\` — 149 files + manifest
  `bbda6ffd5dbd1ae41d710722b3590c40a2453918f747cf6c2181627213944016`; archive `prod-deploy-pack-r4-offline-tests.tar`
  `d539639f7cf059091a88c705b6386ae57e416425683c03f8c3883012f5099775` (162 entries). Entry point `harness/run-all.sh`;
  `results/SUMMARY.txt`.

**What changed (`r-rollback.sh` only, plus the README; every other file is the pack name only, verified mechanically):**
- **Prelude (exit 3, nothing changed):** `--bundle keep` also requires `dp_recovery_copy_verify` (copy present, sha256 = item
  15's, BUILD_ID C0's).
- **Item 40 (limit 60 → 1800 s):** `rb_keep` runs `dp_next_untouched "$RB_START_EPOCH"`, the r3 UC-1 comparison, **byte-identical
  to r3** (with `dp_recovery_copy_verify`, `dp_recovery_copy_create`, `dp_bundle_restore`, `DP_NEXT_KEPT_ERE` and the prune
  expression). Only exit 0 with `NEXT-UNTOUCHED:` passes. A difference, an unreadable entry, an unverifiable copy, a tool error
  or the timeout stops the run at 40: `OUTCOME KEEP REFUSED` (exit 10), **no restart, no checkout, no dependency step, no
  automatic change to recovery-copy or rebuild**.
- **Items 41, 30, 31 (keep):** `rb_keep_proven` re-checks 40's `NEXT-UNTOUCHED:` line and final `exit=0` and refuses on its own.
- **`<since>` = the rollback's start.** Changes between item 15 and the rollback are found by the comparison itself (names,
  contents, sizes, modes, types, link targets, hard links, mtimes against the copy); the ctime scan covers changes made during
  the comparison. Conceded, stated in README §0: a change put back exactly before the rollback started is not seen (the tree is
  then equal in every compared attribute; UK05).
- **D-PROD-19** (proposed in r3) is therefore implemented, as unconditional keep behaviour with no flag. Implemented under this
  offline-preparation authorisation; not recorded as an approved deployment decision.

**Exclusions = Next's `cleanDistDir`, exactly (confirmed by running Next's code, not by reading it alone).** Next 16.3.1
`dist/build/index.js:623-624`: `if (config.cleanDistDir && !isGenerateMode)` → `recursiveDeleteSyncWithAsyncRetries(distDir,
/^(cache|dev|lock|trace)/)`. `dist/lib/recursive-delete.js:122-124` tests the regex on the path **relative to `.next`**, and an
excluded directory is never descended into. So it is a **prefix match on the top-level name only**: `trace-build`, `tracer/`,
`lockfile`, `lock.json`, `devtools/`, `development.txt`, `cache-x` are kept with everything below them; nested look-alikes
(`server/trace`, `server/cache/`, `standalone/.next/cache/`, `standalone/trace`) are deleted, because a nested relative path
starts with its top-level parent's name; the match is case-sensitive (`CACHE-upper` deleted) and anchored (`xtrace`, `.cache`,
`_dev` deleted). The pack's ERE `^\./(cache|dev|lock|trace)` (archive names) and `find -path './cache*' … -prune` (tree) are the
same prefix rule and exclude nothing else. `harness/exclusion-check.sh` ran Next's own deletion (regex read from `index.js`)
on a 51-entry fixture: Next keeps 19 paths, and each pack expression excludes exactly those 19 (`EXCLUSION-EQUIVALENT yes`).
The served `standalone/` tree is never excluded. Item 15's `tar --exclude=./cache` leaves out only `./cache/`. Nothing broadened.

**F-r4-1 (MED, operational, fail-closed; found by r4's Linux tests; NOT fixed — proposed D-PROD-20):** after a D5 restore,
`--bundle keep` always refuses on PROD. `dp_bundle_restore` runs `tar -xf` under `umask 077` (`d5-deploy.sh:39`,
`r-rollback.sh:43`); a non-root GNU tar applies the umask, so the restored tree is 700/600 against the copy's 755/644 and
`tar --compare` reports `Mode differs` (UK03; the same restore under `umask 022` passes, UK04). Nothing unsafe follows (no
restart, nothing moved), but the r3 §3 route "restore + restart OK → `--bundle keep` within the window" no longer exists on
PROD: after a restore, the operator must choose `--bundle recovery-copy` (a second move-aside, extract and restart) or
`--bundle rebuild`. Possible fix, not implemented because it changes the restore D5 also uses: `tar -x --preserve-permissions`.
r3's stub case R10 (keep after D5's restore, which passed only because NTFS cannot show modes) is withdrawn.

**Checks run (workstation; one counted run 07:01–07:34 +11:00 on the sealed r4):**
- Static: manifest verifies; r3 still verifies; `bash -n` 13/13; `node --check` 10/10; no CR, no zero-byte; 0 files changed
  beyond the pack name outside `r-rollback.sh` and the README; the four bundle functions IDENTICAL-TO-R3.
- Exclusions: `EXCLUSION-EQUIVALENT yes` (above).
- Self-tests, node network blocked (0 violations): 18/18, 14/14, 19/19 (real C0 journal), 28/28, 43/43; real tree `SUITABLE`.
- Linux (WSL Ubuntu, ext4, GNU tools, mawk, `env -i`, `unshare -n -c`): tar characterisation 76/76; U 105/105; **UK 25/25**
  (UK00 unchanged → UNTOUCHED; UK01 same-size rewrite with mtime put back and UK02 same-count rename, both before the rollback
  start → TOUCHED; UK03 restore under umask 077 → `Mode differs`; UK04 umask 022 → UNTOUCHED; UK05 mode put back → UNTOUCHED,
  conceded; UK06 unreadable file → cannot compare; UK07 hang → exit 124); K (sealed r2) 4/4; real tree 5/5.
- **Stub dry runs of the sealed r4 scripts: 681/681 assertions in 70 cases (H 2, F 2, N 23, D 24, R 10, RK 9).** Group RK runs
  the actual `r-rollback.sh --bundle keep` from the after-D06 state: RK01 unchanged with a respawned web (exit 0; order
  compare < kill < checkout < npm) and RK02 unchanged with C0's process (exit 0, no restart) continue; RK03 same-size rewrite
  with the exact mtime kept, RK04 same-count rename, RK06 copy damaged after the prelude, RK07 unreadable entry (tar exit 2),
  RK08 hang ended by item 40's 1800 s limit (shrunk to 4 s by the harness, logged; `exit=124`) and RK09 a difference while no
  restart was due all stop at 40 with exit 10; RK05 (copy unverifiable before the run) stops in the prelude with exit 3. Each
  refusal proves no kill and the same MainPID, no git checkout/ref command, no npm call, no mv, no `tar -x`, no reversal, HEAD
  still T on main, the hidden lockfile unchanged, no aside folder, no 41/30/31 item, and the altered tree left as found.
- **Controls:** r2 control 3/3 failing as required. **r3 control 7/7:** group RK unchanged against the sealed r3: every refusal
  case fails there and r3 exits 0 (in RK03–RK08 r3 also killed the web), so the gap was real and r4 closes it.
- **Erratum corrected:** r3 README §11's "D (now 25 cases" is 24 in r4's README §11, and this run counted D 24.

**Limits:** stubs prove control flow; modes, umask, unreadable entries and the real hang are proved on Linux. RK07/RK08 inject
the tool's error/hang. PROD's tree size, its build umask, item 40's real duration and whether the live web writes ISR files
during a window (if it does, keep refuses) are unknown. GNU coreutils 9.7/findutils 4.10 were used (PROD 9.4/4.9).

**Remaining decisions (none approved by this pass; README §9):** D-PROD-4 (binding), D-PROD-1, -2, -5, -9, -14, -15, -16, -17;
then -6, -7, -8, -10, -11. Proposed: **D-PROD-18** (post-rollback Exit A) and **D-PROD-20** (restore keeps the copy's modes,
F-r4-1). The deployment, D7, rollback and 110-reversal authorisations are separate.

**Blockers and state:** deployment is **NOT AUTHORISED**; no rollback is authorised; D-PROD-4 is not approved; ISSUE-265 **stays
open**; nothing changed on any host or database. Next: the operator reviews r4 (README §0, §3, §10). Request an approval only
on r4; r1–r3 are superseded.

### 28.20 Deploy pack r5 built and sealed offline: F-r4-1 fixed (the restore keeps the copy's modes) (2026-10-07; agent) — deployment **NOT AUTHORISED**; no rollback authorised; no decision approved or added

> **Authorisation for this pass (operator, 2026-10-07):** prepare r5 offline to fix F-r4-1: make recovery extraction preserve
> the verified archive's file and directory permissions as `arm` without sudo, consistently for D5 recovery and rollback
> `recovery-copy`; keep every archive verification, settle guard, refusal and restart prerequisite; test on Linux with the
> actual restore and comparison functions; run the existing regression checks; seal new r5 pack and test folders and archives,
> preserving r4 and all earlier evidence. **Not a deployment decision:** recorded as the F-r4-1 implementation fix; D-PROD-20
> (proposed in r4) is withdrawn. **Not done:** no PROD, DEV, database, network or GitHub contact; no repository Git mutation;
> no deployment, migration, service or timer action. r4 (`aa183ace…d0b4`, archive `6cedef9b…39a5`), r4's tests (`bbda6ffd…6016`,
> archive `d539639f…9775`) and r3 re-verified unchanged after the work.

- **Pack:** `D:\tmp\issue265\prod-deploy-pack-r5\` — 44 files + `MANIFEST.sha256`; manifest-file sha256
  `7dd2fbb73d59978f550d138df852fa6b035953008db72ab9fe95922253cf8f0f`. **Archive** `D:\tmp\issue265\prod-deploy-pack-r5.tar`
  sha256 `e59485bb26b8af7f56324dffd4befb24eb0a5206cf9636c6f0c99e1af683accf` (49 entries; extracted content identical to the
  folder, `diff -r`). Read `README-PROD-DEPLOY.md` §0 first.
- **Offline tests:** `D:\tmp\issue265\prod-deploy-pack-r5-offline-tests\` — 154 files + manifest
  `f12453c4c3ae9df04e8161a73654a3ee8590d8150b9d107fd04bc6eef28843d0`; archive `prod-deploy-pack-r5-offline-tests.tar`
  `9eec4a96766758e54af558985373cae9e7797dd0e9f0b7231df760af1236081f` (167 entries). Entry point `harness/run-all.sh`;
  `results/SUMMARY.txt`.

**The fix (`lib/bundle.sh` `dp_bundle_restore`, one code line plus one information line; every other file is the pack name
only, verified mechanically):** `env -u TAR_OPTIONS tar --preserve-permissions -xf "$RECOVERY_DIR/next.tar" -C .next`. A
non-root GNU tar otherwise applies the caller's umask (`umask 077` in `d5-deploy.sh:39` and `r-rollback.sh:43`) to every
recorded mode; with the flag the restored files and directories, the `.next` root included, get exactly the copy's modes
(directory modes are applied after their contents, so a `555` directory still receives its entries). Ownership is unchanged
(non-root never chowns). It is the pack's only extraction to disk, and D5's `d5_restore` (item `41-restore`) and the rollback's
`rb_restore` (`--bundle recovery-copy` item 40) both reach it, so both paths get the same behaviour. The new line `MODES after
the extract (--preserve-permissions; information): …` records the root, `standalone`, `server.js` and BUILD_ID modes.
`env -u TAR_OPTIONS` stays, so an inherited `--no-same-permissions` cannot undo it. Unchanged: the copy's creation and
verification, the UC-1 comparison (`dp_next_untouched`), every settle guard, refusal, outcome, limit and decision flag, and the
restart prerequisites (D5 item 42 and rollback item 41 restart only after the restore item exited 0 with `RESTORE ok` and both
BUILD_IDs C0's). Security note: a restore now reproduces C0's own recorded modes (e.g. `standalone/.env*` as the build left
them while C0 served), never wider; under r4 it made them narrower (`600`).

**Recovery instructions changed (pack README §3, §4, §9):** after a D5 restore + restart (exit 20) the rollback that ends the
mixed state is again **`--bundle keep`** within the window: no second extract; its item 41 restarts the web once more onto the
same proven bundle (the MainPID is no longer C0's original). Keep still runs only if item 40 proves `.next` equal to the
verified copy; if the restarted web has written ISR or cache files since the restore, keep refuses (exit 10, nothing moved) and
`--bundle recovery-copy` or `--bundle rebuild` is chosen as a new call. D-PROD-20 is struck from README §9.

**Checks run (workstation; one counted run 07:54–08:30 +11:00 on the sealed r5):**
- Static: manifest verifies; r4 (and its archive hash) and r3 still verify; `bash -n` 13/13; `node --check` 10/10; no CR, no
  zero-byte; 0 files changed beyond the pack name outside `lib/bundle.sh` and the README (`r-rollback.sh`, `d5-deploy.sh`
  included); `dp_next_untouched`, `dp_recovery_copy_verify`, `dp_recovery_copy_create` IDENTICAL-TO-R4; one extraction to disk.
- Exclusions `EXCLUSION-EQUIVALENT yes`; self-tests 18/18, 14/14, 19/19, 28/28, 43/43, real tree `SUITABLE`, 0 network violations.
- Linux (WSL Ubuntu, ext4, GNU tar 1.35, GNU tools, `env -i`, `unshare -n -c`, unprivileged): tar 76/76; U 105/105; **UK 24/24**
  (UK03 flipped: the pack's restore under umask 077 now leaves C0's modes and keep accepts it); K (sealed r2) 4/4; real 5/5.
- **Linux group RS (new), 101/101:** the pack's own `d5_recover`/`d5_restore`/`d5_restart_restored`, `rb_restore`/
  `rb_restart_c0`/`rb_keep`/`rb_keep_proven` and the rollback's own `dp_step` lines, under `umask 077`; only `dp_restart_web` is
  a recorder. An independent oracle (Python `tarfile` + `lstat`, no GNU tar) compares the restored tree with the archive (path
  sets, types, modes incl. the root, symlink targets, hard links, sha256, mtimes) on a fixture with 775/755/750/700/555
  directories, 664/644/640/600/444/755 files, relative/absolute/dangling/directory symlinks and a hard link. RS00 D5 restore →
  oracle equal → keep `NEXT-UNTOUCHED`; RS10 rollback `recovery-copy` → oracle equal → keep accepts; RS40 the real 33,723-entry
  Next tree → oracle equal → keep accepts; RS01–RS04 a content rewrite (mtime put back), a file mode, a directory mode, a
  symlink target after the restore → keep refuses (exit 10, no 41/30/31); RS05 mode put back → accepted (stated concession);
  **RS20/RS21 a real extract failure (`ulimit -f` below a 64 KiB member) in D5 / rollback → `RESTORE FAILED during extract`,
  exit 21 / 10, no restart item, no restart, aside intact**; RS22/RS25 copy unverifiable and RS23/RS24 settle active → refused,
  nothing moved, no restart; RS30 inherited `TAR_OPTIONS='--no-same-permissions --exclude=./static'` ignored; RS31 umask 022.
- **RS r4 control 18/18:** on the sealed r4 both restore paths leave 38 entries whose modes differ from the copy and nothing
  else (700/600/500/400 against 775/664/555/444…), and keep refuses with `Mode differs`: F-r4-1 reproduced, r5 fixes it.
- **Stub dry runs of the sealed r5 scripts: 695/695 assertions in 71 cases (H 2, F 2, N 23, D 24, R 11, RK 9).** D07 now also
  asserts the `MODES` line and the `tar --preserve-permissions -xf` call; **R10 reinstated** (keep after D5's restore: 40
  `NEXT-UNTOUCHED`, 41/30 re-check the proof, one restart, no extract, no move, HEAD PREV, bundle C0; control flow only, NTFS
  synthesises modes). D10/R03 (extract fault) and D08/D09/R04 still prove no restart after a failed or refused restore.
- Controls: r2 control 3/3 and r3 control 7/7 failing as required (unchanged from r4).
- Harness note: `seal.sh` raced on the pack's first seal attempt (the manifest listed itself; refused at "manifest does not
  verify" before any chmod or archive); fixed (`! -name MANIFEST.sha256`) and re-sealed. Recorded in the tests README.

**Limits:** in RS the web restart is a recorder and systemd/Git are stubs; the stub harness proves control flow only. The real
tree is a Windows build staged on ext4 (all 755, no symlinks); the synthetic fixture carries the mode and link variety. Owner
and group were not exercisable unprivileged. PROD's build umask, tree size and timings are unknown.

**Remaining decisions (none approved or added by this pass; README §9):** D-PROD-4 (binding), D-PROD-1, -2, -5, -9, -14, -15,
-16, -17; then -6, -7, -8, -10, -11. Proposed only: **D-PROD-18** (post-rollback Exit A). D-PROD-20 withdrawn (F-r4-1 fixed as an
implementation fix). The deployment, D7, rollback and 110-reversal authorisations are separate.

**Blockers and state:** deployment is **NOT AUTHORISED**; no rollback is authorised; D-PROD-4 is not approved; ISSUE-265 **stays
open**; nothing changed on any host or database. Next: the operator reviews r5 (README §0, §3, §4, §9). Request an approval
only on r5; r1–r4 are superseded.

### 28.21 Operator decisions on pack r5 (2026-10-07) — decisions recorded; **execution NOT AUTHORISED**

> **Operator, 2026-10-07:** "I approve D-PROD-4's narrow preflight exceptions and the recommended choices for D-PROD-1, -2, -9,
> -14, -15, -16 and -17. For observation, approve two counted AFL Tables runs within seven nights, no overnight sampler and no
> controlled PROD promotion. Deployment window: [date/time AEDT]. I'll hold the required pauses. Execution is not yet
> authorised."

Applies to pack **r5** (`prod-deploy-pack-r5`, manifest `7dd2fbb7…8f0f`, archive `e59485bb…accf`, §28.20). The sealed README
§9 heading "none approved by this pack" describes the pack, not this record; the pack is not changed or resealed, because every
decision is passed as a flag at run time.

| Decision | Recorded | Flag (r5 README §9) |
|---|---|---|
| **D-PROD-4** | **APPROVED**, narrow: deploy-mode preflight is accepted only with the two exact FAIL classes of §28.14.7 (WT = the known settle manifests, same-session classification, C0's 36 present; `pending-migration` naming exactly 110 before D7). Any other FAIL still stops D5, DS, D7 and C1 | `--d-prod-4 approved` |
| D-PROD-1 | **APPROVED: A**, deploy exactly `cd3cf7827da15dc73968bf775c62b975c5f26587` by SHA | `--target cd3cf7827da15dc73968bf775c62b975c5f26587` |
| D-PROD-2 | **APPROVED: accept** the 26-commit in-place release (§28.14.4) | `--range-accepted 26` |
| D-PROD-9 | **APPROVED: yes**, the `.next` recovery copy before the build | `--recovery-copy yes` |
| D-PROD-14 | **APPROVED: `beta.afldb.com`** for the DS/C1 public health check | `--public-host beta.afldb.com` |
| D-PROD-15 | **APPROVED: restore** on a failure at 40, 45 or 50 (then, under r5, `r-rollback.sh --bundle keep` within the window; §28.20) | `--on-build-failure restore` |
| D-PROD-16 | **APPROVED: yes**, one server-log marker line per C1/N-k | `--log-marker yes` (+ `--prev <folder>` for N-k) |
| D-PROD-17 | **APPROVED: verify-only** (no `npm ci`; dependencies verified at T and, on rollback, at PREV) | `--npm-ci verify-only` |
| D-PROD-6 | **APPROVED:** 2 counted AFL Tables runs within 7 nights (no AFL API unit on PROD) | — |
| D-PROD-7 | **APPROVED: decline**, no overnight `p30` sampler | — |
| D-PROD-8 | **APPROVED: do not run** P-CTRL (no controlled PROD promotion) | — |
| **D-PROD-5** | **APPROVED (window), 2026-10-07 second message: 7 October 2026, 10:30–12:30 AEDT (+11:00).** Daytime, one date, outside 04:15–06:00, about 22 h from the next 04:30 AFL Tables timer: meets the constraints. Operator: "I'll remain available and pause uploads, promotions and Match Sheet saves throughout the window." **Pauses named:** legacy uploads, promotions, Match Sheet saves. **Not named in that message** (in the §28.14.7 recommendation; the first message said "I'll hold the required pauses"): Data Editor saves, on-demand settles, and the B1 extension (Match Sheet player-statistic corrections paused until the morning after the first counted night). Recorded as not yet confirmed explicitly. **All three confirmed 2026-10-07, third message: §28.22** | `--window-confirmed 2026-10-07` (typed on the day; the scripts check it equals today's local date) |
| Unchanged | D-PROD-3 = B1, D-PROD-12, D-PROD-13 approved (2026-10-06). **Still open:** D-PROD-10 (closure basis; decided at closure) and D-PROD-11 (a tooling issue outside ISSUE-265). **Proposed only:** D-PROD-18. **Withdrawn:** D-PROD-20 (§28.20) | — |

**Not authorised (separate, explicit authorisations):** the D5 deployment (`--i-authorise-deployment`), the D7 run of migration
110 (`--i-authorise-d7-migration-110`), any rollback (`--i-authorise-rollback`) and any 110 reversal
(`--i-authorise-110-reversal`). No script was copied to or run on PROD.

**Before an execution authorisation can be acted on:**
1. ~~The window~~ **recorded: 2026-10-07 10:30–12:30 +11:00.** ~~Still to confirm: Data Editor saves and on-demand settles paused for
   the window, and the B1 Match Sheet player-statistic pause until the morning after the first counted night.~~ **Confirmed in §28.22.** If execution is
   not authorised in time to start inside the window, the window lapses and D-PROD-5 needs a new date. Capacity note: D5's
   item limits sum to about 1 h 57 min at worst (README §6), and a failure at 40 can add up to about 1 h before the restart;
   real durations are unmeasured, so a worst-case D5 can outrun a 2-hour window. The scripts check the date and the settle
   window, not the window's end time: the stop decision at 12:30 is the operator's.
2. D2 freshness (§28.14.8 item 5): option A deploys by SHA, so no re-run is needed unless a non-documentation commit reaches
   `origin/main` before D5; this worktree's tracker edits are uncommitted and are documentation only.
3. The pack goes to PROD as `prod-deploy-pack-r5.tar` with its sha256 checked (`e59485bb…accf`) and the manifest verified on
   the host (README §9 step 0).

**State:** deployment **NOT AUTHORISED**; ISSUE-265 **stays open**; nothing changed on any host or database.

### 28.22 D-PROD-5 confirmations completed; r5 transfer block and D5 launch line prepared (2026-10-07; agent, local read-only) — **execution NOT AUTHORISED**

> **Operator, 2026-10-07 (third message):** "D-PROD-5 confirmed: 7 October 2026, starting at 10:30 AEDT (+11:00). 12:30 is a
> progress review point, not an automatic stop. I will remain available and maintain the pauses until deployment, migration and
> verification finish, or recovery reaches a verified safe state. Uploads, promotions, Match Sheet saves, Data Editor saves and
> on-demand settles are paused throughout. Match Sheet player-statistic corrections remain paused until the morning after the
> first counted AFL Tables night." The same message preserves every §28.21 decision and keeps D5, D7, rollback and 110 reversal
> separately unauthorised.

**D-PROD-5: CONFIRMED in full.**

| Element | Recorded |
|---|---|
| Date and start | 2026-10-07, 10:30 AEDT (+11:00) |
| 12:30 | a **progress review point, not an automatic stop**. This replaces §28.21's end time of 12:30. The capacity note in §28.21 item 1 still holds: a worst-case D5 can run past 12:30. The scripts check the date and the settle window, not an end time |
| Operator availability and pauses | until deployment, migration and verification finish, **or** recovery reaches a verified safe state |
| Paused throughout | legacy uploads, promotions, Match Sheet saves, **Data Editor saves**, **on-demand settles**. These are the five pauses that `d5-deploy.sh:25-26` says the typed `--window-confirmed` date stands for |
| B1 extension | Match Sheet player-statistic corrections stay paused until **the morning after the first counted AFL Tables night** (D-PROD-3 = B1; D-PROD-6). This extends past the window |

**Preserved, unchanged (§28.21):** D-PROD-4's narrow exceptions (the two exact FAIL classes only), the exact target
`cd3cf7827da15dc73968bf775c62b975c5f26587` (D-PROD-1 A), D-PROD-2 accept 26, the recovery copy (D-PROD-9), automatic bundle
restore (D-PROD-15), dependency verify-only (D-PROD-17), the public health host `beta.afldb.com` (D-PROD-14) and the log
markers (D-PROD-16). D-PROD-6/-7/-8 are as approved. D-PROD-10 and -11 remain open, D-PROD-18 is proposed only, D-PROD-20 is withdrawn.

**Local read-only inspection of the pack (2026-10-07, about 11:07 +11:00, workstation).** Neither the sealed folder nor the archive was changed:
- `prod-deploy-pack-r5.tar` sha256 = `e59485bb26b8af7f56324dffd4befb24eb0a5206cf9636c6f0c99e1af683accf` (389,120 bytes) ✔
- `MANIFEST.sha256` sha256 = `7dd2fbb73d59978f550d138df852fa6b035953008db72ab9fe95922253cf8f0f` ✔. `sha256sum -c` verifies all 44 listed files, and
  the folder holds 45 files (44 plus the manifest) with no zero-byte file.
- The archive has 49 entries: 45 regular files and 4 directories under the single top folder `prod-deploy-pack-r5/`. No file contains a CR byte.
  `bash -n` passes on all 13 `.sh` files (Git Bash; parse only).

**Transfer block (prepared and returned to the operator; NOT run by the agent; no host contacted).** It is one fail-fast Windows
PowerShell 5.1 block, run in the console and not in ISE, and it opens three SSH connections to alias `afldb`:
1. It checks the local archive sha256.
2. One `ssh` refuses if `~/prod-deploy-pack-r5.tar`, `~/issue265-prod-deploy-pack-r5` or `~/issue265-r5-transfer-verify.sh` already exists.
3. One `scp` sends the archive plus an LF verify script.
4. One `ssh` runs that script, which executes no pack script and deletes itself on exit. The script checks:
   - the remote archive sha256, **before** extraction;
   - the archive members: 49 entries, files and directories only, one top folder, no `..`;
   - extraction into `~/issue265-prod-deploy-pack-r5` with `--strip-components=1`, with `TAR_OPTIONS` unset and `env -u TAR_OPTIONS`;
   - the manifest's sha256 against `7dd2fbb7…8f0f`;
   - `sha256sum -c --strict` on every listed file, and that no file is present that the manifest does not list;
   - `bash -n` on the 13 scripts.

The block prints `R5-PACK-VERIFIED` only if every step passed. It saves the verify script and the remote output under
`D:\tmp\issue265\r5-transfer-<stamp>\`. If the run fails after `mkdir`, the folder stays in place and a re-run refuses (by
design). Offline checks of the block:
- PowerShell's parser reports 0 errors, and the here-string is byte-identical to the tested script.
- The verify script was run on scratch copies with HOME redirected. It passed with a hostile `TAR_OPTIONS=--to-stdout`, and it refused
  an existing folder, a tampered archive (nothing extracted) and an extra archive member.

**Proposed D5 launch line (NOT LAUNCHED; needs the D5 authorisation).** Run it on PROD as `arm`, in a bash session on the host:
`setsid nohup bash ~/issue265-prod-deploy-pack-r5/d5-deploy.sh --i-authorise-deployment --target
cd3cf7827da15dc73968bf775c62b975c5f26587 --range-accepted 26 --d-prod-4 approved --recovery-copy yes --on-build-failure restore
--npm-ci verify-only --window-confirmed 2026-10-07 > ~/issue265-prod/d5-launch-$(date +%Y%m%d-%H%M%S).log 2>&1 < /dev/null &`.
This is README §9 step 1 with the date typed in. `d5-deploy.sh:76-77` refuses unless the host's local `date +%F` is `2026-10-07`, and
`:93` refuses inside 04:15–06:00 or when the AFL Tables timer is less than 60 min away.

**Not authorised:** the D5 deployment, D7 (migration 110), any rollback and any 110 reversal. Each needs its own explicit
authorisation. The confirmations in this subsection are **not** execution authorisation.

**State:** pack transfer **not run**; deployment **NOT AUTHORISED**; ISSUE-265 **stays open**; nothing changed on any host or
database.

### 28.23 D5 deployment AUTHORISED (2026-10-07) — operator-run; D7, rollback and 110 reversal **NOT AUTHORISED**

> **Operator, 2026-10-07:** "I authorise D5 deployment using verified pack r5 and the approved options for 7 October 2026. The
> pauses are in place, and I remain available through verification or recovery. D7 migration 110 and any rollback remain
> separately unauthorised."

| Item | Recorded |
|---|---|
| Authorised | **D5 only**: `d5-deploy.sh --i-authorise-deployment` from `~/issue265-prod-deploy-pack-r5` (pack r5, manifest `7dd2fbb7…8f0f`) with exactly the §28.21/§28.22 options: `--target cd3cf7827da15dc73968bf775c62b975c5f26587 --range-accepted 26 --d-prod-4 approved --recovery-copy yes --on-build-failure restore --npm-ci verify-only --window-confirmed 2026-10-07` |
| Date | 2026-10-07 (D-PROD-5, §28.22). D5 refuses if PROD's local date is not this date |
| Pauses | confirmed in place by the operator (all five, plus B1) |
| Within D5's authorised behaviour | the automatic restore of C0's bundle and its restart on a failure at 40/45/50 (D-PROD-15, built into D5). D5 runs no migration, writes no database row and never rolls back the checkout |
| Read-only follow-up | DS (`c1-capture.sh --phase ds`, read-only, from a fresh connection at least 2 min after the restart) is D5's success check |
| **NOT authorised** | **D7 (migration 110)**, **any `r-rollback.sh` run** (including `--bundle keep` after a D5 exit 20) and **any 110 reversal**. Each needs its own explicit authorisation |
| Executor | **the operator**, on PROD as `arm` (CLAUDE.md §9). The agent contacted no host |
| Transfer evidence | the operator describes the pack as "verified". The r5 transfer block's output (`R5-PACK-VERIFIED`, `D:\tmp\issue265\r5-transfer-<stamp>\remote-verify.log`) has **not yet been returned** to the agent. `gates_init` (`lib/capture.sh:23`) re-verifies the manifest and refuses (exit 3, nothing changed) if the pack does not verify |

**State:** D5 **authorised, not yet reported as run**; D7, rollback and reversal **NOT AUTHORISED**; ISSUE-265 **stays open**.

### 28.24 D5 on r5 refused at the window guard: pack defect F-r5-1 (timer timestamp parsing); pack r6 built and sealed offline (2026-10-07; agent) — r6 execution **NOT AUTHORISED**

**Operator report (2026-10-07; PROD, operator-run, D5 authorised for r5 by §28.23).** The agent contacted no host; the facts below
are the operator's. Launch log `/home/arm/issue265-prod/d5-launch-20261007-114955.log`. D5 refused at the window guard:
`WINDOW REFUSED: the AFL Tables timer's next elapse was not read`. The timer was active/waiting and the settle service
inactive/dead. `systemctl show afldb-settle-afltables.timer -p NextElapseUSecRealtime --value --timestamp=unix` returned
`Thu 2026-10-08 04:37:30 AEDT`, exit 0. Read without `--timestamp` and parsed with `date --date="$raw" +%s`, the same property
gave epoch `1791394650`, 931 minutes ahead at the time of that probe.

**Classification: a PACK DEFECT (F-r5-1), failed closed. It is NOT an unsafe timer window and NOT a deployment failure.** The
timer's next elapse was more than 15 h away at the launch (1007 min at 11:49:55; outside 04:15–06:00). The refusal is
`d5-deploy.sh:93`, a top-level guard before `gates_init`. By the script, it exits 3 with no evidence folder and nothing changed
(no checkout, merge, dependency step, build or restart). The agent has not seen the launch log; the operator reported the text.
r5's sealed folder, archive and tests are unchanged (hash-verified 2026-10-07 14:08: manifest `7dd2fbb7…8f0f`, archive
`e59485bb…accf`, tests `f12453c4…43d0` / `9eec4a96…081f`).

**Root cause.** `lib/deploy-common.sh:52` (r5) read the property with `--timestamp=unix` and kept only a line starting with `@`
(`sed -n 's/^@//p'`). PROD's systemctl ignores `--timestamp` for `show --value` and prints the local form, so the value was
always empty. The same pattern was in three more read sites, all on D5's path or after it:
- G-START `S3` (`g4-gstart.sh:79`). D5 runs G-START inside item 10, so it would have FAILED there.
- The DS/C1 start guard (`c1-capture.sh:66`). DS and C1 would always have refused.
- `W3` (`c1-capture.sh:145`). It would always have FAILED.
- N-k `TIMER_LAST_TRIGGER_UNIX` (`nk-capture.sh:105`). It would always have been empty, graded "not inside this window".

The offline tests missed it because the r5 stub `systemctl` printed `@<seconds>` whenever `--timestamp=unix` was passed (§28.20).

**r6 (offline preparation, as authorised: local inspection, pack script edits, offline tests, archives/manifests,
documentation).** `D:\tmp\issue265\prod-deploy-pack-r6\`, built from r5:
- **New `lib/timestamp.sh`.**
  - `dp_unit_epoch <unit> <property>` reads `systemctl show … --value` **without** `--timestamp`, under `LC_ALL=C` and
    `timeout -k 2 10`, and checks systemctl's exit status.
  - It accepts `<Www> YYYY-MM-DD HH:MM:SS <ZONE>` only if `date --date` parses it (exit status checked, digits required) **and**
    renders the epoch back to the identical text in the shell's time zone. It also accepts `@<seconds>`.
  - It refuses the following, each with a `TIMESTAMP REFUSED: <unit> <property>: …` line that keeps the raw value
    (`[bracketed]`, control bytes visible), the exit statuses and the messages: a non-zero exit (124 = timed out,
    127 = not found), an empty value, `n/a`, any other shape, more than one line, a date failure, a round-trip mismatch.
  - `dp_timer_next_minutes` adds a checked `date +%s` and refuses an elapse that is not in the future.
- **`dp_outside_settle_window`** keeps the 04:15–06:00 exclusion (with a checked `date +%H%M`) and the 60-minute minimum
  (whole minutes rounded down: 3600 s passes, 3599 s refuses).
- **The same functions in the three other sites.** G-START `S4` now FAILs on an unread local time (r5 graded it PASS).
- **Unchanged:** every decision flag, refusal exit code, other guard, limit and pause. `lib/bundle.sh`, `d5-deploy.sh`,
  `d7-migrate-110.sh` and `r-rollback.sh` differ from r5 by the pack name only. The two evidence-only `runsh` lines with
  `--timestamp=unix` (`c1-capture.sh:95`, `g4-gstart.sh:51`) still record the raw value; nothing parses them.
- **Why the round trip:** `date --date` alone reads `""` as today 00:00 (exit 0), accepts `tomorrow` and `Thu`, ignores a wrong
  weekday (GNU) or moves the date to match it (uutils), and accepts another zone's form.

**Hashes.**

| Item | sha256 |
|---|---|
| `prod-deploy-pack-r6/MANIFEST.sha256` (45 files listed + the manifest) | `34680b5997b0805f9ecbf67bb526fb52be54b7118c93d052be513e331100e44b` |
| `prod-deploy-pack-r6.tar` (409,600 bytes, 50 entries, top folder `prod-deploy-pack-r6/`) | `e3da234e1fa13b69ff3984a76945edcadd5e3024a4f2c1a203619de3f09d706f` |
| `prod-deploy-pack-r6-offline-tests/MANIFEST.sha256` (159 files + the manifest) | `4be1c60b11874b404b2ef08dd4bdfc28f7a0c7c27f9c6d85113ea914a0991f18` |
| `prod-deploy-pack-r6-offline-tests.tar` (171 entries) | `5864616eed1d0dec9af21181693bc04214c44f5c070d1950ed244d26c0184a94` |
| `transfer/r6-transfer.ps1` (inside the sealed tests) | `4ad3f7f324d8b6aa2c391f8eacff6549d003753fce56929efbec98f027906b95` |

**Offline verification.** One counted run, 2026-10-07 13:32–14:07 +11:00, on the sealed r6, `harness/run-all.sh` exit 0.
Nothing contacted a host, a database or the network.
- **Static:** 14 `bash -n`, 10 `node --check`, 0 CR, 0 zero-byte. r5 and r4 still verify. 0 files changed beyond the pack name
  outside the four scripts, `lib/timestamp.sh` and the README.
- **Exclusions:** equivalent. **Self-tests:** 18/18, 14/14, 19/19, 28/28, 43/43; real tree SUITABLE; 0 network violations.
- **Linux** (WSL, GNU tools, no network, unprivileged; group WG with `TZ=Australia/Melbourne`):
  - WG 259/259 with GNU date. It covers the exact PROD output at the launch time (1007 min) and the probe time (931 min, epoch
    `1791394650`), systemctl exit 1/4/127/124, empty/no output/`n/a`, 18 malformed shapes, CR, two lines, wrong weekday, zone
    not in effect, unknown zone, impossible date, UTC form, date parse/render/clock failures, past/equal elapse, the 59/60-min
    boundary (3599 s refused, 3600 s passes, rounding down) and 04:14:59/04:15:00/05:59:59/06:00:00, DST start/end and the
    repeated hour.
  - WG uutils 259/259 (information). **WG r5 control 6/6:** the sealed r5 refuses PROD's exact output with PROD's text.
  - r5's suites on r6: tar 76/76, U 105/105, UK 24/24, K 4/4, real 5/5, RS 101/101, RS r4 control 18/18.
- **Stub harness** (actual sealed scripts; the stub now prints the local form as PROD does): **802/802 in 82 cases** (H 2, F 2,
  N 23, D 24, R 11, RK 9, new W 11), 0 FAIL lines. W covers D5's refusals with the reason kept in the launch log and nothing
  changed, G-START `S3`/`S4` FAIL, DS refusal and pass with `W3`, and F-flow's D5/G-START/DS/N1 reads of the PROD form.
- **Stub r5 control 13/13:** the sealed r5 reproduces PROD's D5 refusal and G-START `S3 FAIL next elapse not read`.
- **Correction, recorded:** one static check of that run was wrong (`--include` after `--`, so grep searched every file).
  Its `TIMESTAMP-UNIX-PARSED 1` was README prose. Corrected and re-run on the sealed pack:
  `results/static/static-correction.txt`: 0 in r6, and the 5 defective lines in r5. The sealed `run-all.sh` has the
  corrected order.
- **Not repeated:** r5's r2/r3 stub controls. Those packs refuse at the same guard under the faithful stub before reaching
  what they control.

**Not established offline:** that D5 will pass on PROD (every guard re-checks at run time), and PROD's systemd and coreutils
versions. The fix depends only on the observed output form. A zone abbreviation that the shell's `date` cannot render back
would refuse with its reason (fail closed). PROD's AEST/AEDT and both DST changes pass.

**Transfer (prepared, NOT RUN).** `prod-deploy-pack-r6-offline-tests\transfer\r6-transfer.ps1` is the §28.22 block with r6's
names and hashes: 50 archive entries, 45 listed files, 14 scripts, `R6-PACK-VERIFIED`, record folder
`D:\tmp\issue265\r6-transfer-<stamp>\`. It installs into `~/issue265-prod-deploy-pack-r6`. It leaves r5's folder and archive
on PROD untouched and refuses if any r6 path already exists. Checks:
- Its verify script is byte-identical to the here-string. PowerShell's parser reports 0 errors.
- On WSL with GNU tools it passed 11/11: a clean pass with a hostile `TAR_OPTIONS`, the script removing itself, and refusals
  for an existing folder, a tampered archive, the r5 archive under the r6 name and a missing archive.

**Decisions and authorisations (unchanged).**
- Every §28.21/§28.22 decision stands as recorded, including D-PROD-5. 12:30 is a progress review point, not a deadline; the
  pauses and the B1 extension stand.
- **The §28.23 D5 authorisation named pack r5 and is NOT treated as permission to run r6.**
- D7 (migration 110), any rollback and any 110 reversal remain NOT authorised.
- D-PROD-10/-11 stay open; D-PROD-18 is proposed only.

**State:** F-r5-1 fixed in r6 offline; r6 **NOT RUN, NOT AUTHORISED**; nothing changed on any host or database by the agent;
ISSUE-265 **stays open**.

### 28.25 D5 on r6 AUTHORISED (2026-10-07) — operator-run; D7, rollback and 110 reversal **NOT AUTHORISED**

> **Operator, 2026-10-07:** "I authorise operator-run D5 deployment using verified pack r6 today, 7 October 2026." The same
> message reports the r6 transfer, keeps every earlier decision and the pauses, says 12:30 was a progress review point and not
> an end time, and keeps D7, any rollback and any 110 reversal separately unauthorised. ISSUE-265 stays open; a completed
> deployment is not PROD acceptance.

**r6 transfer (operator-run on PROD as `arm`, 2026-10-07 14:48 AEDT).** `R6-PACK-VERIFIED`. Pack `/home/arm/issue265-prod-deploy-pack-r6`.
The agent read the local record `D:\tmp\issue265\r6-transfer-20261007-144800\remote-verify.log` (host `afldb-prod`, user `arm`,
14:48:03 +11:00). It shows:
- the remote archive sha256 `e3da234e…706f` was checked before extraction;
- 50 archive entries, regular files and directories only, under one top folder;
- the manifest sha256 `34680b59…e44b`, with 45/45 listed files verified and no unlisted file;
- `bash -n` passed on 14 scripts, and none was executed;
- the log ends with `R6-REMOTE-CHECKS-PASSED`.

| Item | Recorded |
|---|---|
| Authorised | **D5 only**: `d5-deploy.sh --i-authorise-deployment` from `~/issue265-prod-deploy-pack-r6` (manifest `34680b59…e44b`, archive `e3da234e…706f`), with exactly `--target cd3cf7827da15dc73968bf775c62b975c5f26587 --range-accepted 26 --d-prod-4 approved --recovery-copy yes --on-build-failure restore --npm-ci verify-only --window-confirmed 2026-10-07` |
| Preserved decisions | the exact target, accepting the 26 commits (D-PROD-1 A, -2), D-PROD-4's narrow exceptions, the recovery copy and automatic restore on failure (-9, -15), dependencies verify-only (-17), public host `beta.afldb.com` (-14), the AFL Tables unit unchanged (-12), 110 after the deployment-success checks in the same window (-3 B1, **its execution separately authorised**), two counted AFL Tables runs within 7 nights (-6), log markers yes, no overnight sampler and no controlled PROD promotion (-16, -7, -8) |
| Pauses | uploads, promotions, Match Sheet saves, Data Editor saves and on-demand settles are held. Match Sheet player-statistic corrections stay paused until the morning after the first counted night (B1). The operator stays available until completion or a safe recovery |
| Launch | detached (`setsid nohup`), with a **new** log `~/issue265-prod/d5-launch-r6-<stamp>.log`. A `bash -c` wrapper runs D5 with the arguments above **unchanged**, then appends `D5_EXIT=<code> at <time>`. The wrapper is not in the sealed pack and changes no guard; it records the exit code, which for a pre-`gates_init` refusal exists nowhere else. The launch block is read-only before the launch and does not launch if any of these fails: user `arm`; local date `2026-10-07`; the r6 manifest hash; `sha256sum -c` of the pack; no `d5-deploy.sh` process running; no earlier r6 launch log (**no automatic retry**); the r5 log present |
| Preserved | the refused r5 launch log `/home/arm/issue265-prod/d5-launch-20261007-114955.log`. The launch and outcome blocks only read it and print its sha256, size and mtime. Every sealed pack and evidence folder is kept |
| Within D5's authorised behaviour | the automatic restore of C0's bundle and its restart on a failure at 40/45/50 (D-PROD-15) |
| Read-only follow-up | DS (`c1-capture.sh --phase ds --d5 <D5 folder> --public-host beta.afldb.com --d-prod-4 approved`) runs only after `D5_EXIT=0` and `OUTCOME D5 COMPLETE`. It runs from a fresh SSH connection at least 2 min after the web restart, logged to `~/issue265-prod/ds-launch-r6-<stamp>.log` |
| **NOT authorised** | **D7 (migration 110)**, **any `r-rollback.sh` run** (including `--bundle keep` after a D5 exit 10 at T or exit 20), **any 110 reversal**, the README §5 `sudo systemctl` restart, any change to a timer, and any re-launch of D5 |
| Executor | **the operator**, on PROD as `arm` (CLAUDE.md §9). The agent contacted no host and no database |

**Next action by D5 outcome** (README §3, §10; `90-outcome.txt` is authoritative):

| D5 exit | Meaning | Next |
|---|---|---|
| 0 | D5 COMPLETE; this is **not** deployment success | DS from a fresh connection ≥ 2 min after the restart. DS PASS (exit 0, 20/20) → return the evidence; D7 needs its own authorisation. DS FAIL (exit 1) → stop: T is live in State A; keep the pauses; a rollback decision (`--bundle recovery-copy`) needs its own authorisation. DS refused (exit 3, e.g. < 2 min) → nothing written; re-run DS later. This re-runs a read-only check, not D5 |
| 3 | refused before any change (REFUSED line in the launch log; no evidence folder if before `gates_init`) | stop; return the log; no re-launch without a new instruction |
| 10 | stopped before the build; web on C0's bundle | `CHECKOUT=PREV`: nothing moved except the recovery copy; return it for diagnosis. `CHECKOUT=T`: settles now run T on C0's web. The named exit is `r-rollback.sh --bundle keep`, **not authorised**; decide it within this window |
| 20 | build-stage failure contained: C0's bundle untouched or restored and healthy; checkout T, State A | the same `--bundle keep` decision within this window (README §4: do not leave T on C0's bundle overnight). The AFL Tables timer is next due 2026-10-08 04:37 |
| 21 | restore refused or failed; the web was **not** restarted (old process running from deleted files) | do not restart; return the evidence at once. `--bundle rebuild` or README §5 each need an authorisation |
| 22 | C0 restored, but its restart or health failed: the web is down or unhealthy | return the evidence at once. `RESTART-NEEDS-SUDO` in item 42 → README §5, which needs its own authorisation |
| 23 / missing `D5_EXIT` with no process | not expected (`restore` was passed) / abnormal end | stop; run the outcome block; report |

**Agent process deviation, recorded.** While preparing this, the agent ran one local, read-only shell read (`sed`, `wc`) of the sealed
r6 `d5-deploy.sh` on the workstation through the Bash tool. This is contrary to CLAUDE.md §9. No host was contacted and no file changed.
All other inspection used native read tools.

**State:** D5 on r6 **authorised, not yet reported as run**; D7, rollback and reversal **NOT AUTHORISED**; ISSUE-265 **stays open**.

### 28.26 D5 and DS on r6 reported by the operator; D7 and C1 AUTHORISED (2026-10-07) — operator-run; rollback and 110 reversal **NOT AUTHORISED**

> **Operator, 2026-10-07:** "I authorise D7 to apply migration 110 on PROD today, 7 October 2026, using verified pack r6 and
> DS-20261007-154459." The same message reports the D5 and DS results below as "pasted operator results, not independently graded
> evidence". It asks for deployment success to be recorded as supported by DS, and says PROD acceptance must not be claimed. It
> keeps every pause and the B1 order (application first, then 110 in the same window). It authorises local documentation updates,
> an operator-run D7 with verified r6 and that exact DS folder, and the approved C1 opening server-log marker. Rollback and
> migration reversal stay separately unauthorised. ISSUE-265 stays open pending C1 and two counted AFL Tables runs within seven nights.

**Operator-reported results (pasted; the agent read neither folder, both on PROD):**

| Run | Reported |
|---|---|
| D5 | folder `/home/arm/issue265-prod/D5-20261007-153007`, manifest `8d44ba8f5ae211abd8c49b824f2f1d45996aa4ce7e437cca67644783fc74c9ff`; all capture items exit 0; `OUTCOME D5 COMPLETE`; `CHECKOUT=T`; BUILD_ID `soM_1u3Nf9aIamMtnpfWn`; `WEB=active running 2131615`; `D5_EXIT=0 at 2026-10-07T15:34:53+11:00`; launch log `/home/arm/issue265-prod/d5-launch-r6-20261007-153007.log` |
| DS | from a fresh SSH connection more than 2 min after the restart; folder `/home/arm/issue265-prod/DS-20261007-154459`, manifest `215ea244cdc10816d01e61e6099d2bf97beb570c39ef479443a04262c0b6e077`; all capture items exit 0; `checks: 20 PASS, 0 FAIL (of 20 expected)`; `DS PASS`; `DS_EXIT=0`; log `/home/arm/issue265-prod/ds-launch-r6-20261007-154459.log` |

**Recorded grade (as the operator asked).** **Deployment success on PROD is supported by DS** (D5 COMPLETE, then DS PASS 20/20 from
a fresh connection), on the operator's pasted report. The agent did not grade the folders independently. This is **not PROD
acceptance**. PROD now runs T `cd3cf782` (web BUILD_ID `soM_1u3Nf9aIamMtnpfWn`, MainPID 2131615; settles run T's sources from the
checkout). The database is in State A (ledger 109, no 110) until D7. T is safe in State A (r6 README §10).

| Item | Recorded |
|---|---|
| Authorised | **D7**: `d7-migrate-110.sh --i-authorise-d7-migration-110 --ds /home/arm/issue265-prod/DS-20261007-154459 --window-confirmed 2026-10-07` from `~/issue265-prod-deploy-pack-r6` (manifest `34680b59…e44b`). Then **C1** after D7 succeeds, from a fresh SSH connection: `c1-capture.sh --phase c1 --d5 /home/arm/issue265-prod/D5-20261007-153007 --d7 <D7 folder> --public-host beta.afldb.com --d-prod-4 approved --log-marker yes`. This includes the one intentional opening-marker WARNING line in the server log (D-PROD-16) |
| Blocks returned | `D:\tmp\issue265\r6-d7-c1-blocks-20261007\BLOCKS.md`. **1** pre-checks, then launches D7 detached. The pre-checks are user `arm`, date 2026-10-07, the r6/D5/DS manifest hashes plus `sha256sum -c`, `OUTCOME D5 COMPLETE`, `DS PASS` and 20/20, web MainPID 2131615 both in DS and now, no D7 process, and no earlier `d7-launch-r6-*.log` or `D7-*` folder. A `bash -c` wrapper appends `D7_EXIT=<code> at <time>` to a new log `~/issue265-prod/d7-launch-r6-<stamp>.log`. **2** (read only, can be re-run) waits up to 40 min for `D7_EXIT`. It prints the log, the D7 folder's manifest and verification, `exits.tsv`, `90-outcome.txt`, items 11–14, 20, 25, 31–35 and both preflight grades. It ends with `D7 GO-FOR-C1` or `D7 NOT CLEAN: STOP`. **3** runs from a new connection. It re-checks r6, D5, `D7_EXIT=0`, the single D7 folder named in the log, `OUTCOME D7 COMPLETE`, verification and every item at exit 0. It refuses if a C1 log or folder already exists, because N1's L1b needs exactly one opening marker. It launches C1 detached with `C1_EXIT=`, waits, then prints the C1 manifest, the non-zero items, the checks and the verdict (expected 21/21 with the marker) |
| Checks on the blocks | proofread against `d7-migrate-110.sh`, `c1-capture.sh`, `lib/capture.sh` and `lib/deploy-common.sh` only. **Not executed and not syntax-checked** (no shell authorisation) |
| No retry | none of the blocks re-launches after a refusal, failure or inconclusive end; blocks 1 and 3 refuse when an earlier log or folder exists |
| **NOT authorised** | any `r-rollback.sh` run, any 110 reversal (`--i-authorise-110-reversal`), the README §5 `sudo systemctl` restart or any other restart, any timer change, any re-launch of D5, D7 or C1 |
| Pauses | all held (uploads, promotions, Match Sheet saves, Data Editor saves, on-demand settles). Match Sheet player-statistic corrections stay paused until the morning after the first counted AFL Tables night (B1). The first such record makes the release roll-forward-only. The operator stays available through completion or a safe recovery |

**Next action by D7 outcome** (README §10; D7's `90-outcome.txt` is authoritative):

| D7 | Meaning | Next |
|---|---|---|
| `D7_EXIT=0`, block 2 `GO-FOR-C1` | State B, zero `player_match_stats` records, rollback guard PERMITTED, preflight graded `d5-post110` | block 3 (C1) from a fresh connection; return the C1 log, manifest and verdict |
| 3 (`REFUSED:` in the log; no folder if before `gates_init`) | nothing changed; State A; T is safe in State A | stop; return the log; no re-launch without a new instruction |
| 10, stopped at items 10–14 | before the apply; nothing changed; State A | stop; return block 2's output |
| 10, stopped at item 20 (apply) | the runner applies 110 in one transaction with its ledger row; item 25 records the state (expected State A) | stop; return block 2's output; do not re-run |
| 10, stopped at items 30–35 | 110 **is applied** (State B), but a post-check failed | stop; return block 2's output. Reversal is NOT authorised; decide separately |
| no `D7_EXIT` and no process | abnormal end | stop; return block 2's output |
| C1 exit 1 (FAIL) or 3 (refused) | read the C1 checks | stop; return the output; no C1 re-run (a second opening marker would break N1's L1b) |

**Agent process deviation, recorded.** While preparing this, the agent ran one local, read-only shell command through the Bash tool
(`ls -la` and `cat MANIFEST.sha256` of `D:\tmp\issue265\prod-deploy-pack-r6`, plus `ls D:\tmp\issue265`). This is contrary to
CLAUDE.md §9. No host was contacted and no file changed. All other inspection used native read tools.

**State:** D5 COMPLETE and DS PASS **reported by the operator** (deployment success supported by DS, not graded independently by
the agent; **not PROD acceptance**). D7 and C1 **authorised, not yet reported as run**. Rollback and reversal **NOT AUTHORISED**.
ISSUE-265 **stays open** pending C1 and two counted AFL Tables runs within seven nights (D-PROD-6). The AFL Tables timer is next
due 2026-10-08 04:37 AEDT.

### 28.27 D5, DS, D7 and C1 on r6 graded from the copied evidence (2026-10-07; agent, local read-only) — deployment **SUPPORTED**, migration 110 **APPLIED**, C1 **PASS**; **not PROD acceptance**

> **Operator, 2026-10-07:** asked the agent to grade the copied PROD deployment evidence and update the records autonomously. It
> authorised local read-only evidence and repository inspection, local offline graders and hash checks, and documentation edits. It
> excluded any host, database or network contact, any Git mutation, deployment, migration, service/timer action, settle or
> promotion. It reported the D5, DS, D7 and C1 results and a transfer interruption (§28.27.4). It stated that PROD acceptance is not
> complete (two counted AFL Tables nights within seven nights remain), that no overnight sampler or controlled PROD promotion is
> approved, that ISSUE-265 stays open, and that rollback, migration reversal and further PROD changes stay separately unauthorised.

**Method.** The agent contacted no host and ran no Git command. It read the evidence with the native read tools and used PowerShell
and Node only for local hashing and for the r6 pack's own offline grader (`lib/grade-preflight.mjs`). The helper scripts are in the
session scratchpad. They are not part of the repository, and the evidence folders were not written to. The graders were **re-run
against the raw captures**, not trusted from their saved verdicts.

#### 28.27.1 Evidence integrity

Two workstation folders were read: `D:\tmp\issue265\run-20261007-r6-ProdDeployment\` (D5, DS, D7) and
`D:\tmp\issue265\r6-C1-and-logs-20261007-162416\` (C1 and four launch logs). **No C1 copy exists in the first folder, and no partial
C1 copy, screenshot or other leftover of the failed first transfer exists anywhere under `D:\tmp`.** Nothing was removed or changed.

| Folder | `MANIFEST.sha256` file hash (expected = computed) | Listed | Verified | Unlisted | Missing |
|---|---|---|---|---|---|
| `D5-20261007-153007` | `8d44ba8f5ae211abd8c49b824f2f1d45996aa4ce7e437cca67644783fc74c9ff` | 21 | 21 | 0 | 0 |
| `DS-20261007-154459` | `215ea244cdc10816d01e61e6099d2bf97beb570c39ef479443a04262c0b6e077` | 25 | 25 | 0 | 0 |
| `D7-20261007-161100` | `73540daf1ae8a353a8c05fcf45118e2925b2c009d042fdb028594216c833a8db` | 25 | 25 | 0 | 0 |
| `C1-20261007-161726` | `80f807a1687664a797eef0f07ae6bf705f09b40f7856507cb6d0586f5a1c19d5` | 26 | 26 | 0 | 0 |

- **Inventories agree with the launch logs.** Each log's `Files:` count is the manifest count plus the manifest itself (22, 26, 26, 27).
  Each log's printed `MANIFEST:` hash equals the manifest hash computed here. That is independent corroboration of the log content.
- **Launch logs** (hashes calculated here; **not compared with remote hashes**, as the operator stated):
  `d5-launch-r6-20261007-153007.log` `4721671b4a2df9a72146f17ff9884e06cb7d8d23fdb287d38fb53fe7449ba57b`;
  `ds-launch-r6-20261007-154459.log` `b5a051af52bd596c8539a3b962b93ca97ac5f04e05461920465263a1999e414b`;
  `d7-launch-r6-20261007-161059.log` `d42ba2b1e94cc05be421360d682aedf9e39644d3f6dcc6e745ff38f61e07915a`;
  `c1-launch-r6-20261007-161726.log` `3e4e1e2a7026957163fc6b2f7936e15f88cb82b0f13037b1b5c93460480c610f`.
- **The local r6 pack is the pack that ran.** Its manifest hash `34680b59…e44b` equals the hash each of D5, DS, D7 and C1 printed
  on the host (`pack-verified`), and all 45 listed pack files verify locally.
- **Exit statuses.** Every `exits.tsv` row is 0 (D5 14, DS 18, D7 15, C1 19). No item file holds a `[exit N]` or `exit=N` with N ≠ 0
  except ten preflight lines `exit 1: accepted` (eight in the first folder, two in C1; §28.27.3, preflight row). The launch logs say `Items with a non-zero exit: none`
  and carry `D5_EXIT=0 at 2026-10-07T15:34:53+11:00`, `D7_EXIT=0 at 16:11:07` and `C1_EXIT=0 at 16:17:31`. **`DS_EXIT=0` is not in the
  saved DS log** (§28.27.4).

#### 28.27.2 Timeline (host local time, AEDT +11:00, `NTPSynchronized=yes`)

| Time | Event | Source |
|---|---|---|
| 15:30:07 | D5 starts (`D5_START_EPOCH=1791347407`); pack verified; G-START PASS 13/13; window guard `WINDOW ok` (timer next elapse in 787 min) | D5 00, 10 |
| 15:30:08–15:30:31 | Recovery copy of C0's `.next`: `next.tar` 1.5 G, sha256 `f3515598…c6d2`, 33,742 entries, verified | D5 15 |
| 15:30:33 | `git merge --ff-only cd3cf782…`: `1111ab19..cd3cf782`, 115 files, +35,459 −968 | D5 20 |
| 15:30:34–15:30:36 | `--npm-ci verify-only`: package blobs equal at PREV, T and the tree; DEPS V1–V6 PASS; nothing written | D5 18, 25 |
| 15:30:36–15:30:39 | Deploy preflight graded; rollback guard (State A, PERMITTED); source pins 4/4 | D5 30, 32, 34 |
| 15:30:39–15:34:39 | `npm run build` exit 0; BUILD_ID `soM_1u3Nf9aIamMtnpfWn` | D5 40, 45 |
| 15:34:40 | `KILL_SENT` to the old web (pid 1892284) as designed; the unit restarts it | D5 50 |
| 15:34:50 | New web MainPID 2131615 starts (`@1791347690`); health `ok` after 12 s | D5 50, DS 21 |
| 15:34:53 | D5 ends, `D5_EXIT=0`, `OUTCOME D5 COMPLETE`, `CHECKOUT=T` | D5 90 |
| 15:44:59–15:45:04 | DS: 20/20 PASS | DS 80, 81 |
| 16:11:00–16:11:07 | D7: State A re-proved, `migrate.ts --target prod` applies 110 (16 ms), State B proved, `D7_EXIT=0` | D7 |
| 16:17:26–16:17:31 | C1: 21/21 PASS; opening server-log marker raised 16:17:31.000980 | C1 |

#### 28.27.3 Grade against r6, §28.6 and the runbook

Every row was re-derived from the raw item files, not read from a verdict line.

| Check | Evidence and independent re-derivation | Grade |
|---|---|---|
| Target HEAD | D5 20: `Fast-forward 1111ab19..cd3cf782`; DS 10 and C1 10: `git rev-parse HEAD`, `refs/heads/main` and `refs/remotes/origin/main` are all `cd3cf7827da15dc73968bf775c62b975c5f26587` on `refs/heads/main`, tracked changes 0. The merge's 115 stat lines reconcile with the expected range (`range-name-status` 77 M + 37 A + 2 D = 116; rename detection pairs ISSUE-220's D+A, giving 115; 36 created paths = `range-added-paths`). The worktree HEAD here is `cd3cf782` | PASS |
| Working tree | 37 untracked paths, all `docs/rebuild-manifests/afltables_fitzroy_core/settle-*.json` (status file parsed: no entry other than `??`, none outside that pattern). C0's 36 are all present; the 37th is `settle-2026-2026-10-07-0441.json` (batch 46, §28.27.3 database row) | PASS |
| Preflight exceptions (D-PROD-4) | The grader was **re-run locally on all five raw captures**. D5 30, DS 70 and D7 13 (`d5-pre110`): exactly two FAIL classes, `WT` (37 known manifests) and `PENDING110` naming only `110_match_sheet_player_match_stats_authority.sql`, then `ACCEPTED-UNDER-D-PROD-4`. D7 34 and C1 70 (`d5-post110`): `WT` only and `PASS migration parity (110/110)`, then `ACCEPTED`. **Negative control:** the `d5-post110` profile on the pre-110 DS capture gives `BLOCKED` with the two named PROBLEM lines. No other FAIL occurs; the only WARN is `SSH reachability was not requested` | PASS |
| BUILD_IDs | Before: `rjrdXKga5b7MBY_LjXA06` (mtimes 2026-10-01 18:06:30 and 18:08:51; D5 00). After: `.next/BUILD_ID` and `.next/standalone/.next/BUILD_ID` both `soM_1u3Nf9aIamMtnpfWn`, mtimes 15:32:07 and 15:34:37, both after D5 began 15:30:07. No `.env*` under `.next/standalone`. `Strict-Transport-Security` in `routes-manifest.json`. DS and C1 read identical values | PASS |
| Web process and start | Old MainPID 1892284 (started 2026-10-01 18:09:58). New MainPID 2131615, started Wed 2026-10-07 15:34:50 AEDT (`@1791347690`), **after** the standalone BUILD_ID mtime 15:34:37. `ActiveState=active`, `SubState=running`, `NRestarts=1`, `FragmentPath=/etc/systemd/system/afldb.service`, no drop-ins. DS (15:45:00) and C1 (16:17:27) show the same `InvocationID` `bfe76cebe6ca414e8064faa63926476e`, so the web did not restart between them | PASS |
| Health | D5 50 `{"status":"ok","database":"ok","latencyMs":28}` 200 after 12 s; DS local 200 (3 ms) and public `https://beta.afldb.com/api/health` 200 (1 ms); D7 200; C1 local and public 200 | PASS |
| Installed units | `afldb.service` `a3444840e0bd5f94ea05ea4b01508e0e8209d65ae452be665c1049c6b34e149a`, AFL Tables service `f777395ae7cc307608124abbf2921d8cce5807e0f67baccd6ddabba259722b77`, AFL Tables timer `65a33089f59563745ea83660f077bfb87430b4eb66dfb05f5e0eb2c16df7409e`. All three equal the pack's `c0-state.env` in full, and each hash appears in C0's own unit captures (`run-20261006-181657-ProdC0`, matched on a 16-hex prefix). No drop-ins. AFL API, Brownlow and intake units still `not-installed`. D-PROD-12 holds: no unit was reinstalled. Timer: `OnCalendar 04:30`, `RandomizedDelay 15 min`, `Persistent=yes`, last trigger 2026-10-07 04:41:22, **next elapse Thu 2026-10-08 04:37:30 AEDT** | PASS |
| Gate code pins | `PINS settle-afltables=1 settle-afl-api=1 datasets-advisory=1 gate-wait-300000=1` on PROD (D5 34, DS 40, C1 40). The same four patterns each match exactly once in the T source here | PASS |
| Migration 110 ledger and live constraint | D7 10/11: State A (ledger 109, `ledger_110=f`, CHECK 13 literals md5 `f163aaed…`, comment md5 `72ef0d6f…`/358). D7 20: `110 migration file(s), 109 already applied; applying 110_match_sheet_player_match_stats_authority.sql ... ok (16 ms); Applied 1 migration(s).` D7 30/31 and C1 50/51: ledger **110**, `ledger_110=t`, CHECK validated with **14** literals including `player_match_stats`, md5 `8485a11052b93c3eb28fbe73fdbcfe57`, comment md5 `37f2fe81eaaf0bc26511bb799dd55f2b`/590. **Independent:** the comment string and the 14-literal list were re-derived from the migration file at T (length 590, md5 equal; the list equals the live definition's, in order), and the md5 of each recorded `check_def` line reproduces both State A and State B md5s. That **confirms the pack's State B md5, which the pack had only predicted** | PASS |
| Rollback guard | `PERMITTED (D-257-7): no player_match_stats record exists`: D5 32 and DS 52 (State A), D7 12 (A), D7 32 and C1 52 (State B, `admits player_match_stats (migration 110, State B)`). `data_overrides` rows with `entity_type = 'player_match_stats'`: 0 (active 0) in all five reads | PASS |
| Database baseline | DS 60 and C1 60: `batches max_id=46, settle_afltables=14, settle_afl_api=1, admin_upload=0, running=0`; `cap_fp 36\|36\|4cef464ded2cd3de99dc658b95f2759b` and all 36 `cap_row` lines (ids 41–76, xmin 43538, content md5) **identical to C0**; `deadlock_fp 0\|none`; `gate 0`; `p30` empty; `p41` empty (no staged, validated, approved or failed legacy submission, so R-258-1 has nothing stale). `overrides|players|92|92` is unchanged before and after 110. Against C0: batches 45 → 46 and `settle_afltables` 13 → 14. The one new batch is the **scheduled 2026-10-07 04:41:22 run, which ran PREV's sources** (the checkout moved at 15:30:33). It left every `canonical_apply_failed` row untouched | PASS |
| Marker identity | C1 75: marker `AFLDB-ISSUE-265-NK-MARKER C1-1791350246852473008` (nonce = C1's `date +%s` 1791350246 + nanoseconds). The client saw `WARNING:  <marker>` and the query returned `marker\|t\|…\|2026-10-07T05:17:31.000980Z\|warning` (= 16:17:31.000980 +11:00). Backend pid 2136208, `afldb_import@afldb_prod`, `::1:5432`, PostgreSQL 16.15, cluster `16/main`, postmaster start `2026-10-01T20:40:55.348683Z` (2026-10-02 06:40:55 +10:00). Settings: `log_min_messages=warning`, `log_destination=stderr`, `logging_collector=off`, `log_line_prefix='%m [%p] %q%u@%d '`, `log_timezone=Australia/Melbourne`, `log_lock_waits=off`, `deadlock_timeout=1000`. **The line's presence in the server-log file has not been read** (no sudo); N1's L1b establishes it. M2 PASS rests on client-side evidence only | PASS (client side) |
| DS and C1 checks | DS 20/20 and C1 21/21: every check line re-derived above (G1, G2, B1–B5, W1–W3, H1, H2, U1–U4, P1, M1, D1, F1, M2). No deviation | PASS |

#### 28.27.4 Discrepancies and gaps (nothing was corrected in the evidence)

1. **Transfer interruption, not a deployment failure.** Per the operator: the first transfer failed during C1 and did not reach the
   launch logs. A later single SCP connection copied C1 and all four logs. An outgoing SSH IPS event appeared at **16:21:39**:
   `ET SCAN Potential SSH Scan OUTBOUND`, action **Block**. The operator allowed it and the transfer then succeeded. The agent saw
   no screenshot and does **not** claim the destination was independently verified from it. What the agent can say: every C1 file
   verifies against the manifest, whose file hash equals the operator's expected value. The saved C1 folder's local write time
   (16:24:19) is consistent with a copy after the block. **No partial copy was found to preserve.**
2. **`DS_EXIT=0` is operator-reported only.** The DS launch log ends with the verdict and `## finished: 15:45:04,457` and has no
   `DS_EXIT=` line (the D5, D7 and C1 logs have one). The folder is consistent with exit 0: `exits.tsv` is all 0, the item 81 exit is 0 and
   the script prints `DS PASS`. Recorded as operator-reported, corroborated.
3. **"From a fresh SSH connection" cannot be shown from the folder** (no session identity is recorded). The timing requirement is
   shown: DS started 10 min 10 s after the web started (15:34:50) and 10 min after D5 ended, well over 2 min.
4. **Log hashes are local only** (§28.27.1).
5. **Batch 46 (2026-10-07 04:41:22) is known from the database only.** No journal or server-log capture covers it: the C0 sudo
   supplement ended 2026-10-06 19:19, and N1 starts at C1 with `--since-batch 46`. It ran PREV's code before the deployment, `deadlock_fp`
   and all 36 cap rows are unchanged, and it is not part of the acceptance count. Information.
6. **The web journal between the restart (15:34:50) and C1 (16:17:26) has no graded read**; N1 reads from C1. D5/DS/C1 show the web
   healthy and not restarted, and the pauses held. Information.
7. **Build page count:** PROD's build generated 1,516/1,516 static pages; the `afldb_test` build (§25.8) generated 1,515. The databases differ.
   Not investigated; not a defect. D5 45 also records `10549 files under .next/standalone/.next/server/app modified during the build
   interval` (information, not graded).
8. **`npm ls` noise (D5 18, 25):** two extraneous entries (`@emnapi/runtime@1.11.3`, `@img/sharp-wasm32@0.35.3`) and `UNMET OPTIONAL`
   lines for other platforms. The dependency verifier graded `DEPENDENCIES SUITABLE` (426 entries at locked versions; 5 wanted by no
   installed package) and wrote nothing (`node_modules/.package-lock.json` mtime unchanged, 2026-10-01 18:00:10). Information.
9. **Agent process note.** Only native read tools, PowerShell hashing and local Node scripts were used. The shell's working directory was
   moved once to `D:\tmp\issue265` and no file there was changed.

#### 28.27.5 Verdicts

| Item | Verdict |
|---|---|
| D5 | **COMPLETE** (graded from the raw folder) |
| DS | **PASS 20/20**, re-derived. Deployment success on PROD is **supported by independently graded evidence** (not only the operator's pasted report) |
| D7 | **COMPLETE.** Migration 110 was applied **exactly once**, to State B. The rollback guard is PERMITTED. Zero `player_match_stats` authority records exist |
| C1 | **PASS 21/21**, with the opening marker. C1 is the baseline for N-k: `C1_BATCHES_MAX=46`, `C1_EXEC_START_EPOCH=1791347690`, `C1_MAINPID=2131615`, `C1_BUILD_ID=soM_1u3Nf9aIamMtnpfWn` |
| PROD acceptance | **NOT started to count; NOT achieved.** The period starts at C1 (§28.4), 2026-10-07 16:17 +11:00. Counted AFL Tables runs: **0 of 2**. The first possible run is the timer due **2026-10-08 04:37:30** (04:30 + up to 15 min). The 7-night period ends with the N7 capture on 2026-10-14. Fewer than two counted runs by then = INCONCLUSIVE. No overnight sampler and no controlled promotion is approved. ISSUE-265 **stays open** |
| Not shown by anything here | The deployed code has not yet run a settle on PROD. Also unshown: the gate under real contention on PROD, the AFL API settle (unit absent), the reverse-direction 300 s wait, and writers outside the gate (§28.7) |

#### 28.27.6 Pauses (D-PROD-5, D-PROD-3 B1)

- **The deployment-window pauses can now be released.** Basis: D5, DS, D7 and C1 are complete and graded; T is live in State B; the
  web has been stable since 15:34:50; `gate 0`, no batch `running`, no legacy submission in any state, and the rollback guard
  PERMITTED. The five pauses were uploads, promotions, Match Sheet saves, Data Editor saves and on-demand settles, held "for the
  window". Releasing them is the operator's act; the agent cannot enforce or observe it.
- **Keep the B1 pause**: no Match Sheet **player-statistic** corrections until **the morning after the first successfully counted
  AFL Tables night** (the morning capture that grades that night COUNTED). The first such record makes the release roll-forward-only
  (D-257-7).
- **Recommendations, not recorded decisions.** (a) §28.4 says passive acceptance uses the scheduled settles only, so an on-demand settle
  during the observation period would add a batch the nightly count must then explain; avoid it unless needed. (b) A legacy promotion
  still running when the 04:30 settle starts delays the settle up to 300 s; a stuck one would make the night INCONCLUSIVE (§28.6). Avoid
  starting promotions between about 04:15 and 06:00 on 2026-10-08. Promotions outside that period are graded, not forbidden (§28.6).

#### 28.27.7 N1, prepared (**NOT RUN; instructions only**; nothing scheduled)

The operator-ready instructions are in `D:\tmp\issue265\n1-instructions-20261008\N1-INSTRUCTIONS.md`. In short:

- Run on PROD as `arm`, in an **interactive** SSH session (D-PROD-13's `sudo -v` needs a terminal), on 2026-10-08, **not before 06:00**
  (the script refuses 04:15–06:00 and refuses while a settle unit is active). Typical settle runs take about 40 s from a 04:30–04:45 start.
- `nk-capture.sh N1-20261008 --since "2026-10-07 16:17:26+11:00" --c1 /home/arm/issue265-prod/C1-20261007-161726 --prev
  /home/arm/issue265-prod/C1-20261007-161726 --log-marker yes`.
- `--since` is C1's own start, taken from its `00-meta.txt` (`date +%s` = 1791350246 = 2026-10-07 16:17:26 +11:00). It precedes the opening
  marker (16:17:31) and covers everything after it. `--c1` and `--prev` are the same exact folder (N1 requires it). `--log-marker yes`
  keeps D-PROD-16: it requires the C1 opening marker above and raises N1's own closing marker.
- One run per night. Do not re-run C1. After N1, N2 uses `--prev <the N1 folder>` and `--since` = N1's start time.

**State (end of §28.27):** deployment **supported** (graded), migration 110 **applied**, C1 **PASS**; PROD acceptance **0 of 2** counted
runs; D-PROD-10 (closure) not reached. Rollback, any 110 reversal, any restart, any timer change, any re-run of D5, D7 or C1, an overnight
sampler and a controlled PROD promotion stay **NOT authorised**. ISSUE-265 **stays open**. Next: N1 on 2026-10-08.

### 28.28 N1 graded from the copied evidence (2026-10-08; agent, local read-only) — night **COUNTED 1**; PROD acceptance **1 of 2**; the B1 pause **may lift**; N2 prepared (NOT run)

> **Operator, 2026-10-08:** reported N1 as run and its integrity verified (return archive sha256 `6cabf202…abac4`, equal on the workstation and
> on PROD; N1 `MANIFEST.sha256` file hash `fea6936a…0444`, equal to the capture's printed value; `verify-manifest.mjs` listed 25, verified 25,
> actual 25, extra `[]`, missing `[]`, ALL OK; `N1_EXIT=0`; saved verdict `NIGHT COUNTED 1`). It authorised local offline hash checks and graders,
> the four tracking-file updates, and N2 instructions for 2026-10-09 (after 06:00). It excluded any host, network or database contact, any Git
> mutation, deployment, settle, promotion, service or timer action, any change to a sealed pack or evidence, and scheduling or running N2. The
> branch is five commits behind `main` and is **not** reconciled; a later reconciliation must keep these uncommitted records and `main`'s
> ISSUE-259–263 closure updates. Closure stays a separate D-PROD-10 decision after two counted runs.

**Method.** No host, database or network was contacted and no Git command was run. The agent read the workstation copies with the native read
tools, and used local shell commands for hashing, a tar extraction into the session scratchpad (outside the repository and the evidence), the r6
pack's own offline graders (`lib/grade-journal.mjs`, `lib/grade-pglog.mjs`, run from the pack directory, read-only) and one independent Node
script of its own over the raw journal JSON. The helper scripts are in the session scratchpad, not in the repository. Nothing under the evidence
folders or the pack was written. The saved verdicts were **not** relied on: every criterion below was re-derived from the raw files.

#### 28.28.1 Evidence integrity

Workstation folder `D:\tmp\issue265\run-20261008-141619-ProdN1\` (the N1 folder `N1-20261008-20261008-141316`, the launch log and the return archive).

| Item | Expected | Computed here | Result |
|---|---|---|---|
| `n1-return-20261008.tar` sha256 | `6cabf202cbc6bba8fa0ac9e1c5e810b133b843e93ae6ae661a5eecb9449abac4` (operator; equals PROD's printed hash) | same | MATCH |
| N1 `MANIFEST.sha256` file hash | `fea6936a164c28807dbb154abe71fc027ff8ff4b6cafb55144a07c2945430444` (operator; equals the launch log's `MANIFEST:` value) | same | MATCH |
| N1 folder against its manifest | listed 25, verified 25 (`sha256sum -c`), 0 mismatches; 26 files in the folder (25 + the manifest), none unlisted or missing | same | VERIFIED |
| Archive against the loose copy | extracted into a scratch directory: its N1 folder verifies and is **byte-identical** (`diff -r`) to the copied folder; its launch log has the same hash as the loose log | same | IDENTICAL |
| `n1-launch-r6-20261008-141315.log` sha256 | not given | `74d9225f329e162f0b058d1376b420068648f9bd4bb1f4e34378c995967dcbe1` | **calculated locally; not compared with a remote hash** |
| `exits.tsv` | 21 rows | every row 0; the log says `Items with a non-zero exit: none`, `Files: 26` (= 25 + manifest) and ends `N1_EXIT=0 at 2026-10-08T14:13:21+11:00` | CONSISTENT |
| r6 pack | manifest `34680b5997b0805f9ecbf67bb526fb52be54b7118c93d052be513e331100e44b` | the local pack verifies; N1's `00-meta.txt` printed `pack-verified` with the same hash | SAME PACK |
| C1 baseline | manifest `80f807a1687664a797eef0f07ae6bf705f09b40f7856507cb6d0586f5a1c19d5` | the local C1 copy verifies; its verdict is `C1 PASS`; its `C1_*` identity lines equal those N1 printed | SAME BASELINE |

The `DS_EXIT` gap of §28.27.4 does not recur: the N1 log carries `N1_EXIT=0` itself.

#### 28.28.2 Timeline (host local time, AEDT +11:00; `NTPSynchronized=yes`)

| Time | Event | Source |
|---|---|---|
| 2026-10-07 16:17:26 / 16:17:31.000980 | C1 starts / C1's opening server-log marker (pid 2136208) | C1 |
| 2026-10-08 04:37:45.529 | systemd `Starting afldb-settle-afltables.service`; timer `LastTriggerUSec` = 04:37:45 (1791394665) | N1 10, 34 |
| 04:37:58.144 | batch 47 `started_at` (the transaction's start) | N1 21, 22-A |
| 04:38:23.048 / .116 / .118 | `Applied as import batch 47` / `AFLDB_SETTLE_SUCCESS` / `Finished`, 26.702 s CPU; 37.6 s from first to last line | N1 34 |
| 14:13:15 | N1's journal window ends (`until_epoch=1791429195`) | N1 00 |
| 14:13:16.029 | N1 capture starts | N1 00 |
| 14:13:17.329502 | N1's closing marker raised (pid 2182172, `afldb_import@afldb_prod`), about 9 h 35 min after the run | N1 25 |
| 14:13:21 | N1 ends; `sudo -k`, and `sudo -n true` then fails as designed | N1 99 |

#### 28.28.3 Grade against §28.4 (the six counting conditions) and §28.6

| Condition | Independent re-derivation from the raw files | Grade |
|---|---|---|
| 1. The timer fired | `LastTriggerUSec` = Thu 2026-10-08 04:37:45 AEDT; the unit's first journal line is 04:37:45.529 (0.53 s later; the grader's window is −1 s to +10 s); 04:37:45 lies inside the timer's `OnCalendar 04:30` + 15 min random delay. Next elapse **Fri 2026-10-09 04:34:32** | MET |
| 2. Success marker, `Result=success`, `ExecMainStatus=0` | 188 journal lines, all parsed; 184 carry `_SYSTEMD_INVOCATION_ID` `db337a7903524876be765ef081485654` and 4 are systemd's own lines with the same `INVOCATION_ID`; exactly **one** anchored `AFLDB_SETTLE_SUCCESS label=settle-2026-2026-10-08-0437` (pid 2158792) and **zero** `AFLDB_SETTLE_FAILURE`; `Finished` carries `JOB_RESULT=done`; `systemctl show`: `Result=success`, `ExecMainStatus=0`, the same `InvocationID` | MET |
| 3. `Applied as import batch N … 0 unit(s) rolled back` | exactly one line: batch 47, 0 inserted, **60 updated**, 60 ledger rows, 0 retried after resolution, 0 refused at the write, **0 unit(s) rolled back**; derived recompute ran (58 players). The report block agrees: `canonicalApplyRefusals 0`, `canonicalApplyFailures 0` | MET |
| 4. Exactly one `completed` batch of the tool, `started_at` inside the run | `21-n40-runs` lists one batch since 46: 47, `settle-afltables.ts`, `completed`; `started_at` 04:37:58.144466 lies inside 04:37:45.529–04:38:23.118. `22-A` and `22-G` show the same single row. `20-p20`: max id 47, `settle_afltables` 15 (14 at C1 + 1), `settle_afl_api` 1, `admin_upload` 0, `running` 0 | MET |
| 5. `canonicalApplyFailures = 0` | 0 in the batch row, in `22-A` (`apply_failures 0`, `issues_opened 0`, `issues_refreshed 0`) and in the journal report | MET |
| 6. No gate-timeout text | none of `waited 300 s`, `SettlePromotionGate`, `legacy CSV promotion` in any of the 188 entries (the broader scan hit only the counter line `advisoryDisagreement: 0` and the launcher's failure-marker banner) | MET |
| Timer and run identity | the pack grader's `TIMER` check passes; **negative control:** the same journal graded without the timer trigger is `NOT-COUNTED (J1 TRIGGER-NOT-GIVEN)` | CONSISTENT |

| §28.6 acceptance element | Evidence | Grade |
|---|---|---|
| Deadlock text in the settle journal | 0 of 188 entries match `deadlock detected|40P01` (all entries are priority 6) | CLEAN |
| Web journal | `36`: sudo valid at both ends, `WEB_JOURNAL_READ rc=0`, no line matching `deadlock|40P01|55P03|lock timeout|canceling statement|Started|Stopped|Stopping|Main process exited` (`W1` PASS). The unfiltered read held **1** line, which is not preserved in the item (§28.28.4, item 3) | CLEAN (read completely) |
| PostgreSQL server log | all 8 family files read in scan A and again in scan B with `reader_rc=0`, `scan_rc=0`, `gzip=ok`; **A's body equals B's, byte for byte** (rotated files unchanged, live file the same length). Opening marker (`C1-1791350246852473008`) **once**, line 23, tied (pid 2136208, `afldb_import@afldb_prod`); closing marker (`N1-20261008-1791429195551996264`) **once**, line 27, tied (pid 2182172). **0** `deadlock detected` lines strictly between them. The live file's last line (14:13:17.329, pid 2182172) and its mtime (14:13:17) agree with the closing marker. The scanner's self-test passed 10/10 on the host. `grade-pglog.mjs` re-run here: `PGLOG-VERDICT PASS`, L0–L3 and L1b PASS. This is the first time the server-log line of C1's opening marker has been **read** (§28.27.3's marker row had only the client side) | CLEAN |
| All files, all time | deadlock 0, lock_timeout 0, could_not_obtain_lock 0; `statement_timeout` **2**, both in `postgresql-16-main.log.5.gz` (lines 181 and 196; that file covers 2026-09-01 to 2026-09-05, before the deployment and outside the window). Information: C0's supplement (§28.13.2) did not count statement timeouts, so there is no earlier figure to compare | INFORMATION |
| `data_issues` | `22-D` and `22-F` (any deadlock mention, any type, any time): 0 rows. `deadlock_fp` `0|none` equals C1's | CLEAN |
| Fingerprints | `cap_fp` `36|36|4cef464d…9b` and **all 36 `cap_row` lines (ids 41–76, `xmin` 43538, content md5) are identical to C1's `60-p20`** (a `diff` of the two is empty). No open finding was changed, touched or added | UNCHANGED |
| Gate | `gate 0` and an empty `p30` at 14:13 (nobody holds or waits for it) | CLEAN |
| Promotions | `22-B` (admin-upload batches), `22-C` (legacy submissions) and `p41` are empty; `admin_upload` count 0. **No promotion or upload reached the database after the deployment** | NONE |
| Host and deployment state (H1–H4, re-derived) | HEAD `cd3cf7827da15dc73968bf775c62b975c5f26587` on `refs/heads/main`, 0 tracked changes, 0 unknown untracked, **38** known manifests (C1's 37 plus `settle-2026-2026-10-08-0437.json`); both BUILD_IDs `soM_1u3Nf9aIamMtnpfWn` with the mtimes D5 recorded (15:32:07 / 15:34:37); web MainPID 2131615, started 15:34:50, `NRestarts=1`, active/running, so the web did not restart since C1; local health 200 `ok`/`ok`; the three unit hashes equal C0's and C1's | PASS |
| AFL API settle | `35`: no journal entries for the AFL API service, timer or Brownlow units (not installed). No AFL API run is required (§28.4 adds one only if C0 shows the unit installed and enabled) | N/A |

**What the 20 `[warning] afl_api|apply|player_match_stats|…` journal lines are.** They sit in the settle's end-of-run exceptions report
(`ACTIVE — requires attention (20)`). All 20 read `first detected 2026-09-28` and `refused (foreign_source_owner)`; none is another kind. They list
findings that already existed (the 36 open `canonical_apply_failed` rows of C0 and C1). They are not new: this run opened 0 and refreshed 0, and the
36 rows are unchanged to the byte. Information, not a finding.

**What kind of night this was.** The run read 10,246 records and applied **60 canonical row updates** with a derived recompute for 58 players, so the
deployed gated code ran on a night that changed data, not only on a no-change night (§28.4 counts both). It is not a contention test: no promotion
existed to contend with it.

#### 28.28.4 Discrepancies and gaps (nothing was corrected in the evidence)

1. **The two windows leave a one-second seam if N2 starts at N1's capture start.** N1's `00-meta.txt` records `until_epoch=1791429195` (14:13:15, fixed
   when the script began) and a capture start of `14:13:16,029` (`date +%s` 1791429196). The journal window N1 read ended at 14:13:15. N2's `--since` is
   therefore set to **14:13:15**, N1's own window end, so that no second is read by neither night (§28.28.7). The settle service was inactive at N1's
   start check, and the timer's window is 04:30–04:45, so the seam held no settle. This departs from "N1's start time" only in using the window end the
   file also records.
2. **N1 was captured at 14:13, about 9 h 35 min after the run,** not at a morning hour. Nothing in `nk-capture.sh` requires a morning; the 04:15–06:00 refusal
   and the inactive-service check both passed. It does not affect the grade, and it does not delay B1: the first counted night has been independently
   graded, which is what the approved criterion asks for (§28.28.6).
3. **The web journal's single line is not preserved.** `36` records `WEB_JOURNAL_READ rc=0 lines=1` but saves only the filtered view, and that one line
   matched no filter. The web unit logged nothing matching in about 22 hours, which is consistent with a quiet service but is not shown. W1 rests on the read
   being complete (sudo valid at both ends, rc 0), as designed.
4. **The settle's shared-gate hold at 04:37 was not observed at lock level.** The only `pg_locks` sample is `p30` at 14:13, which is empty. No G-obs sampler is
   approved (§28.7). A counted run's proof is, by §28.4's definition, the deployed pinned code (4/4 pins at D5, DS and C1) completing without a gate timeout;
   that is what N1 shows. It is not a direct observation of the lock. Unchanged from §28.4's own statement of limits.
5. **N-k does not re-measure the rollback guard or `data_overrides`.** N1 therefore cannot say whether a Match Sheet `player_match_stats` record has been
   written since C1 (which showed 0 at 16:17 on 2026-10-07). See §28.28.6.
6. **Launch-log hash is local only** (item 1 of §28.28.1), as for 2026-10-07.
7. **Live server-log file is short.** The live file holds 28 lines from the 2026-10-04 00:00 rotation. The next weekly `copytruncate` rotation is Sunday
   2026-10-11 00:00: N4 onward reads across it. The scanner reads the whole family, but under `copytruncate` lines written during the copy can be lost
   (recorded in `30`, not graded). No effect on N2 or N3.
8. **Agent process note.** The brief authorised local hashing and graders, and the agent used the Bash tool for read-only local commands only, including
   `tar -x` into the session scratchpad. No host was contacted. No file under `D:\tmp\issue265` was changed except the new
   `D:\tmp\issue265\n2-instructions-20261009\` folder (§28.28.7). A stray set of oddly named files already present in `D:\tmp\issue265` (visible in a
   directory listing) was not created by this session and was not touched.

#### 28.28.5 Verdicts

| Item | Verdict |
|---|---|
| N1 evidence | **VERIFIED** (§28.28.1): hashes equal, 25 of 25 files, archive and folder identical |
| N1 night | **NIGHT COUNTED 1.** The saved verdict is confirmed by independent re-derivation of all six conditions and every §28.6 element. No FAIL, REVIEW or INCONCLUSIVE condition |
| Counted AFL Tables runs | **1 of 2** (batch 47, invocation `db337a7903524876be765ef081485654`, 2026-10-08 04:37:45–04:38:23) |
| PROD acceptance | **NOT achieved.** One more counted night is needed. The period began at C1 (2026-10-07 16:17); at most 7 nights, so N7 is 2026-10-14. Fewer than two counted runs by then is INCONCLUSIVE. N2 is 2026-10-09 |
| Still not shown | the gate under real contention on PROD (no promotion has happened since the deployment); the refusal path; the reverse-direction 300 s wait; the AFL API settle (unit absent); writers outside the gate (§28.7); a lock-level observation of the settle's hold |
| ISSUE-265 | **stays open.** Closure is a separate D-PROD-10 decision after an acceptance PASS |

#### 28.28.6 The B1 pause (D-PROD-3)

- **The approved criterion.** Match Sheet player-statistic corrections stay paused "until the morning after the first counted AFL Tables night"
  (D-PROD-3 = B1, §28.12.1, §28.21, §28.26), which §28.27.6 and N1-INSTRUCTIONS §6 define as the morning capture that grades that night COUNTED.
- **Is it met? Yes.** The first counted night is 2026-10-08 (04:37–04:38). A verified capture taken after it, N1, graded it COUNTED, and the independent
  re-derivation in §28.28.3 agrees. **The approved B1 criterion is met and now permits the pause to lift.** The first counted night has been
  independently graded, which is the release criterion. It does **not** wait for N2 or for the morning of 2026-10-09. That N1 was captured at 14:13
  rather than in the morning (§28.28.4, item 2) does not change this. (An earlier draft of this section raised a literal-morning reading and suggested
  waiting until 2026-10-09; that suggestion is withdrawn, corrected 2026-10-08 at the operator's direction.)
- **Permission is not an observed action.** The agent cannot enforce the pause or see it lifted. N1 does not measure Match Sheet saves, the rollback
  guard or `data_overrides` (§28.28.4, item 5), so it neither shows that the pause was kept nor that it has been lifted. No decision by the operator to
  lift it has been recorded. Lifting is the operator's act; the agent has released nothing.
- **What lifting changes.** The first Match Sheet `player_match_stats` record makes the release roll-forward-only (D-257-7): the rollback guard then refuses
  a migration 110 reversal. Rollback and any 110 reversal remain **NOT authorised** either way. The operator should note the time of the first such record;
  the N-k captures will not show it, only a later guard read would.
- **Recommendation (not a decision).** Avoid Match Sheet saves, Data Editor saves, legacy promotions and on-demand settles between about 04:15 and 06:00 on
  the remaining observation mornings, for two different reasons (§28.7):
  - **Legacy promotions take the exclusive ISSUE-265 advisory gate.** The settle takes it shared, so a promotion still running when the 04:30 settle
    starts **delays the settle** (up to its 300 s wait), and a stuck one would make the night INCONCLUSIVE (§28.6). The gate serialises the two; it does
    not make the overlap free.
  - **Match Sheet and Data Editor saves are outside the gate.** They can still contend with the settle on match rows, and a deadlock between one of them
    and the settle would be graded against acceptance (§28.6) though the gate cannot prevent it.
  - (On-demand settles are separate: §28.4 uses the scheduled settles only, so an extra batch would need explaining.)
- The deployment-window pauses (uploads, promotions, Match Sheet saves, Data Editor saves, on-demand settles) were already releasable (§28.27.6); N1 shows
  no promotion or upload reached the database, which says nothing about Match Sheet or Data Editor saves.

#### 28.28.7 N2, prepared (**NOT RUN; instructions only**; nothing scheduled)

The complete operator-ready instructions are in `D:\tmp\issue265\n2-instructions-20261009\N2-INSTRUCTIONS.md` (176 lines). **Current sha256 (operator-computed,
2026-10-08, after the correction below):** `aca78e55c7b7bf2f0d7aa2ca0acdbdea2f5183938c4d1e362aa4572730d0fce0`. This **supersedes** the first-prepared hash
`76a1c4f0dc1414bb9cd710e02abbaba9a5dfed5af91d6c28a43dd4045d822944` (171 lines), which no longer describes the file. The agent did not compute or verify the
new hash; it is the operator's value. **Corrected 2026-10-08 at the operator's direction (documentation
only; §7 "Do not" only):** the 04:15–06:00 avoidance now separates legacy promotions (exclusive gate; they can delay the settle) from Match Sheet and Data
Editor saves (outside the gate; they can still contend with it), and the B1 bullet no longer implies any wait. No bash block, `nk-capture.sh` argument, pack r6 file or sealed evidence was touched. Its three bash blocks passed `bash -n` before the correction; the N1- and C1-specific pre-checks were dry-run against
the local copies and all passed (the host-only lines, such as `systemctl`, could not be). In short:

- On **2026-10-09, not before 06:00**, in an **interactive** SSH session as `arm` (D-PROD-13's `sudo -v`), once.
- Step A: read-only pre-checks (user, host, date, time; r6, C1 and N1 folders verified against their manifest hashes; N1's verdict is `NIGHT COUNTED 1`;
  exactly one N1 folder and one n05 item; N1's closing marker recorded; no N2 folder, launch log or return archive yet; settle service inactive).
- Step B: `nk-capture.sh N2-20261009 --since "2026-10-08 14:13:15+11:00" --c1 /home/arm/issue265-prod/C1-20261007-161726 --prev
  /home/arm/issue265-prod/N1-20261008-20261008-141316 --log-marker yes`, piped through `tee` into a new `n2-launch-r6-<stamp>.log`, with `N2_EXIT=` recorded.
- Step C: one `tar` and one `scp` of `n2-return-20261009.tar` into a new `D:\tmp\issue265\run-<stamp>-ProdN2\`, then `Get-FileHash`, the existing
  `verify-manifest.mjs`, the manifest hash and the verdict lines. The agent then grades it as it did N1 (§28.28).
- N2 reads N1's closing marker (`AFLDB-ISSUE-265-NK-MARKER N1-20261008-1791429195551996264`, line 27 of the live log) as its opening marker. Do not
  re-run C1 or N1.
- For N3 onward, `--since` is the previous capture's `until_epoch` (first line of its `00-meta.txt`) in `+11:00` time.

**State (end of §28.28):** N1 graded **NIGHT COUNTED 1**, evidence verified; PROD acceptance **1 of 2** counted runs, **not achieved**; the B1 pause **may lift**
(the operator's act, not observed); N2 instructions prepared, **NOT run**. Rollback, any 110 reversal, any restart, any timer change, any re-run of D5, D7,
C1 or N1, an overnight sampler and a controlled PROD promotion stay **NOT authorised**. ISSUE-265 **stays open**. Next: N2 on 2026-10-09 after 06:00.

### 28.29 D-RETRO-265-20261014 APPROVED (2026-10-14; owner decision, recorded by the agent, local) — exactly ONE retrospective capture in the N2 slot, Option A; ~~**NOT YET RUN**~~ *run 2026-10-14 10:13:43 +11:00, verified and graded: §28.30*; evidence capture only, **not** PROD acceptance

> **Owner, 2026-10-14:** approved D-RETRO-265-20261014 for exactly one retrospective capture using the corrected section 9R (revision 3) of the local proposal, Option A.
> The owner also asked for the Step B same-shell gate (below) and for the commands to be run in one interactive SSH shell.
> Method of this record: the agent edited this file and the local proposal only. **No SSH, database session, HTTP call, sudo, marker write, deployment, settle,
> service or timer change, staging, commit, merge, push, fetch or cleanup occurred.** The capture itself had **not** been run when this was recorded (*it was run later the same day and is recorded in §28.30*).

**Why a decision was needed.** §28.28.7 and `N2-INSTRUCTIONS.md` (sections 1, 3, 7) prescribe one capture per morning, N2 on 2026-10-09 after 06:00, "not on any
other date". N2 was not run on 9 Oct and no N3-N6 capture exists (the PROD folder listing of 14 Oct, `prod-nk-listing-1.txt`, shows only C0, C1, D2, D4, D5, D7,
DS, N1 and SUDO-C0SUPP). The seventh night of the period is **2026-10-14** (§28.28.5). The scheduled 14 Oct run was identified from PROD evidence read without sudo
or database access (`prod-state-1.txt`): unit `afldb-settle-afltables.service`, `InvocationID` **`55a9060a041d4092bb62e27ad3828af3`**, timer trigger 14 Oct 04:37:15,
run 04:37:15-04:38:02, `Result=success`, `ExecMainStatus=0`, import batch 53, `0 unit(s) rolled back`. That evidence is consistent with a counted run but is **not a
grade**: conditions 4 (the `import_batches` row) and the server-log, web-journal and state checks need the capture (proposal section 5).

**Decision (verbatim scope).**
- **Interval** begins `2026-10-08 14:13:15+11:00` (N1's journal window end, §28.28.4 item 1) and ends at the capture.
- **Counting.** Only the scheduled invocation `55a9060a041d4092bb62e27ad3828af3` (batch 53) may become the **second counted run**, and only if all criteria pass
  (§28.4's six conditions, the §28.6 elements, and a clean server-log interval). The earlier missed nights (9-13 Oct) remain **uncounted**; N2-N6 are not counted.
  `N2-20261014` is the label of "the next capture slot after N1"; it does not mean a second night.
- **Approved effects.** The documented `sudo` reads (one interactive `sudo -v`, then `sudo -n` of read utilities, `sudo -k` at the end); six guarded read-only
  database sessions as `afldb_import` on `afldb_prod` (`default_transaction_read_only=on`); one local health request (`/api/health`); **exactly one** PostgreSQL
  WARNING marker (`AFLDB-ISSUE-265-NK-MARKER N2-20261014-<nonce>`, written to no table, row, sequence or persistent setting); new capture folder, launch-log and
  return-archive files under `arm`'s home.
- **Not changed:** N1's evidence, application data, services, timers and deployed code. No settle, restart, deployment, promotion or cleanup. **No automatic
  retry.** A refused, failed or part-way capture is kept as is and reported; a second attempt needs a new owner decision (a second run would raise a second marker).
- **Not granted.** This authorises **evidence capture only**. It is **not** PROD acceptance, **not** closure (D-PROD-10 stays a separate decision after an acceptance
  PASS) and does **not** lift the ISSUE-265 PROD hold. Rollback, any 110 reversal, any restart, any timer change, any re-run of D5, D7, C1 or N1, an overnight sampler
  and a controlled PROD promotion stay **NOT authorised**.
- The decision token `D-RETRO-265-20261014:APPROVED` is **typed by the operator** (Step 0); it is not prepopulated in any block.

**Departures from §28.28.7 that this decision accepts (D-RETRO-1 to D-RETRO-6 of the proposal).** (1) The N2 slot is used on 14 Oct, not 9 Oct; the date guard is
replaced by an explicit 2026-10-14 check. (2) One capture spans six nights; the 9-13 Oct runs appear as `RUN` lines and, by the pack grader's own rule (one
`--timer-last-trigger-us`, the latest trigger only), come out `NOT-COUNTED (J1 TRIGGER-UNPROVEN)`; this behaviour is a **code reading and has not been run**. (3) The
capture happens about 4.5-5 h after the run (N1 was 9 h 35 min). (4) Counting is limited as above. (5) One extra server-log marker, for a capture the D-PROD-16
approval did not foresee. (6) Interactive `sudo` on a new date, read-only. The server-log interval is marker-defined (N1's closing marker to this capture's
closing marker), so **a `deadlock detected` line on any of the six nights fails the one interval**, which would also prevent the 14 Oct run from being counted.

**Procedure and files.** The command blocks are section **9R (revision 3)** of the local proposal (not this file). They are run in **one interactive SSH shell**,
in this order: Step 0 (the token, typed alone), Step A' (read-only pre-checks), Step B (the capture) and the PROD half of Step C (package, N1 check); then the
workstation half of Step C. **Step B refuses to start, before any terminal or `sudo` check, unless `${ok:-0}` equals `1` and `${N1_LISTING_A:-}` is non-empty**
(both set by Step A' in that shell); this supplements, and does not replace, the fresh `revalidate()` that re-reads user, host, date, the 06:00-23:30 window, service
inactivity, the `InvocationID`, the start and exit timestamps, `Result`/`ExecMainStatus`, the timer trigger, the token, and the absence of an N2 folder, launch log
and return archive. A failed `sudo -v` stops the run. Both the capture's and `tee`'s exit statuses are recorded.

| File | sha256 |
|---|---|
| Local proposal (final, revision 3) `D:\tmp\settle-review-20261014\PROD-265-RETRO-CAPTURE-PROPOSAL.md` | `62679fc4428d71d932c1e8f00191f1a1061943c46dd335b8b8b74c3825fb865d` |
| Pre-revision proposal (historical, byte for byte) `...\PROD-265-RETRO-CAPTURE-PROPOSAL.r1-HISTORICAL.md` | `c3a380bd66021af51e3e72a469240fa838ae4819e339314f1374070fe99934d6` |
| r6 pack `MANIFEST.sha256` (`D:\tmp\issue265\prod-deploy-pack-r6`) | `34680b5997b0805f9ecbf67bb526fb52be54b7118c93d052be513e331100e44b` |
| `nk-capture.sh` | `5a10ab9df2dcb3d3c044f5e47047506cd314e74050799e0faa47d1413843ca97` |
| `lib/grade-journal.mjs` | `5f63772c855a73428f053975bf0dc8c2778b181d067b02eee69cbd895d65da66` |
| `lib/grade-pglog.mjs` | `a2c1d813bd0c71d5da71b29a1db6aa96843b95735979cf36773ce4996ee2c60f` |
| `sql/n05-log-control.sql` | `bd454947babc0256f464b81f04ba0bd66824b7fb87b26f5781ce69d1870b92ce` |
| `verify-manifest.mjs` (`D:\tmp\issue265\n1-instructions-20261008`) | `a6c86b156b64457a7aa38ecb8d353846de22fa786cc0a84052fd874862bb8946` |
| C1 `MANIFEST.sha256` | `80f807a1687664a797eef0f07ae6bf705f09b40f7856507cb6d0586f5a1c19d5` |
| N1 `MANIFEST.sha256` | `fea6936a164c28807dbb154abe71fc027ff8ff4b6cafb55144a07c2945430444` |
| N1 return tar | `6cabf202cbc6bba8fa0ac9e1c5e810b133b843e93ae6ae661a5eecb9449abac4` |
| `prod-state-1.txt` (evidence of the 14 Oct identity; `D:\tmp\settle-review-20261014\`) | `fa185bd67a405a699f3613bf0c8c72665f3ddf33267855f5c70b423e5415c44c` |
| `prod-nk-listing-1.txt` (the PROD folder listing) | `fef92566e0636e71147d082b8e9a8a2c3e7e4614d1ee6b99690623b15c98a033` |

The remaining pack files (`sql/n40-runs.sql`, `p20`, `p30`, `p40`, `p41`) are pinned in proposal section 9R.5. All pack files equal their `MANIFEST.sha256` lines (checked
locally on 14 Oct). The command blocks were **parse-checked locally only** (`bash -n` on the four bash blocks, the PowerShell parser on the workstation block); they have
not been executed anywhere.

**Window.** Run after 06:00 and before 23:30 on 2026-10-14, and before the next timer trigger (forecast 15 Oct 04:36:59); never between 04:15 and 06:00 (the pack
refuses) or while a settle is active. The period ends with N7 = 14 Oct (§28.28.5): if the capture is not taken today, fewer than two counted runs by then is
INCONCLUSIVE unless the owner amends D-PROD-6 (an owner act, not an agent act).

**On return, the agent will** (local read-only, as for N1): verify the archive and manifest hashes; re-derive the six conditions for `55a9060a...` from
`34-journal-afltables.json`, `21-n40-runs.txt` and the report block; re-check the server-log interval (opening marker once and tied, closing marker once and tied, 0
`deadlock detected` between them), the web journal, `deadlock_fp`/`cap_fp` against C1, the gate, H1-H4; read the 9-13 Oct `RUN` lines as evidence, not counts;
report the pack's verdict and an independent one; and state the cumulative position as **retrospective** (never contemporaneous): an acceptance PASS **candidate**
if and only if the 14 Oct run is COUNTED and the interval is clean. The agent will not state PROD acceptance, will not describe 9-13 Oct as counted, and will not
describe the capture as contemporaneous.

**State (end of §28.29; as recorded before the capture, superseded by §28.30):** D-RETRO-265-20261014 **APPROVED** for one retrospective capture; the capture is **NOT RUN**; counted AFL Tables runs remain **1 of 2**
(batch 47) until a returned capture is graded; PROD acceptance **NOT achieved**; the PROD hold, the B1 position of §28.28.6 and every item listed as NOT authorised
above are unchanged. ISSUE-265 **stays open**. Next: the operator runs Step 0, A', B and the PROD half of C in one interactive shell, then the workstation half.

### 28.30 N2 retrospective capture RUN, verified and graded (2026-10-14; agent, local read-only); owner accepted batch 53 as the second counted AFL Tables run (retrospective); passive acceptance (§28.6) satisfied on that credit; closure NOT decided; ISSUE-265 stays OPEN

> **Owner, 2026-10-14:** accepted the independently verified invocation `55a9060a041d4092bb62e27ad3828af3` (import batch 53, 2026-10-14 04:37:15–04:38:02 +11:00)
> as the **second counted scheduled AFL Tables run** under D-RETRO-265-20261014. With N1 (batch 47, 2026-10-08) the D-PROD-6 counted-run requirement (2 counted runs
> within 7 nights) is met. **This is a retrospective credit, not a contemporaneous observation.** Nights 9–13 October (batches 48–52) remain **uncounted**. The decision does
> not independently authorise closure, release B1 or lift any other PROD hold.
> Method of this record: the agent used native reads, local SHA-256 hashing, a tar extraction into the session scratchpad (outside the repository and the evidence), the r6 pack's
> own graders (`lib/grade-journal.mjs`, `lib/grade-pglog.mjs`, run read-only from the pack directory), one independent Node script of its own over the raw journal JSON (kept in the
> scratchpad, not in the repository), and read-only Git. **No SSH, database session, HTTP call, sudo, marker write, deployment, settle, service or timer change, new capture, staging,
> commit, merge, push, fetch or cleanup occurred.** Nothing under `D:\tmp\issue265\run-20261014-101558-ProdN2retro\` or the r6 pack was written.

#### 28.30.1 Execution record (what the capture did)

Evidence directory `D:\tmp\issue265\run-20261014-101558-ProdN2retro\` (the capture folder `N2-20261014-20261014-101343`, the launch log `n2-retro-launch-r6-20261014-101343.log`,
the return archive `n2-retro-return-20261014.tar`). This is the one retrospective capture §28.29 approved; no second attempt occurred.

| Item | Record | Source |
|---|---|---|
| Capture | began 2026-10-14 10:13:43.804 +11:00 on `afldb-prod` as `arm` (`NTPSynchronized=yes`), ended 10:13:49.78; pack `prod-deploy-pack-r6` verified on the host (`pack-verified`, manifest `34680b59…e44b`) | `00-meta`, `99-clock-end` |
| Exit statuses | all 21 items exit 0 (`exits.tsv`); the launch log ends `CAPTURE_EXIT=0 TEE_EXIT=0 at 2026-10-14T10:13:49+11:00` and says `Items with a non-zero exit: none`, `Files: 26` | launch log |
| sudo | valid at both ends of the journal reads (`SUDO_START rc=0` … `SUDO_END rc=0` in `34` and `36`); `sudo -k` ran and `sudo -n true` then failed as designed | `34`, `36`, `99` |
| Window | journal `--since "2026-10-08 14:13:15" --until "2026-10-14 10:13:43"`: N1's own window end, so **no seam** (`since_epoch=1791429195` = N1's `until_epoch`) | `00-meta` |
| Closing marker | exactly one, `AFLDB-ISSUE-265-NK-MARKER N2-20261014-1791933223271136429`, raised 2026-10-13T23:13:45.257886Z (10:13:45 +11:00); a WARNING only, no table, row, sequence or setting written | `25` |
| Opening marker | N1's closing marker `N1-20261008-1791429195551996264` (log line 27 of `postgresql-16-main.log.1`, raised 2026-10-08T03:13:17.329502Z) | `42` L1b |
| Timing | the run's last journal line is 04:38:02.746; the capture began **5 h 35 min** later (§28.29 forecast "about 4.5–5 h"; the actual gap is longer, still inside the 06:00–23:30 window and before the next trigger, forecast 2026-10-15 04:36:59) | `34`, `00-meta`, `10-host` |

#### 28.30.2 Evidence integrity

| Item | Expected | Computed here | Result |
|---|---|---|---|
| `n2-retro-return-20261014.tar` sha256 | `3a3114255426febee879c321c72a28a523ac207063769e1b421be9d3d2cdcf43` (owner) | same | MATCH |
| Capture `MANIFEST.sha256` file hash | `760e362251c8222eb3636faa028c4dc8e97826d704cb65a6e119b0bf935bd6a2` (owner; the launch log prints the same) | same | MATCH |
| Folder against its manifest | 25 entries | each file hashed and compared: 25 verified, 0 mismatches; 26 files in the folder (25 + the manifest), none unlisted or missing | VERIFIED |
| Archive against the loose copy | — | extracted into a scratchpad directory (27 files: the capture folder plus the launch log); `diff -r` against the loose folder is empty; the archive's launch log has the same hash as the loose log | IDENTICAL |
| `n2-retro-launch-r6-20261014-101343.log` sha256 | not given | `7daa1e1f6818da72f6dacd186d2d48013c170625a544ac6e2df74def310be64b` | **calculated locally; not compared with a remote hash** |
| Pinned pack files (§28.29 table) | `MANIFEST.sha256` `34680b59…e44b`; `nk-capture.sh` `5a10ab9d…ca97`; `grade-journal.mjs` `5f63772c…6c`; `grade-pglog.mjs` `a2c1d813…c60f`; `n05-log-control.sql` `bd454947…ce`; `verify-manifest.mjs` `a6c86b15…8862` | all equal the §28.29 values | MATCH (6 of 6). `verify-manifest.mjs` itself was not run; the per-file comparison above was done with a separate local loop |
| C1 baseline and N1 return | C1 manifest `80f807a1…c19d5`; N1 return tar `6cabf202…abac4` | both equal | MATCH |
| Pack graders re-run locally | saved verdicts `NIGHT-COUNTED 1` (journal) and `PGLOG-VERDICT PASS` | the same lines, byte for byte, on the loose copies | AGREE |
| **Provenance of the PROD precheck, capture and packaging transcript** | owner: it shows N1 verified and its listing unchanged | **operator-supplied.** It was relayed in the owner's instruction of 2026-10-14. It is not among the files in the evidence directory, and this agent neither collected nor re-read it, so "N1 verified, listing unchanged" rests on the operator's word, not on anything graded here | OPERATOR-SUPPLIED |

#### 28.30.3 Grade of invocation `55a9060a…` against §28.4's six conditions

Re-derived from the raw `34-journal-afltables.json` (1,128 lines, all parsed; the invocation holds 188 lines: 184 carry `_SYSTEMD_INVOCATION_ID` and 4 are systemd's own with the same `INVOCATION_ID`; the run spans 04:37:15.532–04:38:02.746), `21-n40-runs`, `22-A`, `10-host` and the report block. The saved verdicts were not relied on.

| Condition | Independent re-derivation | Grade |
|---|---|---|
| 1. The timer fired | timer `LastTriggerUSec` = Wed 2026-10-14 04:37:15 AEDT (epoch 1791913035, inside the capture window); the unit's first journal line is 04:37:15.532 (0.53 s later); the pack grader returns `trigger=TIMER` | MET |
| 2. Success marker, `Result=success`, `ExecMainStatus=0` | exactly **one** anchored `AFLDB_SETTLE_SUCCESS label=settle-2026-2026-10-14-0437`; `Finished` carries `JOB_RESULT=done`; `systemctl show`: `Result=success`, `ExecMainStatus=0`, `InvocationID=55a9060a041d4092bb62e27ad3828af3`, exit 04:38:02. An unanchored search for `AFLDB_SETTLE_FAILURE` matches one line, the launcher's banner (`[monitor] failure marker: AFLDB_SETTLE_FAILURE (also inspect REFUSED|ERROR|FAILED|Traceback)`); there is **no** anchored `AFLDB_SETTLE_FAILURE label=` line anywhere in the 1,128 | MET |
| 3. `Applied as import batch N … 0 unit(s) rolled back` | exactly one line: batch 53, 0 canonical rows inserted, 0 updated, 0 ledger rows, 0 retried after resolution, 0 refused at the write, **0 unit(s) rolled back**; derived recompute skipped. The report block reads `canonicalApplyFailures: 0` | MET |
| 4. Exactly one `completed` batch of the tool, `started_at` inside the run | `21-n40-runs` and `22-A` list batch 53, `settle-afltables.ts`, `completed`, `started_at` 2026-10-13 17:37:33.131095Z (04:37:33 +11:00), inside 04:37:15.532–04:38:02.746; `20-p20`: max id 53, `running 0`, `admin_upload 0` | MET |
| 5. `canonicalApplyFailures = 0` | 0 in the batch row (`22-A`: `apply_failures 0`, `issues_opened 0`, `issues_refreshed 0`) and in the journal report | MET |
| 6. No gate-timeout text | none of `waited 300 s`, `SettlePromotionGate`, `legacy CSV promotion` in the invocation or in any of the 1,128 journal lines | MET |

**What kind of night this was.** The run read 10,246 records and changed **nothing** (0 inserted, 0 updated); unlike N1 (60 updates) it is a no-change night, which §28.4 counts ("the gate is the first call of every apply transaction, whatever the data"). It is not a contention test: no promotion existed to contend with it.

#### 28.30.4 Grade against §28.6's acceptance (passive) row

| §28.6 element | Evidence | Grade |
|---|---|---|
| DS PASS | §28.27 (DS 20/20, C1 PASS 21/21). Re-checked at this capture: HEAD `cd3cf7827da15dc73968bf775c62b975c5f26587` on `refs/heads/main` (H1), BUILD_ID = C1's `soM_1u3Nf9aIamMtnpfWn` (H2), web MainPID = C1's 2131615, started 2026-10-07 15:34:50, `NRestarts=1` (H3), the three unit fragments = C0 (H4) | PASS |
| The required counted runs, within 7 nights | **2**: batch 47 (N1, 2026-10-08) and batch 53 (2026-10-14, owner-accepted retrospective credit). The period began at C1 (2026-10-07 16:17); N7 is 2026-10-14, and the capture was taken that day | MET (retrospective) |
| No gate-timeout text | 0 in all 1,128 journal lines | MET |
| Deadlock checks, the settle journals | 0 lines match `deadlock detected\|40P01\|55P03\|lock timeout` in all six invocations of the window. AFL API and Brownlow units: `35` finds no entries (units absent, as at C0) | CLEAN |
| Deadlock checks, the web journal | `36`: sudo valid at both ends, `WEB_JOURNAL_READ rc=0 lines=1`; W1 PASS. The single line is **not preserved** (limitation 3 below) | CLEAN (read completely) |
| Deadlock checks, the PostgreSQL log | the 2 window files (`postgresql-16-main.log.1` and the live file) read completely in scan A and again in scan B, inside a family of 9; L0–L3 and L1b PASS (opening marker once and tied, closing marker once and tied at `postgresql-16-main.log:9`, scanner self-test 10/10, **0** `deadlock detected` lines strictly between the markers). In-window `lock_timeout` 0, `statement_timeout` 0, `could_not_obtain_lock` 0. All files, all time: deadlock 0; `statement_timeout` 2, both in `postgresql-16-main.log.6.gz` (lines 181 and 196; the file covering about 2026-09-01 to 09-05, before the deployment). They are the same two lines N1 found in `.log.5.gz`: the 2026-10-11 rotation renumbered the file | CLEAN |
| `data_issues` D and F | `22-D` and `22-F`: 0 rows (any deadlock mention, any type, any time). `deadlock_fp` `0\|none` equals C1's (S1 PASS) | CLEAN |
| Every `cap_fp` change explained | `cap_fp` `36\|36\|4cef464ded2cd3de99dc658b95f2759b` (S3 PASS). A local comparison of all 38 fingerprint lines (`cap_fp`, 36 `cap_row`, `deadlock_fp`) against C1's `60-p20-state.txt` has **0** differences, so there is no change to explain | UNCHANGED |
| Every promotion succeeded or ended `failed` with the exact refusal | `22-B` (admin-upload batches), `22-C` (legacy submissions) and `p41` are empty, `admin_upload 0`, `gate 0` (S2 PASS) and `p30` empty at the capture. **No promotion or upload reached the database after the deployment**, so the element holds vacuously | NONE TO GRADE |

Result: **every element of the §28.6 acceptance row is met on the N1 and N2 evidence, with the second counted run credited retrospectively by the owner.** Passive acceptance is therefore recorded as **satisfied (retrospective)**. This is the agent's grade against §28.6 on the owner's counting decision; it is **not** closure, and it is not a contemporaneous per-night observation of nights 9–13.

#### 28.30.5 The nights of 9–13 October (evidence, not credit)

The pack grader lists them as `RUN` lines and, as §28.29 departure (2) read from the code, returns `NOT-COUNTED (J1 TRIGGER-UNPROVEN)` for batches 48–52 because it takes one `--timer-last-trigger-us`, the latest only. That behaviour was a code reading in §28.29; it is **now observed**. Each of the five has `rolled_back=0`, `batch=N/completed/apply_failures=0`, an `Applied as import batch N … 0 unit(s) rolled back` line (0 inserted, 0 updated) and an `AFLDB_SETTLE_SUCCESS`, and `22-G` shows 7 completed batches (47–53) and no other. They are **not counted**, by the owner's decision and by the grader; N2–N6 are not counted.

#### 28.30.6 Limitations (all preserved; none is cleared by this record)

1. **No contention on PROD.** No promotion or upload has reached the database since the deployment (`22-B`, `22-C`, `p41` empty, `admin_upload 0`). The gate under real contention, the refusal path, the reverse-direction 300 s wait, the AFL API settle (units absent), writers outside the gate (§28.7; ISSUE-261 is separate) and a lock-level observation of the settle's hold (no G-obs sampler, D-PROD-7; `p30` is empty at 10:13) are **not shown on PROD**. N1 changed data (60 rows); this night changed none.
2. **Missed per-night evidence.** There is no N-k capture for 9, 10, 11, 12 or 13 October (the prescribed N2 date, 2026-10-09, was missed). One capture, 5 h 35 min after the run, spans six nights. The per-night items (timer state, `p20` state, gate sample, a server-log marker, the web journal) exist only at that instant; nights 9–13 are bracketed by markers and fingerprints, not sampled. A `deadlock detected` line on any of them would have failed the whole interval; there is none.
3. **The web journal's single line is not preserved.** `36` records `WEB_JOURNAL_READ rc=0 lines=1` over about 5 days 20 hours and saves only the filtered view, as at N1 (§28.28.4 item 3). W1 rests on the read being complete (sudo valid at both ends), not on the content.
4. **`copytruncate` rotation.** `/etc/logrotate.d/postgresql-common` is weekly with `copytruncate`. The Sunday 2026-10-11 00:00 rotation (`postgresql-16-main.log.1`, mtime 00:00:01.29) fell inside this interval: the first N-k interval that crosses one (§28.28.4 item 7). The opening marker sits in `.log.1` (line 27) and the closing marker in the live file (line 9), each once. Lines written during the copy can be lost; that is recorded in `30` and not graded. The nearest settle run to 00:00 was 04:34 that morning (batch 50), so no run overlapped it, but a lost line at the copy instant cannot be excluded.
5. The launch-log hash is local only. The precheck, capture and packaging transcript is operator-supplied (§28.30.2). N-k still does not measure Match Sheet saves, the rollback guard or `data_overrides` (§28.28.4 item 5). A second marker was written (D-RETRO departure 5).

#### 28.30.7 The decisions §28 names for closure, and how this record divides them

**Exact requirements (as written in this file).**
- **D-PROD-10, closure basis.** §28.8: "The closure basis: passive PASS plus the DEV and `afldb_test` evidence, with §28.7's limits stated"; "the operator's call; recorded at closure, not now". §28.21: "Decide at closure: passive PASS plus DEV and `afldb_test` evidence, with §28.7's limits"; effect "none now". §28.6, Closure: "A separate operator decision after an acceptance PASS (D-PROD-10), recorded with the residual limits of §28.7"; otherwise "the issue stays open". §28.29 and §28.28.5 repeat that closure is separate.
- **D-PROD-11, deploy-mode tooling issue.** §28.8: "Open a separate tooling issue: deploy-mode working-tree classification plus an exact `--expect-pending`"; "operator's call; outside ISSUE-265". §28.21: "Open it, outside ISSUE-265 (three issues have now met the same FAIL)"; "No effect on this deployment". §28.10.4: "Follow-up, outside ISSUE-265 and not opened in this pass: D-PROD-11." It is still open and has not been opened.
- **B1 (D-PROD-3).** "Migration 110 in the same window, after the deployment-success checks; Match Sheet player-statistic corrections paused until the morning after the first counted AFL Tables night." §28.28.6 found the criterion **met** on 2026-10-08 (N1) and that the pause **may lift**; lifting is the operator's act and was not observed; the first Match Sheet `player_match_stats` record makes the release roll-forward-only (D-257-7).

**1. Acceptance criteria now met.**
- D-PROD-6: 2 counted AFL Tables runs within 7 nights (batch 47; batch 53, retrospective), no AFL API unit on PROD.
- Every element of the §28.6 passive-acceptance row (§28.30.4), on top of DS PASS and C1 PASS (§28.27).
- The earlier gates stand as recorded: Phase B 11/11 (§23), the regression window (§24), DEV acceptance PASSED (§27).
- The B1 criterion (first counted night) has been met since 2026-10-08 (§28.28.6); this record does not change that.

**2. Remaining closure prerequisites.**
- **D-PROD-10:** the owner records the closure basis and the §28.7 residual limits. This is the one open owner decision that gates closure.
- **Closure mechanics, after that decision** (CLAUDE.md §5, §14 and this file's own notes): in `issues.md` set the status and resolved date and record the actual root cause, fix and validation, and keep useful history; remove ISSUE-265 from the Open Issues table and from `IssuesIndex.md`; update `CHANGELOG.md` (final wording; the current entry still reads "PROD acceptance pending"); move this runbook and `AFLDB-ISSUE-265-phase-a/` (and the settle-timing SQL and any `-HANDOFF` companions and evidence artefacts) to `issues/closed/`; and repoint `eslint.config.mjs:16`, which hard-codes `issues/open/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs` (§18.1: "the ignore path must then move with them, or the lint error returns"). `.gitattributes` already uses `issues/*/AFLDB-ISSUE-265-phase-a/…` and follows. After the move, `merge:ready` may need `--runbook` for a closed runbook (as it did for ISSUE-239 to 241).
- **Reconciliation with current `main`** (§28.30.8): these records exist only as uncommitted edits in this worktree.

**3. Separate pause and hold-release decisions (none is taken or implied here).**
- **The B1 Match Sheet player-statistic pause:** permitted to lift since 2026-10-08; whether and when to lift it is the operator's act, and nothing recorded shows it lifted. It is not a closure prerequisite.
- **The ISSUE-265 PROD hold** that other issues' PROD deployments wait behind (e.g. ISSUE-267/269, 271/272, 273, 274, 275, 276 in `IssuesIndex.md`). This runbook does not define its release test; the owner states whether passive acceptance, closure, or neither releases it. **Not lifted.**
- **D-PROD-11:** open or decline the separate deploy-mode tooling issue. Outside ISSUE-265; not a closure prerequisite.
- The deployment-window pauses (uploads, promotions, Match Sheet and Data Editor saves, on-demand settles) were already releasable (§28.27.6).
- **Still NOT authorised:** rollback, any 110 reversal, any restart, any timer change, any re-run of D5, D7, C1, N1 or this capture, an overnight sampler and a controlled PROD promotion.

**4. Follow-up limitations that do not prevent closure.** The five limitations of §28.30.6, and the §28.7 list: the AFL API settle and the 300 s reverse-direction wait proved on `afldb_test` only; writers outside the gate (ISSUE-261); the DEV deviations of §27.3 and §27.4; the DS and C1 gaps of §28.27 (the interrupted transfer, `DS_EXIT` operator-reported, batch 46 known from the database only); the AFL Tables service unit still at the 2026-09-02 revision (D-PROD-12, recorded drift); and the 36 open `canonical_apply_failed` findings (first detected 2026-09-28, §28.28.3), which this deployment neither opened nor changed; they are not attributed to ISSUE-265's change. §28.6 asks that closure be "recorded with the residual limits of §28.7"; it does not require them to be cleared.

#### 28.30.8 Reconciliation with current `main` (read-only Git, 2026-10-14; nothing applied)

- `issue/265-settle-deadlock` is at `cd3cf7827da15dc73968bf775c62b975c5f26587`, which is an **ancestor of local `main`** (`34cc9b969a31484f433a952f7fe20a958c8b2fd5`): 0 ahead, **45 behind**. The merge-base is `cd3cf782`. There is no unmerged ISSUE-265 commit; the only unmerged content is the four uncommitted files here (`CHANGELOG.md`, `IssuesIndex.md`, `issues.md`, this runbook). The "five commits behind" noted in §28.28 is out of date.
- This runbook has **no** change on `main` since `cd3cf782`, so it carries over as a whole file. `CHANGELOG.md`, `IssuesIndex.md` and `issues.md` were each changed by all 45 `main` commits: copying this worktree's versions would erase every later issue entry and closure, so they must not be copied; only the ISSUE-265 regions apply, and in each file those regions are byte-identical on `main` and at `cd3cf782`, so a region replacement is clean.
- The bounded plan, the per-file anchors and the proposed ledger text are in `D:\tmp\issue265\reconcile-20261014\RECONCILIATION-PLAN.md` (local review file, not part of the repository). `git diff --check` was run on this worktree's four uncommitted files and exits 0.

**State (end of §28.30):** the N2 retrospective capture **was run** (2026-10-14 10:13:43–10:13:49 +11:00, `CAPTURE_EXIT=0`, `TEE_EXIT=0`), its evidence is **verified** (archive `3a311425…cf43`, manifest file `760e3622…d6a2`, 25 of 25) and **graded**. Counted AFL Tables runs: **2 of 2** (batch 47; batch 53, retrospective, owner-accepted). Passive acceptance under §28.6 is **satisfied (retrospective)**. D-PROD-10 and the closure mechanics are **outstanding**; the B1 pause, the PROD hold and D-PROD-11 are separate and **untouched**. ISSUE-265 **stays open**. Next: the owner's D-PROD-10 decision; then the reconciliation and closure steps above, operator-run where §9 and §12 require it.

#### 28.31 Owner decision D-PROD-10, closure authorised, and closure documentation prepared locally (2026-10-14; agent, local files only)

**Authority and method.** The owner decided D-PROD-10 and authorised closure on 2026-10-14. The agent worked in the new worktree `D:\dev\afldb-issue-265-close` (branch `fix/issue-265-close`, created from local `main` `34cc9b969a31484f433a952f7fe20a958c8b2fd5`, no fetch) using local reads, hashes and edits and read-only Git. It ran no host, database, network or deployment command, and it staged, committed, merged and pushed nothing. The reconciliation plan (§28.30.8) was applied to the three shared ledgers by region replacement; no shared ledger was copied from the old worktree.

**1. D-PROD-10 (decided).** Accept the §28.6 passive-acceptance result as satisfied retrospectively:
- N1, 2026-10-08, import batch 47 (§28.28);
- the scheduled 2026-10-14 invocation `55a9060a041d4092bb62e27ad3828af3`, import batch 53, independently COUNTED (§28.29–§28.30);
- two counted runs within seven nights; the earlier missed nights (9–13 October) remain uncounted.

Closure is authorised on that basis and preserves every §28.7 limitation and the additional evidence gaps disclosed in §28.30.6. It is **not** contention testing and **not** contemporaneous capture: no contention or refusal path was exercised on PROD.

**2. The ISSUE-265 PROD deployment hold: conditional release decided, NOT released.** The ISSUE-265-specific PROD deployment hold releases **only after the closure documentation is merged, pushed and verified**. Until then it remains active. Nothing in this record or in the worktree releases it, and verifying the merge and push is an operator act (CLAUDE.md §9, §12). No deployment is authorised by this record. Other issues' independent PROD prerequisites are unchanged.

**3. Separate and unchanged.** B1 (D-PROD-3, the Match Sheet player-statistic pause) remains a separate, unchanged pause (§28.28.6, §28.30.7). D-PROD-11 remains a separate follow-up, not a closure prerequisite and not opened here. Rollback, any 110 reversal, any restart, any timer change, any re-run of D5, D7, C1, N1 or the retrospective capture, an overnight sampler and a controlled PROD promotion stay NOT authorised.

**4. Closure mechanics prepared (the §28.30.7 list), applied to files in the worktree only.**
- `issues.md`: status Resolved (2026-10-14); the actual root cause, fix, validation and residual limits recorded; the N2 retrospective capture recorded; the ISSUE-265 row removed from the Open Issues table (open count 46 to 45, recomputed from the entries).
- `IssuesIndex.md`: the ISSUE-265 block removed (46 to 45 entries).
- `CHANGELOG.md`: the ISSUE-265 entry brought to its final wording (deployment, N1, the second counted night, closure). The ISSUE-264, ISSUE-258 and ISSUE-257 headings are deliberately **unchanged** (scope correction, §28.32): their status reconciliation is outside this closure.
- This runbook, `AFLDB-ISSUE-265-phase-a/` and `AFLDB-ISSUE-265-prod-settle-timing.sql` moved from `issues/open/` to `issues/closed/`. Their contents are unchanged except this runbook's §0 status line and this section. Earlier sections keep naming the original `issues/open/` locations as historical provenance, and the phase-a README's archived command lines are likewise unchanged.
- `eslint.config.mjs`: the `globalIgnores` entry now names `issues/closed/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs` (§18.1). `.gitattributes` already uses `issues/*/AFLDB-ISSUE-265-phase-a/…` and needs no change.
- `blockers.md`: R1 and R3 recorded as complete (section 11), R2 reworded as a conditional hold, R5 reworded to the pending merge, C1 and C5 updated, the counts recomputed.
- `issues/open/AFLDB-ISSUE-275.md` and `issues/open/AFLDB-ISSUE-294.md`: their references to this runbook now name `issues/closed/` and the line numbers in this file as it stands (the §0 and §28.29–§28.30 additions moved earlier text down).
- `tests/integration/settle-promotion-deadlock.test.ts` is **not** edited: its sha256 is pinned in §22.5 and §23, and its comments keep naming `issues/open/…` as historical provenance.

**5. Pending, operator-run.** Stage exactly the closure paths, commit, run `merge:ready` (a closed runbook needs `--runbook issues/closed/AFLDB-ISSUE-265.md`, as for ISSUE-239 to 241), merge and push, then verify that the closure documentation is on `origin/main`. Only then does the conditional release in item 2 apply. The branch `issue/265-settle-deadlock` and its worktree `D:\dev\afldb-issue-265` are superseded by this one; retiring them is the operator's call.

**State (end of §28.31):** D-PROD-10 is decided and ISSUE-265 is **Resolved (2026-10-14)** on that decision. The closure documentation is **prepared locally; commit, merge and push are pending**. The ISSUE-265 PROD hold **remains active**. B1 and D-PROD-11 are untouched. No deployment is authorised.

#### 28.32 Scope correction and owner-directed decision D-265-CLOSE-READY-20261014 (2026-10-14; agent, local files only)

**Scope correction (owner-directed).** The three `CHANGELOG.md` heading changes that §28.31 item 4 first described for ISSUE-264, ISSUE-258 and ISSUE-257 ("deployed to PROD 2026-10-07 in the ISSUE-265 release") are **reverted**: those headings are byte-identical to `main` again. Their status reconciliation is outside this ISSUE-265 closure. Every ISSUE-265 addition and all historical evidence in `CHANGELOG.md`, `issues.md` and this runbook are kept (including the CHANGELOG note that earlier "PROD has not received" statements for ISSUE-257, -258 and -264 are superseded by the ISSUE-265 deployment entry, which is ISSUE-265 evidence, not a status change to those entries). The pinned integration-test comments, the archived phase-a README commands and the ISSUE-264 historical references stay unchanged, as in §28.31 item 4.

**D-265-CLOSE-READY-20261014 (recorded 2026-10-14, owner-directed): scoped primary clean-tree exception for the ISSUE-265 closure-documentation merge.** The `merge:ready` requirement that the main worktree be clean ("main worktree is clean: D:\dev\afldb") may be excepted for the closure-documentation merge of ISSUE-265 **only** for the preserved changes below, in the primary checkout `D:\dev\afldb`. The allowed path set is the two modified runbooks of ISSUE-274 and ISSUE-276 and the same 15 unrelated untracked paths enumerated in the ISSUE-302 (D-302-2, D-302-3) and ISSUE-278 close-out records. Paths are given exactly as Git prints them, literal backticks included, so they are in a block rather than Markdown code spans:

```text
 M issues/open/AFLDB-ISSUE-274.md
 M issues/open/AFLDB-ISSUE-276.md
?? .agents/skills/javascript-testing-patterns/SKILL.md
?? .agents/skills/javascript-testing-patterns/references/advanced-testing-patterns.md
?? .agents/skills/nextjs-hydration-audit/SKILL.md
?? .agents/skills/nodejs-backend-patterns/SKILL.md
?? .agents/skills/nodejs-backend-patterns/references/advanced-patterns.md
?? .agents/skills/nodejs-backend-patterns/references/details.md
?? .agents/skills/postgresql-table-design/SKILL.md
?? .agents/skills/typescript-advanced-types/SKILL.md
?? .agents/skills/typescript-advanced-types/references/details.md
?? 0)
?? 20`
?? `path
?? i
?? q(sequenceValueSql(qname))))[0]
?? t.kind
```

*Tracked differences permitted.* The tracked differences must contain **only** the already authorised continuity and observation-window sections: ISSUE-274 §33.9 and §33.10, and ISSUE-276 §17.9 and §17.10.

*Verified before recording (read-only Git and hashes, 2026-10-14).*
- `git --no-optional-locks -C D:\dev\afldb -c core.quotepath=false status --porcelain=v1 --untracked-files=all` printed **exactly 17 paths**, identical to the block above (2 ` M`, 15 `??`, none other), including the six literal fragment names.
- `git diff` of `issues/open/AFLDB-ISSUE-274.md`: one hunk `@@ -1649,3 +1649,55 @@` (`index d6bb77d1..fe0ae4aa`), 52 lines added, 0 deleted; the only added headings are §33.9 and §33.10. Its diff sha256 is `69fdc32d1cfedbf60852779af0d3bf82a0920ad47882786cec564c124b216b41`.
- `git diff` of `issues/open/AFLDB-ISSUE-276.md`: one hunk `@@ -341,3 +341,44 @@` (`index 838f3ae8..815524f9`), 41 lines added, 0 deleted; the only added headings are §17.9 and §17.10. Its diff sha256 is `3bc35f409601d3a5efbc23215769165b63fc719d73b2ad8c5a4708e39de16767`. The two diffs together hash to `fda4e9b5edace11ae9ce5550860592639725095c857792a16536ef6dd9d91eba`.
- Working-file sha256 (primary checkout, as read): `issues/open/AFLDB-ISSUE-274.md` `fb269424a555bd26bd3587782b5ebc9514b8cceae4a04fc47b5a4076fdde263e`; `issues/open/AFLDB-ISSUE-276.md` `2255d898ec9b118af3bc3eca27610ccdc646d71dddb889af314aaec22ddf0074`.
- Git blob ids of the working files (`git hash-object`, the clean filter applied; they equal the new side of the `index` lines above): `issues/open/AFLDB-ISSUE-274.md` `fe0ae4aa93ef2a1ac5a680a69a86bee66918155c`; `issues/open/AFLDB-ISSUE-276.md` `815524f998c95e53bab2b851a86ec912e4bdbc7f`. These are independent of line-ending configuration and are the content check to repeat before `merge:ready`.
- The diff hashes are of Git's diff text on this workstation (autocrlf on); they compare like with like only on the same configuration. The blob ids and the working-file hashes are the stronger checks.

*Limits of the exception.*
- It covers **only** the "main worktree is clean" FAIL caused by exactly the paths above. **Every other readiness requirement must pass**: branch, closure worktree clean after the commit, local `main` equals recorded `origin/main`, base/main relationship (ahead, 0 behind), migration collision/checksum parity, and the committed files matching the declared scope below.
- **Any additional path, or any changed tracked content in either file, requires reassessment.** The primary status, the two working-file hashes and the two full diffs must be re-checked against this section immediately before `merge:ready` is run. A numstat match is supplementary evidence only.
- The raw `merge:ready` output, including the clean-tree FAIL and its listed paths, is preserved verbatim and reported **separately** from this exception. The FAIL is never suppressed or relabelled, and the tooling is not changed.
- The exception does not modify, clean or stash the primary checkout, and the strays stay in place. It is per-issue and path-scoped, like D-302-2, D-302-3 and the ISSUE-278 close-out exception, and extends to nothing else.
- **It grants no deployment, no B1 release and no early release of the ISSUE-265 PROD hold.** The hold stays active until the closure documentation is merged, pushed and verified (§28.31 item 2).

**Readiness metadata and the declared documentation-closure scope.** This runbook carries no `afldb-merge-readiness` block, so `merge:ready` reports its standing WARN ("runbook readiness metadata unavailable") and the declared scope is supplied by repeated `--expected-file` arguments naming **exact paths** (no directory prefixes, and not derived from whatever is staged). A WARN is not a failure and is not covered by the exception. The scope is 23 paths: the seven modified files, and both the old and the new location of the runbook, the settle-timing SQL and the six tracked Phase A files.

```text
CHANGELOG.md
IssuesIndex.md
issues.md
blockers.md
eslint.config.mjs
issues/open/AFLDB-ISSUE-275.md
issues/open/AFLDB-ISSUE-294.md
issues/open/AFLDB-ISSUE-265.md
issues/closed/AFLDB-ISSUE-265.md
issues/open/AFLDB-ISSUE-265-prod-settle-timing.sql
issues/closed/AFLDB-ISSUE-265-prod-settle-timing.sql
issues/open/AFLDB-ISSUE-265-phase-a/Invoke-Issue265PhaseA.ps1
issues/closed/AFLDB-ISSUE-265-phase-a/Invoke-Issue265PhaseA.ps1
issues/open/AFLDB-ISSUE-265-phase-a/README.md
issues/closed/AFLDB-ISSUE-265-phase-a/README.md
issues/open/AFLDB-ISSUE-265-phase-a/issue265-db-probe.mjs
issues/closed/AFLDB-ISSUE-265-phase-a/issue265-db-probe.mjs
issues/open/AFLDB-ISSUE-265-phase-a/tools/Invoke-Issue265SkipCheck.ps1
issues/closed/AFLDB-ISSUE-265-phase-a/tools/Invoke-Issue265SkipCheck.ps1
issues/open/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs
issues/closed/AFLDB-ISSUE-265-phase-a/tools/block-network.cjs
issues/open/AFLDB-ISSUE-265-phase-a/tools/import-graph.mjs
issues/closed/AFLDB-ISSUE-265-phase-a/tools/import-graph.mjs
```

**Local preparation for the readiness run.** The closure worktree had no `node_modules`. A directory junction `D:\dev\afldb-issue-265-close\node_modules` to `D:\dev\afldb\node_modules` was created after confirming that both `package-lock.json` files hash to `435dc97e686f13a0f09a3659bcedccc8a0683605ac7ac6114d27f4c96c4e8e91`, that `package.json` is identical, and that `tsx` is present. `node_modules/` is gitignored; nothing was installed and no network was used. Regenerable cache writes inside that directory are permitted. No `.env` was copied.

**State (end of §28.32):** the exception is recorded; `merge:ready` has **not** been run by the agent, so no raw readiness output exists yet and none is recorded here. It will be reported separately, verbatim, by the operator. The ISSUE-265 PROD hold **remains active**, B1 and D-PROD-11 are untouched, and no deployment is authorised.
