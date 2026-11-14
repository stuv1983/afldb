# perf scope (ISSUE-361, FE-5 and FE-6) - remediation run 2026-11-14

Branch `claude/rem-perf-20261114` (worktree `D:\dev\afldb-rem-perf`), base `5035ed96`. Local commits only; nothing pushed.
Host workspace `/mnt/ssd/afldb-rem-perf-20261114` on streamanator, isolated PostgreSQL port 55621, databases
`afldb_v2_remperf_{tmpl,a,int,build}_test` (template restored from the approved snapshot, sha256 `e77c307d...2826d`, 30141895
bytes verified, ledger 118, `raw/tmpl-probe.txt`). No migration, no production or DEV access, no push.

## Commits (code tree qualified = `b1e1a140`)

| SHA | Subject | Files |
|---|---|---|
| `00d5a9db` | expose the player index statements and add the FE-5 equality and plan regressions (red by design) | `src/db/queries/players.ts` (extraction, SQL unchanged), `tests/integration/database.test.ts` |
| `a6170337` | cut the /players page before looking up club names (FE-5) | `src/db/queries/players.ts`, `tests/integration/database.test.ts` |
| `b1e1a140` | gate simultaneous club comparisons per process (FE-6) | `src/lib/concurrency-gate.ts` (new), `src/app/clubs/compare/state.ts`, `tests/club-comparison.test.ts`, `tests/integration/club-comparison-route.test.ts` |
| (this commit) | evidence only | `docs/v2/evidence/remediation-20261114/perf/**` |

## Validation of the findings

**FE-5 - validated.** `src/db/queries/players.ts` (base lines 133-154) evaluated the correlated club-names sub-select in the
select list, so PostgreSQL ran it for every row the OFFSET skipped. Reproduced: the plan check in the new test sees
`Actual Loops = 13365` for a 5-row last page (`raw/final-qual.txt`, RED 1: `expected 13365 to be less than or equal to 5`); the
review's EXPLAIN shows `loops=13350`. The same cost was paid by the past-the-end page before the redirect.

**FE-6 - validated, with two amendments.**
1. The review's "~22 queries per pair" undercounts. Counting statements in the source (`state.ts` + `club-comparison.ts`):
   wave 1 starts 12 loaders issuing 29 statements (Brownlow history is 6 per club, two clubs; player leaders 4; averages 3;
   period records 2; H2H Brownlow 2; the rest 1 each), wave 2 adds 3 (records 1, meetings 2): about 32. Counted from source,
   not from `pg_stat_statements`.
2. The cost driver is the 10-connection pool queue, not one slow query: a lone comparison takes 0.2-0.4 s once the database
   has planner statistics; eight simultaneous ones put ~230 statements ahead of an unrelated page's single query.

**Environment finding (affects any timing on these disposable databases).** A database restored from the snapshot has no planner
statistics (`pg_stat_user_tables`: 0 of 105 tables analysed, `analyze.mjs`). On it `getHeadToHeadBrownlow` took ~3.9 s and one
comparison ~4 s (observed in my terminal, not saved; the saved effect is `singleAloneMs` 3234-4014 in `raw/session1-*.txt`
against 215-397 in `raw/session2-*.txt`), with a 5 s statement timeout one step away. I ran `ANALYZE` on `a`, `int` and `build`
(not on `tmpl`) before the measurements that count; `session1` (un-analysed, loadavg 6.5-8.2) is kept only as the record of
that effect and is **not** used for conclusions about FE-6. Production has statistics.

## Changes

### FE-5 (`players.ts`)
The page is cut in a CTE (`page`: filter, order, `LIMIT/OFFSET`, `count(*) OVER ()`, `row_number() OVER (ORDER BY <same
order>) AS rn`), and the outer statement adds the club-names sub-select for those rows and orders by `rn`. `rn` repeats the
ordering as an explicit sequence so the outer statement returns the inner order by construction instead of relying on a
sub-select preserving it (variant B, no `rn`, measured 53 ms at depth and 30.5 ms at offset 0 but with no ordering guarantee;
C chosen). `listPlayers` keeps its contract; the page and the past-the-end count are exposed as `playerListQueries()` so the
suite can EXPLAIN the exact statement.

**Behavioural refinement (disclosed, the only change to results):** every sort now ends in `p.id`. Homonyms share
`sort_name` (460 duplicated values in the snapshot) and tie on every other key, so their order was plan-dependent; the equality
oracle showed legacy and fixed plans cutting a boundary through such ties differently (first run: 4 of 16 sort/direction cases,
`debut asc`, `finals asc`, `brownlow_votes asc`, `name desc`, only inside tied groups, e.g. two "Ahern, Bill" rows). A total order makes a
page reproducible and no player can appear on two pages or none. The oracle in the test carries the same final key.

### FE-6 (`concurrency-gate.ts`, `state.ts`)
A pure FIFO `createConcurrencyGate(limit)` (`acquire()`/`run()`, `stats()`, limit 0 = ungated) and
`clubComparePairGate`, created in `state.ts` from `AFLDB_COMPARE_MAX_CONCURRENT` (default **2**; blank/junk fall back to 2;
`0` disables). `resolveClubComparisonState` holds one slot for the whole pair load (waves 1 and 2), via `acquire()` plus
`try/finally`; waiting requests hold no connection. Queries, results, pool size and metadata resolution are unchanged. Because
`0` reproduces the pre-change behaviour exactly, the same build gives the before and after numbers, and the setting is also
the rollback. The gate is per server process (production 2 workers, DEV 4: the host-wide cap is 2 x workers).
Not edited: `.env.example` (the environment-name derivation in `tests/afl-api-ingestion-safety.test.ts` reads that file;
a documentation line is proposed below instead).

## Tests

Extended closest suites only (CLAUDE.md section 10); no new test file.
* `tests/integration/database.test.ts` (`AFLDB-ISSUE-361 player index looks up club names for the returned page only`, 18 tests):
  legacy-statement oracle comparing `listPlayers` for 8 sorts x 2 directions x offsets {0, 100, total-40, total+100} and the
  filters `name`, `club`, `season`, `club+season` (rows, order, club names, total, past-the-end), plus the plan check
  (`Subplan` loops <= page size). Oracle: relational (the legacy statement run on the same database), a precondition
  `players > 200`; no literal count from the snapshot, so it holds on the snapshot and on a rebuilt `afldb_test`.
* `tests/club-comparison.test.ts` (5 gate unit tests, DB-free): limit and FIFO order, slot returned on rejection, idempotent
  release, limit 0 ungated, environment parsing.
* `tests/integration/club-comparison-route.test.ts` (1 test + a pass-through `vi.mock` counting in-flight loaders): six
  simultaneous loads of Carlton v Collingwood each equal a lone load (`data`, `notices`), never exceed default x 12 loaders
  in flight, and the gate ends idle. Relational oracle, holds on either database.

Red/green (`raw/final-qual.txt`, run on the host checkout; every run under the host lock):
| Check | Tree | Result |
|---|---|---|
| FE-5 plan check | `00d5a9db` (SQL unchanged) | RED `AssertionError: expected 13365 to be less than or equal to 5`; 17 other tests pass (equality is trivially true there) |
| FE-6 unit tests | `a6170337` + test file from `b1e1a140` | RED `Cannot find package '@/lib/concurrency-gate'` (no tests run) |
| FE-6 integration test | `b1e1a140` with `AFLDB_COMPARE_MAX_CONCURRENT=0` (= ungated) | RED `AssertionError: expected 72 to be less than or equal to 24` (6 x 12 loaders) |
| all | `b1e1a140`, `git status --porcelain` empty | `tsc --noEmit` rc 0; unit `club-comparison.test.ts` + `club-comparison-view.test.ts` 52 passed; `database.test.ts` 65 passed / 4 failed; `club-comparison-route.test.ts` 30 passed (incl. the new test; warm route medians 336-358 ms against the 1500 ms budget); the gated test is green with the default |

Remaining failures (28), classified in `raw/classify.txt`: `tests/integration/club-comparison.test.ts` (24) and four in
`database.test.ts` (`has the full player-match dataset`: 695499 vs 685471; three `advanced search regression cases`: 223 vs
219, 120 vs 114, 268 vs 261). Run on the unmodified base `5035ed96` and on `b1e1a140` against the same database the failure
lists are **identical** (28 = 28, name and first assertion line; json sha256 below). They are snapshot-literal assertions
(for example 43 vs 41 Adelaide/Brisbane Lions meetings: the 2026-11-04 snapshot holds 2026 results the pinned witnesses
predate) - the snapshot-versus-rebuilt-`afldb_test` class of review section 3.1, not caused by this change. A rebuilt
`afldb_test` was not available to me, so the 24 + 4 are unverified there.

## Measurements

All numbers: host shared by ~11 agents; every measuring job under `flock /mnt/ssd/afldb-rem-20261114-heavy.lock nice -n 10 ionice -c3`;
`/proc/loadavg` is recorded beside each number in the raw files. Confidence: **medium** wherever load could explain a
difference; the FE-5 numbers have tight min/max and are high confidence in direction.

### FE-5 - same session (`raw/session2-20261113T224407Z.txt`, loadavg 2.0 at start and end), median of 8 (min-max), ms
| OFFSET | legacy (A) | fixed (C, as shipped, with `p.id`) |
|---|---|---|
| 0 | 31.4 (30.1-64.7) | 35.9 (35.4-38.2) |
| 6650 | 163.6 (162.9-164.2) | 37.1 (36.8-39.3) |
| 13300 | 313.3 (306.0-328.2) | 39.9 (38.9-62.2) |
| 14000 | 309.1 (303.0-317.1) | 37.9 (37.7-38.3) |

Deep pages ~7.9x faster; the first page costs about +4.5 ms (the extra window over the full set). Plan, fixed: `SubPlan 1
loops=50` (legacy 13350-13365). Review figures (372.7 vs 28.1 ms) were on a different load. `session1` (un-analysed, loadavg
~7) gave 789 vs 39.9 ms for the same statements: the ratio holds, the absolute number is load. HTTP after the fix
(`raw/http-session.txt`, 10 hits each, built server): `/players` 95-116 ms, `/players?page=267` 110-128 ms, `page=268` 101-113 ms,
`page=400` 307 redirect 79-85 ms; no HTTP "before" was taken (one build allowed).

### FE-6 function-level, same session (`session2`), 8 closed-loop clients x 15 s, probe = one light query every 200 ms
| gate | comparisons done | heavy p50 / p95 ms | probe p50 / p95 / max ms | loadavg end |
|---|---|---|---|---|
| 0 (off) | 73 | 1211 / 4383 | 1 / 1007 / 3363 | 3.3 |
| 1 | 46 | 2562 / 4006 | 1 / 1 / 171 | 3.2 |
| 2 | 72 | 1485 / 2762 | 1 / 340 / 343 | 4.6 |
| 3 | 86 | 1329 / 2066 | 1 / 359 / 723 | 5.1 |
| 4 | 83 | 1303 / 2856 | 1 / 372 / 1044 | 6.3 |
| 0 (off, repeat) | 93 | 1148 / 2073 | 227 / 687 / 1792 | 6.6 |
| 2 (repeat) | 75 | 1448 / 2623 | 0 / 341 / 453 | 6.7 |

Gate 1 starves throughput (46); 2-4 keep throughput within noise of ungated; 2 gave the tightest probe tail. Default 2 chosen
(medium confidence; 3 is equally defensible on these numbers).

### FE-6 end to end, built server (`raw/http-session.txt`, BUILD_ID `oUUVh6OSk_l_w_EbKJ1M9`, loopback 3341 only), 8 clients x 20 s, probe `/clubs`
| run | comparisons done | heavy p50 / p95 ms | `/clubs` p50 / p95 / max ms | `/clubs` n | errors | loadavg before |
|---|---|---|---|---|---|---|
| gate 0 | 85 | 1741 / 2568 | 317 / 1450 / 1639 | 26 | 0 | 1.9 |
| gate 2 | 83 | 1660 / 2668 | 60 / 394 / 521 | 57 | 0 | 3.2 |
| gate 0 | 84 | 1627 / 2725 | 315 / 1005 / 1018 | 32 | 0 | 4.6 |
| gate 2 | 80 | 1755 / 2695 | 113 / 387 / 411 | 53 | 0 | 5.4 |

Unrelated `/clubs` p50 falls from ~316 to 60-113 ms and p95 from 1005-1450 to ~390 ms, with the heavy page's throughput within
2-5 % (within noise) and no errors; the idle `/clubs` baseline in the same runs was 34-36 ms. The review's own un-gated run
(26 ms idle, 485 ms p50 under load) agrees with the gate-0 rows. Load rose during the session (partly my own), so the order
was interleaved (0, 2, 0, 2); medium confidence. Not reproduced: the review's "pair p50 2.0 s" is 1.6-1.8 s here.

**BUILD_ID disclosure.** `httpload.mjs` was meant to record the build id in each probe response but its regex (a pages-router
`_buildManifest` path) does not match the App Router payload, so every probe row says `builds: ["none"]`. Afterwards a single
request to the same standalone build found `"b":"oUUVh6OSk_l_w_EbKJ1M9"` in the HTML, equal to `.next/BUILD_ID` and
`.next/standalone/.next/BUILD_ID` (`raw/buildid-check.txt`); the server was started only from that standalone directory on a
port I had checked free. The one production build: `raw/build.txt` (HEAD `b1e1a140`, `git status` empty before and after,
rc 0), full log on the host.

## Owner decisions (none blocking)
1. **Default gate value** - recommend 2 (kept). Alternative 3 (equal on these data). Change: the constant
   `COMPARE_MAX_CONCURRENT_DEFAULT` in `src/app/clubs/compare/state.ts`, or `AFLDB_COMPARE_MAX_CONCURRENT=<n>` in the service
   environment file (no code change; restart needed). Recovery/rollback: set `0`.
2. **Document the variable** - recommend adding to `.env.example` next to `AFLDB_POOL_MAX`:
   `# AFLDB_COMPARE_MAX_CONCURRENT=2   # simultaneous /clubs/compare loads per worker; 0 disables`. Not done by me: that file
   is read by `tests/afl-api-ingestion-safety.test.ts`; the integrator should run it with the edit.
3. **Further FE-6 reduction (not done)** - `getClubBrownlowHistory` issues 6 statements per club, each re-deriving the
   attributed Brownlow rows; a single materialised scan per club (or a derived `totals` from `seasons`) would cut ~12 of ~32
   statements and ~0.3 s of CPU per comparison. Larger change to a 3000-line query module; the gate already removes the
   user-visible symptom.

## Proposed ledger text (ISSUE-361)
* **Status:** Fixed locally on `claude/rem-perf-20261114` (`a6170337`, `b1e1a140`; tests `00d5a9db`); not pushed, not deployed.
* **Fix:** FE-5 - `/players` cuts the page in a CTE before looking up club names (sub-select loops 13,365 to the page size);
  every sort now ends in `p.id` so ties are reproducible. FE-6 - a per-process FIFO gate (default 2,
  `AFLDB_COMPARE_MAX_CONCURRENT`, 0 = off) around the whole `/clubs/compare` pair load; queries, results and pool unchanged.
  The review's "~22 queries per pair" is ~32 by source count.
* **Validation:** red/green on the host checkout equal to `b1e1a140` (clean): FE-5 plan check red `13365 > 5` then green,
  18 tests incl. a legacy-statement oracle over 8 sorts x 2 directions x 4 offsets x 5 filters; gate unit tests 5; route test
  proves six concurrent loads equal a lone load and start at most 2 x 12 loaders (red with the gate off: 72 > 24);
  `tsc` rc 0; 28 snapshot-literal failures identical on the base. Timing (medium confidence, shared host): OFFSET 13,300
  313 to 40 ms; 8 clients, unrelated `/clubs` p50 316 to 60-113 ms, p95 1005-1450 to ~390 ms, heavy throughput within 2-5 %.
* **Next action:** integrator review; optional `.env.example` line; deploy with the next release; optional Brownlow-history
  statement reduction.

## Proposed `CHANGELOG.md` Unreleased lines
* `/players` no longer looks up club names for every row it skips: the page is cut first (OFFSET 13,300 313 to 40 ms on a
  snapshot copy), and every sort ends in the player id so tied rows page reproducibly (ISSUE-361, FE-5).
* `/clubs/compare` loads at most two pair comparisons at a time per server process (`AFLDB_COMPARE_MAX_CONCURRENT`, 0
  disables), so simultaneous comparisons no longer queue behind each other on the connection pool and unrelated pages stay
  responsive; results are unchanged (ISSUE-361, FE-6).

## Files changed (all commits)
`src/db/queries/players.ts`, `src/lib/concurrency-gate.ts` (new), `src/app/clubs/compare/state.ts`,
`tests/integration/database.test.ts`, `tests/club-comparison.test.ts`, `tests/integration/club-comparison-route.test.ts`,
and this directory. No other repository file was edited; no helper script lives in the repository tree (copies are under
`scripts/*.txt`, hashes in `scripts.sha256`). The evidence commit follows `b1e1a140` and touches only this directory, so the
qualified code tree is unchanged.

## Host state and hashes
Workspace `/mnt/ssd/afldb-rem-perf-20261114` (5.8 GB), port 55621, cluster stopped at the end (`raw/cluster-stop.txt`: no listener on 55621/3341/3342; listener check
recorded there). Raw files in `raw/` (sha256, host copies identical):
`session1-20261113T222102Z.txt` 4097d6a3a5041f56f5008dad8a678cc4f726a1d062d4fd5b63a898057386f6a3;
`session2-20261113T224407Z.txt` a2d7df1f91e1dcf186af212116a4002b727f49d3915b0ce472faa1f79215d3f7;
`http-session.txt` 77b21333427cc4d114f4886d17cca0f52ae34f61909ce6de70f245ffe6cde0d1;
`build.txt` d13b21c3516e352667fc8818caf73ada91f33714eea3ad191423d1773b377f97;
`buildid-check.txt` eae6a0fb5a011073f8cc84e68b02e7c5de587489f09e44000f0641b126fa6e0d;
`final-qual.txt` dcea998e76e1fdd59fa28004e6cd528e80a9310b598098aaf0ac881e5e39ae12;
`classify.txt` cf9d9526165fa40db9c9e488e8a37f6e28783753b3ad90ab2828f6a3e44c6020;
host-only: `build-next.log` b510a73422e0f5283af66d8bf319066701a6702bb86ac6dfc5c6fd440d36ee75,
`classify-5035ed96.json` 943e57b0612a7a5954375038fda0b0c0eb053021214698a8ccf737e29f58c8b0,
`classify-b1e1a140.json` 7ad93e44891de07195f4c7d416b2c7b8f84a9ba10eef1477083000a3f02603db.
`classify-attempt1-wrong-base.txt` is a first attempt whose base revision was
mistyped (`reference is not a tree`, both blocks ran the final commit); superseded by `classify.txt`.
Helper scripts were run from my host workspace copies (never from a shared directory); `scripts.sha256` lists them.
