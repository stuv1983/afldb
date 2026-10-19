# AFLDB V2 — isolated PostgreSQL 16 and the isolated historical rebuild

Launch F intends local development and rehearsal only. **Incident correction (2026-10-20):**
the earlier launcher attempted authentication through SSH-owned 55432, forwarded to the documented shared
development PostgreSQL endpoint. Successful login/SQL and remote cluster identity are not
established. The launcher now checks local postmaster ownership before credentials, followed
by the original SQL identity checks. See `evidence/gap-029-port-incident.json`. Do not infer
isolation from a loopback address alone.

## 1. The cluster

`tools/v2/isolated-pg.ts` runs a loopback-only PostgreSQL 16 cluster (`cluster_name
afldb_v2_isolated`, default port 55432) under `AFLDB_V2_PG_ROOT`. It creates, verifies and drops
only `afldb_v2_*_test` databases that carry its marker comment (`afldb-v2-isolated-test`).

```bash
export AFLDB_V2_PG_ROOT=/d/tmp/afldb-v2-pg16
export AFLDB_V2_PG_PORT=55433 # current verified cluster; 55432 belongs to an unchanged SSH forward
npx tsx tools/v2/isolated-pg.ts start | list | create-db <name> [--template <name>] | drop-db <name> --acknowledge-destroy <name>
npx tsx tools/v2/isolated-pg.ts run <name> -- <command...>
```

`run` first proves the local listener belongs to this data directory’s postmaster (PID, executable,
data-directory argument and loopback address), refusing unavailable process evidence. It then
verifies the database’s identity on the live server and runs the command without a shell
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

## 4. Historical Launch F limitation (resolved locally)

Two integration files pin a database literally named `afldb_test` as the only authorised target
for a deliberate bypass:

- `tests/integration/settle-afl-api-brownlow-backtest.test.ts` (6 tests): the completed-season
  backtest bypass;
- `tests/integration/settle-afl-api-state-b.test.ts` (1 test).

The local-release follow-up removed that literal-name dependency. Both now require the isolated
runner, loopback/approved port, V2 `_test` name, matching live database, cluster identity and
database marker. Remote/redirected DSNs and unmarked databases refuse. Linux verification is
still a separate release gate, not a reason to require a literal local database name.

## 5. Reproducing the local-release inputs

Use an absolute existing `AFLDB_PYTHON` executable with psycopg and the retained source snapshots
listed above. No network acquisition is necessary. Missing snapshots or Python are errors.
Run `export_person_bridge.py --resolve-against isolated --parent
data/reference/draftguru-person-bridge-20260918-v2.json --out <new-child.json>` inside the isolated
runner. This rolled-back read-only export checks live cluster identity, retains parent provenance
and withholds targets not registered exactly once. Supply that child to rebuild's
`--draftguru-bridge <new-child.json>` and set `AFLDB_DRAFTGURU_BRIDGE` to the same absolute file
for tests. The final target is `afldb_v2_rb_final_test` (not an arbitrary test name: the
reinstatement suite intentionally requires the protected rebuild-target pattern).

The completed fresh replay ran migrations 001–114, all 30 stages and 89 validations; additive
migration 115 subsequently supplies the missing adjudication supersession FK index. The bridge
was then replayed from the authentic parent against its own measured registration. No assertions
or isolation guards were bypassed. The final workflow and evidence are in `local-release-review.md`.

For the final broad run a fresh delivery database was cloned from the preserved historical
template, migrated through 115 and supplied its own measured bridge child before any read-only
acceptance test. The full importer suite restores that child after its deliberate no-bridge
cases. Repetition must import the child before starting, irrespective of test-file order.
Choose an unused `afldb_v2_rb_<label>_test` for a new fresh clone; retain existing evidence databases.

Credentials were rotated for this dedicated cluster only. `isolated-pg.ts rotate-credentials`
checks identity, stores a local recovery file before the transaction, rotates all six roles,
replaces the local secret files and verifies new login success and old password rejection.
Neither passwords nor DSNs belong in evidence or version control. All retained databases survive.
