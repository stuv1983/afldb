# ISSUE-368: AFLW race-test target guard on the live connections, 23 November 2026

Answers Astra's push hold on `6953898083f184e9624996dc97b74884e5262250` (`review.md`, "Open push finding, ISSUE-368 test harness"). Local, not published.

**Tested SHA: `bd50bde80ce18ad0bba89c6207c845f32f5a5d6b`** (tree `3cb0b64e5d6d4977fe57231446e322a9dbc515bd`), a child of `69538980`. Its diff from `69538980` is four files, all under `tests/python/`. This record and the tracker edits are a documentation-only successor; the final review SHA is reported in the hand-back.

**Application code changed: no.** `git diff 69538980 bd50bde8 -- . ':!tests/python'` is empty. `tools/aflw/load_staging.py`, `tools/migration/common.py` and everything under `src/` are byte-identical, so the normal loader entry point (and its production targets) is unaffected and no separate loader qualification is needed. The unmodified loader was run unguarded only in the negative control below.

## The defect

`tests/python/aflw_staging_race.py` checked a parsed DSN host and database suffix with `assert`, which `python -O` removes, and the writer and the separately launched loader (`load_staging.connect()`, `psycopg.connect(AFLDB_IMPORT_DATABASE_URL)`) never verified where they had actually connected.

## The change

| File | Change |
|---|---|
| `tests/python/aflw_race_guard.py` (new) | `enforce(conn, expected_db, label)`: on the live connection, `current_database()` must equal the intended database and end in `_test`; `inet_server_addr()` and `inet_client_addr()` must both be NULL and libpq's host must be an absolute directory (Unix socket). Explicit `if` checks, never `assert`. Any failure, including a failed check query, closes the connection and exits 3. `connect_writer()` and `install_connection_guard()` (wraps `psycopg.Connection.connect`, so every connection a process opens, including any reconnect, is checked before it is returned). |
| `tests/python/aflw_race_loader.py` (new) | Child entry point: installs the guard on psycopg, then imports and runs the real `load_staging.main()`. The intended database arrives in `AFLW_RACE_EXPECTED_DATABASE`; absent means refuse. |
| `tests/python/aflw_staging_race.py` | The writer is opened with `connect_writer`; the child is launched through `aflw_race_loader.py` with the intended database in its environment; `-O` is propagated to the child interpreter. The DSN check stays as an early diagnostic, now explicit (exit 3, survives `-O`). |
| `tests/python/aflw_race_guard_refusals.py` (new) | The refusal proof below. |

Reconnect paths: the writer is one connection; the loader is a fresh process per invocation (initial load, blocked load, replacement), each guarded at its own `connect`.

## Environment

DEV host `streamanator`; fresh `git archive bd50bde8` export in a new directory; private PostgreSQL 16.15 cluster (118 migrations and privileges applied, trust auth, private Unix socket directory); Python 3.12.3, psycopg 3.3.4; Node 22.23.2. Databases were clones of one migrated template. `GRANT afldb_import TO afldb_owner` was applied so the owner-role writer and loader can `SET ROLE afldb_import`, as the harness docstring requires. For the refusal run the cluster also listened on 127.0.0.1; for the valid race it was socket-only (no TCP listener on the port).

## Refusal results (`python tests/python/aflw_race_guard_refusals.py`, exit 0, "All 38 AFLW race guard refusal checks hold.")

Three disposable databases (`..._ok_test`, `..._other_test`, `..._plain` without the suffix), each seeded with the eleven-season generation. The attempted load is a different twelve-season generation, so a stray write is visible. Every refusal must exit 3 and print the guard's own `REFUSED [writer|loader|dsn]` message; an independent unguarded connection compares every database's full staging rows after each group.

| Connection | Case | `python` | `python -O` |
|---|---|---|---|
| Child loader (invoked directly, no writer) | TCP to a disposable `_test` database | exit 3, not Unix socket | exit 3, same |
| | Unix socket to a disposable database without `_test` (intended = that database) | exit 3, no `_test` | exit 3, same |
| | live database `other_test` while intended `ok_test` | exit 3, server reports other | exit 3, same |
| | live `ok_test` while intended `other_test` | exit 3 | exit 3 |
| | no intended database supplied | exit 3 | exit 3 |
| Writer (`connect_writer`) | TCP to a disposable `_test` database | exit 3 | exit 3 |
| | Unix socket to a database without `_test` | exit 3 | exit 3 |
| | live database differs from intended | exit 3 | exit 3 |
| Writer through `aflw_staging_race.main()` | valid-looking socket DSN whose live connection is TCP | exit 3 | exit 3 |
| | valid-looking DSN whose live database differs | exit 3 | exit 3 |
| | TCP DSN (early diagnostic) | exit 3, `[dsn]` | exit 3, `[dsn]` |

After every group the independent connection saw all three protected databases unchanged (same row-set hash, same row count, zero 2027 rows). Controls: the intended socket target is admitted (exit 0) under both interpreters, and the 2027 rows then appear only in the intended database.

**Negative control.** The pre-fix child launcher (no connection guard), run against the same kind of target (TCP to the unsuffixed database holding eleven seasons), exited 0 and the independent connection read 2027 rows 0 to 1 and seasons 11 to 12. The refusals above are therefore not artefacts of the observer.

## Valid race on the committed successor (socket-only cluster, `AFLDB_TEST_DATABASE_URL='postgresql://afldb_owner@/<race>_test?host=<sock>&port=<port>'`, `python tests/python/aflw_staging_race.py <export> fixed`, exit 0)

```
PASS complete reviewed eleven-season generation loads through CLI
PASS PostgreSQL identifies the writer as the CLI loader's blocker before commit
PASS fixed CLI exits 1 and preserves every staging row and all six 2027 public views
PASS complete replacement succeeds with an independently advanced test inventory
```

The writer and the blocked loader are two real sessions on the same database; the blocker line is from `pg_blocking_pids` on the writer's connection. An independent sampler recorded every session on the race database: all `client_addr` NULL (Unix socket), login `afldb_owner`, the loader sessions named `aflw_staging_race_loader` (the sampler's 50 ms polling did not catch the blocked state, which the test's own check did). Final state: twelve staging seasons, one 2027 season in staging and in `aflw.seasons`.

Other checks on the tested SHA: `aflw_staging_contract.py` 54/54; `vitest run tests/reference-data.test.ts -t "standalone Python contracts"` 9 passed (62 skipped); `git diff --check` clean.

## Reused from Astra's review (unchanged components)

Application and release evidence, selector and build, Wednesday helpers, and the matched broad-suite comparison are unchanged: this fix touches no file they exercise. The only repository files differing from `69538980` are the four above and the records.

## Not done

Nothing was pushed, deployed or installed. Deployment and Wednesday's reboot remain owner decisions. The disposable cluster is stopped; its workspace is `/mnt/ssd/afldb-pushfix-20261123` on the DEV host.

---

# Addendum: the unsuffixed database is no longer seeded (Astra's remaining push blocker)

Astra's remaining blocker on top of `d9cedc7a2cdc17022354744979e7db1f181a7df5`: `tests/python/aflw_race_guard_refusals.py` seeded the unsuffixed database directly (an owner-role connection and `ls.load`, former lines 118 to 121), a deliberate unguarded write to a database the guard exists to protect. Local, not published.

**Tested SHA: `635d4df2c073dee8e2fc3787f1c8ed736cedc378`** (tree `c91c89818d45dc67e6716b35da82056239d0ec66`), a child of `d9cedc7a` on branch `claude/astra-push-blocker2-20261123` (worktree `D:\dev\afldb-pushfix2-20261123`; the earlier `claude/astra-push-blocker-20261123` worktree is untouched). The records commit that carries this addendum is a documentation-only successor; the final SHA is reported in the hand-back.

**Changed path: `tests/python/aflw_race_guard_refusals.py` only** (`git diff --stat d9cedc7a 635d4df2`: 1 file, 61 insertions, 31 deletions). `git diff d9cedc7a 635d4df2` is empty for `src/`, `tools/`, `tests/python/aflw_race_guard.py`, `tests/python/aflw_race_loader.py`, `tests/python/aflw_staging_race.py` and `tests/python/aflw_staging_contract.py`: the writer guard, the child guard and the application loader are unchanged.

## The change

- The direct seed of the unsuffixed database is removed, together with its `ls` import. The unsuffixed database starts empty and must stay empty.
- Before any fixture setup the driver takes a snapshot of all three databases from independent observer connections. Those connections are read-only on the server (`options=-c default_transaction_read_only=on`), and the driver confirms each with `SHOW transaction_read_only` before reading, refusing to observe otherwise. The snapshot covers every row of the eight `staging_aflw` tables and the six `aflw` public views (`seasons`, `fixtures`, `matches`, `ladders`, `player_match_stats`, `player_seasons`), as per-object row counts and digests, plus the 2027 staging season count. The previous observer covered the staging tables only.
- Only the two `_test` databases are seeded, through the guarded loader. After each seed the driver checks that only the seeded database changed. After setup, and after every refusal group, every database is compared against its snapshot, and the unsuffixed database must still equal its initial empty snapshot. The final control asserts that 2027 appears only in the intended database and the unsuffixed database still equals its initial snapshot.
- Setup fails closed: any non-empty database at the start (staging tables or views) stops the run.

## Inspection of every path in the driver that can reach the unsuffixed database

| Path | Status |
|---|---|
| Former seed (owner role + `ls.load`) | **Removed.** |
| Former emptiness probe (plain connection) | Replaced by the read-only observer. |
| `observe()` | Read-only, server-enforced and checked with `SHOW`. |
| Loader refusal probe with the unsuffixed database as target (normal and `-O`) | Child process under the connection guard; refused at `connect`, before its first statement (exit 3). By design this is a writing path that is reachable only if the guard fails; Run C shows what the driver then reports. |
| Writer refusal probe (`writer-direct`) with the unsuffixed database | `connect_writer` runs the guard's first statement, a `SELECT`, then exits 3; there is no write statement on this path. |
| Race `main()` probes | Redirected to `ok_test`, `other_test` or TCP `ok_test`; the unsuffixed database is never their target. |
| Controls | Target `ok_test` only. |
| Retry or cleanup | None: every `subprocess.run` is a single attempt; no `DROP`, `TRUNCATE`, teardown or reconnect loop; the `TemporaryDirectory` removes local files only. Fresh clones are created outside the driver (`CREATE DATABASE ... TEMPLATE`). |

## Environment and certification

DEV host `streamanator`, the disposable workspace `/mnt/ssd/afldb-pushfix-20261123` of the earlier qualification. Certified before use: its own postmaster (from `postmaster.pid`, user `arm`, `-D /mnt/ssd/afldb-pushfix-20261123/pg/data`), PostgreSQL 16.15, port 61561 on `127.0.0.1` plus the private socket directory `/mnt/ssd/afldb-pushfix-20261123/sock`, `pg_hba.conf` trust for local and loopback only, no listener on the port before start, databases only `afldb_v2_pushfix_*` and `postgres`, the template migrated (8 `staging_aflw` base tables, 12 `aflw` views, 0 staging seasons, roles `afldb_*`). The other PostgreSQL clusters on the host were not touched. Python 3.12.3 and psycopg 3.3.4 from the project virtual environment. The tested commit was exported with `git archive` into `.../fix2`; the SHA-256 of the seven relevant files (the five under `tests/python/`, `tools/aflw/load_staging.py`, `tools/migration/common.py`) matched the local worktree.

Commands (cluster in loopback mode, `bash cluster-mode.sh tcp`; each run clones fresh databases from the template and runs a read-only polling observer beside the driver):

```
bash run-refusals2.sh normal   .../fix2     ""   # python    tests/python/aflw_race_guard_refusals.py
bash run-refusals2.sh optimize .../fix2     "-O" # python -O tests/python/aflw_race_guard_refusals.py
bash run-refusals2.sh mutant   .../fix2mut  ""   # detection control, below
```

Condensed logs: [`AFLDB-ASTRA-PUSH-BLOCKER-2026-11-23-REFUSAL-RUNS.txt`](AFLDB-ASTRA-PUSH-BLOCKER-2026-11-23-REFUSAL-RUNS.txt). Per-object detail files stay on the host (`ev-normal`, `ev-optimize`, `ev-mutant` under the workspace).

## Results

| Run | Driver exit | Checks | Refusal exit codes | Controls |
|---|---|---|---|---|
| A: normal Python | **0** | All 41 hold | 22 of 22 refusals exit 3 (11 under the `python` child interpreter, 11 under `python -O`), each with the guard's own `REFUSED [loader\|writer\|dsn]` message | `python` and `python -O` controls exit 0 |
| B: `python -O` (the driver itself under `-O`) | **0** | All 41 hold | 22 of 22 exit 3 | both exit 0 |

The 41 checks: initial emptiness is a precondition (not counted), two seeds, two "only the seeded database changed" checks, setup leaving the unsuffixed database identical to its empty snapshot, both seeded databases at eleven seasons with no 2027 rows, 22 refusals, 10 unchanged-comparisons (every database including the unsuffixed one against its snapshot), two controls and the final target check.

**Independent observer (separate from the driver, plain `psql`, read-only sessions, 408 and 426 polls).** Every poll computed a digest over all eight staging tables and six public views per database. In both runs the unsuffixed database showed one state for the whole run: 0 rows, digest `58d98ef1bd95` (136 and 142 polls), equal to its initial snapshot. `other_test` moved once, empty to the eleven-season seed (231 rows, `bf3c7860cb7d`). `ok_test` moved twice, empty to the seed, then at the intended control to 252 rows (`939e524bc06d`). The final snapshots matched the polled states; all observer sessions reported `transaction_read_only=on`. Setup therefore leaves the unsuffixed database untouched, every refusal exits 3, and the valid controls and seeds succeed only on their intended target.

**Detection control (Run C).** The same committed driver, run against a scratch copy of the tested tree in which only `aflw_race_loader.py` differs (its `install_connection_guard(...)` line deleted, so the child loader is unguarded), exits **1** with 21 of 41 checks failed: ten loader refusals exit 0 instead of 3, all ten unchanged-comparisons fail (including the explicit "unsuffixed database still equal to its initial snapshot" clause) and the final target check fails. The independent observer saw the unsuffixed database go from 0 rows to 252 rows (digest `939e524bc06d`, the same as the expanded `ok_test`) at +2.3 s. The writer refusals, which the mutant leaves guarded, still exit 3. So an accidental load into the now-empty unsuffixed database is detected both by the driver and by an independent observer. This supplements Astra's existing unsafe-launcher evidence (the pre-fix launcher written to the unsuffixed database over TCP, recorded above), which is unchanged and still applies; the mutant is a scratch construct on the host and is not committed.

**Observer artefact found and fixed (not a driver defect).** The first Run A attempt had a polling observer that read all fourteen objects in a single statement. It deadlocked once against the loader's exclusive locks during the intended `ok_test` control (`deadlock detected`, loader the victim, driver exit 1, 1 of 41 failed). The driver itself reads sequentially between loader runs and cannot overlap one. The polling observer was given `lock_timeout=150ms` so a contended poll is skipped and the observer never waits while holding a lock; A, B and C were then run from fresh clones (A and B skipped 0 polls, C skipped 3). The first attempt is kept in the logs file as Run 0 for transparency and is not counted.

## Reused, not repeated

The valid two-session race, the loader's behaviour and Astra's independently observed race evidence apply unchanged: `aflw_staging_race.py`, `aflw_race_guard.py`, `aflw_race_loader.py`, `aflw_staging_contract.py`, `tools/aflw/load_staging.py` and `tools/migration/common.py` are byte-identical between `bd50bde8` (the SHA tested earlier in this record) and `635d4df2` (`git diff --quiet bd50bde8 635d4df2 -- tools src tests/python/...` exits 0). The valid race and the staging contract were therefore not re-run. `git diff --check` is clean.

## Not done

Nothing was pushed, deployed or installed, and no other cluster or application database was touched. The application keeps its READY FOR ATTENDED APPLICATION RELEASE verdict. Push, deployment and Wednesday's reboot remain separate owner decisions. The disposable cluster is stopped again (nothing listens on port 61561); its workspace is `/mnt/ssd/afldb-pushfix-20261123` on `streamanator`.
