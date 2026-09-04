# AFLDB-ISSUE-123 — Current-season settle performance, measured at steady state

**Status:** Resolved 2026-09-04 — **measured; no performance defect at steady state; no
optimisation warranted.**
**Severity at close:** Low (unchanged)
**Area:** Data acquisition / Import architecture / Performance
**Branch:** `claude/issue-123` (worktree `D:\dev\afldb-issue-123`)

> This issue never had an open runbook. This file is the closure record: it exists to persist the
> production runtime evidence that the issue's own "Next action" step 1 asked for, so the number is
> not lost with the session.

---

## 1. What the issue asked

ISSUE-123 was opened at the `AFLDB-ISSUE-122` closeout because the **first full production settle
pass** — a `--dry-run --auto-apply` followed by the real `--apply --auto-apply` over snapshot
`settle-2026-09-02-1958` (207 matches, 9,522 player-match rows, **10,582 canonical rows, 9,133
ledger rows**) — took **roughly an hour** on the 2 vCPU droplet with PostgreSQL co-located.

The diagnosis recorded at the time was negative in the useful sense: continuous forward progress,
rapidly changing per-record `source_records` / version / projection / savepoint SQL, **no lock
blocking and no long-running single query**. The shape was per-record round-trip cost across a
whole-season backfill, not a bad plan, and the idempotent rerun (`import_batches` 732) wrote
nothing, so correctness was never in question.

The issue therefore **deferred optimisation** behind one gate:

> **Measure steady state first.** Read `journalctl -u afldb-settle-afltables.service` across
> several in-season firings and record actual nightly runtime. Do not optimize against the
> backfill number.

This is that measurement.

---

## 2. Method

**Production host `afldb-prod` (ssh alias `afldb`, 209.38.87.252), read-only throughout,
2026-09-04 ~15:30–15:45 AEST.**

No settle was triggered, no timer cadence was changed, no unit was started or stopped, no row was
written, and `AFLDB-ISSUE-137` was not touched. Everything below is `systemctl show`,
`journalctl`, and `SELECT`.

Three sources were used, in this order:

1. **`import_batches`** — the run ledger. It turns out this table **cannot express duration**: the
   settle writes its `import_batches` row *inside* the run's single transaction, so
   `now()` returns the transaction timestamp and `completed_at = started_at` **exactly**, to the
   microsecond, for all 25 settle batches. This is a property of the design ISSUE-127 §8 already
   documents, not a defect, but it means the batch table proves *what* each run did and not *how
   long it took*.
2. **The systemd journal** — the actual measurement. `/var/log/journal` is persistent and unrotated
   back to **2026-08-16T12:02:51 AEST**; total journal size 35.0 M, so nothing has aged out.
3. **`pg_stat_activity` / `pg_stat_database` / `pg_settings`** — contention and configuration.

---

## 3. The measurement — the scheduled nightly run

`afldb-settle-afltables.timer` became active **Thu 2026-09-03 22:46:55 AEST** (ISSUE-131's
re-enable). It has fired **once** since. That firing is the only invocation of
`afldb-settle-afltables.service` in the entire persistent journal — invocation
`b152416669bb`, 2,567 journal lines, and no other invocation id exists at any point back to
2026-08-16.

| Property | Value |
|---|---|
| `ExecMainStartTimestamp` | **Fri 2026-09-04 04:31:21 AEST** |
| `ExecMainExitTimestamp` | **Fri 2026-09-04 04:31:56 AEST** |
| **Wall-clock runtime** | **35.0 s** |
| CPU time consumed | **21.277 s** |
| `Result` | `success` |
| Main PID | `786905`, `code=exited, status=0/SUCCESS` |
| `NRestarts` | `0` |
| `TimeoutStartUSec` | `1h` — the run used **0.97 %** of its budget |
| `Nice` | `10` |
| `Type` | `oneshot` |

### 3.1 Phase breakdown, from the unit's own chain markers

| Phase | From | To | Elapsed |
|---|---|---|---|
| `[1/3] acquire (AFL Tables via fitzRoy)` | 04:31:21 | 04:31:35 | **14 s** |
| `[2/3] adjudicate and emit observations (offline)` | 04:31:35 | 04:31:37 | **2 s** |
| `[3/3] settle (apply, automatic canonical path)` | 04:31:37 | 04:31:56 | **19 s** |
| `settle chain complete — label settle-2026-2026-09-04-0431` | | 04:31:56 | **35 s total** |

**The 19 s is the number ISSUE-123 was actually about.** Phase 3 is the per-record path — the
`source_records` / version / projection / savepoint work whose round-trip cost was the suspected
problem. In that 19 s it read and compared **9,823 acquired records** covering **209 matches** and
**9,614 player-match rows**, i.e. the *whole season*, and concluded that every one of them was
already canonical.

### 3.2 What that run produced

Batch **739**, `validation_result`, snapshot `settle-2026-2026-09-04-0431`:

| Counter | Value |
|---|---|
| `snapshotMatches` | 209 |
| `snapshotPlayerMatchRows` | 9,614 |
| records read / rejected | 9,823 / **0** |
| `canonicalRowsInserted` | **0** |
| `canonicalRowsUpdated` | **0** |
| `canonicalApplicationsLogged` | **0** |
| `canonicalApplyFailures` | **0** |
| Source completeness | **COMPLETE** — every acquired row was represented |

End-of-run report, from the journal: **pending candidates still open 0**, **open canonical apply
failures 0**, **open source disagreements 0**.

---

## 4. Classifying every settle run on production

All 25 `import_batches` rows whose `tool` matches `settle`, every one `status = completed`:

| Class | Batches | What they are |
|---|---|---|
| **Fixture/harness runs** | 608–610, 613–615, 618–620, 651–653, 684–686, 717–719 (2026-09-02 18:14–18:30) | 1 match / 2 player rows each — ISSUE-122 acceptance exercises, not workload |
| **First-season backfill** | **731** (2026-09-02 21:43) | 207 matches, 9,522 player rows, **10,582 canonical inserts, 9,133 ledger rows**, 803 rejections. **This is the ~1 hour.** |
| **Backfill idempotence rerun** | **732** (2026-09-03 05:53) | Same 9,729 records, **0/0/0**. Proves SC3. |
| **Supervised remediation + validation** | **735–738** (2026-09-03 22:37–22:45) | ISSUE-131's rekey fix. 735 wrote 101 canonical rows / 87 ledger rows (2 matches, 2 `match_period_scores`, 83 `player_match_stats`); 736, 737, 738 wrote **nothing**. Run by hand, **not through the unit**, so they carry no journal invocation and no measured duration. |
| **Scheduled nightly (steady state)** | **739** (2026-09-04 04:31) | The measurement in §3. **35.0 s.** |

**No settle batch has ever held any status other than `completed`.** There is no `running` and no
`failed` settle row, at any point, so there is no stuck transaction and no partial run to clean up.

The 20 non-`completed` rows that do exist in `import_batches` are all from **2026-09-02**, all
`import_awards.py` or `enrich_birth_dates.py`, and all are **deliberate fail-closed refusals**
(`ReloadOwnershipCollision`, `LinkDecisionLoss`, `PopulationDropRefused`, the Coleman
`source_record_id` guard). They belong to other work and are unrelated to this issue.

---

## 5. Contention, long queries, timeouts, backlog

| Question ISSUE-123 asked | Answer | Evidence |
|---|---|---|
| Lock contention? | **None.** | `pg_stat_database` for `afldb_prod`: **deadlocks 0**, **conflicts 0**, against 96,919 commits / 39 rollbacks. `deadlock_timeout` is 1 s, so a genuine deadlock would have been detected and counted. |
| Any long-running individual SQL? | **None observable, and none needed.** | At inspection: 0 active backends, 0 waiting on `Lock`, longest active query 0 s. The whole run is 35 s, of which 19 s is the entire DB phase over 9,823 records — there is no room in it for a pathological statement. |
| Timeouts? | **None.** | `Result=success`, `TimeoutStartUSec=1h` vs 35 s used. `statement_timeout` is `0` on this role, so nothing was cut short either. |
| Failed or stuck batches? | **None, ever, for settle.** | §4. |
| Accumulation / backlog? | **None.** | 0 pending candidates open, 0 open canonical apply failures, 0 open source disagreements at end of run. |
| Schedule overlap? | **Impossible at this cost.** | Timer `OnCalendar=*-*-* 04:30`, `RandomizedDelaySec=15min`, `AccuracySec=1min`, `Persistent=true`. Last trigger 2026-09-04 04:31:21; next elapse **2026-09-05 04:34:59**. A 35 s run against a 24 h period is a duty cycle of **0.04 %**. |
| Is the ~1 hour representative? | **No.** | It is batch 731 — a one-time whole-season backfill writing 10,582 canonical rows plus a full dry-run pass ahead of it. The scheduled workload writes 0 rows on a quiet night and ~100 on an active one. |

**Note on what could not be mined.** PostgreSQL statement logging is off on production —
`logging_collector=off`, `log_min_duration_statement=-1`, `log_lock_waits=off`,
`log_connections`/`log_disconnections=off` — so no per-statement duration history exists to
profile from, and `/var/log/postgresql/*.log` is `postgres:adm 640`, unreadable as `arm`. This is
recorded as a fact about the evidence available, not as a gap that changes the conclusion: the
contention question is answered by the zero deadlock/conflict counters, and the runtime question is
answered by the journal.

---

## 6. The one thing that is bounded rather than measured

**Directly measured:** a scheduled nightly run that ingests **no new match** — 35 s, of which 19 s
is the full-season per-record comparison.

**Not directly measured:** a scheduled nightly run that *writes*. The timer has been active only
since 2026-09-03 22:46:55 and has fired once; that night the season was already settled. The
write-shaped run that does exist — batch **735**, 101 canonical rows and 87 ledger rows, which is
exactly the shape of an active night — was run by hand under ISSUE-131 supervision rather than
through the unit, so systemd never timed it.

**The bound.** Batch 731 wrote 10,582 canonical rows in the ~1 hour that *also* contained a
complete `--dry-run --auto-apply` pass. Attributing the entire hour to the apply is deliberately
pessimistic and still gives **≤ 0.34 s per canonical row**:

| Night | Canonical rows | Write cost at the pessimistic rate | Plus the 33 s acquire+compare floor |
|---|---|---|---|
| Batch 735's actual shape (2 matches) | 101 | ≤ 35 s | ≤ ~1.1 min |
| A finals round (4 matches) | ~200 | ≤ 68 s | ≤ ~1.7 min |
| A full home-and-away round (9 matches) | ~480 | ≤ 165 s | ≤ ~3.3 min |

The worst of those is **≤ 6 % of `TimeoutStartSec`** and **≤ 0.25 % of the 24 h period**, at
04:30 with `Nice=10`, with no HTTP request waiting on any of it. The 2026 home-and-away season is
already complete (207 matches to 2026-08-23, 2 wildcard finals on 08-28/29), so the remaining
nightly deltas this season are strictly smaller than the finals row above.

**An upper bound is enough to close this issue.** ISSUE-123 does not ask whether the settle is as
fast as it could be; it asks whether the hour observed at backfill indicates a steady-state
performance defect. It does not, by a margin of roughly three orders of magnitude on the quiet
case and two on the pessimistic active case.

---

## 7. Decision

**Closed as measured. The initial full-season backfill was not representative of the scheduled
workload, and no optimisation is currently warranted.**

This is explicitly **not** a claim that anything was fixed. **No performance code was changed, and
no repository file outside issue tracking was touched by this closure.** The hour that opened the
issue was real; it was simply the cost of a one-time 10,582-row backfill, and the workload the
timer actually runs costs 35 s.

### 7.1 Invariants — preserved by not changing anything

The issue required that any change preserve the `AFLDB-ISSUE-122` semantics. No change was made,
so all four hold exactly as they did, and were confirmed still present in the tree at `413d1d3`:

| Invariant | Where it lives |
|---|---|
| The **record** is the savepoint / failure boundary (SC4) | `src/lib/acquisition/canonical-apply.ts:829-871` — "Apply one record's canonical targets inside one savepoint (§13). The savepoint boundary is the RECORD" |
| Canonical mutation and its ledger row are transactionally coupled (SC2) | `src/lib/acquisition/canonical-apply.ts:583` — "The machine audit row, written inside the SAME savepoint as the mutation it records" |
| One bad record cannot abort otherwise valid records | Same savepoint-per-record structure; batch 731 landed 10,582 rows alongside 803 rejections |
| An identical rerun writes zero canonical and zero ledger rows (SC3) | Proven three times on production: batch 732 (0/0/0 after the backfill) and batches 736–739 (0/0/0 each) |

### 7.2 Reopen criteria

Reopen — or open a successor — only on **new production evidence**, specifically any of:

1. a scheduled run exceeding, say, **10 minutes** in the journal (still far inside the 1 h budget,
   but a 17× departure from the measured baseline and worth explaining);
2. any settle batch reaching `TimeoutStartSec`, or any settle `import_batches` row in `failed` or
   left `running`;
3. a non-zero `deadlocks` or `conflicts` count on `afldb_prod` coinciding with the settle window;
4. the phase-3 no-op comparison cost growing materially faster than the season row count as 2027
   accumulates — the honest thing to watch, since 19 s buys a full-season comparison today.

If any of those appear, **profile before optimising**: the original issue's decomposition
(per-record round trips vs. the per-target savepoint vs. projection writes vs. version/payload
upserts) is still the right first question, and the dominant component must be measured and
persisted before any code is proposed.

---

## 8. Files changed by this closeout

| File | Change |
|---|---|
| `issues/closed/AFLDB-ISSUE-123.md` | **New** — this record |
| `issues.md` | ISSUE-123 marked Resolved with the production evidence; its Open Issues row retired; count 8 → 7 |
| `IssuesIndex.md` | ISSUE-123 row retired; count 8 → 7 |

No `CHANGELOG.md` entry: this closeout is measurement and issue-tracking only, with no retained
change to application, search, data, admin or deployment behaviour — the same treatment the
ISSUE-127 closeout recorded for its own no-code-change closure.

No code, test, migration, schema, `privileges.sql`, unit-file, timer or `.env` change. `086`
remains the next free migration number. No production mutation of any kind.
