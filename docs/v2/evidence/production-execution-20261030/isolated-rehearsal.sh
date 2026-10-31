#!/bin/bash
# AFLDB V2 release, isolated rehearsal on the frozen bytes (D-V2-PROD-EXEC-1 package §2.2-§2.3, P-3).
# Derived from current-production-shadow/shadow-restore.sh (accepted restore and capture options, unchanged)
# and followup-20261029/scripts/followup.sh F8-F9. Host streamanator only; a NEW root and a NEW isolated
# cluster on 127.0.0.1:$PORT, fresh generated credentials (never printed); writes only under $R. The
# accepted a4641ca0 root is read only. No production, no DEV database or application.
#   rehearse <STAMP> <frozen_archive_sha256> <pinned_manifest_sha256>    clones REF0, A, AM, B; gates D, R, T
#   after    <STAMP> <postschema_archive_sha256> <pinned_manifest_sha256> clone C; gate V3
# Run detached (the transfer script prints the exact line):
#   ssh arm@10.0.40.100 "nohup bash $R/pinned/isolated-rehearsal.sh rehearse ... > $R/rehearse.out 2>&1 &"
# Results: $E/<mode>.result = PASS | PASS-PENDING-OWNER-GO | FAIL ... | INCOMPLETE ...; exit 0 | 3 | 1 | 2.
# Exit 3 means PASS-PENDING-OWNER-GO only. Refusals and failures: 2 usage/root state, 4 host/disk/cluster,
# 5 restore, 6 staged seasons, 7 A-REL sequence, 8 gate tool, 9 refused input (I1/I2/I4). Decide on $MODE.result.
set -uo pipefail
export LC_ALL=C
umask 077
MODE=${1:-}; STAMP=${2:-}; INPUT_SHA=${3:-}; PINNED_SHA=${4:-}
[[ "$MODE" =~ ^(rehearse|after)$ && "$STAMP" =~ ^[0-9]{8}T[0-9]{6}Z$ && "$INPUT_SHA" =~ ^[0-9a-f]{64}$ && "$PINNED_SHA" =~ ^[0-9a-f]{64}$ ]] \
  || { echo "STOP: usage isolated-rehearsal.sh rehearse|after <STAMP> <archive_sha256> <pinned_manifest_sha256>"; exit 2; }
R=/home/arm/afldb-v2-prodexec-$STAMP
P=$R/pinned; E=$R/evidence
PORT=55491
NODE=/home/arm/.nvm/versions/node/v22.23.2/bin/node
PGBIN=/usr/lib/postgresql/16/bin
export PATH=/home/arm/.nvm/versions/node/v22.23.2/bin:/usr/bin:/bin
# The accepted a4641ca0 shadow root: read only, bound by the hashes recorded in its committed evidence.
REF=/home/arm/afldb-v2-currentshadow-20261028T192336Z
REF_ARCHIVE_SHA=a4641ca0d1533c30d6670dfa9b555552548a91b736054e941adba75cee0c46fc
REF_SIDECAR_SHA=72f000462a2e7560afee97edf5598723a2ccfa45c9664e7d57ce7b62dddb57d4
REF_MANIFEST_SHA=ea197fcf40c1b27108bebb1cc9b0a6523e8d79804952f77610f5f4606ac8ac75
LV_SRC=/home/arm/afldb-v2-linuxverify-20261028T0310Z/src
REVIEWED_COMMIT=9ed9c9dd3e84682c43e96c46e98974b245eb54ed
LEDGER110_DIGEST=789946fe734b23c32ec87e59e3b860877d31a4b32b561624bf1d88fb8f055153
EXPECTED_PENDING='111_curated_award_proposals.sql 112_derived_award_results.sql 113_brownlow_eligibility_decisions.sql 114_award_projections_and_curated_revisions.sql 115_adjudication_supersession_fk_index.sql 116_brownlow_correction_receipts.sql 117_brownlow_provider_eligibility_unknown.sql'
declare -A PIN=(
  [111_curated_award_proposals.sql]=2ed29d9598742c74d0f9db6f7bac0bec8409733c1dace1d25356ad27edb91290
  [112_derived_award_results.sql]=e0aa0c7e6fd14b6885aaf43725309e82e2d9b362cf167fd57cca9b95cef401ac
  [113_brownlow_eligibility_decisions.sql]=79e7b9d1b839414962571ffff832b230e458273c24bd26d8474d259137ca9971
  [114_award_projections_and_curated_revisions.sql]=1c33324f9c7c616e998aa152fdd5fbdf20b2585694b3e6d62c2addb5f307f180
  [115_adjudication_supersession_fk_index.sql]=2f16efb9694f76f946543bbaca01785127b632417ad21ba1fc7b8745bb7c1852
  [116_brownlow_correction_receipts.sql]=c61953b71e1210b5389579342e155d367dfada5737bf3cd37f1a536b9ac61075
  [117_brownlow_provider_eligibility_unknown.sql]=a7dff2bddb1dd9c01ea0e69478193c5e5c50d8a531b2db448e7052b9f25e286f
)
DEFAULT_IMPORT='ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE ON TABLES TO afldb_import;'
DEFAULT_APP='ALTER DEFAULT PRIVILEGES FOR ROLE afldb_owner IN SCHEMA staging GRANT SELECT ON TABLES TO afldb_app;'
REF0=afldb_v2_shadow_pxref_test; A=afldb_v2_shadow_pxfrozen_test; AM=afldb_v2_shadow_pxfrozenmig_test
B=afldb_v2_shadow_permw_test; C=afldb_v2_shadow_pxafter_test
SEAL=2025
STAGE=start; EVIDENCE=0; OWNED=0; KEEP_RUNNING=0
step() { STAGE="$*"; echo "== $* $(date -u +%FT%TZ)"; }
die() { echo "STOP: $1"; exit "${2:-1}"; }
rc() { echo "EXIT $1 = $2" | tee -a "$E/$MODE.exit-codes.txt"; }
req() { rc "$1" "$2"; [ "$2" = 0 ] || die "$1 failed (exit $2); evidence retained" "${3:-1}"; }
# A gate tool reports through its exit code; a code outside its documented set, or a missing report,
# is a tool failure and stops the run (it can never be read as a pass).
gate() { rc "$1" "$2"; [[ " $3 " == *" $2 "* ]] || die "$1 failed (exit $2, allowed $3)" 8; [ -s "$4" ] || die "$1 wrote no report" 8; }
finish() {
  local x=$?
  trap - EXIT
  [ "$EVIDENCE" = 1 ] || exit "$x"
  # The cluster keeps running only for a recorded PASS result (later stages and controls need it); any other
  # outcome, whatever its exit code, stops it.
  case "$(cat "$E/$MODE.result" 2>/dev/null)" in PASS*) ;; *) if [ "$OWNED" = 1 ]; then OWNED=0; "${ISO[@]}" stop; rc cluster-stop-after-stop $?; fi;; esac
  [ -s "$E/$MODE.result" ] || echo "FAIL exit=$x stage=$STAGE" > "$E/$MODE.result"
  ( cd "$E" && find . -type f ! -name "$MODE.evidence-sha256.txt" ! -name "$MODE.done" -print0 | sort -z | xargs -0 sha256sum ) > "$E/$MODE.evidence-sha256.txt"
  echo "process completed exit=$x $(date -u +%FT%TZ)" > "$E/$MODE.done"
  echo "$MODE result: $(cat "$E/$MODE.result")"
  exit "$x"
}

[ "$(hostname)" = streamanator ] && [ "$(whoami)" = arm ] || die "wrong host or user" 2
[ -d "$P" ] || die "pinned directory missing" 2
if [ "$MODE" = rehearse ]; then
  [ -d "$R/xfer" ] && [ ! -e "$E" ] && [ ! -e "$R/src" ] && [ ! -e "$R/cluster" ] || die "root state unexpected for rehearse" 2
  mkdir -m 700 "$E" "$R/archive" || die "evidence directory" 2
else
  [ -d "$R/xfer2" ] && [ -s "$E/rehearse.result" ] && [ ! -e "$E/after.exit-codes.txt" ] || die "root state unexpected for after (rehearsal evidence and xfer2/ required)" 2
  case "$(cat "$E/rehearse.result")" in PASS*) ;; *) die "the rehearsal did not pass: $(cat "$E/rehearse.result")" 2;; esac
fi
exec > >(tee -a "$E/$MODE.log") 2>&1
EVIDENCE=1; trap finish EXIT
T0=$(date +%s)
step "isolated $MODE start host=$(hostname) stamp=$STAMP"

step "I1 pinned bytes and transferred archive"
[ "$(sha256sum < "$P/PINNED.SHA256" | cut -c1-64)" = "$PINNED_SHA" ]; req pinned-manifest-sha $? 9
( cd "$P" && sha256sum --check --strict PINNED.SHA256 ); req pinned-files $? 9
grep -q ' isolated-rehearsal.sh$' "$P/PINNED.SHA256"; req self-listed $? 9
X=xfer; LABEL=frozen; [ "$MODE" = after ] && { X=xfer2; LABEL=postschema; }
( cd "$R/$X" && sha256sum --check --strict SHA256SUMS ); req "$X-sums" $? 9
# Exactly one dump and its own sidecar; the name binds nothing by itself (the hash and the sidecar do).
mapfile -t DUMPS < <(find "$R/$X" -maxdepth 1 -type f -name '*.dump' -printf '%f\n')
mapfile -t SIDES < <(find "$R/$X" -maxdepth 1 -type f -name '*.release.json' -printf '%f\n')
[ "${#DUMPS[@]}" = 1 ] && [ "${#SIDES[@]}" = 1 ] && [ "${SIDES[0]}" = "${DUMPS[0]%.dump}.release.json" ] || die "$X must hold exactly one dump and its one release sidecar" 9
DUMP=${DUMPS[0]}; SIDE=${SIDES[0]}
cp "$R/$X/$DUMP" "$R/archive/$DUMP"; cp "$R/$X/$SIDE" "$R/archive/$SIDE"; chmod 600 "$R/archive/$DUMP" "$R/archive/$SIDE"
ARCHIVE=$R/archive/$DUMP; SIDECAR=$R/archive/$SIDE
printf '%s  %s\n' "$INPUT_SHA" "$ARCHIVE" | sha256sum --check --strict -; req archive-sha $? 9
# The summary binds its verdict to these bytes; A-REL later checks the same hash against the host's record.
echo "$INPUT_SHA" > "$E/$MODE.input-sha256.txt"
"$NODE" -e '
const [file, sha, label, want, dump] = process.argv.slice(1); const p = require(file);
const ok = p.format === "afldb.v2.release-backup.1" && p.label === label && p.archive_sha256 === sha && p.archive === dump
  && Number.isInteger(p.archive_bytes) && Array.isArray(p.observed_ledger) && typeof p.observed_ledger_digest === "string"
  && typeof p.dump_start_utc === "string" && typeof p.dump_end_utc === "string" && (label !== "frozen" || (p.observed_ledger.length === 110 && p.observed_ledger_digest === want));
if (!ok) process.exit(1);' "$SIDECAR" "$INPUT_SHA" "$LABEL" "$LEDGER110_DIGEST" "$DUMP"; req sidecar-fields $? 9
[ "$(stat -c %s "$ARCHIVE")" = "$("$NODE" -e 'process.stdout.write(String(require(process.argv[1]).archive_bytes))' "$SIDECAR")" ]; req archive-bytes $? 9

ISO=("$NODE" --import tsx tools/v2/isolated-pg.ts)
export AFLDB_V2_PG_ROOT="$R/cluster" AFLDB_V2_PG_BIN=$PGBIN AFLDB_V2_PG_PORT=$PORT
on() { local db=$1; shift; "${ISO[@]}" run "$db" -- "$@"; }
super() { PGPASSWORD="$(cat "$R/cluster/secrets/superuser.pw")" PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=afldb_v2_super "$@"; }
owned_listener() {
  local line p; line=$(ss -H -ltnp "( sport = :$PORT )"); p=$(echo "$line" | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2)
  [ -n "$p" ] && tr '\0' ' ' < "/proc/$p/cmdline" | grep -q -- "$R/cluster" && [ "$(echo "$line" | awk '{print $4}')" = "127.0.0.1:$PORT" ]
}
# Accepted restore method (shadow-restore.sh S4): --no-owner --no-privileges --exit-on-error --use-list, the
# four pg_trgm/unaccent entries excluded (the isolated bootstrap creates both extensions).
restore_toc() {
  "$PGBIN/pg_restore" --list "$1" > "$2.archive.toc" || return 1
  awk '!/ EXTENSION - (pg_trgm|unaccent)( |$)/ && !/ COMMENT - EXTENSION (pg_trgm|unaccent)( |$)/' "$2.archive.toc" > "$2.restore.toc" || return 1
  [ $(( $(grep -cv '^;' "$2.archive.toc") - $(grep -cv '^;' "$2.restore.toc") )) = 4 ]
}
restore_accepted() {
  local db=$1 dump=$2 tag=$3
  restore_toc "$dump" "$E/$tag" || die "$tag TOC (expected exactly 4 excluded extension entries)" 5
  "${ISO[@]}" create-db "$db"; req "create-$tag" $? 5
  on "$db" /usr/bin/env AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/restore-accepted.mjs" "$dump" "$E/$tag.restore.toc"; req "restore-$tag" $? 5
  on "$db" "$NODE" --import tsx tools/v2/shadow-guard.ts check --require AFLDB_OWNER_DATABASE_URL; req "shadow-guard-$tag" $? 5
}
ledger_check() {  # restored ledger equals the sidecar's observed ledger (name and checksum)
  on "$1" "$NODE" --input-type=module - "$2" < "$P/ledger-check.mjs" | tee "$E/$3.ledger-check.json"; req "ledger-check-$3" "${PIPESTATUS[0]}" 5
}
ledger_tsv() {  # name<TAB>checksum<LF>, ORDER BY name COLLATE "C": the host session's digest form
  on "$1" "$NODE" --input-type=module - < "$P/ledger-tsv.mjs" > "$E/$2.ledger.tsv"; req "ledger-tsv-$2" $? "${3:-7}"
  sha256sum < "$E/$2.ledger.tsv" | cut -c1-64 > "$E/$2.ledger.digest"
}
capture_preservation() {
  on "$1" "$NODE" --import tsx tools/v2/shadow-capture.ts preservation --dsn-env AFLDB_OWNER_DATABASE_URL \
    --contract docs/v2/preservation-queries.json --backup-sha256 "$2" --seal "$SEAL" --out "$E/$3.preservation.json"; req "$3.preservation" $? "$4"
}
capture_baseline() {
  on "$1" "$NODE" --import tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/$2.manifest.json"; req "$2.manifest" $? "$3"
  on "$1" "$NODE" --import tsx tools/v2/shadow-capture.ts row-counts --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/$2.row-counts.json"; req "$2.row-counts" $? "$3"
  on "$1" "$NODE" --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts coleman \
    --dsn-env AFLDB_OWNER_DATABASE_URL --from 1980 --through 2025 --settled --out "$E/$2.coleman.json"; req "$2.coleman" $? "$3"
  "$NODE" --import tsx tools/v2/shadow-parity.ts coverage-export --out "$E/$2.coverage.json"; req "$2.coverage" $? "$3"
}
psql_owner() {  # one statement or file as afldb_owner, password in the child's environment only
  on "$1" /usr/bin/env AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/psql-owner.mjs" "${@:2}"
}
# The A-REL sequence exactly as Stage 9 runs it: reviewed runner 111-117, privileges.sql (tools/db/privileges.ts
# runs the same `psql -v ON_ERROR_STOP=1 -f tools/maintenance/privileges.sql`), then the two defaults, each read back.
arel() {
  local db=$1 tag=$2
  on "$db" "$NODE" --import tsx tools/db/migrate.ts --target test --status > "$E/$tag.migrate-status-before.txt" 2>&1; req "$tag.migrate-status-before" $? 7
  local pending; pending=$(grep -oE 'PENDING  [0-9]{3}_[A-Za-z0-9_]+\.sql' "$E/$tag.migrate-status-before.txt" | awk '{print $2}' | paste -sd' ')
  [ "$pending" = "$EXPECTED_PENDING" ]; req "$tag.pending-exactly-111-117" $? 7
  on "$db" "$NODE" --import tsx tools/db/migrate.ts --target test > "$E/$tag.migrate.log" 2>&1; req "$tag.migrate" $? 7
  on "$db" "$NODE" --import tsx tools/db/privileges.ts --target test > "$E/$tag.privileges.log" 2>&1; req "$tag.privileges" $? 7
  psql_owner "$db" -c "$DEFAULT_IMPORT" > "$E/$tag.default-import.log" 2>&1; req "$tag.default-import" $? 7
  psql_owner "$db" -c "$DEFAULT_APP" > "$E/$tag.default-app.log" 2>&1; req "$tag.default-app" $? 7
  on "$db" "$NODE" --import tsx tools/db/migrate.ts --target test --status > "$E/$tag.migrate-status-after.txt" 2>&1; req "$tag.migrate-status-after" $? 7
  grep -qx '0 pending.' "$E/$tag.migrate-status-after.txt"; req "$tag.zero-pending" $? 7
  psql_owner "$db" -At -f "$P/arel-readback.sql" > "$E/$tag.arel-readback.txt"; req "$tag.arel-readback" $? 7
  cat "$E/$tag.arel-readback.txt"
  [ "$(grep -c '|ok$' "$E/$tag.arel-readback.txt")" = "$(wc -l < "$E/$tag.arel-readback.txt")" ] && [ "$(wc -l < "$E/$tag.arel-readback.txt")" = 12 ]
  req "$tag.arel-readback-all-ok" $? 7
}

step "I2 private source: git archive $REVIEWED_COMMIT and the Linux node_modules of the verified tree"
if [ "$MODE" = rehearse ]; then
  mkdir -m 700 "$R/src" && tar -xf "$P/src-9ed9c9dd.tar" -C "$R/src"; req src-extract $? 9
  test ! -e "$R/src/.env"; req no-dotenv $? 9
  for f in "${!PIN[@]}"; do printf '%s  %s\n' "${PIN[$f]}" "$R/src/src/db/migrations/$f"; done | sort -k2 | sha256sum --check --strict - > "$E/migrations-111-117.check"
  req migrations-pinned "${PIPESTATUS[2]}" 9
  [ "$(ls "$R/src/src/db/migrations" | grep -cE '^1(1[8-9]|[2-9][0-9])_')" = 0 ]; req no-migration-after-117 $? 9
  cmp -s "$R/src/package-lock.json" "$LV_SRC/package-lock.json" && cmp -s "$R/src/package.json" "$LV_SRC/package.json"; req dependency-manifests-equal-verified-tree $? 9
  NM=$(du -sb "$LV_SRC/node_modules" | cut -f1); AV=$(df -B1 --output=avail /home/arm | tail -1 | tr -d ' ')
  AB=$(stat -c %s "$ARCHIVE"); DBEST=$(( AB * 16 ))
  # Five restored databases now (REF0, A, AM, B and one disposable control clone at a time) and C later,
  # each estimated at 16x the archive (measured 13.4x for a4641ca0), plus node_modules and a 2 GiB floor.
  NEED=$(( 6 * DBEST + NM + 2147483648 ))
  echo "disk avail=$AV need=$NEED (db_estimate=$DBEST node_modules=$NM)" | tee "$E/disk-budget.txt"
  [ "$AV" -ge "$NEED" ]; req disk-budget $? 4
  cp -a "$LV_SRC/node_modules" "$R/src/node_modules"; req node-modules-copy $? 9
  echo "$REVIEWED_COMMIT" > "$E/reviewed-commit.txt"; "$NODE" --version > "$E/node-version.txt"; "$PGBIN/postgres" --version > "$E/pg-version.txt"; uname -a > "$E/linux-version.txt"
fi
cd "$R/src" || die "src" 9
for k in $(env | grep -oE '^(PG[A-Z_]*|[A-Z_]*DATABASE_URL[A-Z_]*|AFLDB_[A-Z_]*)=' | tr -d = | grep -v '^AFLDB_V2_PG_'); do unset "$k"; done
export NEXT_TELEMETRY_DISABLED=1

step "I3 isolated cluster on 127.0.0.1:$PORT (fresh generated credentials, never printed)"
if [ "$MODE" = rehearse ]; then
  ss -H -ltn "( sport = :$PORT )" | grep -q . && die "port $PORT in use" 4
  "${ISO[@]}" init; req cluster-init $? 4
  "${ISO[@]}" start; req cluster-start $? 4
  "${ISO[@]}" roles; req cluster-roles $? 4
elif ! owned_listener; then
  ss -H -ltn "( sport = :$PORT )" | grep -q . && die "port $PORT held by another process" 4
  "${ISO[@]}" start; req cluster-start $? 4
fi
owned_listener; req listener-owned-loopback $? 4
OWNED=1
ss -H -ltnp "( sport = :$PORT )" | awk '{print $4}' > "$E/$MODE.listener.txt"

if [ "$MODE" = rehearse ]; then
  step "I4 reference: the accepted a4641ca0 archive and its before set (read only)"
  printf '%s  %s\n%s  %s\n' "$REF_ARCHIVE_SHA" "$REF/archive/afldb_prod-20261028T192336Z.dump" "$REF_SIDECAR_SHA" "$REF/archive/afldb_prod-20261028T192336Z.provenance.json" | sha256sum --check --strict -; req reference-archive $? 9
  [ "$(sha256sum < "$REF/evidence/evidence-sha256.txt" | cut -c1-64)" = "$REF_MANIFEST_SHA" ]; req reference-manifest $? 9
  mkdir -m 700 "$E/reference"
  for f in before.preservation.json before.manifest.json; do
    grep -E "^[0-9a-f]{64}  \./$f\$" "$REF/evidence/evidence-sha256.txt" | sed "s#  \./#  $REF/evidence/#" | sha256sum --check --strict -; req "reference-$f" $? 9
    cp "$REF/evidence/$f" "$E/reference/$f"
  done
  REF_TIME=$("$NODE" -e 'process.stdout.write(require(process.argv[1]).captured_start_utc)' "$REF/archive/afldb_prod-20261028T192336Z.provenance.json")
  echo "$REF_TIME" > "$E/reference/captured_start_utc.txt"
  "$NODE" -e 'const p=require(process.argv[1]); require("fs").writeFileSync(process.argv[2], JSON.stringify({observed_ledger:p.observed_ledger})+"\n",{flag:"wx"})' \
    "$REF/archive/afldb_prod-20261028T192336Z.provenance.json" "$E/reference/ledger.json"; req reference-ledger $? 9

  step "I5 clone REF0 (a4641ca0, accepted method) and clone A (frozen dump, accepted method)"
  T_RESTORE=$(date +%s)
  restore_accepted "$REF0" "$REF/archive/afldb_prod-20261028T192336Z.dump" ref0
  ledger_check "$REF0" "$E/reference/ledger.json" ref0
  restore_accepted "$A" "$ARCHIVE" A
  ledger_check "$A" "$SIDECAR" A
  echo "restore_seconds_two_clones=$(( $(date +%s) - T_RESTORE ))" | tee -a "$E/timings.txt"
  SEASONS=$(on "$A" "$NODE" --input-type=module - < "$P/staged-seasons.mjs"); req staged-seasons $? 6
  WANT=$("$NODE" -e 'const s=require(process.argv[1]).staged_brownlow_seasons; process.stdout.write(s==="none"?"":s.split(" ").map((x)=>x.split(":")[0]).join(" "))' "$SIDECAR"); req sidecar-staged-seasons $? 6
  [ "$SEASONS" = "$WANT" ]; req staged-seasons-equal-production $? 6
  echo "staged Brownlow seasons: [$SEASONS]"

  step "I6 clone A before captures (the accepted capture set)"
  T_CAP=$(date +%s)
  on "$A" /usr/bin/env AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/schema-dump.mjs" "$E/before.schema.sql"; req before.schema $? 6
  capture_preservation "$A" "$INPUT_SHA" before 6
  capture_baseline "$A" before 6
  for S in $SEASONS; do
    on "$A" "$NODE" --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
      --dsn-env AFLDB_OWNER_DATABASE_URL --season "$S" --out "$E/before.brownlow-$S.json"; req "before.brownlow-$S" $? 6
  done
  echo "before_capture_seconds=$(( $(date +%s) - T_CAP ))" | tee -a "$E/timings.txt"

  step "I7 gate D: drift since the accepted a4641ca0 shadow (comparison, sealed scope, attribution)"
  "$NODE" "$P/snapshot-compare.mjs" preservation --a "$E/reference/before.preservation.json" --b "$E/before.preservation.json" --out "$E/gateD.compare.json"
  gate gateD-compare $? "0 1" "$E/gateD.compare.json"
  "$NODE" --import tsx tools/v2/historical-manifest.ts compare "$E/reference/before.manifest.json" "$E/before.manifest.json" --out "$E/gateD.manifest-compare.json"
  MX=$?; gate gateD-manifest "$MX" "0 1" "$E/gateD.manifest-compare.json"
  on "$A" "$NODE" --input-type=module - drift "$E/gateD.compare.json" "$MX" "$REF0" "$REF_TIME" "$E/gateD.json" < "$P/drift-gate.mjs"
  gate gateD "$?" "0 1 3" "$E/gateD.json"

  step "I8 clone AM = A + the A-REL sequence; after captures"
  T_AREL=$(date +%s)
  "${ISO[@]}" create-db "$AM" --template "$A"; req create-AM $? 7
  on "$AM" "$NODE" --import tsx tools/v2/shadow-guard.ts check --require AFLDB_OWNER_DATABASE_URL; req shadow-guard-AM $? 7
  arel "$AM" AM
  echo "arel_seconds=$(( $(date +%s) - T_AREL ))" | tee -a "$E/timings.txt"
  ledger_tsv "$AM" AM 7
  [ "$(wc -l < "$E/AM.ledger.tsv")" = 117 ] && head -110 "$E/AM.ledger.tsv" | sha256sum | grep -q "^$LEDGER110_DIGEST "; req AM-ledger-117-extends-110 $? 7
  echo "ledger digest after A-REL (host identity 117 expects this): $(cat "$E/AM.ledger.digest")"
  on "$AM" /usr/bin/env AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/schema-dump.mjs" "$E/postmig.schema.sql"; req postmig.schema $? 7
  diff -u "$E/before.schema.sql" "$E/postmig.schema.sql" > "$E/schema.diff"; X=$?; [ "$X" -le 1 ]; req schema-diff $? 7
  capture_preservation "$AM" "$INPUT_SHA" postmig 7
  capture_baseline "$AM" postmig 7
  for S in $SEASONS; do
    on "$AM" "$NODE" --import tsx --conditions=react-server tools/v2/shadow-award-reports.ts brownlow \
      --dsn-env AFLDB_OWNER_DATABASE_URL --season "$S" --out "$E/postmig.brownlow-$S.json"; req "postmig.brownlow-$S" $? 7
  done

  step "I9 gate R: the accepted shadow comparison, unchanged, then by finding code against a4641ca0"
  brownlow_args=()
  for f in "$E"/before.brownlow-*.json; do test -f "$f" || continue; s="${f##*/before.}"; brownlow_args+=(--brownlow-before "$f" --brownlow-after "$E/postmig.$s"); done
  "$NODE" --import tsx tools/v2/shadow-parity.ts compare \
    --manifest-before "$E/before.manifest.json" --manifest-after "$E/postmig.manifest.json" \
    --row-counts-before "$E/before.row-counts.json" --row-counts-after "$E/postmig.row-counts.json" \
    --coleman-before "$E/before.coleman.json" --coleman-after "$E/postmig.coleman.json" \
    --coverage-before "$E/before.coverage.json" --coverage-after "$E/postmig.coverage.json" \
    "${brownlow_args[@]}" --out "$E/migration.parity.json" --summary "$E/migration.parity.txt"
  gate parity $? "0 1 2" "$E/migration.parity.json"
  "$NODE" --import tsx tools/v2/release-gates.ts --before "$E/before.preservation.json" --after "$E/postmig.preservation.json" \
    --parity "$E/migration.parity.json" --functional docs/v2/migration-functional-evidence.json \
    --out "$E/release-gates.json" > "$E/release-gates.stdout.json" 2> "$E/release-gates.stderr.log"
  gate release-gates $? "0 1 2" "$E/release-gates.json"
  "$NODE" "$P/expected-deltas.mjs" "$E" "$SEASONS"; gate expected-deltas $? "0 1" "$E/expected-deltas.json"
  "$NODE" "$P/gate-r.mjs" "$E" "$P/accepted" "$E/gateR.json"; gate gateR $? "0 1" "$E/gateR.json"

  step "I10 clone B: the frozen dump with owners and ACLs kept; every named role must exist"
  T_B=$(date +%s)
  restore_toc "$ARCHIVE" "$E/B" || die "B TOC" 5
  "$PGBIN/pg_restore" --schema-only --use-list "$E/B.restore.toc" -f "$E/B.archive.schema.sql" "$ARCHIVE"; req B-archive-schema-text $? 5
  { awk '!/^;/ && NF {print $NF}' "$E/B.restore.toc"
    grep -oE '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES) .* (TO|FROM) [a-z_][a-z0-9_]*' "$E/B.archive.schema.sql" | awk '{print $NF}'
    grep -oE 'FOR ROLE [a-z_][a-z0-9_]*' "$E/B.archive.schema.sql" | awk '{print $NF}'
    grep -oE 'OWNER TO [a-z_][a-z0-9_]*' "$E/B.archive.schema.sql" | awk '{print $NF}'
  } | grep -vxE 'PUBLIC|public|-' | sort -u > "$E/B.named-roles.txt"
  super "$PGBIN/psql" -X -At -d postgres -c "SELECT rolname FROM pg_roles ORDER BY 1" > "$E/B.cluster-roles.txt"; req B-cluster-roles $? 5
  comm -23 "$E/B.named-roles.txt" "$E/B.cluster-roles.txt" > "$E/B.missing-roles.txt"
  echo "roles named by the dump: $(paste -sd' ' "$E/B.named-roles.txt"); missing: [$(paste -sd' ' "$E/B.missing-roles.txt")]"
  [ ! -s "$E/B.missing-roles.txt" ]; req B-every-named-role-exists $? 5
  "${ISO[@]}" create-db "$B"; req create-B $? 5
  super "$PGBIN/pg_restore" --dbname "$B" --exit-on-error --use-list "$E/B.restore.toc" "$ARCHIVE" > "$E/B.restore.log" 2>&1; req restore-B-acl-kept $? 5
  [ ! -s "$E/B.restore.log" ]; req B-restore-silent $? 5
  on "$B" "$NODE" --import tsx tools/v2/shadow-guard.ts check --require AFLDB_OWNER_DATABASE_URL; req shadow-guard-B $? 5
  ledger_check "$B" "$SIDECAR" B
  # Fidelity: every owner, ACL and default-ACL statement the archive carries is reproduced by the restored clone.
  super "$PGBIN/pg_dump" --schema-only -d "$B" -f "$E/B.restored.schema.sql"; req B-restored-schema-text $? 5
  acl() { grep -E '^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES|ALTER [A-Z ]+ .* OWNER TO )' "$1" | grep -v 'EXTENSION' | sort; }
  diff <(acl "$E/B.archive.schema.sql") <(acl "$E/B.restored.schema.sql") > "$E/B.fidelity.diff"; X=$?
  echo "B fidelity: archive $(acl "$E/B.archive.schema.sql" | wc -l) owner/ACL statements; differing lines $(grep -c '^[<>]' "$E/B.fidelity.diff")"
  [ "$X" = 0 ]; req B-acl-fidelity $? 5
  on "$B" /usr/bin/env PSQL_ROLE=afldb_backup AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/psql-owner.mjs" -f "$P/permission-readback.sql" > "$E/B-before.permissions.txt"; req B-before-readback $? 5
  arel "$B" B
  T_SUITE=$(date +%s)
  on "$B" "$NODE" node_modules/vitest/vitest.mjs run --no-cache tests/integration/privileges.test.ts --reporter=json \
    --outputFile="$E/T.privileges.json" > "$E/T.stdout.log" 2> "$E/T.stderr.log"; rc T-suite $?
  echo "suite_seconds=$(( $(date +%s) - T_SUITE ))" | tee -a "$E/timings.txt"
  "$NODE" -e 'const r=require(process.argv[1]); const o={total:r.numTotalTests,passed:r.numPassedTests,failed:r.numFailedTests,pending:r.numPendingTests,todo:r.numTodoTests};
    console.log(JSON.stringify(o)); process.exit(o.total===43&&o.passed===43&&o.failed===0&&o.pending===0&&o.todo===0?0:1)' "$E/T.privileges.json" | tee "$E/T.counts.json"
  rc T-43-of-43 "${PIPESTATUS[0]}"
  for n in 1 2; do
    on "$B" /usr/bin/env PSQL_ROLE=afldb_backup AFLDB_V2_PG_BIN="$PGBIN" "$NODE" "$P/psql-owner.mjs" -f "$P/permission-readback.sql" > "$E/B.permissions.$n.txt"; req "B-readback-$n" $? 5
  done
  cmp -s "$E/B.permissions.1.txt" "$E/B.permissions.2.txt"; req B-readback-deterministic $? 5
  cp "$E/B.permissions.1.txt" "$E/B.permissions.txt"
  "$NODE" "$P/snapshot-compare.mjs" permissions --a "$E/B.permissions.1.txt" --b "$E/B.permissions.2.txt" --out "$E/B.self-compare.json"
  gate B-self-compare $? "0" "$E/B.self-compare.json"
  echo "clone_B_seconds=$(( $(date +%s) - T_B ))" | tee -a "$E/timings.txt"

  step "I11 rehearsal summary (every gate present, or INCOMPLETE; never PASS on missing evidence)"
  "$NODE" "$P/rehearsal-summary.mjs" rehearse "$E" "$E/rehearse.summary.json"; S=$?
  gate rehearsal-summary "$S" "0 1 2 3" "$E/rehearse.summary.json"
  "$NODE" -e 'process.stdout.write(require(process.argv[1]).result)' "$E/rehearse.summary.json" > "$E/rehearse.result"
  echo "rehearsal_seconds=$(( $(date +%s) - T0 ))" | tee -a "$E/timings.txt"
  # The cluster keeps running for gate V3 later in the session (AM is its reference) unless the rehearsal failed.
  [ "$S" = 0 ] || [ "$S" = 3 ] || die "rehearsal summary $(cat "$E/rehearse.result")" "$S"
  exit "$S"
fi

step "J1 clone C: the post-A-REL production dump (accepted method)"
"${ISO[@]}" verify "$AM" > "$E/after.verify-AM.txt" 2>&1; req verify-AM $? 4
restore_accepted "$C" "$ARCHIVE" C
ledger_check "$C" "$SIDECAR" C
ledger_tsv "$C" C 7
cmp -s "$E/C.ledger.tsv" "$E/AM.ledger.tsv"; req C-ledger-equals-rehearsal $? 7
step "J2 gate V3: production after A-REL vs the rehearsed after-state"
capture_preservation "$C" "$INPUT_SHA" after 7
on "$C" "$NODE" --import tsx tools/v2/historical-manifest.ts produce --dsn-env AFLDB_OWNER_DATABASE_URL --out "$E/after.manifest.json"; req after.manifest $? 7
"$NODE" "$P/snapshot-compare.mjs" preservation --a "$E/postmig.preservation.json" --b "$E/after.preservation.json" --out "$E/gateV3.compare.json"
gate gateV3-compare $? "0 1" "$E/gateV3.compare.json"
"$NODE" --import tsx tools/v2/historical-manifest.ts compare "$E/postmig.manifest.json" "$E/after.manifest.json" --out "$E/gateV3.manifest-compare.json"
MX=$?; gate gateV3-manifest "$MX" "0 1" "$E/gateV3.manifest-compare.json"
# Reference time: the frozen dump's START (its snapshot). A row committed during the dump is absent from AM
# and dated after the start, so it is judged by its writer rule rather than refused as "before the reference".
FROZEN_START=$("$NODE" -e 'const fs=require("fs"); const f=fs.readdirSync(process.argv[1]).find((n)=>/\.release\.json$/.test(n)); process.stdout.write(require(process.argv[1]+"/"+f).dump_start_utc)' "$R/xfer")
on "$C" "$NODE" --input-type=module - after "$E/gateV3.compare.json" "$MX" "$AM" "$FROZEN_START" "$E/gateV3.json" < "$P/drift-gate.mjs"
gate gateV3 "$?" "0 1 3" "$E/gateV3.json"
"$NODE" "$P/rehearsal-summary.mjs" after "$E" "$E/after.summary.json"; S=$?
gate after-summary "$S" "0 1 2 3" "$E/after.summary.json"
step "J3 stop the owned cluster (every database retained for review), then record the result"
"${ISO[@]}" list | tee "$E/after.databases.txt"
OWNED=0; "${ISO[@]}" stop; req cluster-stop $? 8
"$NODE" -e 'process.stdout.write(require(process.argv[1]).result)' "$E/after.summary.json" > "$E/after.result"
echo "after_seconds=$(( $(date +%s) - T0 ))" | tee -a "$E/timings.txt"
exit "$S"
