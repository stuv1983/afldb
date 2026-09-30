# AFLDB-ISSUE-238 Slice 11 — operator host handoff (rehearsal host, `code_test_db` only)

Companion to `issues/open/AFLDB-ISSUE-238.md` §12 item 11 (decisions S11-D1, S11-D2). The operator
runs every command in this file **on the rehearsal host (streamanator)**. The workstation performs
read-only verification only, through its `127.0.0.1:55432` tunnel, which is the same PostgreSQL
server as the host-local `127.0.0.1:5432`.

**Never** `afldb_dev`, never PROD. Nothing here stages, commits or pushes on the workstation.

## Flow

| Step | Where | What | Writes |
|---|---|---|---|
| T | workstation, then host | Transport the working tree; prove it is byte-exact | host checkout only |
| A | host | Env, target proof, `--plan`, ISSUE-237 zero-corrected seed, `verify --phase pre` | `code_test_db` (seed) |
| A′ | workstation (Claude) | Read-only pre-capture: ledger/importer digests, derived fixed point | none |
| B | host | **Run 1** destructive rebuild, then `verify --phase post` | `code_test_db` (rebuild) |
| B′ | workstation (Claude) | Read-only post-verification against A′ | none |
| C | later session | Run 2 (one corrected provider via the real CLI); separate section, not yet written | — |

**Return the complete log of each host step before starting the next.** Step B must not start
until A′ has been reported.

## T. Transport the exact working tree

The host must run exactly the tree at `D:\dev\afldb-issue-238-current`. That is base `d279c8e0`
plus the unstaged ISSUE-238/253/254 changes and six untracked files. `second` is excluded.

Workstation (PowerShell, operator):

```powershell
Set-Location D:\dev\afldb-issue-238-current
New-Item -ItemType Directory -Force D:\tmp\issue238-slice11 | Out-Null
git diff --binary d279c8e0 --output=D:/tmp/issue238-slice11/tracked.patch
tar -cf D:\tmp\issue238-slice11\untracked.tar `
  issues/closed/AFLDB-ISSUE-253.md issues/closed/AFLDB-ISSUE-254.md `
  src/db/migrations/108_import_reads_data_edits.sql `
  src/db/migrations/109_import_reads_player_match_period_stats.sql `
  tests/integration/derived-rebuild-parity.test.ts `
  tools/db/afl-api-identity-correction-rehearsal.ts
Get-FileHash -Algorithm SHA256 D:\tmp\issue238-slice11\tracked.patch, D:\tmp\issue238-slice11\untracked.tar
```

If `d279c8e0` is not on `origin`, also `git bundle create D:\tmp\issue238-slice11\base.bundle
issue/238-canonical-reattribution` and fetch from the bundle on the host. Copy the files to the host
(`scp`), then on the host:

```bash
hostname                                   # must be the rehearsal host
cd ~/afldb                                 # the host checkout the code_test_db rebuilds used
git fetch origin                           # or: git fetch <bundle> issue/238-canonical-reattribution
git worktree add ~/afldb-issue238-s11 d279c8e0
cd ~/afldb-issue238-s11
sha256sum ~/issue238-s11/tracked.patch ~/issue238-s11/untracked.tar   # must equal Get-FileHash
git apply --binary ~/issue238-s11/tracked.patch
tar -xf ~/issue238-s11/untracked.tar
git diff --binary d279c8e0 --output=/tmp/host.patch && sha256sum /tmp/host.patch
#   /tmp/host.patch's sha256 must equal tracked.patch's: that proves every tracked file is identical.
git status --short                         # expect the same 17 M + 6 ?? as the workstation (no `second`)
```

**STOP if any hash differs.** Then set up the checkout, and stop if a source snapshot is missing:

```bash
cp ~/afldb/.env .env                       # must define AFLDB_CODE_TEST_DATABASE_URL (afldb_owner) and
                                           # AFLDB_CODE_TEST_IMPORT_DATABASE_URL (afldb_import), naming code_test_db
cp -a ~/afldb/data/sources data/           # the snapshots the earlier code_test_db rebuilds used;
                                           # the rebuild PRECHECK re-verifies every SHA-256 before destruction
npm ci
```

## A. Environment, target proof, zero-corrected seed (host)

Export the two `code_test_db` DSNs and the capture root into the shell. The capture root must be
absolute, outside every checkout, and the same one the earlier L2 rehearsals used. Do not echo a DSN.

```bash
cd ~/afldb-issue238-s11
set -a; . ./.env; set +a
export AFLDB_REBUILD_CAPTURE_ROOT=<absolute capture root used by the ISSUE-237 L2 rehearsals>
# psql and the psycopg-capable python must resolve exactly as they did for the 2026-09-07 run

# The target proof. Run it immediately before EVERY writing or destructive command below.
proof() {
  local v got
  for v in AFLDB_CODE_TEST_DATABASE_URL AFLDB_CODE_TEST_IMPORT_DATABASE_URL; do
    [ -n "${!v}" ] || { echo "REFUSE: $v unset"; return 1; }
    got=$(psql "${!v}" -XAtqc "select current_database()||' '||coalesce(host(inet_server_addr()),'socket')||' '||current_setting('port')||' '||current_user") || return 1
    echo "$v -> $got"
    case "$got" in "code_test_db "*) ;; *) echo "REFUSE: $v does not name code_test_db"; return 1;; esac
  done
  hostname
}

proof && npm run db:test:rebuild -- --target code_test_db --plan     # no database contact
proof && npm run db:code-test:issue237-rehearsal -- residue
proof && npm run db:code-test:issue237-rehearsal -- seed
proof && npm run db:code-test:issue237-rehearsal -- verify --phase pre
```

Expected results:

- The plan names `code_test_db` with `AFLDB_CODE_TEST_DATABASE_URL + AFLDB_CODE_TEST_IMPORT_DATABASE_URL`,
  and binds `db:migrate:code-test` / `db:privileges:code-test`.
- `residue` is 0.
- `seed` writes one importer provider and one `linked` adjudication, on two real baseline players,
  with zero `corrected` rows.
- `verify --phase pre` PASSES.

**Return the log, then wait for step A′.**

## B. Run 1 — zero-corrected destructive rebuild (host; only after A′ is reported)

```bash
cd ~/afldb-issue238-s11
proof && echo "ACK: destroying code_test_db only" && \
  nohup npm run db:test:rebuild -- --target code_test_db --acknowledge-destroy code_test_db \
    > ~/issue238-s11/run1-rebuild.log 2>&1 &
# Watch with: tail -f ~/issue238-s11/run1-rebuild.log
#   success = "Rebuild complete."; failure = "REBUILD FAILED at stage '…'" (PRECHECK failures are pre-destruction).
proof && npm run db:code-test:issue237-rehearsal -- verify --phase post
ls -l "$AFLDB_REBUILD_CAPTURE_ROOT/code_test_db/" && sha256sum "$AFLDB_REBUILD_CAPTURE_ROOT"/code_test_db/afl-api-identities.*.reinstated.json
```

**Return:**

- `run1-rebuild.log` in full;
- the `verify --phase post` output;
- the newest `afl-api-identities.*.reinstated.json`. It holds only the fixture actor's email.

Leave the seed in place (no teardown). Step B′ reads it.
