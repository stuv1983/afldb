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
