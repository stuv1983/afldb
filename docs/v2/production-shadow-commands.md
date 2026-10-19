# Production-data shadow: Linux execution package (not executed)

This package supersedes the old shadow runbook's baseline-110-through-112 command examples.
Use migrations **111 through 115**, subject to the restored ledger. It does not authorise an
environment, production access, full suite, rebuild, capture, deployment or live-service change.
Review [the decision and backup requirements](migration-acceptance-2026-10-20.md) first.
Retain the archive unchanged. No acquire command, SSH, shared database or tunnel is involved.

## Environment and approval boundary

Available here: Windows Node 22.21.0, installed dependencies, local PostgreSQL 16 client
binaries at `D:/tmp/afldb-v2-pg16/dist/pgsql/bin/` and the retained isolated cluster. Offline
gate/comparison tests, TypeScript and changed-file lint can run here. The documented local
backup directory is absent. No restore or database contact was attempted for this package.

Requires an approved environment: unprivileged Linux user, local PostgreSQL 16 server/client
and required extensions, matching lockfile dependencies, a prepared checkout of the reviewed
commit with no `.env*` except `.env.example`, sufficient disk for archive + restored data +
hash snapshots, and the approved archive/provenance sidecar. Do not create a new worktree or
reuse a running service/cluster. S-A1/S-A2/S-A3 apply to data handling, new isolation and schema
changes; S-A4 is required for subsequent app-contract/rollback work. Linux process-ownership
verification in the isolated launcher is still unvalidated: if it cannot establish ownership,
STOP before credentials. A database name or loopback address is not isolation evidence.

The shell below uses the existing ownership-checking isolated launcher for every DB step;
it clears inherited PG/DSN variables for child processes and injects only the isolated target.
Record each exit code, the Linux/Node/PostgreSQL versions, reviewed commit, operator, approvals,
archive SHA and ledger. Never print the launcher's secret files, child environment or DSNs.

## 1. Input review, new isolated cluster and archive integrity

After approval, in the prepared reviewed checkout with dependencies already installed:

```bash
set -euo pipefail
umask 077
BACKUP="$HOME/backups/afldb/production-shadow-approved.dump"
PROVENANCE="$HOME/backups/afldb/production-shadow-approved.provenance.json"
test -f "$BACKUP" && test -f "$PROVENANCE"
# Operator first checks every provenance requirement in the decision record; no inference from naming.
BACKUP_SHA256="$(node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!/^[a-f0-9]{64}$/.test(p.sha256)) process.exit(2); process.stdout.write(p.sha256)' "$PROVENANCE")"
printf '%s  %s\n' "$BACKUP_SHA256" "$BACKUP" | sha256sum --check -

E="$HOME/afldb-v2-shadow-evidence/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 700 -p "$E"
git rev-parse HEAD > "$E/reviewed-commit.txt"
node --version > "$E/node-version.txt"
uname -a > "$E/linux-version.txt"
export AFLDB_V2_PG_ROOT="$E/cluster"
export AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin
export AFLDB_V2_PG_PORT=55434
test ! -e "$AFLDB_V2_PG_ROOT"
test -x "$AFLDB_V2_PG_BIN/initdb"
"$AFLDB_V2_PG_BIN/pg_restore" --version > "$E/pg-restore-version.txt"
# Inspect listeners/process ownership locally; the port must be unused, never a forward.
ss -ltnp '( sport = :55434 )'
node --import tsx tools/v2/isolated-pg.ts init
node --import tsx tools/v2/isolated-pg.ts start
node --import tsx tools/v2/isolated-pg.ts roles
DB=afldb_v2_shadow_prod_test
node --import tsx tools/v2/isolated-pg.ts create-db "$DB"
shadow() { node --import tsx tools/v2/isolated-pg.ts run "$DB" -- "$@"; }
shadow node --import tsx tools/v2/shadow-guard.ts check --require AFLDB_OWNER_DATABASE_URL
```

Stop if the port is occupied, listener ownership is unavailable, guard fails, archive provenance
is unapproved or the recorded SHA differs. Do not change another listener, use 55432, or bypass
the launcher. The root is a new private directory, not the existing Windows cluster.

## 2. Inspect archive and restore once

```bash
"$AFLDB_V2_PG_BIN/pg_restore" --list "$BACKUP" > "$E/archive.toc"
# The isolated bootstrap already owns pg_trgm and unaccent as superuser. Exclude ONLY their
# CREATE/COMMENT entries, preserving all data, constraints and other objects. Retain both TOCs.
awk '!/ EXTENSION - (pg_trgm|unaccent)( |$)/ && !/ COMMENT - EXTENSION (pg_trgm|unaccent)( |$)/' \
  "$E/archive.toc" > "$E/restore.toc"
# Review TOC coverage against provenance before restore. No --clean or --create is used.
shadow node --input-type=module - "$BACKUP" "$E/restore.toc" <<'JS'
import { spawnSync } from 'node:child_process';
const u = new URL(process.env.AFLDB_OWNER_DATABASE_URL);
const result = spawnSync('pg_restore', ['--dbname', u.pathname.slice(1), '--no-owner',
  '--no-privileges', '--exit-on-error', '--use-list', process.argv[3], process.argv[2]], {
  stdio: 'inherit', env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port,
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) }
});
process.exit(result.status ?? 2);
JS
shadow node --input-type=module - <<'JS'
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1 });
try {
  console.log(await sql`SELECT name FROM afldb_meta.schema_migrations ORDER BY name DESC LIMIT 6`);
} finally { await sql.end(); }
JS
```

Required: restore exit **0**, complete expected ledger ending at 110 and no unknown migration.
Any error stops; do not ignore stderr or retry over a partial restore. Preserve the failed copy
and logs for review. Inspect the retained TOC for all expected schemas, tables, sequences and
constraints. No archive or production-data evidence is currently available to fill this gate.

## 3. Migration-only snapshots (no replay, publication or settings writes)

Use the seal approved in the backup sidecar (2025 below is the current policy, not an automatic
rollover). All commands run against the same restored database through the owner connection.

```bash
SEAL=2025
capture_preservation() {
  shadow node --import tsx tools/v2/shadow-capture.ts preservation \
    --dsn-env AFLDB_OWNER_DATABASE_URL --contract docs/v2/preservation-queries.json \
    --backup-sha256 "$BACKUP_SHA256" --seal "$SEAL" --out "$E/$1.preservation.json"
}
capture_baseline() {
  shadow node --import tsx tools/v2/historical-manifest.ts produce \
    --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/$1.manifest.json"
  shadow node --import tsx tools/v2/shadow-capture.ts row-counts \
    --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/$1.row-counts.json"
  shadow node --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts coleman \
    --dsn-env AFLDB_OWNER_DATABASE_URL --from 1980 --through 2025 --settled --out "$E/$1.coleman.json"
  node --import tsx tools/v2/shadow-parity.ts coverage-export --out "$E/$1.coverage.json"
}
capture_preservation before
capture_baseline before
shadow node --import tsx tools/db/migrate.ts --target test --status
# Must show exactly 111..115 pending; otherwise stop for baseline review.
shadow node --import tsx tools/db/migrate.ts --target test
shadow node --import tsx tools/db/privileges.ts --target test
shadow node --import tsx tools/db/migrate.ts --target test --status
capture_preservation postmig
capture_baseline postmig
```

The Brownlow reconciliation reports required by the original comparator must also be captured
before/after, for identical authentic staged seasons, state and eligibility settings. Inventory
`staging.afl_api_brownlow_vote` as in `shadow-rehearsal.md` §4 and run for each real season S:

```bash
# BEFORE migrations (repeat after as postmig with identical options):
shadow node --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
  --dsn-env AFLDB_OWNER_DATABASE_URL --season "$S" --out "$E/before.brownlow-$S.json"
# AFTER migrations:
shadow node --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
  --dsn-env AFLDB_OWNER_DATABASE_URL --season "$S" --out "$E/postmig.brownlow-$S.json"
```

Do not invent staged inputs or a completed-season report if the backup has none. Raw votes are
independently preserved by the full-row snapshot. Missing original reconciliation evidence
still yields INCOMPLETE and needs a scoped owner review, not a synthetic substitute.

## 4. Offline comparisons and separate release results

```bash
# Build Brownlow flags only from actually captured before files; do not use placeholder files.
brownlow_args=()
for f in "$E"/before.brownlow-*.json; do
  test -f "$f" || continue
  suffix="${f##*/before.}"
  brownlow_args+=(--brownlow-before "$f" --brownlow-after "$E/postmig.$suffix")
done
# 0 PASS / 1 FAIL / 2 INCOMPLETE / 3 ERROR. A nonzero result stops acceptance; retain outputs.
node --import tsx tools/v2/shadow-parity.ts compare \
  --manifest-before "$E/before.manifest.json" --manifest-after "$E/postmig.manifest.json" \
  --row-counts-before "$E/before.row-counts.json" --row-counts-after "$E/postmig.row-counts.json" \
  --coleman-before "$E/before.coleman.json" --coleman-after "$E/postmig.coleman.json" \
  --coverage-before "$E/before.coverage.json" --coverage-after "$E/postmig.coverage.json" \
  "${brownlow_args[@]}" --out "$E/migration.parity.json" --summary "$E/migration.parity.txt"
node --import tsx tools/v2/release-gates.ts \
  --before "$E/before.preservation.json" --after "$E/postmig.preservation.json" \
  --parity "$E/migration.parity.json" --functional docs/v2/migration-functional-evidence.json \
  --out "$E/release-gates.json"
printf '%s  %s\n' "$BACKUP_SHA256" "$BACKUP" | sha256sum --check -
```

Under `set -e`, a failed/incomplete parity stops the shell. To obtain the separate gate report,
run its command explicitly after recording that exit code. Do not label it accepted. An
operational input is deliberately absent; production acceptance is INCOMPLETE / NO-GO.
Functional evidence is the retained local result; Linux reviewers must separately attach
their actual environment-specific checks. All JSON outputs use exclusive creation.

## 5. Functional Linux and rollback review, outside the preservation pair

After recording and accepting the migration-only comparison, retain that database unchanged.
Approve a separate smoke copy/phase and use the existing replay, publication, permission,
audit and rollback procedures in `shadow-rehearsal.md` §§6–9 and `rollback-runbook.md` §§4–7.
Do **not** run their old full-suite, shared-db rebuild, screenshot, acquisition, new-checkout
or host-service examples as part of this package. No fixture-writer first-season apply before
ISSUE-229 B2. Migration 115 is index-only and retained on app rollback; 111–114 reversal remains
the documented explicit data-loss operation, with publication/audit exports before any drop.
Host restore/rollback and service/legacy-writer operations require their separate release window.

Focused checks on approved Linux (no database required):

```bash
node node_modules/vitest/vitest.mjs run tests/v2-shadow-parity.test.ts tests/v2-shadow-capture.test.ts --no-cache
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js tools/v2/migration-preservation.ts tools/v2/preservation-capture.ts \
  tools/v2/release-gates.ts tools/v2/shadow-capture.ts tests/v2-shadow-parity.test.ts tests/v2-shadow-capture.test.ts
```

Record environment, actual counts, findings and all remaining incomplete evidence. Do not
delete the backup, cluster or evidence as an automatic final step. Stop at review; production
is still NO-GO and no deployment command is supplied.
