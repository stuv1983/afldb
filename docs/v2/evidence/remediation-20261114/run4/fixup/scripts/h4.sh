#!/usr/bin/env bash
# remediation run 4, scope `fixup`: host helper. Usage: bash $W/in/h4.sh <phase> [args]
#   phases: clone cluster tmpl_snap tmpl_rb run <label> <snap|rb> <shared|all> <vitest args...>  fetch <bundle> <ref>  stop
# Everything lives under $W on /mnt/ssd; own loopback cluster on port 55692; databases afldb_v2_rem4fixup*_test only. No sudo.
set -u -o pipefail
export W=/mnt/ssd/afldb-rem4-fixup-20261115
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
export PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_PYTHON=/home/arm/i250/afldb/.venv/bin/python AFLDB_TEST_PYTHON=/home/arm/i250/afldb/.venv/bin/python
export AFLDB_V2_PG_ROOT=${W}-pg AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=55692
export NEXT_TELEMETRY_DISABLED=1
PORT=55692
B4=7cfbe186e70ca91db67da1aa4e28325ccbc32a86
BUNDLE=/mnt/ssd/afldb-rem4-base/base-B4.bundle
BUNDLE_SHA=b1e2491b9739703c2ea3484300e9f7db9b051cba5e1d44fb595e4badb13b7a74
LOCK=/mnt/ssd/afldb-rem4-base/heavy.lock
CAND=$W/cand
E=$W/evidence; mkdir -p "$E"
IN=$W/in
SNAP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
SNAP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
SNAP_BYTES=30141895
RB_DIR=/mnt/ssd/afldb-rem3-base/rebuilt
RB_DUMP=$RB_DIR/afldb_v2_rb_rem3-6d5388ea.dump
RB_SHA=d8397aab92e3ce0cf2a640bb5daeac6594fb0e2c723dc410d82d8e718f165c63
TSNAP=afldb_v2_rem4fixup_snap_tmpl_test
TRB=afldb_v2_rem4fixup_rb_tmpl_test

strip() { sed 's/\x1b\[[0-9;]*m//g' | { grep -a -v -i 'postgres://' || true; }; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
H() { flock "$LOCK" nice -n 10 "$@"; }
pc() { git -C "$CAND" status --porcelain | wc -l; }
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$E/run.log"; }
# read-only psql: Q <db> <sql>
Q() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c 'PGOPTIONS="-c default_transaction_read_only=on" "$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
# read-write psql for SCRATCH copies only: QW <db> <sql>
QW() { local db=$1; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- bash -c '"$AFLDB_V2_PG_BIN/psql" -X -A -t -F"|" -v ON_ERROR_STOP=1 "$AFLDB_TEST_DATABASE_URL" -c "$1"' _ "$*" 2>&1 | { grep -a -v '^isolated-pg:' || true; }); }
tcounts() {
  local db=$1 out=$2 names sql
  names=$(Q "$db" "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1")
  sql=$(echo "$names" | awk 'NF{printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1}')
  Q "$db" "$sql" | tr '|' '\t' | sort > "$out"
  echo "tcounts $db: $(wc -l < "$out") tables -> $out"
}

ph="${1:-}"; shift || true
case "$ph" in
clone)
  [ "$(sha256sum "$BUNDLE" | cut -d' ' -f1)" = "$BUNDLE_SHA" ] || { echo "bundle sha256 mismatch"; exit 1; }
  grep -F "$BUNDLE_SHA" /mnt/ssd/afldb-rem4-base/SHA256SUMS >/dev/null || { echo "bundle sha not in SHA256SUMS"; exit 1; }
  echo "B4 bundle verified sha256 $BUNDLE_SHA"
  [ "$(stat -c %s "$SNAP")" = "$SNAP_BYTES" ] || { echo "snapshot size mismatch"; exit 1; }
  [ "$(sha256sum "$SNAP" | cut -d' ' -f1)" = "$SNAP_SHA" ] || { echo "snapshot sha256 mismatch"; exit 1; }
  echo "snapshot verified: $SNAP_BYTES bytes sha256 $SNAP_SHA"
  ( cd "$RB_DIR" && sha256sum -c SHA256SUMS ) || { echo "rebuilt dir SHA256SUMS check failed"; exit 1; }
  [ "$(sha256sum "$RB_DUMP" | cut -d' ' -f1)" = "$RB_SHA" ] || { echo "rebuilt dump sha256 mismatch"; exit 1; }
  echo "rebuilt dump verified"
  if ss -ltnH 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port in use"; exit 1; fi
  [ ! -e "$CAND" ] || { echo "checkout already exists"; exit 1; }
  git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || exit 1
  cd "$CAND" || exit 1
  git fetch -q "$BUNDLE" claude/remediation-20261114:refs/heads/base || exit 1
  git checkout -q base || exit 1
  echo "HEAD=$(git rev-parse HEAD) want=$B4"
  [ "$(git rev-parse HEAD)" = "$B4" ] || { echo "HEAD MISMATCH"; exit 1; }
  [ ! -e "$CAND/.env" ] || { echo ".env present: refusing"; exit 1; }
  timeout 900 npm ci --no-audit --no-fund 2>&1 | tail -4
  echo "node $(node --version) vitest $(node node_modules/vitest/vitest.mjs --version 2>/dev/null)"
  echo "porcelain lines: $(pc)"
  ;;
fetch)   # fetch <bundle> <ref>: fetch my branch, check it out detached
  b=$1; ref=$2
  cd "$CAND" || exit 1
  git bundle verify "$b" 2>&1 | tail -1
  git fetch -q "$b" "claude/rem4-fixup-20261115:refs/heads/$ref" || exit 1
  git checkout -q "$ref" || exit 1
  echo "HEAD=$(git rev-parse HEAD) branch=$(git branch --show-current) porcelain=$(pc)"
  ;;
cluster)
  [ ! -e "$AFLDB_V2_PG_ROOT" ] || { echo "cluster root already exists"; exit 1; }
  IR init || exit 1
  IR start > "$E/pg-start.out" 2>&1 < /dev/null
  sleep 3
  IR roles && IR status || exit 1
  ss -ltnp 2>/dev/null | grep ":$PORT " | tee "$E/listener.txt"
  PM=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  grep "pid=$PM," "$E/listener.txt" >/dev/null || { echo "the listener on $PORT is not this cluster's postmaster"; exit 1; }
  ;;
tmpl_snap)
  IR create-db "$TSNAP" || exit 1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TSNAP -- node /mnt/ssd/afldb-review-20261114T0640Z/in/restore.mjs $SNAP $SNAP_SHA" 2>&1 | strip | tail -4
  RUNDB "$TSNAP" node --import tsx tools/db/migrate.ts --target test 2>&1 | strip | tail -6
  cp /mnt/ssd/afldb-review-20261114T0640Z/in/probe-dbs.mjs "$CAND/.probe-dbs.mjs"
  RUNDB "$TSNAP" node .probe-dbs.mjs "$TSNAP" | tee "$E/snap-tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$E/snap-tmpl-probe.txt" > /dev/null || { echo "ledger is not 118"; exit 1; }
  IR verify "$TSNAP" 2>&1 | strip | tail -2
  {
    echo "identity of the snapshot template (aggregates only):"
    Q "$TSNAP" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TSNAP" "SELECT 'matches='||count(*)||' players='||(SELECT count(*) FROM players)||' auth_users='||(SELECT count(*) FROM auth_users)||' seasons='||(SELECT count(*) FROM seasons)||' season2026='||coalesce((SELECT status::text FROM seasons WHERE year=2026),'none') FROM matches"
    Q "$TSNAP" "SELECT 'brownlow_season_votes_2026='||count(*) FROM brownlow_season_votes WHERE season=2026"
    Q "$TSNAP" "SELECT 'stat_availability_2026='||coalesce(string_agg(stat_key||':'||coverage::text, ',' ORDER BY stat_key),'none') FROM stat_availability WHERE season=2026 AND stat_key LIKE 'brownlow%'"
  } 2>&1 | tee "$E/snap-template-identity.txt"
  tcounts "$TSNAP" "$E/snap-template.table-counts.tsv"
  ;;
tmpl_rb)
  IR create-db "$TRB" 2>&1 | strip | tail -1
  H timeout 3000 bash -c "cd $CAND && node --import tsx tools/v2/isolated-pg.ts run $TRB -- node $RB_DIR/restore-dump.mjs $RB_DUMP $RB_SHA" 2>&1 | strip | tee "$E/rb-restore.log" | tail -6
  IR verify "$TRB" 2>&1 | strip | tee -a "$E/rb-restore.log" | tail -2
  IR list 2>&1 | strip | grep -F "$TRB" | tee -a "$E/rb-restore.log" || true
  TC=$(ls "$RB_DIR"/*table-counts.tsv | head -1)
  SQLTXT=$(awk -F'\t' 'NF==2 { printf "%sSELECT '\''%s'\'' AS t, count(*)::text AS n FROM public.\"%s\"", (c++ ? " UNION ALL " : ""), $1, $1 }' "$TC")
  Q "$TRB" "$SQLTXT" | tr '|' '\t' | sort > "$E/rb-table-counts.restored.tsv"
  sort "$TC" > "$E/rb-table-counts.published.tsv"
  if diff "$E/rb-table-counts.published.tsv" "$E/rb-table-counts.restored.tsv" > "$E/rb-table-counts.diff"; then say "rebuilt table counts: IDENTICAL to $(basename "$TC") ($(wc -l < "$E/rb-table-counts.restored.tsv") tables)"; else say "rebuilt table counts: DIFFER"; exit 1; fi
  {
    echo "identity of the restored accepted rebuild (aggregates only):"
    Q "$TRB" "SELECT 'ledger_max='||max(name)||' ledger_count='||count(*) FROM afldb_meta.schema_migrations"
    Q "$TRB" "SELECT 'matches='||count(*)||' players='||(SELECT count(*) FROM players)||' auth_users='||(SELECT count(*) FROM auth_users)||' seasons='||(SELECT count(*) FROM seasons)||' season2026='||coalesce((SELECT status::text FROM seasons WHERE year=2026),'none') FROM matches"
    Q "$TRB" "SELECT 'seasons_in_progress='||coalesce(string_agg(year::text, ',' ORDER BY year),'none') FROM seasons WHERE status::text='in_progress'"
    Q "$TRB" "SELECT 'brownlow_season_votes_2026='||count(*) FROM brownlow_season_votes WHERE season=2026"
    Q "$TRB" "SELECT 'stat_availability_2026='||coalesce(string_agg(stat_key||':'||coverage::text, ',' ORDER BY stat_key),'none') FROM stat_availability WHERE season=2026 AND stat_key LIKE 'brownlow%'"
  } 2>&1 | tee "$E/rb-template-identity.txt"
  ;;
run)     # run <label> <snap|rb> <shared|all> <vitest args...>   (fresh copy, per-table counts before/after, drop)
  label=$1; base=$2; mode=$3; shift 3
  [ "$base" = snap ] && tmpl=$TSNAP || tmpl=$TRB
  db="afldb_v2_rem4fixup_${label}_test"
  EV="$E/$label"; mkdir -p "$EV"
  {
  echo "label=$label base=$base mode=$mode db=$db HEAD=$(git -C "$CAND" rev-parse HEAD) porcelain=$(pc)"
  echo "args: $*"
  date -u +%FT%TZ
  IR create-db "$db" --template "$tmpl" 2>&1 | strip | tail -1
  tcounts "$db" "$EV/counts.before.tsv"
  AUQ="SELECT 'AUTH_USERS_%s count='||count(*)||' md5='||coalesce(md5(string_agg(to_jsonb(u)::text,'|' ORDER BY u.id)),'none') FROM auth_users u"
  IDQ="SELECT 'REAL_IDENTITY_%s rows='||count(*)||' md5='||coalesce(md5(string_agg(to_jsonb(e)::text,'|')),'none') FROM external_identities e WHERE e.source_id=(SELECT id FROM sources WHERE key='afl_api') AND e.external_id='CD_I297354'"
  Q "$db" "$(printf "$AUQ" BEFORE)"
  Q "$db" "$(printf "$IDQ" BEFORE)"
  [ -z "${PRESEED:-}" ] || { echo "PRESEED: $PRESEED"; QW "$db" "$PRESEED"; Q "$db" "$(printf "$AUQ" SEEDED)"; }
  cd "$CAND" || exit 1
  set +e
  vt() { # <tag> <vitest args...>
    local tag=$1; shift
    if [ "$mode" = all ]; then
      env AFLDB_TEST_PER_FILE_DB=all AFLDB_TEST_PER_FILE_ADMIN_USER=afldb_v2_super \
          AFLDB_TEST_PER_FILE_ADMIN_PASSWORD_FILE="$AFLDB_V2_PG_ROOT/secrets/superuser.pw" \
          node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
          --reporter=default --reporter=json --outputFile.json="$EV/vitest$tag.json" > "$EV/vitest$tag-raw.log" 2>&1
    else
      node --import tsx tools/v2/isolated-pg.ts run "$db" -- node node_modules/vitest/vitest.mjs run "$@" \
          --reporter=default --reporter=json --outputFile.json="$EV/vitest$tag.json" > "$EV/vitest$tag-raw.log" 2>&1
    fi
    local rc=$?
    echo "vitest$tag start-order file(s): $* rc=$rc ($(date -u +%T))"
    strip < "$EV/vitest$tag-raw.log" > "$EV/vitest$tag.log"
    grep -a -E "Test Files|Tests |Duration" "$EV/vitest$tag.log" | tail -3
    grep -a -E "AssertionError|^Error:|FAIL " "$EV/vitest$tag.log" | head -6
  }
  if [ "${SEQ:-0}" = 1 ]; then
    n=0; for f in "$@"; do n=$((n+1)); vt "-step$n" "$f"; done
  else
    vt "" "$@"
  fi
  tcounts "$db" "$EV/counts.after.tsv"
  if diff "$EV/counts.before.tsv" "$EV/counts.after.tsv" > "$EV/counts.diff"; then echo "COUNTDIFF=0 tables=$(wc -l < "$EV/counts.after.tsv")"; else echo "COUNTDIFF=NONZERO"; cat "$EV/counts.diff"; fi
  Q "$db" "$(printf "$AUQ" AFTER)"
  Q "$db" "$(printf "$IDQ" AFTER)"
  date -u +%FT%TZ
  [ "${KEEP:-0}" = 1 ] || IR drop-db "$db" --acknowledge-destroy "$db" 2>&1 | strip | tail -1
  } 2>&1 | tee "$EV/summary.txt"
  ;;
stop)
  IR stop || true
  sleep 2
  if ss -ltn | awk '{print $4}' | grep -E ":$PORT$"; then echo "port still listening"; exit 1; fi
  echo "no listener on $PORT"; pgrep -u arm -af "$W" || echo "no process matching $W"; du -sh "$W" "$W-pg" | tail -2
  ;;
*) echo "unknown phase '$ph'"; exit 2 ;;
esac
