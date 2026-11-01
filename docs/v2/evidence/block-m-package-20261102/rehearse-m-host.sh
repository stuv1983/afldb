#!/usr/bin/env bash
# Block M phase rehearsal on an authorised isolated Linux target (streamanator, NEW workspace under /mnt/ssd).
# It exercises the REAL m-prod.sh phases (pre, migrate, readback, window-stage, replay refusals) against a production-derived ledger-117
# clone in a guarded disposable cluster, through a sed-transformed COPY of m-prod.sh whose only changes are host facts (diff recorded).
# Touches no DEV service and nothing outside $W; reads the verified production dump (ledger 117). Production is never contacted.
# Usage: W=/mnt/ssd/afldb-v2-blockm-... R=<40-hex> CAND_SHA=<sha256> bash rehearse-m-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/home/arm/afldb-v2-prodexec-20261030T210000Z/archive/afldb_prod-20261031-084435.dump
DUMP_SHA=3f5b5339cee312950c308b494ca98ff29a2f1620d9f60a4d062fbaf37b624730
LOCK_SHA=984b44221f8f7256
OLDW=/mnt/ssd/afldb-v2-gap029l-20261101T204205Z
PORT=55494
DB=afldb_v2_blockm_rh_test
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
phase() { local name="$1"; shift; say "PHASE $name: start"; "$@" > "$EV/$name.log" 2>&1; local rc=$?
  if [ $rc -eq 0 ]; then say "PHASE $name: PASS"; echo "PASS $name" >> "$SUM"; else say "PHASE $name: FAIL rc=$rc (see $EV/$name.log)"; echo "FAIL $name rc=$rc" >> "$SUM"; fi; return $rc; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }

p0_resources() {
  df -h /mnt/ssd /; free -g | sed -n 2p; nproc
  [ "$(df --output=avail -k /mnt/ssd | tail -1)" -gt $((30*1024*1024)) ] || { echo "less than 30 GB free"; return 1; }
  [ "$(awk '/MemAvailable/ {print $2}' /proc/meminfo)" -gt $((8*1024*1024)) ] || { echo "less than 8 GB MemAvailable"; return 1; }
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":($PORT)$" && return 1
  echo "--- DEV services BEFORE (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  ls -l "$DUMP"
}
p1_inputs() {
  cd "$W/in" || return 1
  [ "$(sha256sum cand-m.tar.gz | cut -d' ' -f1)" = "$CAND_SHA" ] || { echo "candidate tar sha256 mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "production dump sha256 mismatch"; return 1; }
  cd "$W" && rm -rf cand && tar xzf in/cand-m.tar.gz || return 1
  cd "$CAND" && [ "$(git rev-parse HEAD)" = "$R" ] && [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "candidate not clean at $R"; return 1; }
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] || { echo "package-lock.json differs"; return 1; }
  [ -d "$OLDW/cand/node_modules" ] || { echo "no reusable node_modules"; return 1; }
  [ "$(sha256sum "$OLDW/cand/package-lock.json" | cut -c1-16)" = "$LOCK_SHA" ] || { echo "reusable node_modules lock differs"; return 1; }
  ln -s "$OLDW/cand/node_modules" "$CAND/node_modules"; echo node_modules >> "$CAND/.git/info/exclude"
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "node_modules link dirtied the tree"; return 1; }
  echo "candidate clean at $(git rev-parse HEAD); tracked=$(git ls-files | wc -l)"
}
p4_cluster() {
  IR init && IR start > "$EV/pg-start.out" 2>&1 < /dev/null &
  wait; sleep 3
  IR roles && IR status || return 1
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
  grep -q "127.0.0.1:$PORT" "$EV/listener.txt" && grep -q "pid=$pmpid," "$EV/listener.txt" && [ "$(grep -c . "$EV/listener.txt")" = 1 ] || { echo "listener not exclusively our postmaster"; return 1; }
}
p5_restore() {
  IR create-db afldb_v2_mtmpl_test || return 1
  RUNDB afldb_v2_mtmpl_test node "$OLDW/in/restore.mjs" "$DUMP" "$DUMP_SHA" || return 1
  cp "$OLDW/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
  RUNDB afldb_v2_mtmpl_test node .probe-dbs.mjs afldb_v2_mtmpl_test | tee "$EV/mtmpl-probe.txt"; rm -f "$CAND/.probe-dbs.mjs"
  grep -q '"ledger":"117_brownlow_provider_eligibility_unknown.sql"' "$EV/mtmpl-probe.txt" && grep -q '"matches":17056' "$EV/mtmpl-probe.txt" || return 1
  IR create-db "$DB" --template afldb_v2_mtmpl_test
}
# Host facts only: host/user, checkout path, ROOT, node path, database identity, DSN host/port, units, crontab, state-probe.
p6_prepare() {
  cd "$CAND" || return 1
  rm -f "$CAND/.env"   # isolated-pg refuses to run while the repository holds a .env, so identity is read first
  PSQL=/usr/lib/postgresql/16/bin/psql
  OID=$(RUNDB "$DB" bash -c "$PSQL \"\$AFLDB_BACKUP_DATABASE_URL\" -Atc \"SELECT oid FROM pg_database WHERE datname=current_database()\"") || return 1
  SYSID=$(RUNDB "$DB" bash -c "$PSQL \"\$AFLDB_BACKUP_DATABASE_URL\" -Atc \"SELECT system_identifier::text FROM pg_control_system()\"") || return 1
  cat > "$W/in/mkenv.cjs" <<'EOS'
const fs = require('fs'); const e = process.env;
const keys = ['AFLDB_OWNER_DATABASE_URL', 'AFLDB_BACKUP_DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL', 'DATABASE_URL'];
const miss = keys.filter((k) => !e[k]);
if (miss.length) { console.error('missing ' + miss.join()); process.exit(1); }
fs.writeFileSync(process.argv[2], keys.map((k) => k + '=' + e[k]).join(String.fromCharCode(10)) + String.fromCharCode(10), { mode: 0o600, flag: 'wx' });
EOS
  RUNDB "$DB" node "$W/in/mkenv.cjs" "$CAND/.env" || return 1
  echo .env >> "$CAND/.git/info/exclude"
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo ".env dirtied the tree"; return 1; }
  echo "rehearsal identity oid=$OID sysid=$SYSID db=$DB"; echo "OID=$OID SYSID=$SYSID" > "$EV/ident.env"
  X="$EV/m-prod.rehearsal.sh"
  sed -e 's#^\[ "$(hostname)" = afldb-prod \] && \[ "$(id -un)" = arm \]#[ "$(hostname)" = streamanator ] \&\& [ "$(id -un)" = arm ]#' \
      -e "s#^R_CHK=.*#R_CHK=$CAND#" -e "s#^ROOT=.*#ROOT=/mnt/ssd#" -e "s#^EXPECT_DB=afldb_prod; EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432#EXPECT_DB=$DB; EXPECT_DSN_HOST=127.0.0.1; EXPECT_DSN_PORT=$PORT#" \
      -e "s#^EXPECT_SYSID=.*#EXPECT_SYSID=$SYSID; EXPECT_OID=$OID#" \
      -e 's#^UNITS=.*#UNITS="afldb-rehearsal-none.service"#' -e '/^afldb-settle-afl-api-brownlow.service/d' \
      -e 's#^  bash "$HERE/state-probe.sh" .*#  echo "state-probe skipped (rehearsal host serves nothing)"#' \
      -e 's#if crontab -l >/dev/null 2>&1; then stop "arm has a crontab" 4; else echo "no crontab for arm"; fi#echo "crontab check skipped (rehearsal host)"#' \
      "$HERE_SRC/m-prod.sh" > "$X"
  diff "$HERE_SRC/m-prod.sh" "$X" > "$EV/m-prod.rehearsal.diff"; echo "transform diff lines: $(grep -c '^[<>]' "$EV/m-prod.rehearsal.diff")"
  cp "$HERE_SRC/state-probe.sh" "$EV/state-probe.sh"; bash -n "$X" && echo "rehearsal copy syntax ok"
  mkdir -p "$CAND/data/sources/afl_api/fixtures"; rm -rf "$CAND/data/sources/afl_api/fixtures/afl-api-2027-2026-11-01-012026"; cp -r "$W/in/snap" "$CAND/data/sources/afl_api/fixtures/afl-api-2027-2026-11-01-012026"
  [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "snapshot staging dirtied the tree (data/sources must be ignored)"; return 1; }
}
HERE_SRC="$CAND/docs/v2/evidence/block-m-package-20261102"
M() { ( cd "$EV" && M_BACKUP_DIR="${MB:-$EV/synth-ok}" M_LOG_DIR="$EV/m1-log" bash "$EV/m-prod.rehearsal.sh" "$@" ); }
PRE_OK=fd48ace0c2cb-pqAQwRIJWLjSYzR8LiTuy
okc() { "$@"; local rc=$?; [ $rc -eq 0 ] || { echo "ASSERT FAILED: expected success: $*  (rc=$rc)"; return 1; }; }
nok() { "$@"; local rc=$?; [ $rc -ne 0 ] && { echo "CONTROL refused as required (rc=$rc): ${*:1:3}"; return 0; }; echo "ASSERT FAILED: expected a refusal: $*"; return 1; }
p7_pre117() { okc M pre "$R" "$PRE_OK" 117; }
# A SYNTHETIC backup directory (a stand-in file, real SHA256SUMS, a sidecar with the fields backup_fresh reads). It proves the binding logic and
# its refusals only; the real capture script ran for Block L and its Block M copies differ by constants (diff in the package).
mk_backup() { # dir digest minutes-ago sysid oid
  node -e '
const fs = require("fs"), cp = require("child_process"), path = require("path"), cr = require("crypto");
const [dir, dig, ago, sysid, oid] = process.argv.slice(1);
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
const name = "afldb_prod-SYNTH.dump"; fs.writeFileSync(path.join(dir, name), "synthetic stand-in " + dig);
const sha = cr.createHash("sha256").update(fs.readFileSync(path.join(dir, name))).digest("hex");
const side = { observed_ledger_digest: dig, ledger_unchanged_across_capture: true, source_identity: { system_identifier: sysid, database_oid: oid },
  captured_end_utc: new Date(Date.now() - Number(ago) * 60000).toISOString(), archive: name, archive_sha256: sha };
fs.writeFileSync(path.join(dir, "afldb_prod-SYNTH.provenance.json"), JSON.stringify(side));
const lines = [name, "afldb_prod-SYNTH.provenance.json"].map((n) => cr.createHash("sha256").update(fs.readFileSync(path.join(dir, n))).digest("hex") + "  " + n);
fs.writeFileSync(path.join(dir, "SHA256SUMS"), lines.join(String.fromCharCode(10)) + String.fromCharCode(10));
' "$@"
}
p7b_backup_controls() { # each variant must be refused by migrate BEFORE anything is written; the valid one is accepted by p9
  . "$EV/ident.env"; local D117=647c3fb39ca66a572664e1dae9028e4fad4d6b121226d6bdf208e6738af45f72 D118=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57
  mk_backup "$EV/synth-ok" $D117 5 "$SYSID" "$OID" || return 1
  mk_backup "$EV/synth-stale" $D117 300 "$SYSID" "$OID" || return 1
  mk_backup "$EV/synth-wrongdigest" $D118 5 "$SYSID" "$OID" || return 1
  mk_backup "$EV/synth-wrongtarget" $D117 5 "1" "2" || return 1
  mk_backup "$EV/synth-tampered" $D117 5 "$SYSID" "$OID" || return 1; echo "tamper" >> "$EV/synth-tampered/afldb_prod-SYNTH.dump"
  for v in stale wrongdigest wrongtarget tampered; do MB="$EV/synth-$v" nok M migrate "$R" || return 1; done
  MB="$EV/no-such-dir" nok M migrate "$R" || return 1
  okc M pre "$R" "$PRE_OK" 117
}
p8_neg_wrong_state() { # nothing may change
  nok M pre "$R" x-x 118 && nok M migrate 0000000000000000000000000000000000000000 && okc M pre "$R" "$PRE_OK" 117
}
p9_migrate() { okc M migrate "$R"; }
p10_readback() { okc M readback; }
M2() { ( cd "$EV" && M_BACKUP_DIR="$EV/synth-ok" M_LOG_DIR="$EV/m1-log2" bash "$EV/m-prod.rehearsal.sh" "$@" ); }
p11_replay() {
  nok M migrate "$R" && nok M2 migrate "$R" && okc M pre "$R" "$PRE_OK" 118 && nok M pre "$R" "$PRE_OK" 117 || return 1
  echo "-- dirty checkout control"; echo "x" >> "$CAND/README.md"
  nok M pre "$R" "$PRE_OK" 118; local rc=$?; git -C "$CAND" checkout -q -- README.md
  [ "$(git -C "$CAND" status --porcelain | wc -l)" = 0 ] && [ $rc -eq 0 ]
}
p12_window_stage() {
  local L=afl-api-2027-2026-11-01-012026 F=21fd12e7704b7c7146cfbab414352352f3cfaa53e7ef5038f4411fa789e4c84d
  okc M window-stage $L $F && nok M window-stage $L 0000000000000000000000000000000000000000000000000000000000000000 || return 1
  M window check "$R" $L $F "$EV/window-check-1" "rehearsal check-only on an isolated clone, no approval"; rc=$?
  echo "window check exit=$rc (the DEV host has enabled AFL API timers: a refusal, exit 2, is the correct answer here; 0 would mean it saw none)"
  [ $rc -eq 0 ] || [ $rc -eq 2 ]
}
p12b_apply_readback_b() { # the REAL settle CLI on the disposable clone (the window cannot run on the DEV host); then the real read-back phase
  local D="rehearsal decision text for readback-b: synthetic audit rows"
  mv "$CAND/.env" "$W/env.aside" || return 1
  RUNDB "$DB" bash "$W/in/rehearse-m-apply-inner.sh" "$CAND" "$D"; local rc=$?
  mv "$W/env.aside" "$CAND/.env"; [ $rc -eq 0 ] || return 1
  okc M readback-b 17056 "$D" && nok M readback-b 17055 "$D" && nok M readback-b 17056 "some other decision text" || return 1
}
p13_final() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true; sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":($PORT)$" && return 1
  du -sh "$W" | tail -1
}
ALL="p0_resources p1_inputs p4_cluster p5_restore p6_prepare p7_pre117 p7b_backup_controls p8_neg_wrong_state p9_migrate p10_readback p11_replay p12_window_stage p12b_apply_readback_b p13_final"
PH="${*:-$ALL}"
for ph in $PH; do phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_inputs|p4_cluster|p5_restore|p6_prepare) say "prerequisite $ph failed: stopping"; break;; esac; }; done
say "DONE"; cat "$SUM"
