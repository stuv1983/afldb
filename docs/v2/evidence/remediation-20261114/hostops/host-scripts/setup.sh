#!/usr/bin/env bash
# hostops remediation 2026-11-14: workspace, checkout, isolated cluster (port 55620), production-snapshot template.
# Pattern: the full review's in/review-host.sh (p1_clone, p2_deps, p4_cluster, p5_template). No sudo; touches no DEV service.
# Usage: W=/mnt/ssd/afldb-rem-hostops-20261114 bash setup.sh [phase ...]
set -u -o pipefail
: "${W:?}"
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
DUMP=/mnt/ssd/afldb/workspaces/afldb-issue333-o2-20261104/private/afldb_prod-20261104T021037Z.dump
DUMP_SHA=e77c307d3e0cddcb652e398a946e4c22c2063f13c70edadf96a975c92842826d
DUMP_BYTES=30141895
PORT=55620
BASE=de640826d13489c58392563e7ae1ff62403ed293
EV="$W/evidence"; mkdir -p "$EV" "$W/in"
CAND="$W/cand"
TMPL=afldb_v2_remhostops_tmpl_test
export AFLDB_V2_PG_ROOT="$W/pg-root" AFLDB_V2_PG_BIN=/usr/lib/postgresql/16/bin AFLDB_V2_PG_PORT=$PORT
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$EV/run.log"; }
IR() { (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts "$@"); }
RUNDB() { local db="$1"; shift; (cd "$CAND" && node --import tsx tools/v2/isolated-pg.ts run "$db" -- "$@"); }
listener_is_ours() {
  local pmpid; pmpid=$(head -1 "$AFLDB_V2_PG_ROOT/data/postmaster.pid")
  ss -ltnp 2>/dev/null | grep ":$PORT " > "$EV/listener.txt"
  cat "$EV/listener.txt"; echo "postmaster pid $pmpid"
  [ "$(grep -c "127.0.0.1:$PORT " "$EV/listener.txt")" = 1 ] || { echo "not exactly one listener on 127.0.0.1:$PORT"; return 1; }
  [ "$(grep -c "pid=$pmpid," "$EV/listener.txt")" = 1 ] || { echo "listener is not our postmaster"; return 1; }
}
s0() {
  df -h /mnt/ssd; free -g | sed -n 2p; uptime
  if ss -ltn 2>/dev/null | awk '{print $4}' | grep -E ":$PORT$"; then echo "port $PORT in use"; return 1; fi
  [ "$(stat -c %s "$DUMP")" = "$DUMP_BYTES" ] || { echo "snapshot size mismatch"; return 1; }
  [ "$(sha256sum "$DUMP" | cut -d' ' -f1)" = "$DUMP_SHA" ] || { echo "snapshot sha256 mismatch"; return 1; }
  echo "snapshot verified $DUMP_SHA"
}
s1_clone() {
  [ -d "$CAND/.git" ] || git clone -q /mnt/ssd/afldb-review-20261114T0640Z/cand "$CAND" || return 1
  cd "$CAND" && git -c advice.detachedHead=false checkout -q --detach "$BASE" && echo "HEAD=$(git rev-parse HEAD)"
}
s2_deps() { cd "$CAND" && node -v && npm ci --no-audit --no-fund 2>&1 | tail -5; [ "$(git status --porcelain | wc -l)" = 0 ]; }
s4_cluster() {
  IR init || return 1
  IR start > "$EV/pg-start.out" 2>&1 < /dev/null; sleep 3
  IR roles && IR status || return 1
  listener_is_ours
}
s5_template() {
  IR create-db "$TMPL" || return 1
  RUNDB "$TMPL" node "$W/in/restore.mjs" "$DUMP" "$DUMP_SHA" || return 1
  RUNDB "$TMPL" node --import tsx tools/db/migrate.ts --target test 2>&1 | tail -4
  cp "$W/in/probe-dbs.mjs" "$CAND/.probe-dbs.mjs"
  RUNDB "$TMPL" node .probe-dbs.mjs "$TMPL" | tee "$EV/tmpl-probe.txt"
  rm -f "$CAND/.probe-dbs.mjs"
  grep -q '"ledger":"118_fixtures_unconfirmed_participants.sql"' "$EV/tmpl-probe.txt" || { echo "template ledger is not 118"; return 1; }
}
PH="${*:-s0 s1_clone s2_deps s4_cluster s5_template}"
for ph in $PH; do say "PHASE $ph: start"; "$ph" > "$EV/$ph.log" 2>&1 && say "PHASE $ph: PASS" || { say "PHASE $ph: FAIL"; tail -20 "$EV/$ph.log"; exit 1; }; done
say DONE
