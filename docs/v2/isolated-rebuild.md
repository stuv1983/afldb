# AFLDB V2 — isolated PostgreSQL 16 and the isolated historical rebuild

Launch F. Local development and rehearsal only: nothing here contacts production, `afldb_dev`,
`afldb_test` or any shared server.

## 1. The cluster

`tools/v2/isolated-pg.ts` runs a loopback-only PostgreSQL 16 cluster (`cluster_name
afldb_v2_isolated`, default port 55432) under `AFLDB_V2_PG_ROOT`. It creates, verifies and drops
only `afldb_v2_*_test` databases that carry its marker comment (`afldb-v2-isolated-test`).

```bash
export AFLDB_V2_PG_ROOT=/d/tmp/afldb-v2-pg16
npx tsx tools/v2/isolated-pg.ts start | list | create-db <name> [--template <name>] | drop-db <name> --acknowledge-destroy <name>
npx tsx tools/v2/isolated-pg.ts run <name> -- <command...>
```

`run` verifies the database's identity on the live server, then runs the command without a shell
with `AFLDB_TEST_DATABASE_URL`, `AFLDB_TEST_IMPORT_DATABASE_URL`, `AFLDB_IMPORT_DATABASE_URL` (and
the other role DSNs) pointed at it, plus `AFLDB_V2_ISOLATED_PG=1` and `AFLDB_V2_ISOLATED_PORT`. It
spawns without a shell, so run `node node_modules/<pkg>/...` directly, not `npm` or `npx`:

```bash
npx tsx tools/v2/isolated-pg.ts run afldb_v2_main_test -- node node_modules/tsx/dist/cli.mjs tools/db/migrate.ts --target test
npx tsx tools/v2/isolated-pg.ts run afldb_v2_main_test -- node node_modules/vitest/vitest.mjs run <files>
```

## 2. The isolated historical rebuild (`--target isolated`)

`tools/db/rebuild-test.ts` admits the isolated target only when every one of these holds. The
details are in the `ISOLATED_REBUILD_TARGET` comment.

1. You pass `--target isolated --acknowledge-destroy <name>`.
2. The command runs inside `isolated-pg run`.
3. The name is `afldb_v2_hist_test` or matches `afldb_v2_rb_*_test`.
4. Both DSNs name that database on the isolated loopback port.
5. Before ANY stage runs, the live server reports cluster `afldb_v2_isolated`, the marker comment
   and the same `current_database()`.

The adjudication stage tool and the manual-registration replay repeat the name and DSN proofs
themselves. The AFL API adjudication stage replaces the marker comment with its rebuild marker.
After the rebuild the database rests at the isolated-pg marker again, so `isolated-pg` can still
verify it and drop it.

Prerequisites: the git-ignored source snapshots under `data/sources/` and
`data/records/first-kick-goal.csv`, a Python environment with the importer dependencies
(`AFLDB_PYTHON` when the checkout has no `.venv`), and `AFLDB_REBUILD_CAPTURE_ROOT` outside the
checkout.

```bash
export AFLDB_V2_PG_ROOT=/d/tmp/afldb-v2-pg16 AFLDB_PYTHON='<venv python>' AFLDB_REBUILD_CAPTURE_ROOT='D:\tmp\afldb-v2-rebuild-capture'
npx tsx tools/v2/isolated-pg.ts run afldb_v2_hist_test -- node node_modules/tsx/dist/cli.mjs \
  tools/db/rebuild-test.ts --target isolated --acknowledge-destroy afldb_v2_hist_test
```

## 3. Recorded result (2026-10-19)

The first attempt stopped at `brownlow-season` with Windows exit `3221225794` (`0xC0000142`, a
process DLL-initialisation failure). That was a host fault, not a refusal: no rows were rejected.

The re-run completed all 30 stages with exit 0. It ran migrations 001-114 and privileges, then
loaded fitzRoy `full-history-20260902` (the accepted baseline), DraftGuru `annual-html-20260826`,
awards and honours, Brownlow, derived data and Coleman. The afl_api adjudication capture,
reinstatement and bijection checks all passed. **FINAL VALIDATION PASSED: 89 checks**, including
player, coach, father-son, sibling, after-siren and first-kick-goal counts against the accepted
contracts. The database is about 360 MB.

This proves that the rebuild mechanics reproduce the accepted local contracts from tracked and
retained sources. **It is not historical parity with production.** No approved production backup
was restored, and nothing was compared with production (`docs/v2/shadow-rehearsal.md`).

## 4. Suites that cannot run here

Two integration files pin a database literally named `afldb_test` as the only authorised target
for a deliberate bypass:

- `tests/integration/settle-afl-api-brownlow-backtest.test.ts` (6 tests): the completed-season
  backtest bypass;
- `tests/integration/settle-afl-api-state-b.test.ts` (1 test).

The isolated cluster cannot create that name (`afldb_v2_*_test` only), so both refuse here by
design. They run on the Linux `afldb_test` host. Neither guard is relaxed.
