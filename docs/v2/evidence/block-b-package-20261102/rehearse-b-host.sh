#!/usr/bin/env bash
# Block B wrapper rehearsal on an authorised isolated Linux target (streamanator, NEW workspace under /mnt/ssd).
# Runs the REAL b-prod.sh phases (pre, snapshots, target, baseline, plan, apply, accept) and the REAL Brownlow runner through all five stages
# b0, b1, b2, b3, e on a production-derived ledger-118 clone, with a fresh pg_dump / restore / restored-baseline / assembled evidence PER STAGE,
# through a sed-transformed COPY of b-prod.sh whose only differences are host facts (diff recorded). The approvals are SYNTHETIC (their
# reference says so). Production is never contacted; no DEV service is touched.
# Usage: W=/mnt/ssd/afldb-v2-blockb-... R=<40-hex> CAND_SHA=<sha256> bash rehearse-b-host.sh [phase ...]
set -u -o pipefail
: "${W:?}" "${R:?}" "${CAND_SHA:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/home/arm/afldb-v2-prodexec-20261030T210000Z/archive/afldb_prod-20261031-084435.dump
DUMP_SHA=3f5b5339cee312950c308b494ca98ff29a2f1620d9f60a4d062fbaf37b624730
LOCK_SHA=984b44221f8f7256
OLDW=/mnt/ssd/afldb-v2-gap029l-20261101T204205Z
D118=573594e9365b642ec518c252b17de11d3a423872c53c3020ab525db5904aaf57
PORT=55495
DB=afldb_v2_blockb_rh_test
EV="$W/evidence"; mkdir -p "$EV"
SUM="$EV/SUMMARY.txt"
CAND="$W/cand"
PKGD="$CAND/docs/v2/evidence/block-b-package-20261102"
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
PSQL=/usr/lib/postgresql/16/bin/psql
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
phase() { local name="$1"; shift; say "PHASE $name: start"; "$@" > "$EV/$name.log" 2>&1; local rc=$?
  if [ $rc -eq 0 ]; then say "PHASE $name: PASS"; echo "PASS $name" >> "$SUM"; else say "PHASE $name: FAIL rc=$rc (see $EV/$name.log)"; echo "FAIL $name rc=$rc" >> "$SUM"; fi; return $rc; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
# isolated-pg `run` refuses while the repository holds a .env, so it is moved aside for exactly the duration of the call.
RUNDB() { local db="$1"; shift; local rc; [ -f "$CAND/.env" ] && mv "$CAND/.env" "$W/env.aside"; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); rc=$?; [ -f "$W/env.aside" ] && mv "$W/env.aside" "$CAND/.env"; return $rc; }
okc() { "$@"; local rc=$?; [ $rc -eq 0 ] || { echo "ASSERT FAILED: expected success: ${*:1:4} (rc=$rc)"; return 1; }; }
nok() { "$@"; local rc=$?; [ $rc -ne 0 ] && { echo "CONTROL refused as required (rc=$rc): ${*:1:4}"; return 0; }; echo "ASSERT FAILED: expected a refusal: ${*:1:4}"; return 1; }
B() { ( cd "$EV" && bash "$PKGD/b-prod.rehearsal.sh" "$@" ); }

p0_resources() {
  df -h /mnt/ssd; free -g | sed -n 2p
  [ "$(df --output=avail -k /mnt/ssd | tail -1)" -gt $((30*1024*1024)) ] || return 1
  [ "$(awk '/MemAvailable/ {print $2}' /proc/meminfo)" -gt $((8*1024*1024)) ] || return 1
  ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":($PORT)$" && return 1
  for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
}
p1_inputs() {
  cd "$W/in" || return 1
  [ "$(sha256sum cand-m.tar.gz | cut -d' ' -f1)" = "$CAND_SHA" ] && [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "hash mismatch"; return 1; }
  cd "$W" && rm -rf cand && tar xzf in/cand-m.tar.gz || return 1
  cd "$CAND" && [ "$(git rev-parse HEAD)" = "$R" ] && [ "$(git status --porcelain | wc -l)" = 0 ] || { echo "candidate not clean at $R"; return 1; }
  [ "$(sha256sum package-lock.json | cut -c1-16)" = "$LOCK_SHA" ] && [ "$(sha256sum "$OLDW/cand/package-lock.json" | cut -c1-16)" = "$LOCK_SHA" ] || { echo "lock mismatch"; return 1; }
  ln -s "$OLDW/cand/node_modules" "$CAND/node_modules"; echo node_modules >> "$CAND/.git/info/exclude"
  [ "$(git status --porcelain | wc -l)" = 0 ] && echo "candidate clean at $(git rev-parse HEAD)"
  ( cd "$PKGD" && node "$PKGD/assemble-backup-evidence.mjs" --help > /dev/null 2>&1; true )
  bash "$PKGD/assemble-selftest.sh"
}
p4_cluster() {
  IR init && IR start > "$EV/pg-start.out" 2>&1 < /dev/null &
  wait; sleep 3
  IR roles && IR status || return 1
  pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid"); ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$EV/listener.txt"
  grep -q "127.0.0.1:$PORT" "$EV/listener.txt" && grep -q "pid=$pmpid," "$EV/listener.txt" && [ "$(grep -c . "$EV/listener.txt")" = 1 ]
}
p5_restore_migrate() {
  IR create-db afldb_v2_btmpl_test || return 1
  RUNDB afldb_v2_btmpl_test node "$OLDW/in/restore.mjs" "$DUMP" "$DUMP_SHA" || return 1
  IR create-db "$DB" --template afldb_v2_btmpl_test || return 1
  # Block M-a on the clone (the real migrate tool as the owner role): the Brownlow package starts at ledger 118.
  cat > "$W/in/mig-inner.sh" <<'EOS'
#!/bin/bash
cd "$1" || exit 1
AFLDB_PROD_DATABASE_URL="$AFLDB_OWNER_DATABASE_URL" node --import tsx tools/db/migrate.ts --target prod 2>&1 | tail -4
exit "${PIPESTATUS[0]}"
EOS
  RUNDB "$DB" bash "$W/in/mig-inner.sh" "$CAND" || return 1
  cat > "$W/in/facts-inner.sh" <<'EOS'
#!/bin/bash
P=/usr/lib/postgresql/16/bin/psql
"$P" "$AFLDB_BACKUP_DATABASE_URL" -X -At -F '|' -c "SELECT current_database(), (SELECT oid FROM pg_database WHERE datname=current_database()), (SELECT system_identifier::text FROM pg_control_system()), current_setting('cluster_name'), coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'),''), (SELECT count(*) FROM afldb_meta.schema_migrations), (SELECT count(*) FROM brownlow_round_votes), (SELECT count(*) FROM brownlow_correction_receipts)"
EOS
  RUNDB "$DB" bash "$W/in/facts-inner.sh" | tee "$EV/clone-facts.txt"
  grep -q '|118|330383|0$' "$EV/clone-facts.txt"
}
p6_prepare() {
  IFS='|' read -r _db OID SYSID CLUSTER COMMENT _rows _votes _rc < <(grep -v isolated-pg "$EV/clone-facts.txt" | tail -1)
  echo "clone identity oid=$OID sysid=$SYSID cluster=$CLUSTER comment=[$COMMENT]"; echo "OID=$OID SYSID=$SYSID CLUSTER=$CLUSTER" > "$EV/ident.env"; printf '%s' "$COMMENT" > "$EV/comment.txt"
  cat > "$W/in/mkenv.cjs" <<'EOS'
const fs = require('fs'); const e = process.env;
const keys = ['AFLDB_OWNER_DATABASE_URL', 'AFLDB_BACKUP_DATABASE_URL', 'AFLDB_IMPORT_DATABASE_URL', 'AFLDB_AUTH_DATABASE_URL', 'DATABASE_URL'];
const miss = keys.filter((k) => !e[k]);
if (miss.length) { console.error('missing ' + miss.join()); process.exit(1); }
fs.writeFileSync(process.argv[2], keys.map((k) => k + '=' + e[k]).join(String.fromCharCode(10)) + String.fromCharCode(10), { mode: 0o600, flag: 'wx' });
EOS
  rm -f "$CAND/.env"; RUNDB "$DB" node "$W/in/mkenv.cjs" "$CAND/.env" || return 1
  echo .env >> "$CAND/.git/info/exclude"
  mkdir -p "$CAND/data/sources/afl_api/fixtures" "$CAND/data/sources/afl_api/brownlow"
  rm -rf "$CAND/data/sources/afl_api/fixtures/afl-api-2025-2026-10-20-014218" "$CAND/data/sources/afl_api/brownlow/afl-api-brownlow-2025-2026-10-20-014218"
  cp -r "$W/in/snap-fixtures" "$CAND/data/sources/afl_api/fixtures/afl-api-2025-2026-10-20-014218"
  cp -r "$W/in/snap-brownlow" "$CAND/data/sources/afl_api/brownlow/afl-api-brownlow-2025-2026-10-20-014218"
  [ "$(git -C "$CAND" status --porcelain | wc -l)" = 0 ] || { echo "staging dirtied the tree (data/sources must be ignored)"; return 1; }
  WANT="const want = { host: \"127.0.0.1\", port: $PORT, database: \"$DB\", user: \"afldb_owner\", systemIdentifier: \"$SYSID\", databaseOid: \"$OID\", clusterName: \"$CLUSTER\", databaseComment: $(node -e 'process.stdout.write(JSON.stringify(require("fs").readFileSync(process.argv[1],"utf8")||null))' "$EV/comment.txt") };"
  X="$PKGD/b-prod.rehearsal.sh"; grep -qx "docs/v2/evidence/block-b-package-20261102/b-prod.rehearsal.sh" "$CAND/.git/info/exclude" || echo "docs/v2/evidence/block-b-package-20261102/b-prod.rehearsal.sh" >> "$CAND/.git/info/exclude"
  sed -e 's#^\[ "$(hostname)" = afldb-prod \] && \[ "$(id -un)" = arm \]#[ "$(hostname)" = streamanator ] \&\& [ "$(id -un)" = arm ]#' \
      -e "s#^CHK=.*#CHK=$CAND#" -e "s#^EXPECT_DB=afldb_prod; EXPECT_DSN_HOST=localhost; EXPECT_DSN_PORT=5432#EXPECT_DB=$DB; EXPECT_DSN_HOST=127.0.0.1; EXPECT_DSN_PORT=$PORT#" \
      -e "s#^EXPECT_SYSID=.*#EXPECT_SYSID=$SYSID; EXPECT_OID=$OID#" \
      -e '/^UNITS=/,/^afldb-settle-afl-api-brownlow.service/c\UNITS="afldb-rehearsal-none.service"' \
      -e 's#  if crontab -l >/dev/null 2>&1; then stop "arm has a crontab" 4; fi#  echo "crontab check skipped (rehearsal host)"#' \
      -e "s#/home/arm/ops/blockb-#$EV/ops/blockb-#" -e "s#'host','localhost'#'host','127.0.0.1'#" \
      -e "s#^const want = .*#$(printf '%s' "$WANT" | sed 's/[#&\\]/\\&/g')#" \
      "$PKGD/b-prod.sh" > "$X"
  diff "$PKGD/b-prod.sh" "$X" > "$EV/b-prod.rehearsal.diff"; echo "transform diff lines: $(grep -c '^[<>]' "$EV/b-prod.rehearsal.diff")"
  bash -n "$X" && echo "rehearsal copy syntax ok"
}

# One full stage cycle: pre, snapshots, target, live baseline, fresh dump, restore + restored baseline, assemble, plan, synthetic approval, apply, accept.
cycle() { # stage
  local s=$1 d="$EV/stage-$s"; mkdir -p "$d"; . "$EV/ident.env"
  okc B pre "$R" "$s" || return 1
  case "$s" in b0|b1) okc B snapshots "$s" || return 1;; esac
  okc B target "$R" "$s" || return 1
  okc B baseline "$R" "$s" || return 1
  local BD="$EV/ops/blockb-${R:0:12}/$s"
  # fresh dump of the live clone (read by the owner DSN inside the isolated runner) + a sidecar shaped like the capture script's
  cat > "$W/in/dump-inner.sh" <<'EOS'
#!/bin/bash
D=$1; DIG=$2; SYS=$3; OID=$4
/usr/lib/postgresql/16/bin/pg_dump --format=custom --no-owner -f "$D/d.dump" "$AFLDB_OWNER_DATABASE_URL" || exit 1
SHA=$(sha256sum "$D/d.dump" | cut -c1-64)
node -e '
const [d, dig, sha, sys, oid] = process.argv.slice(1);
require("fs").writeFileSync(d + "/side.json", JSON.stringify({ archive: "d.dump", archive_sha256: sha, observed_ledger_digest: dig, ledger_unchanged_across_capture: true,
  source_identity: { system_identifier: sys, database_oid: oid }, captured_end_utc: new Date().toISOString() }));' "$D" "$DIG" "$SHA" "$SYS" "$OID"
echo "dump $SHA"
EOS
  RUNDB "$DB" bash "$W/in/dump-inner.sh" "$d" "$D118" "$SYSID" "$OID" || return 1
  local SHA; SHA=$(sha256sum "$d/d.dump" | cut -c1-64); sleep 2
  local RDB="afldb_v2_blockb_${s}_rst_test"
  IR create-db "$RDB" || return 1
  RUNDB "$RDB" node "$OLDW/in/restore.mjs" "$d/d.dump" "$SHA" || return 1
  # restored copy: facts + the REAL runner `baseline` against it (target built from the restored database's own facts)
  cat > "$W/in/restored-inner.sh" <<'EOS'
#!/bin/bash
CHK=$1; D=$2; R=$3; PORT=$4
P=/usr/lib/postgresql/16/bin/psql
F=$("$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -F '|' -c "SELECT current_database(), (SELECT oid FROM pg_database WHERE datname=current_database()), (SELECT system_identifier::text FROM pg_control_system()), current_setting('cluster_name'), coalesce(shobj_description((SELECT oid FROM pg_database WHERE datname=current_database()),'pg_database'),'')") || exit 1
LED=$("$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -F "$(printf '\t')" -c "SELECT name, checksum FROM afldb_meta.schema_migrations ORDER BY name COLLATE \"C\"") || exit 1
ROWS=$(printf '%s\n' "$LED" | wc -l); DIG=$(printf '%s\n' "$LED" | sha256sum | cut -c1-64)
M=$("$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -c "SELECT count(*) FROM matches"); FX=$("$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -c "SELECT count(*) FROM fixtures")
node -e '
const [f, rows, dig, m, fx, d, port] = process.argv.slice(1); const [db, oid, sys, cl, cm] = f.split("|");
const fs = require("fs");
fs.writeFileSync(d + "/restore-facts.json", JSON.stringify({ ledgerRows: Number(rows), ledgerDigest: dig, matches: Number(m), fixtures: Number(fx), restoredAt: new Date().toISOString() }));
fs.writeFileSync(d + "/restored-target.json", JSON.stringify({ host: "127.0.0.1", port: Number(port), database: db, user: "afldb_owner", systemIdentifier: sys, databaseOid: oid, clusterName: cl, databaseComment: cm === "" ? null : cm }));
' "$F" "$ROWS" "$DIG" "$M" "$FX" "$D" "$PORT"
cd "$CHK" && AFLDB_BROWNLOW_CORRECTION_DSN="$AFLDB_OWNER_DATABASE_URL" node --import tsx --conditions=react-server tools/v2/brownlow-production-correction.ts baseline --target "$D/restored-target.json" --out "$D/baseline-restored.json"
EOS
  RUNDB "$RDB" bash "$W/in/restored-inner.sh" "$CAND" "$d" "$R" "$PORT" || return 1
  okc node "$PKGD/assemble-backup-evidence.mjs" --stage "$s" --revision "$R" --target "$BD/target.json" --live-baseline "$BD/baseline-live.json" \
    --restored-baseline "$d/baseline-restored.json" --sidecar "$d/side.json" --dump "$d/d.dump" --restore-facts "$d/restore-facts.json" --expect-ledger-digest "$D118" --out-dir "$d/evidence" || return 1
  okc B plan "$R" "$s" "$d/evidence/backup-$s.json" "$d/d.dump" "$d/evidence/restore-evidence-$s.json" || return 1
  # synthetic approvals: a WRONG one must be refused by the wrapper before the runner, then the right one
  node -e '
const fs = require("fs"); const [plan, out, bad] = process.argv.slice(1); const p = JSON.parse(fs.readFileSync(plan, "utf8"));
const a = { planDigest: bad === "bad" ? "0".repeat(64) : p.digest, target: p.target, revision: process.env.REV, operation: p.request.operation, seasons: p.request.seasons,
  source: String(p.request.operation).endsWith("backfill") ? "legacy" : "afl_api", approvedAt: new Date().toISOString(), expiresAt: p.expiresAt,
  reference: "SYNTHETIC isolated rehearsal approval - never production authority", rulings: p.request.rulings, stage: p.request.stage };
fs.writeFileSync(out, JSON.stringify(a), { flag: "wx" });' "$BD/plan.json" "$d/approval-bad.json" bad || return 1
  REV="$R" node -e '
const fs = require("fs"); const [plan, out] = process.argv.slice(1); const p = JSON.parse(fs.readFileSync(plan, "utf8"));
const a = { planDigest: p.digest, target: p.target, revision: process.env.REV, operation: p.request.operation, seasons: p.request.seasons,
  source: String(p.request.operation).endsWith("backfill") ? "legacy" : "afl_api", approvedAt: new Date().toISOString(), expiresAt: p.expiresAt,
  reference: "SYNTHETIC isolated rehearsal approval - never production authority", rulings: p.request.rulings, stage: p.request.stage };
fs.writeFileSync(out, JSON.stringify(a), { flag: "wx" });' "$BD/plan.json" "$d/approval.json" || return 1
  nok B apply "$R" "$s" "$BD/plan.json" "$d/approval-bad.json" "$d/d.dump" "$d/evidence/restore-evidence-$s.json" || return 1
  nok B apply "$R" "$s" "$BD/plan.json" "$d/no-such-approval.json" "$d/d.dump" "$d/evidence/restore-evidence-$s.json" || return 1
  nok B accept "$R" "$s" || return 1   # accept must refuse before the stage has run
  okc B apply "$R" "$s" "$BD/plan.json" "$d/approval.json" "$d/d.dump" "$d/evidence/restore-evidence-$s.json" || return 1
  okc B accept "$R" "$s" || return 1
  nok B apply "$R" "$s" "$BD/plan.json" "$d/approval.json" "$d/d.dump" "$d/evidence/restore-evidence-$s.json" || return 1   # never re-applied
}
p7_b0() { nok B pre "$R" b1 && cycle b0; }                    # b1 first would skip b0: refused by the receipts check
p7_b1() { nok B pre "$R" b0 && cycle b1; }                    # b0 is already applied
p7_b2() { cycle b2; }
p7_b3() { cycle b3; }
p7_e()  { cycle e; }
p8_2026_control() { # Brownlow 2026 must stay byte-identical: change one 2026 row, the wrapper must refuse; restore the row
  cat > "$W/in/tamper-inner.sh" <<'EOS'
#!/bin/bash
P=/usr/lib/postgresql/16/bin/psql
"$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c "UPDATE brownlow_round_votes SET votes = votes + 1 WHERE ctid = (SELECT ctid FROM brownlow_round_votes WHERE season = 2026 ORDER BY 1 LIMIT 1)" -c "SELECT 'tampered'"
EOS
  cat > "$W/in/untamper-inner.sh" <<'EOS'
#!/bin/bash
P=/usr/lib/postgresql/16/bin/psql
"$P" "$AFLDB_OWNER_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c "UPDATE brownlow_round_votes SET votes = votes - 1 WHERE ctid = (SELECT ctid FROM brownlow_round_votes WHERE season = 2026 ORDER BY 1 LIMIT 1)" -c "SELECT 'restored'"
EOS
  RUNDB "$DB" bash "$W/in/tamper-inner.sh" || return 1
  nok B accept "$R" e; local rc=$?
  RUNDB "$DB" bash "$W/in/untamper-inner.sh" || return 1
  [ $rc -eq 0 ] && okc B accept "$R" e
}
p13_final() {
  echo "--- DEV services AFTER (read-only)"; for u in afldb.service postgresql@16-main.service; do echo "$u $(systemctl is-active $u 2>&1) MainPID=$(systemctl show -p MainPID --value $u 2>&1)"; done
  IR stop || true; sleep 2
  ss -ltn | awk '{print $4}' | grep -E ":($PORT)$" && return 1
  du -sh "$W" | tail -1
}
ALL="p0_resources p1_inputs p4_cluster p5_restore_migrate p6_prepare p7_b0 p7_b1 p7_b2 p7_b3 p7_e p8_2026_control p13_final"
PH="${*:-$ALL}"
for ph in $PH; do phase "$ph" "$ph" || { case "$ph" in p0_resources|p1_inputs|p4_cluster|p5_restore_migrate|p6_prepare|p7_b0|p7_b1|p7_b2|p7_b3) say "stage or prerequisite $ph failed: stopping"; break;; esac; }; done
say "DONE"; cat "$SUM"
