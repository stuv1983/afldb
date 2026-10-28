#!/bin/bash
# AFLDB V2 current-production shadow: isolated restore, migration-only pair, comparison and report
# (D-V2-CURRENT-SHADOW-CAPTURE-1). Adapted from the 2026-10-28 retained-archive run
# (linux-verification-2026-10-28.md §10.5), which produced exactly the expected 116/117 deltas.
# Host streamanator only; new root and new isolated cluster on 127.0.0.1:55467; writes only under $R.
# No network, no shared database, no production. Run detached:
#   ssh arm@10.0.40.100 "nohup bash /home/arm/afldb-v2-currentshadow-<STAMP>/shadow-restore.sh <STAMP> > /home/arm/afldb-v2-currentshadow-<STAMP>/run.out 2>&1 &"
set -uo pipefail
export LC_ALL=C
umask 077
STAMP=${1:-}
[[ "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ ]] || { echo "STOP: usage shadow-restore.sh <STAMP>"; exit 2; }
R=/home/arm/afldb-v2-currentshadow-$STAMP
SRC_FROM=/home/arm/afldb-v2-linuxverify-20261028T0310Z/src
SRC_MANIFEST=/home/arm/afldb-v2-linuxverify-20261028T0310Z/evidence/src-c478c31b.files.sha256
PORT=55467
E=$R/evidence
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
BACKUP=$R/archive/afldb_prod-$STAMP.dump
PROVENANCE=$R/archive/afldb_prod-$STAMP.provenance.json
EXPECTED_PENDING='111_curated_award_proposals.sql 112_derived_award_results.sql 113_brownlow_eligibility_decisions.sql 114_award_projections_and_curated_revisions.sql 115_adjudication_supersession_fk_index.sql 116_brownlow_correction_receipts.sql 117_brownlow_provider_eligibility_unknown.sql'
SHADOW_PATHS='^\./(tools/v2/|tools/db/|src/|packages/|docs/v2/preservation-queries\.json|docs/v2/migration-functional-evidence\.json|package\.json|package-lock\.json|tsconfig\.json)'
STAGE=start; EVIDENCE=0; OWNED=0
step() { STAGE="$*"; echo "== $* $(date -u +%FT%TZ)"; }
die() { echo "STOP: $1"; exit "${2:-1}"; }
rc() { echo "EXIT $1 = $2" | tee -a "$E/exit-codes.txt"; }
# A required step records its status and stops the run on any nonzero exit.
req() { rc "$1" "$2"; [ "$2" = 0 ] || die "$1 failed (exit $2); evidence retained" "$3"; }
# A strict reporter exits 0/1/2 for PASS/FAIL/INCOMPLETE; that result is evidence, never a stop.
# Any other exit, or no report file, is a tool failure and stops the run.
report() { rc "$1" "$2"; case "$2" in 0|1|2) [ -s "$3" ] || die "$1 wrote no report" 8 ;; *) die "$1 failed (exit $2); evidence retained" 8 ;; esac; }
# Completion is recorded apart from success: shadow.done = the process ended (any exit); shadow.result
# = SUCCEEDED only for exit 0. On a stop, evidence is kept and only the cluster this run proved it owns
# (S3 listener check) is stopped. No database is dropped and no guard is changed.
finish() {
  local x=$?
  trap - EXIT
  [ "$EVIDENCE" = 1 ] || exit "$x"
  if [ "$x" != 0 ]; then
    if [ "$OWNED" = 1 ]; then OWNED=0; "${ISO[@]}" stop; rc cluster-stop-after-stop $?; fi
    ( cd "$E" && find . -type f ! -name evidence-sha256.txt ! -name shadow.done ! -name shadow.result -print0 | sort -z | xargs -0 sha256sum ) > "$E/evidence-sha256.txt"
    echo "FAILED exit=$x stage=$STAGE" > "$E/shadow.result"
  else
    echo SUCCEEDED > "$E/shadow.result"
  fi
  echo "process completed exit=$x $(date -u +%FT%TZ)" > "$E/shadow.done"
  echo "shadow result: $(cat "$E/shadow.result")"
  exit "$x"
}

[ "$(hostname)" = streamanator ] || die "wrong host" 2
[ -d "$R/xfer" ] && [ ! -e "$E" ] && [ ! -e "$R/src" ] && [ ! -e "$R/cluster" ] || die "root state unexpected" 2
mkdir -m 700 "$E" "$R/archive" || die "evidence directory" 2
exec > >(tee -a "$E/shadow.log") 2>&1
EVIDENCE=1; trap finish EXIT
step "current-production shadow start host=$(hostname) stamp=$STAMP"
sha256sum "$0" "$R/expected-deltas.mjs"

step "S1 archive integrity (copy of the transferred archive; xfer/ retained unchanged)"
( cd "$R/xfer" && sha256sum --check --strict SHA256SUMS ) || die "xfer hashes" 3
cp "$R/xfer/$(basename "$BACKUP")" "$BACKUP"; cp "$R/xfer/$(basename "$PROVENANCE")" "$PROVENANCE"; chmod 600 "$BACKUP" "$PROVENANCE"
BACKUP_SHA256="$("$NODE" -e 'const p=require(process.argv[1]); if(p.decision!=="D-V2-CURRENT-SHADOW-CAPTURE-1"||!/^[a-f0-9]{64}$/.test(p.archive_sha256)||p.observed_ledger.length!==110) process.exit(2); process.stdout.write(p.archive_sha256)' "$PROVENANCE")" || die "sidecar fields" 3
grep -q "^$BACKUP_SHA256  $(basename "$BACKUP")\$" "$R/xfer/SHA256SUMS" || die "sidecar archive sha differs from SHA256SUMS" 3
printf '%s  %s\n' "$BACKUP_SHA256" "$BACKUP" | sha256sum --check - || die "archive sha" 3
[ "$(stat -c %s "$BACKUP")" = "$("$NODE" -e 'process.stdout.write(String(require(process.argv[1]).archive_bytes))' "$PROVENANCE")" ] || die "archive bytes" 3

step "S2 source: private copy of the Linux-verified c478c31b tree"
cp -a "$SRC_FROM" "$R/src" || die "src copy" 3
( cd "$R/src" && find . -path ./node_modules -prune -o -type f -print0 | sort -z | xargs -0 sha256sum ) > "$E/src.files.sha256" || die "src manifest" 3
# A missing, empty or unreadable manifest, or any comparison error, stops: it must never read as "no differences".
[ -s "$SRC_MANIFEST" ] || die "verified source manifest missing or empty: $SRC_MANIFEST" 3
VERIFIED=$(sort -k2 "$SRC_MANIFEST") && [ -n "$VERIFIED" ] || die "verified source manifest unreadable" 3
CURRENT=$(sort -k2 "$E/src.files.sha256") && [ -n "$CURRENT" ] || die "src manifest unreadable" 3
diff <(printf '%s\n' "$VERIFIED") <(printf '%s\n' "$CURRENT") | grep -E '^[<>]' | awk '{print $1, $3}' > "$E/src-vs-c478c31b-manifest.diff"
S=("${PIPESTATUS[@]}"); [ "${S[0]}" -le 1 ] && [ "${S[1]}" -le 1 ] && [ "${S[2]}" = 0 ] || die "source manifest comparison failed (diff/grep/awk ${S[*]})" 3
echo "src vs verified c478c31b manifest: $(wc -l < "$E/src-vs-c478c31b-manifest.diff") differing lines"
awk '{print $2}' "$E/src-vs-c478c31b-manifest.diff" | grep -E "$SHADOW_PATHS"
S=("${PIPESTATUS[@]}"); [ "${S[0]}" = 0 ] && [ "${S[1]}" = 1 ] || die "a shadow-path file differs from the verified tree, or the check failed (awk/grep ${S[*]})" 3
echo c478c31b2ad84719907e0372d1b94230d3a4c508 > "$E/reviewed-commit.txt"
"$NODE" --version > "$E/node-version.txt"; uname -a > "$E/linux-version.txt"
cd "$R/src"

step "S3 new isolated cluster on 127.0.0.1:$PORT"
[ "$(df -B1 --output=avail /home/arm | tail -1 | tr -d ' ')" -ge 10737418240 ] || die "less than 10 GiB free" 4
export AFLDB_V2_PG_ROOT="$R/cluster" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d = | grep -v '^AFLDB_V2_PG_'); do unset "$k"; done
export NEXT_TELEMETRY_DISABLED=1
test -x "$AFLDB_V2_PG_BIN/initdb" || die "initdb" 4
"$AFLDB_V2_PG_BIN/pg_restore" --version > "$E/pg-restore-version.txt"
ss -H -ltnp "( sport = :$PORT )" | grep -q . && die "port $PORT in use" 4
ISO=("$NODE" --import tsx tools/v2/isolated-pg.ts)
"${ISO[@]}" init || die "init" 4
"${ISO[@]}" start || die "start" 4
LINE=$(ss -H -ltnp "( sport = :$PORT )"); P=$(echo "$LINE" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
[ -n "$P" ] && tr '\0' ' ' < "/proc/$P/cmdline" | grep -q -- "$R/cluster" || die "$PORT not served by this root" 4
OWNED=1   # from here a stop also stops this cluster (finish)
echo "listener $(echo "$LINE" | awk '{print $4}') pid $P exe $(readlink "/proc/$P/exe") data $(tr '\0' ' ' < "/proc/$P/cmdline" | grep -oE -- "-D [^ ]+")"
"${ISO[@]}" roles || die "roles" 4
DB=afldb_v2_shadow_current_baseline_test
"${ISO[@]}" create-db "$DB" || die "create-db" 4
shadow() { "${ISO[@]}" run "$DB" -- "$@"; }
shadow "$NODE" --import tsx tools/v2/shadow-guard.ts check --require AFLDB_OWNER_DATABASE_URL; X=$?; rc shadow-guard $X
[ "$X" = 0 ] || die "shadow guard" 4

step "S4 inspect archive and restore once (--no-owner --no-privileges --exit-on-error --use-list)"
"$AFLDB_V2_PG_BIN/pg_restore" --list "$BACKUP" > "$E/archive.toc" || die "archive TOC unreadable" 5
awk '!/ EXTENSION - (pg_trgm|unaccent)( |$)/ && !/ COMMENT - EXTENSION (pg_trgm|unaccent)( |$)/' "$E/archive.toc" > "$E/restore.toc" || die "restore TOC" 5
EXCLUDED=$(( $(grep -cv '^;' "$E/archive.toc") - $(grep -cv '^;' "$E/restore.toc") ))
echo "toc entries $(grep -cv '^;' "$E/archive.toc"); excluded $EXCLUDED"
[ "$EXCLUDED" = 4 ] || die "expected exactly 4 excluded pg_trgm/unaccent entries, got $EXCLUDED" 5
cat > "$E/restore.mjs" <<'JS'
import { spawnSync } from 'node:child_process';
const u = new URL(process.env.AFLDB_OWNER_DATABASE_URL);
const result = spawnSync(process.env.AFLDB_V2_PG_BIN + '/pg_restore', ['--dbname', u.pathname.slice(1), '--no-owner',
  '--no-privileges', '--exit-on-error', '--use-list', process.argv[3], process.argv[2]], {
  stdio: 'inherit', env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port,
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) }
});
process.exit(result.status ?? 2);
JS
shadow /usr/bin/env AFLDB_V2_PG_BIN="$AFLDB_V2_PG_BIN" "$NODE" "$E/restore.mjs" "$BACKUP" "$E/restore.toc"; X=$?; rc restore $X
[ "$X" = 0 ] || die "restore failed; baseline retained for review, no retry" 5
cat > "$E/ledger-check.mjs" <<'JS'
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
const want = JSON.parse(readFileSync(process.argv[2], 'utf8')).observed_ledger;
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const got = await sql`SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name`;
  const w = new Map(want.map((r) => [r.name, r.checksum]));
  const bad = got.filter((r) => w.get(r.name) !== r.checksum).map((r) => r.name);
  const missing = want.filter((r) => !got.some((g) => g.name === r.name)).map((r) => r.name);
  console.log(JSON.stringify({ restored: got.length, sidecar: want.length, last: got.at(-1)?.name, mismatched: bad, missing }));
  process.exitCode = bad.length || missing.length || got.length !== want.length ? 1 : 0;
} finally { await sql.end(); }
JS
# stdin form: the module resolves `postgres` from the src tree (the first §10.5 attempt failed without it).
shadow "$NODE" --input-type=module - "$PROVENANCE" < "$E/ledger-check.mjs" | tee "$E/ledger-check.json"; X=${PIPESTATUS[0]}; rc ledger-check $X
[ "$X" = 0 ] || die "restored ledger differs from the captured ledger" 5

step "S5 migration copy (baseline retained unchanged) and migration-only snapshots"
MDB=afldb_v2_shadow_current_migration_test
"${ISO[@]}" create-db "$MDB" --template "$DB" || die "clone" 6
DB=$MDB
shadow "$NODE" --import tsx tools/v2/shadow-guard.ts check --require AFLDB_OWNER_DATABASE_URL; X=$?; rc shadow-guard-migration $X
[ "$X" = 0 ] || die "shadow guard (migration copy)" 6
SEAL=2025   # scope label only (preservation-capture.ts); kept equal to both accepted runs for comparability
# Captures are required: any failure stops with $2 (6 before migration, 7 after).
capture_preservation() {
  shadow "$NODE" --import tsx tools/v2/shadow-capture.ts preservation \
    --dsn-env AFLDB_OWNER_DATABASE_URL --contract docs/v2/preservation-queries.json \
    --backup-sha256 "$BACKUP_SHA256" --seal "$SEAL" --out "$E/$1.preservation.json"; req "$1.preservation" $? "$2"
}
capture_baseline() {
  shadow "$NODE" --import tsx tools/v2/historical-manifest.ts produce \
    --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/$1.manifest.json"; req "$1.manifest" $? "$2"
  shadow "$NODE" --import tsx tools/v2/shadow-capture.ts row-counts \
    --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/$1.row-counts.json"; req "$1.row-counts" $? "$2"
  shadow "$NODE" --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts coleman \
    --dsn-env AFLDB_OWNER_DATABASE_URL --from 1980 --through 2025 --settled --out "$E/$1.coleman.json"; req "$1.coleman" $? "$2"
  "$NODE" --import tsx tools/v2/shadow-parity.ts coverage-export --out "$E/$1.coverage.json"; req "$1.coverage" $? "$2"
}
cat > "$E/staged-seasons.mjs" <<'JS'
import postgres from 'postgres';
const sql = postgres(process.env.AFLDB_OWNER_DATABASE_URL, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`SELECT DISTINCT season FROM staging.afl_api_brownlow_vote ORDER BY season`;
  console.log(rows.map((r) => r.season).join(' '));
} finally { await sql.end(); }
JS
SEASONS=$(shadow "$NODE" --input-type=module - < "$E/staged-seasons.mjs"); X=$?; rc staged-seasons $X
[ "$X" = 0 ] || die "staged-season query failed; an empty list must never be inferred" 6
echo "authentic staged Brownlow seasons in the archive: [${SEASONS}]"
# Cross-check with the value P4 measured on production (review MED-1): "none" or "season:count ...".
PROD_STAGED=$("$NODE" -e 'const s=require(process.argv[1]).staged_brownlow_seasons; process.stdout.write(s==="none"?"":s.split(" ").map((x)=>x.split(":")[0]).join(" "))' "$PROVENANCE") \
  || die "sidecar staged_brownlow_seasons unreadable; an empty list must never be inferred" 6
[ "$SEASONS" = "$PROD_STAGED" ] || die "restored staged seasons [$SEASONS] differ from production's [$PROD_STAGED]" 6
cat > "$E/schema-dump.mjs" <<'JS'
import { spawnSync } from 'node:child_process';
const u = new URL(process.env.AFLDB_OWNER_DATABASE_URL);
const result = spawnSync(process.env.AFLDB_V2_PG_BIN + '/pg_dump', ['--schema-only', '--no-owner', '--file', process.argv[2],
  u.pathname.slice(1)], { stdio: 'inherit', env: { ...process.env, PGHOST: u.hostname, PGPORT: u.port,
    PGUSER: decodeURIComponent(u.username), PGPASSWORD: decodeURIComponent(u.password) } });
process.exit(result.status ?? 2);
JS
# Complete schema (with ACLs) before and after, for the owner's 116/117 schema review (review MED-2).
shadow /usr/bin/env AFLDB_V2_PG_BIN="$AFLDB_V2_PG_BIN" "$NODE" "$E/schema-dump.mjs" "$E/before.schema.sql"; X=$?; rc before.schema $X
[ "$X" = 0 ] || die "schema dump before" 6
capture_preservation before 6
capture_baseline before 6
for S in $SEASONS; do
  shadow "$NODE" --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
    --dsn-env AFLDB_OWNER_DATABASE_URL --season "$S" --out "$E/before.brownlow-$S.json"; req "before.brownlow-$S" $? 6
done
shadow "$NODE" --import tsx tools/db/migrate.ts --target test --status > "$E/migrate-status-before.txt" 2>&1; req migrate-status-before $? 7
PENDING=$(grep -oE 'PENDING  [0-9]{3}_[A-Za-z0-9_]+\.sql' "$E/migrate-status-before.txt" | awk '{print $2}' | paste -sd' ')
echo "pending: $PENDING"
[ "$PENDING" = "$EXPECTED_PENDING" ] || die "pending set is not exactly 111..117; no migration applied" 7
shadow "$NODE" --import tsx tools/db/migrate.ts --target test > "$E/migrate.log" 2>&1; X=$?; rc migrate $X; tail -12 "$E/migrate.log"
[ "$X" = 0 ] || die "migrate failed; copy retained" 7
shadow "$NODE" --import tsx tools/db/privileges.ts --target test > "$E/privileges.log" 2>&1; req privileges $? 7
shadow "$NODE" --import tsx tools/db/migrate.ts --target test --status > "$E/migrate-status-after.txt" 2>&1; req migrate-status-after $? 7
grep -qx '0 pending.' "$E/migrate-status-after.txt" || die "pending migrations remain after apply" 7
shadow /usr/bin/env AFLDB_V2_PG_BIN="$AFLDB_V2_PG_BIN" "$NODE" "$E/schema-dump.mjs" "$E/postmig.schema.sql"; X=$?; rc postmig.schema $X
[ "$X" = 0 ] || die "schema dump after" 7
diff -u "$E/before.schema.sql" "$E/postmig.schema.sql" > "$E/schema.diff"; X=$?
[ "$X" -le 1 ] || die "schema diff failed (exit $X)" 7
echo "schema diff: $(grep -c '^-[^-]' "$E/schema.diff") removed / $(grep -c '^+[^+]' "$E/schema.diff") added lines (owner review evidence; not classified)"
capture_preservation postmig 7
capture_baseline postmig 7
for S in $SEASONS; do
  shadow "$NODE" --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
    --dsn-env AFLDB_OWNER_DATABASE_URL --season "$S" --out "$E/postmig.brownlow-$S.json"; req "postmig.brownlow-$S" $? 7
done

step "S6 offline comparisons, strict release-gates report, expected-delta classification"
brownlow_args=()
for f in "$E"/before.brownlow-*.json; do
  test -f "$f" || continue
  suffix="${f##*/before.}"
  brownlow_args+=(--brownlow-before "$f" --brownlow-after "$E/postmig.$suffix")
done
"$NODE" --import tsx tools/v2/shadow-parity.ts compare \
  --manifest-before "$E/before.manifest.json" --manifest-after "$E/postmig.manifest.json" \
  --row-counts-before "$E/before.row-counts.json" --row-counts-after "$E/postmig.row-counts.json" \
  --coleman-before "$E/before.coleman.json" --coleman-after "$E/postmig.coleman.json" \
  --coverage-before "$E/before.coverage.json" --coverage-after "$E/postmig.coverage.json" \
  "${brownlow_args[@]}" --out "$E/migration.parity.json" --summary "$E/migration.parity.txt"; report parity $? "$E/migration.parity.json"
cat "$E/migration.parity.txt"
"$NODE" --import tsx tools/v2/release-gates.ts \
  --before "$E/before.preservation.json" --after "$E/postmig.preservation.json" \
  --parity "$E/migration.parity.json" --functional docs/v2/migration-functional-evidence.json \
  --out "$E/release-gates.json" > "$E/release-gates.stdout.json" 2> "$E/release-gates.stderr.log"; report release-gates $? "$E/release-gates.json"
# The classifier never changes a strict result. Anything but exit 0 (ONLY_EXPECTED_116_117_DELTAS) fails the
# run (stop 9) after the integrity re-checks and S7, so the evidence and the stopped cluster are both retained.
"$NODE" "$R/expected-deltas.mjs" "$E" "$SEASONS"; CLASSIFIED=$?; rc expected-deltas $CLASSIFIED
printf '%s  %s\n' "$BACKUP_SHA256" "$BACKUP" | sha256sum --check -; req archive-recheck $? 8
( cd "$R/xfer" && sha256sum --check --strict SHA256SUMS ); req xfer-recheck $? 8

step "S7 retain: stop the cluster (both databases kept for review); evidence manifest"
"${ISO[@]}" list
OWNED=0; "${ISO[@]}" stop; req cluster-stop $? 8
ss -H -ltn "( sport = :$PORT )" | grep -q . && die "$PORT still listening after stop" 8
echo "$PORT free"
( cd "$E" && find . -type f ! -name evidence-sha256.txt -print0 | sort -z | xargs -0 sha256sum ) > "$E/evidence-sha256.txt" || die "evidence manifest" 8
echo "evidence manifest $(sha256sum "$E/evidence-sha256.txt" | cut -c1-64) files $(wc -l < "$E/evidence-sha256.txt")"
[ "$CLASSIFIED" = 0 ] || die "expected-delta classification did not return ONLY_EXPECTED_116_117_DELTAS (exit $CLASSIFIED); run FAILED" 9
step "shadow done"
