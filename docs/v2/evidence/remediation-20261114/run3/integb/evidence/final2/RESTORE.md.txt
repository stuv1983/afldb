# Restoring `afldb_v2_rb_rem3-6d5388ea.dump` into another isolated-pg cluster

Run-3 rebuild scope, 2026-11-14. The dump is a **local rebuild from retained sources, not production data**: it was produced by
`tools/db/rebuild-test.ts --target isolated` at commit `6d5388ea5305e73b0420fbccfa7b0cea4fe75927`, fitzRoy baseline
`c2-2026-final-core-v1` (the register's single accepted entry), DraftGuru `annual-html-20260826` **without a bridge**, migration
ledger head `118_fixtures_unconfirmed_participants.sql` (118 applied), FINAL VALIDATION PASSED: 91 checks. Its DraftGuru
baseline is the frozen 6,810 picks / 5,057 persons; production's 35 D-336-2 inserts (ids 6819-6853) are NOT in it.

## Files (all in this directory, read-only for other scopes)

| File | Bytes | sha256 |
|---|---|---|
| `afldb_v2_rb_rem3-6d5388ea.dump` (pg_dump -Fc, PG 16.15, gzip, 1658 TOC entries, dbname `afldb_v2_rb_rem3_test`) | 20662515 | `d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63` |
| `afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json` (`AFLDB_DRAFTGURU_BRIDGE` child: parent `draftguru-person-bridge-20260918-v3.json`, 3,562 of 3,562 bridges register exactly once, 1,495 withheld) | 710882 | `1200e702a6d3b637a50ab0fc61d8ede6cf0564ad18908a361bb0038b451b6e9d` |
| `restore-dump.mjs` (verifies the dump sha256, then `pg_restore --no-owner --no-comments -j 4`; credentials in the child's environment only) | see `SHA256SUMS` | `SHA256SUMS` |
| `afldb_v2_rb_rem3-6d5388ea.table-counts.tsv` (exact `count(*)` of the 83 public base tables, for the post-restore diff) | see `SHA256SUMS` | `SHA256SUMS` |

Check before use: `cd /mnt/ssd/afldb-rem3-base/rebuilt && sha256sum -c SHA256SUMS`.

## Prerequisites in YOUR cluster

* A checkout containing `tools/v2/isolated-pg.ts` (any run-3 base, `6d5388ea` or a descendant) with `npm ci` done, and **no `.env`**.
* Your own cluster and port (never 5432, 55432, 55651, 55660):

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export AFLDB_V2_PG_ROOT=<your cluster root, outside the checkout> AFLDB_V2_PG_PORT=<your port> AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
cd <your checkout>
IR() { node --import tsx tools/v2/isolated-pg.ts "$@"; }
IR init && IR start && IR roles && IR status      # roles: afldb_owner, afldb_app, afldb_import, afldb_backup, afldb_auth
```

`IR roles` is required: the dump carries ACLs for those roles, and `--no-owner` makes `afldb_owner` the owner of everything.

## Restore

The target database name must match `afldb_v2_*_test`; use **`afldb_v2_rb_<label>_test`** if any suite needs the protected
rebuild-target pattern (the reinstatement suite requires it). Use a FRESH database (never restore over a used one).

```bash
DB=afldb_v2_rb_<label>_test
D=/mnt/ssd/afldb-rem3-base/rebuilt
IR create-db $DB                                  # creates it with owner afldb_owner, installs pg_trgm/unaccent, applies the schema grants, sets the isolated-pg marker
SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
IR run $DB -- node $D/restore-dump.mjs $D/afldb_v2_rb_rem3-6d5388ea.dump $SHA
```

Notes:
* `pg_restore` options are `--no-password --no-comments --no-owner -j 4 -d $DB`. `--no-comments` is deliberate: `create-db` has already set
  the marker comment (`afldb-v2-isolated-test`), and a `pg_dump` taken without `--create` carries no `COMMENT ON DATABASE` entry.
* Verified result (second database `afldb_v2_rb_rem3_restore_test` in the producing cluster): `pg_restore exit=0 seconds=5 stderrLines=0`.
* Do not `pg_restore --clean` and do not restore into a database that already holds tables.
* A faster path inside ONE cluster: `IR create-db <new> --template afldb_v2_rb_rem3_test` (requires the template to be idle and marked).

## Post-restore checks (all were run against the verification copy and passed)

```bash
IR verify $DB                                      # prints: ISOLATED TARGET OK: <db>
IR list                                            # <db> must show "marked"
```

Then, with `isolated-pg run $DB -- node <probe>` (any read-only SQL), expect:
* `max(name) FROM afldb_meta.schema_migrations` = `118_fixtures_unconfirmed_participants.sql`, 118 rows.
* `draft_picks` 6,810 (ids 1-6810; none in 6819-6853), `draft_persons` 5,057.
* `matches` 17,056; `players` 13,365 (FINAL VALIDATION's 13,363 counts players with an afltables profile identity; the 2 more are player ids 13364 and 13365, created by the DraftGuru stage under `draftguru_explicit_admin_decision`, with no match rows and no afltables identity); `clubs` 24; `seasons` 131 (1897-2027).
* `fixtures` 0.
* Exact `count(*)` of every public base table equals `afldb_v2_rb_rem3-6d5388ea.table-counts.tsv` (83 tables; the verification copy diffed IDENTICAL).

## DraftGuru bridge child (needed by the draft-linkage and draftguru-import suites)

The dump is the pristine rebuild, imported **without** a bridge, so DraftGuru persons are not yet linked to players.
`tests/integration/draft-linkage.test.ts` derives its expectations from the child and so needs the child imported first, and
`draftguru-import.test.ts` restores it in `afterAll` from `AFLDB_DRAFTGURU_BRIDGE`:

```bash
CHILD=$D/afldb_v2_rb_rem3-draftguru-bridge-child-v3-6d5388ea.json
IR run $DB -- $AFLDB_PYTHON tools/rebuild/draftguru/import_draftguru.py --label annual-html-20260826 --bridge $CHILD
export AFLDB_DRAFTGURU_BRIDGE=$CHILD               # absolute path, for the tests
```

`AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python`. The import step needs the Stage A raw pages under the checkout's gitignored
`data/sources/draftguru/annual-html-20260826/raw/years/` (42 files, hashes in
`docs/rebuild-manifests/draftguru/annual-html-20260826.json`). Verified on the verification copy: exit 0,
`persons 5,057 / picks 6,810`, authority ledger 6, bridge 3,559, unmatched 1,493, live_override 0, reload guard clear.
Picks and persons stay 6,810 / 5,057 after the import. If a suite needs a different parent (for example the v2 parent named in
`docs/v2/isolated-rebuild.md` section 5), regenerate the child inside `isolated-pg run` with
`export_person_bridge.py --resolve-against isolated --parent <parent> --out <new absolute path>`; it is read-only and rolled back.
